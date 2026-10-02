import { config } from './env.js';

/**
 * Robust CORS configuration supporting environment-defined origins,
 * localhost development, standard HTTP methods, and exposed headers.
 */
export function getCorsOptions() {
  const allowedOriginsEnv = config.corsOrigin || '';
  const parsedOrigins = allowedOriginsEnv
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  return {
    origin: (origin, callback) => {
      // 1. Allow server-to-server, mobile app, CLI or curl requests (no Origin header)
      if (!origin) return callback(null, true);

      // 2. Allow wildcard if configured
      if (parsedOrigins.includes('*')) return callback(null, true);

      // 3. In development or test, allow any localhost/127.0.0.1 origins
      if (config.nodeEnv !== 'production') {
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return callback(null, true);
        }
      }

      // 4. Check explicitly configured origins
      if (parsedOrigins.length > 0) {
        if (parsedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Origem não permitida pela política de CORS: ${origin}`));
      }

      // 5. Default in development or demo if CORS_ORIGIN is unset: allow all origins
      // (ensures local dev and Netlify preview work seamlessly)
      return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Device-Id',
      'Accept',
      'Origin',
      'X-Requested-With'
    ],
    exposedHeaders: [
      'Content-Disposition',
      'Content-Type',
      'Content-Length',
      'X-Total-Count'
    ],
    credentials: true,
    maxAge: 86400 // 24 hours
  };
}
