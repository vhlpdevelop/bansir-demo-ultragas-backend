import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { isDbConnected } from '../config/db.js';
import { User } from '../modules/users/user.model.js';

/**
 * JWT Authentication Guard
 * Validates Bearer token in Authorization header, checks expiration and signature,
 * and attaches the active User document to req.user.
 */
export async function protect(req, res, next) {
  if (!isDbConnected()) {
    return res.status(503).json({ success: false, message: 'MongoDB indisponível.' });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Faça login para acessar.',
      code: 'UNAUTHORIZED'
    });
  }

  if (!config.jwtSecret) {
    return res.status(500).json({
      success: false,
      message: 'Configuração de autenticação incompleta no servidor (JWT_SECRET ausente).',
      code: 'SERVER_CONFIG_ERROR'
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwtSecret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Sessão expirada. Faça login novamente.',
        code: 'TOKEN_EXPIRED'
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Sessão inválida ou expirada.',
      code: 'INVALID_TOKEN'
    });
  }

  if (!decoded || !decoded.id || !mongoose.isValidObjectId(decoded.id)) {
    return res.status(401).json({
      success: false,
      message: 'Sessão inválida.',
      code: 'INVALID_TOKEN'
    });
  }

  try {
    const user = await User.findById(decoded.id);
    if (!user || !user.active) {
      return res.status(401).json({
        success: false,
        message: 'Conta inexistente ou inativa.',
        code: 'USER_INACTIVE'
      });
    }

    req.user = user;
    return next();
  } catch {
    return res.status(503).json({
      success: false,
      message: 'Não foi possível validar a sessão no MongoDB.',
      code: 'DB_ERROR'
    });
  }
}
