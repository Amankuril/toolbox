import { C, addressLines, brandForPdf, createPdf, date, money } from './pdf.kit.js';
import { PAYMENT_LABELS } from './invoice.pdf.js';

const PAYMENT_STATUS = {
  paid: 'Paid',
  partially_paid: 'Advance paid',
  pending: 'To be paid',
  refunded: 'Refunded',
  partially_refunded: 'Partly refunded',
  failed: 'Failed',
};

/** What's been paid and what's left, by channel. All paise. */
export function paymentBreakdown(order) {
  const { amounts: a, payment } = order;
  const wallet = a.wallet ?? 0;
  const settled = ['paid', 'partially_paid', 'refunded', 'partially_refunded'].includes(payment.status);
  const rows = [];
  if (wallet) rows.push(['Paid from wallet', wallet]);
  if (payment.method === 'razorpay' && settled) rows.push(['Paid online', a.total - wallet]);
  if (payment.method === 'offline' && settled) rows.push(['Paid', a.total - wallet]);
  if (payment.method === 'partial') {
    if (settled) rows.push(['Advance paid online', a.advance ?? 0]);
    rows.push(['To pay on delivery', a.balanceDue ?? a.total - wallet - (a.advance ?? 0)]);
  }
  if (payment.method === 'cod')
    rows.push([order.pickups?.length ? 'To pay on delivery / at pickup' : 'To pay on delivery', a.balanceDue ?? a.total - wallet]);
  return rows;
}

/**
 * The buyer's order confirmation (A4), sent when the order is confirmed. Not a tax invoice: each seller
 * issues that once their items ship.
 * @param order the order document (lean)
 * @param {Map<string, { name: string, gstin?: string }>} sellers by vendor id
 * @returns {Promise<Buffer>}
 */
