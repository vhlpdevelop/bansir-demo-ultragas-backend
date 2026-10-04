import crypto from 'node:crypto';

function safeEquals(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function protectTerminal(req, res, next) {
  const expected = process.env.TERMINAL_API_TOKEN?.trim();
  if (!expected) {
    return res.status(503).json({
      success: false,
      code: 'TERMINAL_NOT_CONFIGURED',
      message: 'Integração com terminais ainda não configurada no servidor.'
    });
  }
  if (expected.length < 32) {
    return res.status(503).json({
      success: false,
      code: 'TERMINAL_TOKEN_WEAK',
      message: 'TERMINAL_API_TOKEN deve possuir ao menos 32 caracteres.'
    });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!safeEquals(token, expected)) {
    return res.status(401).json({ success: false, code: 'INVALID_TERMINAL_TOKEN', message: 'Credencial do terminal inválida.' });
  }

  req.terminalAudit = {
    terminalId: String(req.headers['x-terminal-id'] || '').trim(),
    operatorId: String(req.headers['x-operator-id'] || '').trim(),
    operatorName: String(req.headers['x-operator-name'] || '').trim()
  };
  if (!req.terminalAudit.terminalId || !req.terminalAudit.operatorId || !req.terminalAudit.operatorName) {
    return res.status(400).json({ success: false, code: 'MISSING_AUDIT_HEADERS', message: 'Identificação do terminal e do operador é obrigatória.' });
  }
  next();
}
