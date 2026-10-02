import { ZodError } from 'zod';

/**
 * Payload, Query, and Param Validation Middleware using Zod.
 * Can be called with:
 * - validate(schema) -> validates req.body
 * - validate({ body: bodySchema, query: querySchema, params: paramsSchema })
 */
export function validate(schemas) {
  return (req, res, next) => {
    try {
      if (!schemas) return next();

      // If a raw Zod schema is passed directly, treat it as body validator
      if (typeof schemas.parse === 'function') {
        req.body = schemas.parse(req.body);
        return next();
      }

      if (schemas.params && typeof schemas.params.parse === 'function') {
        req.params = schemas.params.parse(req.params);
      }

      if (schemas.query && typeof schemas.query.parse === 'function') {
        req.query = schemas.query.parse(req.query);
      }

      if (schemas.body && typeof schemas.body.parse === 'function') {
        req.body = schemas.body.parse(req.body);
      }

      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues || error.errors || [];
        const formattedErrors = issues.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }));

        return res.status(400).json({
          success: false,
          message: formattedErrors.length > 0 
            ? formattedErrors[0].message 
            : 'Falha na validação dos dados enviados.',
          code: 'VALIDATION_ERROR',
          errors: formattedErrors
        });
      }
      return next(error);
    }
  };
}