export async function renderConfirmationPdf(order, sellers) {
  const brand = await brandForPdf();
  const { siteName } = brand;
  const k = createPdf({
    brand,
    runningTitle: `Order ${order.orderNumber}`,
    info: { Title: `Order confirmation ${order.orderNumber}`, Author: siteName, Subject: `Order ${order.orderNumber}` },
  });
  const { doc, left, width, right } = k;
  const a = order.amounts;
  const ship = order.shippingAddress;
  const pickupOf = new Map((order.pickups ?? []).map((p) => [String(p.vendor), p]));
  const vendorIds = [...new Set(order.items.map((i) => String(i.vendor)))];
  const allPickup = vendorIds.every((v) => pickupOf.has(v));
  const units = order.items.reduce((n, i) => n + i.quantity, 0);

  k.header({
    title: 'ORDER CONFIRMATION',
    subtitle: 'Not a tax invoice',
    chip: [
      ['Order no.', order.orderNumber],
      ['Order date', date(order.createdAt)],
    ],
  });

  k.facts([
    ['Items', `${units} ${units === 1 ? 'unit' : 'units'} · ${vendorIds.length} ${vendorIds.length === 1 ? 'seller' : 'sellers'}`],
    ['Payment method', PAYMENT_LABELS[order.payment.method] ?? order.payment.method],
    ['Payment status', PAYMENT_STATUS[order.payment.status] ?? order.payment.status],
    ['Delivery', allPickup ? 'Store pickup' : pickupOf.size ? 'Delivery + store pickup' : 'Home delivery'],
  ]);

  const billName = order.billing?.businessName || order.billing?.name || ship.name;
  k.parties([
    {
      title: 'Billed to',
      name: billName,
      lines: [order.billing?.businessName ? order.billing.name : null, ...addressLines(ship), `Phone: ${ship.phone}`],
      strong: order.billing?.gstin ? `GSTIN: ${order.billing.gstin}` : null,
    },
    {
      title: allPickup ? 'Contact' : 'Deliver to',
      name: ship.name,
      lines: [...(allPickup ? [] : addressLines(ship)), `Phone: ${ship.phone}`],
    },
  ]);

  /* ── Items, grouped by seller ── */
  const cols = [
    { key: 'n', label: '#', w: 22, align: 'center' },
    { key: 'item', label: 'Item description', w: 196, align: 'left' },
    { key: 'qty', label: 'Qty', w: 32, align: 'center' },
    { key: 'rate', label: 'Price', w: 66, align: 'right' },
    { key: 'disc', label: 'Discount', w: 60, align: 'right' },
    { key: 'gst', label: 'GST', w: 40, align: 'right' },
  ];
  cols.push({ key: 'amount', label: 'Amount', w: width - cols.reduce((s, c) => s + c.w, 0), align: 'right' });

  const rows = [];
  let n = 0;
  for (const v of vendorIds) {
    const seller = sellers.get(v);
    const pickup = pickupOf.get(v);
    rows.push({
      section: `Sold by ${seller?.name ?? 'Seller'}${seller?.gstin ? `  ·  GSTIN ${seller.gstin}` : ''}`,
      note: pickup
        ? `Collect from: ${[pickup.name, ...addressLines(pickup)].filter(Boolean).join(', ')}${pickup.hours ? ` (${pickup.hours})` : ''}`
        : null,
    });
    for (const i of order.items.filter((it) => String(it.vendor) === v)) {
      n += 1;
      const cancelled = i.status === 'cancelled';
      rows.push({
        n: String(n),
        item: [
          { text: i.name, font: 'bold', size: 8.2, color: cancelled ? C.MUTED : C.INK },
          i.variant?.title ? { text: i.variant.title, size: 7.2, color: C.MUTED } : null,
          i.sku || i.hsnCode
            ? { text: [i.sku && `SKU: ${i.sku}`, i.hsnCode && `HSN: ${i.hsnCode}`].filter(Boolean).join('   '), size: 7.2, color: C.MUTED }
            : null,
          cancelled ? { text: 'Cancelled', font: 'bold', size: 7.2, color: '#b91c1c' } : null,
        ],
        qty: String(i.quantity),
        rate: [
          { text: money(i.unitPrice) },
          i.unitMrp > i.unitPrice ? { text: `MRP ${money(i.unitMrp)}`, size: 6.8, color: C.MUTED } : null,
        ],
        disc: i.discount ? `-${money(i.discount)}` : '—',
        gst: `${i.gstRate}%`,
        amount: [{ text: money(i.lineTotal), font: 'bold', color: cancelled ? C.MUTED : C.INK }],
      });
    }
  }
  k.table(cols, rows);

  /* ── Totals & payment ── */
  const totalsW = 208;
  const totalsX = right - totalsW;
  const sideW = width - totalsW - 18;
  const payRows = paymentBreakdown(order);
  const next = [
    allPickup
      ? 'We will let you know when your items are ready to collect.'
      : 'Each seller packs and ships their items; you will get tracking details as they ship.',
    'Your GST tax invoice is issued by each seller once their items ship. You can download it any time from My Orders.',
  ].join('\n\n');
  const nextH = k.measure(next, sideW - 20, { size: 7.8 }) + 30;
  const payH = 26 + payRows.length * 16;
  k.ensure(Math.max(payH + 10 + nextH, 4 * 17 + 90) + 16);
  k.y += 16;
  const blockTop = k.y;

  const totalRows = [
    ['Items total', money(a.subtotal)],
    ...(a.discount
      ? [[order.coupon?.code ? `Coupon ${order.coupon.code}` : 'Coupon discount', `-${money(a.discount)}`, { color: C.PRIMARY }]]
      : []),
    ['Delivery charges', a.shipping ? money(a.shipping) : 'Free'],
  ];
  let ty = k.totals(totalsX, blockTop, totalsW, totalRows, ['Order total', money(a.total)]);
  const mrpSavings = order.items.reduce((s, i) => s + Math.max(0, (i.unitMrp - i.unitPrice) * i.quantity), 0) + (a.discount ?? 0);
  if (mrpSavings > 0) {
    k.text(`You saved ${money(mrpSavings)} on this order`, totalsX, ty, {
      font: 'bold',
      size: 7.8,
      color: C.PRIMARY,
      width: totalsW,
      align: 'right',
    });
    ty = doc.y + 2;
  }
  k.text(`Prices include GST${a.tax ? ` of ${money(a.tax)}` : ''}.`, totalsX, ty, {
    size: 7.2,
    color: C.MUTED,
    width: totalsW,
    align: 'right',
  });
  const totalsBottom = doc.y;

  // Left: payment summary.
  let ly = blockTop;
  if (payRows.length) {
    doc.roundedRect(left, ly, sideW, payH, 5).fill(C.TINT);
    k.label('Payment summary', left + 10, ly + 9, { color: C.PRIMARY });
    let py = ly + 22;
    for (const [l, v] of payRows) {
      const due = l.startsWith('To pay');
      k.text(l, left + 10, py, { size: 8, font: due ? 'bold' : 'body', color: due ? C.INK : C.BODY, width: sideW - 120 });
      k.text(money(v), left + sideW - 110, py, { size: 8, font: 'bold', color: C.INK, width: 100, align: 'right' });
      py += 16;
    }
    ly += payH + 10;
  }

  // Left: what happens next.
  doc.roundedRect(left, ly, sideW, nextH, 5).lineWidth(0.7).strokeColor(C.RULE).stroke();
  k.label('What happens next', left + 10, ly + 9, { color: C.PRIMARY });
  k.text(next, left + 10, ly + 20, { size: 7.8, width: sideW - 20 });
  ly += nextH;

  k.y = Math.max(totalsBottom, ly) + 22;
  k.ensure(20);
  k.text(`Thank you for shopping with ${siteName}!`, left, k.y, { font: 'bold', size: 9.5, color: C.PRIMARY, width, align: 'center' });

  return k.finish(`Order confirmation from ${siteName}. Not a tax invoice; sellers issue GST invoices when items ship.`);
}
