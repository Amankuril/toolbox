/** Short unit labels for prices: "₹1,350/pc". */
export const unitShort = (unit) =>
  ({ piece: 'pc', pair: 'pair', set: 'set', box: 'box', pack: 'pack', kg: 'kg', litre: 'L', metre: 'm', roll: 'roll' })[unit] ?? unit ?? 'pc'

export const unitPlural = (unit, n) => {
  const u = unit ?? 'piece'
  if (n === 1) return u
  return { box: 'boxes', kg: 'kg' }[u] ?? `${u}s`
}
