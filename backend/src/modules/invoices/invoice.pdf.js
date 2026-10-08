import { createRequire } from 'node:module';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { amountInWords } from '#core/utils/gst.js';
import { settingsService } from '#services/settings/settings.service.js';

// DejaVu Sans has the ₹ sign, which PDF's built-in fonts don't.
const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONT = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

const PAYMENT_LABELS = {
  razorpay: 'Paid online',
  cod: 'Cash on delivery',
  partial: 'Advance online, balance on delivery',
};

const INK = '#0f172a';
const MUTED = '#64748b';
const RULE = '#cbd5e1';
const FILL = '#f1f5f9';

const money = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const addressLines = (a) =>
  a
    ? [a.line1, a.line2, a.landmark, [a.city, a.state].filter(Boolean).join(', ') + (a.pincode ? ` – ${a.pincode}` : '')].filter(Boolean)
    : [];

/**
 * Renders a GST tax invoice (A4) for one seller's part of an order.
 * @returns {Promise<Buffer>}
 */
export async function renderInvoicePdf(inv) {
  const { siteName } = await settingsService.get('branding');
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: { Title: `Tax invoice ${inv.number}`, Author: inv.seller.name, Creator: siteName },
  });
  doc.registerFont('body', FONT);
  doc.registerFont('bold', FONT_BOLD);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = doc.page.height - doc.page.margins.bottom;
  const text = (s, x, y, opts = {}) => {
    const { font = 'body', size = 8.5, color = INK, ...rest } = opts;
    doc
      .font(font)
      .fontSize(size)
      .fillColor(color)
      .text(s ?? '', x, y, { lineGap: 1, ...rest });
    return doc.y;
  };
  const rule = (y, color = RULE) =>
    doc
      .moveTo(left, y)
      .lineTo(left + width, y)
      .lineWidth(0.6)
      .strokeColor(color)
      .stroke();

  /* ── Header ── */
  let y = doc.page.margins.top;
  text('TAX INVOICE', left, y, { font: 'bold', size: 16, width, align: 'right' });
  text('Original for recipient', left, y + 20, { size: 7.5, color: MUTED, width, align: 'right' });

  const sellerBottom = [
    text(inv.seller.name, left, y, { font: 'bold', size: 12, width: width * 0.6 }),
    inv.seller.businessName && inv.seller.businessName !== inv.seller.name
      ? text(`Store: ${inv.seller.businessName}`, left, doc.y + 1, { color: MUTED, width: width * 0.6 })
      : 0,
    text(addressLines(inv.seller.address).join('\n'), left, doc.y + 2, { width: width * 0.6 }),
    text(inv.seller.gstin ? `GSTIN: ${inv.seller.gstin}` : 'GSTIN: Not registered', left, doc.y + 2, { font: 'bold', width: width * 0.6 }),
  ].pop();
  y = Math.max(sellerBottom, y + 40) + 10;
  rule(y);

  /* ── Invoice facts ── */
  y += 8;
  const facts = [
    ['Invoice no.', inv.number],
    ['Invoice date', date(inv.issuedAt)],
    ['Order no.', inv.orderNumber],
    ['Order date', date(inv.orderDate)],
    ['Payment', PAYMENT_LABELS[inv.paymentMethod] ?? inv.paymentMethod],
    ['Place of supply', inv.placeOfSupply],
  ];
  const colW = width / 3;
  facts.forEach(([label, value], k) => {
    const x = left + (k % 3) * colW;
    const rowY = y + Math.floor(k / 3) * 26;
    text(label, x, rowY, { size: 7.5, color: MUTED });
    text(value, x, rowY + 10, { font: 'bold', width: colW - 8 });
  });
  y += 56;
  rule(y);

  /* ── Bill to / Ship to ── */
  y += 8;
  const half = width / 2;
  const billBottom = [
    text('Bill to', left, y, { size: 7.5, color: MUTED }),
    text(inv.buyer.businessName || inv.buyer.name, left, y + 11, { font: 'bold', width: half - 10 }),
    inv.buyer.businessName ? text(inv.buyer.name, left, doc.y, { width: half - 10 }) : 0,
    text(addressLines(inv.buyer.address).join('\n'), left, doc.y + 1, { width: half - 10 }),
    inv.buyer.gstin ? text(`GSTIN: ${inv.buyer.gstin}`, left, doc.y + 1, { font: 'bold', width: half - 10 }) : doc.y,
  ].pop();
  const shipBottom = [
    text('Ship to', left + half, y, { size: 7.5, color: MUTED }),
    text(inv.shipTo.name, left + half, y + 11, { font: 'bold', width: half }),
    text(addressLines(inv.shipTo.address).join('\n'), left + half, doc.y + 1, { width: half }),
    inv.shipTo.phone ? text(`Phone: ${inv.shipTo.phone}`, left + half, doc.y + 1, { width: half }) : doc.y,
  ].pop();
  y = Math.max(billBottom, shipBottom) + 12;

  /* ── Lines ── */
  const cols = [
    { key: 'n', label: '#', w: 18, align: 'left' },
    { key: 'item', label: 'Item', w: 168, align: 'left' },
    { key: 'hsn', label: 'HSN', w: 44, align: 'left' },
    { key: 'qty', label: 'Qty', w: 28, align: 'right' },
    { key: 'rate', label: 'Rate', w: 56, align: 'right' },
    { key: 'disc', label: 'Discount', w: 46, align: 'right' },
    { key: 'taxable', label: 'Taxable', w: 60, align: 'right' },
    { key: 'gst', label: 'GST', w: 30, align: 'right' },
    { key: 'amount', label: 'Amount', w: width - 450, align: 'right' },
  ];
  const drawRow = (cells, rowY, { font = 'body', fill } = {}) => {
    const heights = cols.map((c) =>
      doc
        .font(font)
        .fontSize(8)
        .heightOfString(String(cells[c.key] ?? ''), { width: c.w - 6 }),
    );
    const h = Math.max(...heights) + 8;
    if (fill) doc.rect(left, rowY, width, h).fill(fill);
    let x = left;
    for (const c of cols) {
      text(String(cells[c.key] ?? ''), x + 3, rowY + 4, { font, size: 8, width: c.w - 6, align: c.align });
      x += c.w;
    }
    return rowY + h;
  };
  const header = Object.fromEntries(cols.map((c) => [c.key, c.label]));
  y = drawRow(header, y, { font: 'bold', fill: FILL });

  const rows = inv.lines.map((l, k) => ({
    n: k + 1,
    item: [l.name, l.variant, l.sku ? `SKU ${l.sku}` : null].filter(Boolean).join('\n'),
    hsn: l.hsnCode ?? '',
    qty: l.quantity,
    rate: money(l.unitPrice),
    disc: l.discount ? money(l.discount) : '—',
    taxable: money(l.taxable),
    gst: `${l.gstRate}%`,
    amount: money(l.amount),
  }));
  if (inv.shipping) {
    rows.push({
      n: rows.length + 1,
      item: 'Delivery charges',
      hsn: '',
      qty: 1,
      rate: money(inv.shipping.amount),
      disc: '—',
      taxable: money(inv.shipping.taxable),
      gst: `${inv.shipping.gstRate}%`,
      amount: money(inv.shipping.amount),
    });
  }
  for (const row of rows) {
    if (y > bottom - 160) {
      doc.addPage();
      y = doc.page.margins.top;
      y = drawRow(header, y, { font: 'bold', fill: FILL });
    }
    y = drawRow(row, y);
    rule(y, '#e2e8f0');
  }

  /* ── Totals ── */
  y += 10;
  const totalsTop = y;
  const totalsX = left + width - 220;
  const totalRows = [
    ['Taxable value', inv.totals.taxable],
    ...(inv.interState
      ? [['IGST', inv.totals.igst]]
      : [
          ['CGST', inv.totals.cgst],
          ['SGST', inv.totals.sgst],
        ]),
  ];
  for (const [label, value] of totalRows) {
    text(label, totalsX, y, { color: MUTED, width: 110 });
    text(money(value), totalsX + 110, y, { width: 110, align: 'right' });
    y += 14;
  }
  doc.rect(totalsX, y, 220, 22).fill(FILL);
  text('Invoice total', totalsX + 6, y + 6, { font: 'bold', size: 10, width: 110 });
  text(money(inv.totals.total), totalsX + 110, y + 6, { font: 'bold', size: 10, width: 104, align: 'right' });
  const totalsBottom = y + 22;

  text('Amount in words', left, totalsTop, { size: 7.5, color: MUTED, width: width - 240 });
  text(amountInWords(inv.totals.total), left, doc.y + 1, { font: 'bold', width: width - 240 });
  text(
    `Prices include GST.${inv.totals.discount ? ` Includes coupon discount of ${money(inv.totals.discount)}.` : ''} Tax payable on reverse charge: No.`,
    left,
    doc.y + 6,
    { size: 7.5, color: MUTED, width: width - 240 },
  );

  /* ── Footer ── */
  y = Math.max(totalsBottom, doc.y) + 30;
  text(`For ${inv.seller.name}`, left + width - 220, y, { font: 'bold', width: 220, align: 'right' });
  text('Authorised signatory', left + width - 220, y + 28, { size: 7.5, color: MUTED, width: 220, align: 'right' });
  rule(bottom - 26);
  // Written inside the bottom margin; lift the margin while doing so, or pdfkit starts a blank page.
  const margin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  text(`Sold by ${inv.seller.name} through ${siteName}. This is a computer-generated invoice.`, left, bottom - 20, {
    size: 7,
    color: MUTED,
    width,
    align: 'center',
    lineBreak: false,
  });
  doc.page.margins.bottom = margin;

  doc.end();
  return done;
}
