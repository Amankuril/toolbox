/**
 * Uniform success envelope: { success: true, data, meta? }.
 * Errors use { success: false, error } and are produced only by the error handler.
 */
export function ok(res, data = null, meta) {
  return res.status(200).json(meta ? { success: true, data, meta } : { success: true, data });
}

export function created(res, data = null) {
  return res.status(201).json({ success: true, data });
}

export function noContent(res) {
  return res.status(204).end();
}
