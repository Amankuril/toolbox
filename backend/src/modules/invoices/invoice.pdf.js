import { amountInWords } from '#core/utils/gst.js';
import { C, addressLines, brandForPdf, createPdf, date, money } from './pdf.kit.js';

export const PAYMENT_LABELS = {
  razorpay: 'Paid online',
  cod: 'Cash on delivery',
  partial: 'Advance online, balance on delivery',
  offline: 'Paid offline',
  wallet: 'Paid from wallet',
};

/**
 * Renders a GST tax invoice (A4) for one seller's part of an order.
 * @returns {Promise<Buffer>}
 */
export async function renderInvoicePdf(inv) {
  const brand = await brandForPdf();
  const { siteName } = brand;
  const k = createPdf({
    brand,
    runningTitle: `Tax invoice ${inv.number}`,
    info: { Title: `Tax invoice ${inv.number}`, Author: inv.seller.name, Subject: `Order ${inv.orderNumber}` },
  });
  const { doc, left, width, right } = k;

  k.header({
    title: 'TAX INVOICE',
    subtitle: 'Original for recipient',
    chip: [
      ['Invoice no.', inv.number],
      ['Invoice date', date(inv.issuedAt)],
    ],
  });

  k.facts([
    ['Order no.', inv.orderNumber],
    ['Order date', date(inv.orderDate)],
    ['Payment', PAYMENT_LABELS[inv.paymentMethod] ?? inv.paymentMethod],
    ['Place of supply', inv.placeOfSupply],
    ['Supply type', inv.interState ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'],
  ]);

  k.parties([
    {
      title: 'Sold by',
      name: inv.seller.name,
      lines: [
        inv.seller.businessName && inv.seller.businessName !== inv.seller.name ? `Store: ${inv.seller.businessName}` : null,
        ...addressLines(inv.seller.address),
      ],
      strong: inv.seller.gstin ? `GSTIN: ${inv.seller.gstin}` : 'GSTIN: Not registered',
    },
    {
      title: 'Bill to',
      name: inv.buyer.businessName || inv.buyer.name,
      lines: [
        inv.buyer.businessName ? inv.buyer.name : null,
        ...addressLines(inv.buyer.address),
        inv.buyer.phone ? `Phone: ${inv.buyer.phone}` : null,
      ],
      strong: inv.buyer.gstin ? `GSTIN: ${inv.buyer.gstin}` : null,
    },
    {
      title: 'Ship to',
      name: inv.shipTo.name,
      lines: [...addressLines(inv.shipTo.address), inv.shipTo.phone ? `Phone: ${inv.shipTo.phone}` : null],
    },
  ]);

  /* ── Line items ── */
  const cols = [
    { key: 'n', label: '#', w: 22, align: 'center' },
    { key: 'item', label: 'Item description', w: 132, align: 'left' },
    { key: 'hsn', label: 'HSN', w: 50, align: 'center' },
    { key: 'qty', label: 'Qty', w: 28, align: 'center' },
    { key: 'rate', label: 'Rate', w: 62, align: 'right' },
    { key: 'disc', label: 'Discount', w: 56, align: 'right' },
    { key: 'taxable', label: 'Taxable', w: 62, align: 'right' },
    { key: 'gst', label: 'GST', w: 44, align: 'right' },
  ];
  cols.push({ key: 'amount', label: 'Amount', w: width - cols.reduce((s, c) => s + c.w, 0), align: 'right' });

  const rows = inv.lines.map((l, n) => ({
    n: String(n + 1),
    item: [
      { text: l.name, font: 'bold', size: 8.2, color: C.INK },
      l.variant ? { text: l.variant, size: 7.2, color: C.MUTED } : null,
      l.sku ? { text: `SKU: ${l.sku}`, size: 7.2, color: C.MUTED } : null,
    ],
    hsn: l.hsnCode || '—',
    qty: `${l.quantity}${l.unit ? ` ${l.unit}` : ''}`,
    rate: money(l.unitPrice),
    disc: l.discount ? `-${money(l.discount)}` : '—',
    taxable: money(l.taxable),
    gst: [{ text: `${l.gstRate}%` }, { text: money(l.tax), size: 7, color: C.MUTED }],
    amount: [{ text: money(l.amount), font: 'bold', color: C.INK }],
  }));
  if (inv.shipping) {
    rows.push({
      n: String(rows.length + 1),
      item: [
        { text: 'Delivery charges', font: 'bold', size: 8.2, color: C.INK },
        { text: 'Taxed at the main item’s rate', size: 7.2, color: C.MUTED },
      ],
      hsn: '—',
      qty: '1',
      rate: money(inv.shipping.amount),
      disc: '—',
      taxable: money(inv.shipping.taxable),
      gst: [{ text: `${inv.shipping.gstRate}%` }, { text: money(inv.shipping.tax), size: 7, color: C.MUTED }],
      amount: [{ text: money(inv.shipping.amount), font: 'bold', color: C.INK }],
    });
  }
  k.table(cols, rows);

  /* ── Totals & tax summary ── */
  const totalsW = 208;
  const totalsX = right - totalsW;
  const sideW = width - totalsW - 18;

  // GST summary by rate (lines + delivery).
  const byRate = new Map();
  for (const l of [...inv.lines, ...(inv.shipping ? [inv.shipping] : [])]) {
    const g = byRate.get(l.gstRate) ?? { taxable: 0, tax: 0 };
    g.taxable += l.taxable ?? 0;
    g.tax += l.tax ?? 0;
    byRate.set(l.gstRate, g);
  }
  const summary = [...byRate.entries()].sort(([a], [b]) => a - b);
  const totalRows = [
    ['Taxable value', money(inv.totals.taxable)],
    ...(inv.interState
      ? [['IGST', money(inv.totals.igst)]]
      : [
          ['CGST', money(inv.totals.cgst)],
          ['SGST', money(inv.totals.sgst)],
        ]),
  ];
  const words = amountInWords(inv.totals.total);
  const wordsH = k.measure(words, sideW - 20, { font: 'bold', size: 8.5 }) + 30;
  const summaryH = 18 + 16 * (summary.length + 1);
  k.ensure(Math.max(wordsH + 10 + summaryH, totalRows.length * 17 + 80) + 16);
  k.y += 16;
  const blockTop = k.y;

  // Right: totals panel.
  let ty = k.totals(totalsX, blockTop, totalsW, totalRows, ['Grand total', money(inv.totals.total)]);
  if (inv.totals.discount) {
    k.text(`You saved ${money(inv.totals.discount)} on this order`, totalsX, ty, {
      font: 'bold',
      size: 7.8,
      color: C.PRIMARY,
      width: totalsW,
      align: 'right',
    });
    ty = doc.y + 2;
  }
  k.text('All prices include GST.\nTax payable on reverse charge: No.', totalsX, ty, {
    size: 7.2,
    color: C.MUTED,
    width: totalsW,
    align: 'right',
  });
  const totalsBottom = doc.y;

  // Left: amount in words.
  doc.roundedRect(left, blockTop, sideW, wordsH, 5).fill(C.TINT);
  k.label('Amount in words', left + 10, blockTop + 9, { color: C.PRIMARY });
  k.text(words, left + 10, blockTop + 20, { font: 'bold', size: 8.5, color: C.INK, width: sideW - 20 });

  // Left: GST summary table.
  let sy = blockTop + wordsH + 10;
  const sCols = [
    { label: 'GST rate', w: 0.18, align: 'left' },
    { label: 'Taxable value', w: 0.27, align: 'right' },
    { label: inv.interState ? 'IGST' : 'CGST + SGST', w: 0.3, align: 'right' },
    { label: 'Total tax', w: 0.25, align: 'right' },
  ];
  const sRow = (cells, rowY, { head = false, bold = false } = {}) => {
    let x = left;
    cells.forEach((cell, n) => {
      const w = sCols[n].w * sideW;
      const opts = head
        ? { font: 'bold', size: 6.6, color: C.MUTED, characterSpacing: 0.4 }
        : { font: bold ? 'bold' : 'body', size: 7.8, color: bold ? C.INK : C.BODY };
      k.text(head ? cell.toUpperCase() : cell, x + 6, rowY + 4, { ...opts, width: w - 12, align: sCols[n].align, lineBreak: false });
      x += w;
    });
  };
  sRow(
    sCols.map((c) => c.label),
    sy,
    { head: true },
  );
  sy += 16;
  k.hline(sy, left, left + sideW, C.RULE, 0.7);
  for (const [rate, g] of summary) {
    const split = inv.interState ? `${rate}%` : `${rate / 2}% + ${rate / 2}%`;
    sRow([`${rate}%`, money(g.taxable), split, money(g.tax)], sy);
    sy += 16;
    k.hline(sy, left, left + sideW, C.SOFT_RULE, 0.5);
  }
  const totalTax = (inv.totals.igst ?? 0) + (inv.totals.cgst ?? 0) + (inv.totals.sgst ?? 0);
  sRow(['Total', money(inv.totals.taxable), '', money(totalTax)], sy, { bold: true });
  sy += 18;

  k.y = Math.max(totalsBottom, sy) + 18;

  /* ── Declaration & signature ── */
  k.ensure(96);
  const declText =
    'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.';
  const declH = Math.max(k.measure(declText, sideW - 20, { size: 7.8 }) + 34, 78);
  doc.roundedRect(left, k.y, sideW, declH, 5).lineWidth(0.7).strokeColor(C.RULE).stroke();
  k.label('Declaration', left + 10, k.y + 9, { color: C.PRIMARY });
  k.text(declText, left + 10, k.y + 20, { size: 7.8, width: sideW - 20 });

  doc.roundedRect(totalsX, k.y, totalsW, declH, 5).lineWidth(0.7).strokeColor(C.RULE).stroke();
  k.text(`For ${siteName}`, totalsX + 10, k.y + 9, { font: 'bold', size: 8.5, color: C.INK, width: totalsW - 20, align: 'right' });
  k.hline(k.y + declH - 22, totalsX + 60, right - 10, '#94a3b8', 0.6);
  k.text('Authorised signatory', totalsX + 10, k.y + declH - 17, { size: 7.2, color: C.MUTED, width: totalsW - 20, align: 'right' });
  k.y += declH + 14;

  k.ensure(20);
  k.text(`Thank you for shopping with ${siteName}!`, left, k.y, { font: 'bold', size: 9.5, color: C.PRIMARY, width, align: 'center' });

  return k.finish(`Sold by ${inv.seller.name} through ${siteName}. This is a computer-generated invoice.`);
}
