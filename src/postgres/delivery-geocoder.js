import { createHash } from 'node:crypto';
import { httpError } from './database.js';

function formatPhotonLabel(props = {}) {
  const streetLine = [props.street || props.name, props.housenumber].filter(Boolean).join(', ');
  const parts = [streetLine, props.district || props.suburb, props.city || props.county, props.state, props.postcode]
    .map(v => String(v || '').trim())
    .filter(Boolean);
  return parts.filter((part, index) => parts.indexOf(part) === index).join(' - ') || 'Endereço encontrado';
}

async function readJsonBody(response) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 512000) {
      await reader.cancel();
      throw Error('RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

export function createDeliveryGeocoder({
  key = process.env.DELIVERY_ORS_API_KEY || '',
  transport = fetch,
  clock = () => Date.now(),
  enableFallback = true
} = {}) {
  const cache = new Map();
  const pending = new Map();
  let minute = [];
  let count = 0;
  let start = clock();
  let blocked = 0;
  let heigitBlocked = 0;

  async function searchHeigit(address, origin, now) {
    if (!key) return { ok: false, rateLimited: false };
    if (now < heigitBlocked) return { ok: false, rateLimited: false };
    const url = new URL('https://api.heigit.org/pelias/v1/search');
    url.searchParams.set('text', address);
    url.searchParams.set('boundary.country', 'BRA');
    url.searchParams.set('size', '3');
    if (origin) {
      url.searchParams.set('focus.point.lat', String(origin.latitude));
      url.searchParams.set('focus.point.lon', String(origin.longitude));
    }
    try {
      const r = await transport(url, {
        headers: { Authorization: key, Accept: 'application/geo+json, application/json' },
        signal: AbortSignal.timeout(8000),
        redirect: 'error'
      });
      if (!r.ok) {
        const rateLimited = [403, 429].includes(r.status);
        heigitBlocked = now + (rateLimited ? 900000 : 60000);
        await r.body?.cancel();
        return { ok: false, rateLimited };
      }
      const data = await readJsonBody(r);
      const features = Array.isArray(data.features) ? data.features : [];
      const value = features
        .slice(0, 3)
        .filter(
          f =>
            f.geometry?.type === 'Point' &&
            f.geometry.coordinates?.length >= 2 &&
            f.geometry.coordinates.slice(0, 2).every(Number.isFinite) &&
            Math.abs(f.geometry.coordinates[0]) <= 180 &&
            Math.abs(f.geometry.coordinates[1]) <= 90
        )
        .map(f => ({
          latitude: f.geometry.coordinates[1],
          longitude: f.geometry.coordinates[0],
          label: String(f.properties?.label || 'Endereço encontrado').slice(0, 300)
        }));
      return { ok: true, value };
    } catch {
      heigitBlocked = now + 30000;
      return { ok: false, rateLimited: false };
    }
  }

  async function searchPhoton(address, origin) {
    if (!enableFallback) return { ok: false, rateLimited: false };
    const url = new URL('https://photon.komoot.io/api/');
    const query = /\bbrasil\b/i.test(address) ? address : `${address}, Brasil`;
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '5');
    if (origin) {
      url.searchParams.set('lat', String(origin.latitude));
      url.searchParams.set('lon', String(origin.longitude));
    }
    try {
      const r = await transport(url, {
        headers: { Accept: 'application/geo+json, application/json' },
        signal: AbortSignal.timeout(8000),
        redirect: 'error'
      });
      if (!r.ok) {
        const rateLimited = [403, 429].includes(r.status);
        await r.body?.cancel();
        return { ok: false, rateLimited };
      }
      const data = await readJsonBody(r);
      const features = Array.isArray(data.features) ? data.features : [];
      const value = features
        .filter(f => {
          const cc = f.properties?.countrycode;
          return (
            (!cc || String(cc).toUpperCase() === 'BR') &&
            f.geometry?.type === 'Point' &&
            f.geometry.coordinates?.length >= 2 &&
            f.geometry.coordinates.slice(0, 2).every(Number.isFinite) &&
            Math.abs(f.geometry.coordinates[0]) <= 180 &&
            Math.abs(f.geometry.coordinates[1]) <= 90
          );
        })
        .slice(0, 3)
        .map(f => ({
          latitude: f.geometry.coordinates[1],
          longitude: f.geometry.coordinates[0],
          label: formatPhotonLabel(f.properties).slice(0, 300)
        }));
      return { ok: true, value };
    } catch {
      return { ok: false, rateLimited: false };
    }
  }

  return {
    async search(address, origin, scope) {
      if (!key && !enableFallback) {
        throw httpError(503, 'Busca por endereço indisponível. Use sua localização ou ajuste o mapa.', 'GEOCODER_UNAVAILABLE');
      }
      const hash = createHash('sha256').update(JSON.stringify([scope, address.toLowerCase(), origin])).digest('hex');
      const old = cache.get(hash);
      if (old && clock() < old.expires) return old.value;
      if (pending.has(hash)) return pending.get(hash);

      const now = clock();
      if (now - start >= 86400000) {
        count = 0;
        start = now;
      }
      minute = minute.filter(t => now - t < 60000);
      if (now < blocked || minute.length >= 20 || count >= 500) {
        throw httpError(429, 'Busca temporariamente limitada. Ajuste o ponto no mapa ou tente novamente mais tarde.', 'GEOCODER_LIMIT');
      }
      minute.push(now);
      count++;

      const job = (async () => {
        const primary = await searchHeigit(address, origin, now);
        let value = primary.ok ? primary.value : null;

        if (!primary.ok) {
          const fallback = await searchPhoton(address, origin);
          if (fallback.ok) {
            value = fallback.value;
          } else {
            if (primary.rateLimited || fallback.rateLimited) {
              blocked = now + 900000;
            }
            throw httpError(503, 'Não foi possível localizar esse endereço agora. Use sua localização ou ajuste o mapa.', 'GEOCODER_UNAVAILABLE');
          }
        }

        if (cache.size >= 256) cache.delete(cache.keys().next().value);
        cache.set(hash, { expires: clock() + 300000, value });
        return value;
      })().finally(() => pending.delete(hash));

      pending.set(hash, job);
      return job;
    }
  };
}
