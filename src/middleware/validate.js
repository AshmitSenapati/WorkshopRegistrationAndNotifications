import { ValidationError } from '../utils/errors.js';

export function validate(schema) {
  return async (req, res, next) => {
    try {
      if (schema.body) {
        req.body = await schema.body.parseAsync(req.body);
      }
      if (schema.params) {
        req.params = await schema.params.parseAsync(req.params);
      }
      if (schema.query) {
        const parsed = await schema.query.parseAsync(req.query);
        req.validatedQuery = parsed;
        for (const key of Object.keys(parsed)) {
          req.query[key] = parsed[key];
        }
      }
      next();
    } catch (err) {
      const issues = err.issues || err.errors;
      if (issues && Array.isArray(issues)) {
        const details = issues.map((e) => ({
          path: Array.isArray(e.path) ? e.path.join('.') : String(e.path || ''),
          message: e.message,
        }));
        return next(new ValidationError('Request validation failed', details));
      }
      next(err);
    }
  };
}

export default validate;
