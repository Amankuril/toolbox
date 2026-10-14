/**
 * The HSN code and GST rate a product filed in category `id` inherits: for each, the nearest category up
 * the tree that sets it (mirrors the API). `categories` is a flat list with `ancestors` and `tax`.
 *
 * @returns {{ hsnCode: string|null, gstRate: number|null, hsnFrom: string|null, gstFrom: string|null }}
 */
export function inheritedTax(categories, id) {
  const out = { hsnCode: null, gstRate: null, hsnFrom: null, gstFrom: null }
  const byId = new Map((categories ?? []).map((c) => [String(c._id), c]))
  const category = byId.get(String(id))
  if (!category) return out
  const chain = [...(category.ancestors ?? []).map((a) => byId.get(String(a?._id ?? a))), category]
  for (const c of chain) {
    if (c?.tax?.hsnCode) Object.assign(out, { hsnCode: c.tax.hsnCode, hsnFrom: c.name })
    if (c?.tax?.gstRate != null) Object.assign(out, { gstRate: c.tax.gstRate, gstFrom: c.name })
  }
  return out
}

/** A category's `tax` as form values ('' = not set) and back. */
export const taxToForm = (tax) => ({ hsnCode: tax?.hsnCode ?? '', gstRate: tax?.gstRate != null ? String(tax.gstRate) : '' })
export const taxPayload = (v) => ({ hsnCode: v?.hsnCode || null, gstRate: v?.gstRate === '' || v?.gstRate == null ? null : Number(v.gstRate) })
