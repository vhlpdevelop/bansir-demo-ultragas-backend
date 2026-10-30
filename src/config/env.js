import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Deployment variables take priority; only the backend .env is loaded locally.
const loadedPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: loadedPath });

export const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGINS || '',
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '500', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
  authRateLimitMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '20', 10),
  bodyLimitGeneral: process.env.BODY_LIMIT_GENERAL || '500kb',
  bodyLimitXml: process.env.BODY_LIMIT_XML || '15mb',
  loadedEnvPath: loadedPath
};
