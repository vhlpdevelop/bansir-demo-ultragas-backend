import { ZodError } from 'zod';

export function notFound(req, res, next) {
  const error = new Error(`Rota não encontrada: ${req.originalUrl}`);
  res.status(404);
  next(error);
}

export function errorHandler(err, req, res, next) {
  // 1. Request payload size limit exceeded (HTTP 413)
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      success: false,
      message: 'Tamanho da requisição excede o limite permitido (Payload Too Large). Para notas fiscais e arquivos XML grandes, utilize as rotas dedicadas de importação de NF-e.',
      code: 'PAYLOAD_TOO_LARGE'
    });
  }

  // 2. Malformed JSON syntax in body
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Formato JSON inválido no corpo da requisição.',
      code: 'INVALID_JSON'
    });
  }

  // 3. Zod schema validation errors
  if (err instanceof ZodError) {
    const issues = err.issues || err.errors || [];
    const formattedErrors = issues.map(e => ({
      field: e.path.join('.'),
      message: e.message
    }));

    return res.status(400).json({
      success: false,
      message: formattedErrors.length > 0 ? formattedErrors[0].message : 'Falha na validação dos dados de entrada.',
      code: 'VALIDATION_ERROR',
      errors: formattedErrors
    });
  }

  // 4. CORS errors
  if (err.message && err.message.startsWith('Origem não permitida pela política de CORS')) {
    return res.status(403).json({
      success: false,
      message: err.message,
      code: 'CORS_ERROR'
    });
  }

  const statusCode = (res.statusCode && res.statusCode !== 200) ? res.statusCode : (err.status || 500);

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Erro interno no servidor',
    code: err.code || undefined,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  });
}
