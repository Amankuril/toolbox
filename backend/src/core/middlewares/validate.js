import { z } from 'zod';

/**
 * Validates and coerces req.body / req.query / req.params with Zod.
 * Parsed values replace the originals, so handlers only ever see clean data
 * (unknown keys are stripped, which also blocks `$`-operator injection into Mongo filters).
 *
 * @param {{ body?: z.ZodType, query?: z.ZodType, params?: z.ZodType }} schemas
 */
export function validate(schemas) {
  const shape = {};
  for (const key of ['body', 'query', 'params']) {
    if (schemas[key]) shape[key] = schemas[key];
  }
  const schema = z.object(shape);

  return async (req, _res, next) => {
    const parsed = await schema.parseAsync({ body: req.body ?? {}, query: req.query, params: req.params });
    if (parsed.body !== undefined) req.body = parsed.body;
    // Express 5 exposes req.query as a getter, so it has to be redefined rather than assigned.
    if (parsed.query !== undefined) {
      Object.defineProperty(req, 'query', { value: parsed.query, writable: true, configurable: true, enumerable: true });
    }
    if (parsed.params !== undefined) req.params = parsed.params;
    next();
  };
}
