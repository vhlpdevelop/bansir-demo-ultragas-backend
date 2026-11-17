import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliveryGeocoder } from '../src/postgres/delivery-geocoder.js';

test('geocoding is bounded, cached, scoped and sends its key only server-side', async () => {
  let calls = 0;
  const service = createDeliveryGeocoder({
    key: 'private-key',
    transport: async (url, options) => {
      calls++;
      assert.equal(url.origin, 'https://api.heigit.org');
      assert.equal(url.pathname, '/pelias/v1/search');
      assert.equal(url.searchParams.get('boundary.country'), 'BRA');
      assert.ok(!url.href.includes('private-key'));
      assert.equal(options.headers.Authorization, 'private-key');
      return Response.json({
        features: [{ geometry: { type: 'Point', coordinates: [-56.48, -21.12] }, properties: { label: 'Praça pública' } }]
      });
    }
  });
  const a = await Promise.all([service.search('Praça teste', null, 'a'), service.search('Praça teste', null, 'a')]);
  assert.equal(calls, 1);
  assert.equal(a[0][0].latitude, -21.12);
  assert.equal(JSON.stringify(a).includes('private-key'), false);
  await service.search('Praça teste', null, 'b');
  assert.equal(calls, 2);
});

test('falls back to Photon when HeiGIT returns HTTP 500 and pauses retries to HeiGIT during cooldown', async () => {
  let now = 1000000;
  let heigitCalls = 0;
  let photonCalls = 0;
  const service = createDeliveryGeocoder({
    key: 'private-key',
    clock: () => now,
    transport: async url => {
      if (url.origin === 'https://api.heigit.org') {
        heigitCalls++;
        return new Response('proxy error', { status: 500 });
      }
      photonCalls++;
      assert.equal(url.origin, 'https://photon.komoot.io');
      return Response.json({
        features: [
          {
            geometry: { type: 'Point', coordinates: [-56.49, -21.13] },
            properties: {
              street: 'Rua Coronel Pilad Rebuá',
              housenumber: '100',
              district: 'Centro',
              city: 'Bonito',
              state: 'MS',
              countrycode: 'BR'
            }
          }
        ]
      });
    }
  });

  const first = await service.search('Rua Coronel Pilad Rebuá, Bonito MS', null, 'a');
  assert.equal(first[0].latitude, -21.13);
  assert.match(first[0].label, /Rua Coronel Pilad Rebuá, 100/);
  assert.equal(heigitCalls, 1);
  assert.equal(photonCalls, 1);

  now += 5000;
  const second = await service.search('Outra rua, Bonito MS', null, 'a');
  assert.equal(second.length, 1);
  assert.equal(heigitCalls, 1);
  assert.equal(photonCalls, 2);
});

test('unavailable provider never leaks its response and backs off cleanly when rate limited', async () => {
  let count = 0;
  const service = createDeliveryGeocoder({
    key: 'x',
    transport: async () => {
      count++;
      return new Response('private-provider-error', { status: 403 });
    }
  });
  await assert.rejects(
    service.search('Rua teste', null, 'a'),
    e => e.code === 'GEOCODER_UNAVAILABLE' && !e.message.includes('private-provider')
  );
  await assert.rejects(service.search('Outra rua', null, 'a'), e => e.code === 'GEOCODER_LIMIT');
  assert.equal(count, 2);
});

test('5xx errors on both providers return GEOCODER_UNAVAILABLE without misleading GEOCODER_LIMIT', async () => {
  const service = createDeliveryGeocoder({
    key: 'x',
    transport: async () => new Response('upstream 500', { status: 500 })
  });
  await assert.rejects(service.search('Rua teste', null, 'a'), e => e.code === 'GEOCODER_UNAVAILABLE');
  await assert.rejects(service.search('Outra rua', null, 'a'), e => e.code === 'GEOCODER_UNAVAILABLE');
});
