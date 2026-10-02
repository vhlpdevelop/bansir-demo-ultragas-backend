import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';

/**
 * General API Rate Limiter
 * Protects endpoints from DDoS, scraper bots, and abusive traffic.
 */
export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => {
    // Skip during automated tests or for internal health check
    if (process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
      return true;
    }
    return req.path === '/api/health';
  },
  handler: (req, res, next, options) => {
    res.status(options.statusCode).json({
      success: false,
      message: 'Muitas requisições originadas deste IP. Por favor, aguarde alguns instantes antes de tentar novamente.',
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }
});

/**
 * Strict Rate Limiter for Authentication (Brute-Force Protection)
 * Limits failed login attempts per IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.authRateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failed logins towards brute force block
  skip: (req) => {
    if (process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
      return true;
    }
    return false;
  },
  handler: (req, res, next, options) => {
    res.status(429).json({
      success: false,
      message: 'Muitas tentativas de autenticação incorretas. Por segurança, tente novamente em 15 minutos.',
      code: 'AUTH_RATE_LIMIT_EXCEEDED'
    });
  }
});

/**
 * Dedicated Rate Limiter for Heavy XML / NF-e Operations
 * Parsing large XML files consumes memory and CPU; rate limit ensures server stability.
 */
export const xmlImportRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => {
    if (process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
      return true;
    }
    return false;
  },
  handler: (req, res, next, options) => {
    res.status(429).json({
      success: false,
      message: 'Limite de processamento de XML atingido para este IP. Aguarde antes de enviar novos arquivos.',
      code: 'XML_RATE_LIMIT_EXCEEDED'
    });
  }
});
