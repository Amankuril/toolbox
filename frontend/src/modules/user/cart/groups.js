/**
 * Cart lines grouped the way the order will be split: one parcel per seller.
 * Guests don't get seller names, so their lines form a single unnamed group.
 */
export function groupBySeller(items, sellers) {
  const groups = new Map()
  for (const line of items) {
    const key = sellers && line.vendor ? String(line.vendor) : '_'
    if (!groups.has(key)) groups.set(key, { key, seller: sellers?.[key] ?? null, lines: [] })
    groups.get(key).lines.push(line)
  }
  return [...groups.values()]
}

/** Slowest dispatch among a group's lines: the parcel leaves when its last item is ready. */
export function dispatchOf(lines) {
  const days = lines.map((l) => l.product?.dispatchDays).filter((d) => d != null)
  return days.length ? Math.max(...days) : null
}
