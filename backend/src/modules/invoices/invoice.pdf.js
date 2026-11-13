import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { amountInWords } from '#core/utils/gst.js';
import { settingsService } from '#services/settings/settings.service.js';

// DejaVu Sans has the ₹ sign, which PDF's built-in fonts don't.
const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONT = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

// The storefront's default logo, cropped for print. An admin-uploaded storefront logo replaces it.
const DEFAULT_LOGO = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets/logo.jpg'));
const BUILT_IN_LOGO_URL = '/toolboxlogo.jpeg';

const PAYMENT_LABELS = {
  razorpay: 'Paid online',
  cod: 'Cash on delivery',
  partial: 'Advance online, balance on delivery',
};

// Brand palette (matches the storefront theme).
const PRIMARY = '#1e5b38';
const ACCENT = '#f5c518';
const TINT = '#eef5f0';
const ZEBRA = '#f7faf8';
const INK = '#0f172a';
const BODY = '#334155';
const MUTED = '#64748b';
const RULE = '#d7e2db';

const MARGIN = 36;
const FOOTER_H = 44;

const money = (paise) => `₹${((paise ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const addressLines = (a) =>
  a
    ? [a.line1, a.line2, a.landmark, [a.city, a.state].filter(Boolean).join(', ') + (a.pincode ? ` – ${a.pincode}` : '')].filter(Boolean)
    : [];

/* ─────────────── Logo ─────────────── */

const logoCache = new Map();

/** The uploaded storefront logo as PNG (pdfkit reads only PNG/JPEG), or the built-in one. Never throws. */
async function loadLogo(url) {
  if (!url || url === BUILT_IN_LOGO_URL) return DEFAULT_LOGO;
  if (logoCache.has(url)) return logoCache.get(url);
  let logo = DEFAULT_LOGO;
  try {
    let source;
    const publicPrefix = `${env.LOCAL_UPLOAD_PUBLIC_PATH}/`;
    if (url.startsWith(publicPrefix)) {
      const file = path.resolve(env.LOCAL_UPLOAD_DIR, decodeURIComponent(url.slice(publicPrefix.length).split('?')[0]));
      if (!file.startsWith(env.LOCAL_UPLOAD_DIR + path.sep)) throw new Error('Logo path outside the upload folder');
      source = await readFile(file);
    } else if (/^https?:\/\//i.test(url)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`Logo download failed (${res.status})`);
      source = Buffer.from(await res.arrayBuffer());
    } else {
      throw new Error('Unsupported logo URL');
    }
    logo = await sharp(source).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch (err) {
    logger.warn({ err, url }, 'Invoice logo could not be loaded; using the default');
  }
  logoCache.set(url, logo);
  return logo;
}

/* ─────────────── Renderer ─────────────── */

/**
 * Renders a GST tax invoice (A4) for one seller's part of an order.
 * @returns {Promise<Buffer>}
 */
export async function renderInvoicePdf(inv) {
  const branding = await settingsService.get('branding');
  const { siteName, supportEmail, supportPhone } = branding;
  const logo = await loadLogo(branding.modules?.user?.logo?.url);

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: FOOTER_H + 12 },
    bufferPages: true,
    info: { Title: `Tax invoice ${inv.number}`, Author: inv.seller.name, Creator: siteName, Subject: `Order ${inv.orderNumber}` },
  });
  doc.registerFont('body', FONT);
  doc.registerFont('bold', FONT_BOLD);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageW = doc.page.width;
  const left = MARGIN;
  const width = pageW - MARGIN * 2;
  const right = left + width;
  const contentBottom = doc.page.height - FOOTER_H - 12;

  /** Writes text and returns the y below it. */
  const text = (s, x, y, opts = {}) => {
    const { font = 'body', size = 8.5, color = BODY, ...rest } = opts;
    doc
      .font(font)
      .fontSize(size)
      .fillColor(color)
      .text(s ?? '', x, y, { lineGap: 1.2, ...rest });
    return doc.y;
  };
  const measure = (s, w, { font = 'body', size = 8.5, ...rest } = {}) =>
    doc
      .font(font)
      .fontSize(size)
      .heightOfString(String(s ?? ''), { width: w, lineGap: 1.2, ...rest });
  const hline = (y, x1 = left, x2 = right, color = RULE, lw = 0.6) =>
    doc.moveTo(x1, y).lineTo(x2, y).lineWidth(lw).strokeColor(color).stroke();
  const label = (s, x, y, opts = {}) =>
    text(s.toUpperCase(), x, y, { font: 'bold', size: 6.6, color: MUTED, characterSpacing: 0.6, ...opts });

  const brandStripe = () => {
    doc.rect(0, 0, pageW, 6).fill(PRIMARY);
    doc.rect(0, 6, pageW, 2).fill(ACCENT);
  };

  /* ── Header ── */
  brandStripe();
  let y = 26;
  const logoH = 78;
  // "Ordered via", then the logo (it carries the name and tagline), then the support contacts.
  label('Ordered via', left, y);
  doc.image(doc.openImage(logo), left, y + 11, { fit: [240, 58], align: 'left', valign: 'center' });
  const contact = [supportEmail, supportPhone].filter(Boolean).join('   ·   ');
  if (contact) text(contact, left, y + 74, { size: 7.5, color: PRIMARY, width: width * 0.55, lineBreak: false });

  // Title + invoice number on the right.
  const metaW = 190;
  const metaX = right - metaW;
  text('TAX INVOICE', metaX, y + 2, { font: 'bold', size: 20, color: PRIMARY, width: metaW, align: 'right', characterSpacing: 1 });
  text('Original for recipient', metaX, y + 27, { size: 7.2, color: MUTED, width: metaW, align: 'right' });
  const chipY = y + 42;
  doc.roundedRect(metaX + 20, chipY, metaW - 20, 30, 4).fill(TINT);
  const numW = (metaW - 20) * 0.58;
  const dateX = metaX + 20 + numW;
  const dateW = metaW - 20 - numW - 8;
  label('Invoice no.', metaX + 28, chipY + 5);
  text(inv.number, metaX + 28, chipY + 14, { font: 'bold', size: 8.5, color: INK, width: numW, lineBreak: false });
  label('Invoice date', dateX, chipY + 5, { width: dateW, align: 'right' });
  text(date(inv.issuedAt), dateX, chipY + 14, { font: 'bold', size: 8.5, color: INK, width: dateW, align: 'right', lineBreak: false });

  y += logoH + 14;
  hline(y, left, right, RULE, 0.8);

  /* ── Order facts ── */
  y += 10;
  const facts = [
    ['Order no.', inv.orderNumber],
    ['Order date', date(inv.orderDate)],
    ['Payment', PAYMENT_LABELS[inv.paymentMethod] ?? inv.paymentMethod],
    ['Place of supply', inv.placeOfSupply],
    ['Supply type', inv.interState ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'],
  ];
  const factW = width / facts.length;
  const factH = Math.max(...facts.map(([, v]) => measure(v, factW - 16, { font: 'bold', size: 8 }))) + 26;
  doc.roundedRect(left, y, width, factH, 5).fill(TINT);
  facts.forEach(([l, v], k) => {
    const x = left + k * factW;
    if (k)
      doc
        .moveTo(x, y + 8)
        .lineTo(x, y + factH - 8)
        .lineWidth(0.6)
        .strokeColor('#cfe0d5')
        .stroke();
    label(l, x + 8, y + 8, { width: factW - 16 });
    text(v ?? '—', x + 8, y + 18, { font: 'bold', size: 8, color: INK, width: factW - 16 });
  });
  y += factH + 14;

  /* ── Parties ── */
  const gap = 10;
  const cardW = (width - gap * 2) / 3;
  const parties = [
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
      strong: null,
    },
  ];
  const pad = 10;
  const innerW = cardW - pad * 2 - 3;
  const cardBody = (p) =>
    [
      measure(p.name, innerW, { font: 'bold', size: 9.5 }),
      measure(p.lines.filter(Boolean).join('\n'), innerW, { size: 8 }),
      p.strong ? measure(p.strong, innerW, { font: 'bold', size: 8 }) + 3 : 0,
    ].reduce((a, b) => a + b, 0);
  const cardH = Math.max(...parties.map(cardBody)) + 34;
  parties.forEach((p, k) => {
    const x = left + k * (cardW + gap);
    doc.roundedRect(x, y, cardW, cardH, 5).lineWidth(0.7).strokeColor(RULE).stroke();
    doc.rect(x, y + 8, 3, cardH - 16).fill(k === 0 ? PRIMARY : ACCENT);
    const tx = x + pad + 3;
    label(p.title, tx, y + 9, { color: PRIMARY });
    let cy = text(p.name, tx, y + 20, { font: 'bold', size: 9.5, color: INK, width: innerW });
    cy = text(p.lines.filter(Boolean).join('\n'), tx, cy + 1, { size: 8, width: innerW });
    if (p.strong) text(p.strong, tx, cy + 3, { font: 'bold', size: 8, color: INK, width: innerW });
  });
  y += cardH + 16;

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
  const cellPad = 4;

  // A cell is a string, or a list of styled runs stacked one under another.
  const runs = (cell) => (Array.isArray(cell) ? cell.filter((r) => r && r.text) : [{ text: String(cell ?? '') }]);
  const cellHeight = (cell, w) => runs(cell).reduce((h, r) => h + measure(r.text, w, { font: r.font, size: r.size ?? 7.8 }), 0);

  const drawHeader = (rowY) => {
    doc.roundedRect(left, rowY, width, 22, 4).fill(PRIMARY);
    let x = left;
    for (const c of cols) {
      text(c.label.toUpperCase(), x + cellPad, rowY + 7.5, {
        font: 'bold',
        size: 6.5,
        color: '#ffffff',
        width: c.w - cellPad * 2,
        align: c.align,
        characterSpacing: 0.3,
        lineBreak: false,
      });
      x += c.w;
    }
    return rowY + 22;
  };
  const rowHeight = (row) => Math.max(...cols.map((c) => cellHeight(row[c.key], c.w - cellPad * 2))) + cellPad * 2 + 2;
  const drawRow = (row, rowY, zebra) => {
    const h = rowHeight(row);
    if (zebra) doc.rect(left, rowY, width, h).fill(ZEBRA);
    let x = left;
    for (const c of cols) {
      let cy = rowY + cellPad + 1;
      for (const r of runs(row[c.key])) {
        cy = text(r.text, x + cellPad, cy, {
          font: r.font,
          size: r.size ?? 7.8,
          color: r.color ?? BODY,
          width: c.w - cellPad * 2,
          align: c.align,
        });
      }
      x += c.w;
    }
    hline(rowY + h, left, right, '#e3ebe6', 0.5);
    return rowY + h;
  };

  /** Starts a new page (with the brand stripe and a short running header) when `h` won't fit. */
  const ensure = (h, { tableHeader = false } = {}) => {
    if (y + h <= contentBottom) return;
    doc.addPage();
    brandStripe();
    y = 22;
    text(`${siteName}  ·  Tax invoice ${inv.number}`, left, y, { font: 'bold', size: 8, color: PRIMARY, width, lineBreak: false });
    text(`Order ${inv.orderNumber}`, left, y, { size: 8, color: MUTED, width, align: 'right', lineBreak: false });
    y += 20;
    if (tableHeader) y = drawHeader(y);
  };

  const rows = inv.lines.map((l, k) => ({
    n: String(k + 1),
    item: [
      { text: l.name, font: 'bold', size: 8.2, color: INK },
      l.variant ? { text: l.variant, size: 7.2, color: MUTED } : null,
      l.sku ? { text: `SKU: ${l.sku}`, size: 7.2, color: MUTED } : null,
    ],
    hsn: l.hsnCode || '—',
    qty: `${l.quantity}${l.unit ? ` ${l.unit}` : ''}`,
    rate: money(l.unitPrice),
    disc: l.discount ? `-${money(l.discount)}` : '—',
    taxable: money(l.taxable),
    gst: [{ text: `${l.gstRate}%` }, { text: money(l.tax), size: 7, color: MUTED }],
    amount: [{ text: money(l.amount), font: 'bold', color: INK }],
  }));
  if (inv.shipping) {
    rows.push({
      n: String(rows.length + 1),
      item: [
        { text: 'Delivery charges', font: 'bold', size: 8.2, color: INK },
        { text: 'Taxed at the main item’s rate', size: 7.2, color: MUTED },
      ],
      hsn: '—',
      qty: '1',
      rate: money(inv.shipping.amount),
      disc: '—',
      taxable: money(inv.shipping.taxable),
      gst: [{ text: `${inv.shipping.gstRate}%` }, { text: money(inv.shipping.tax), size: 7, color: MUTED }],
      amount: [{ text: money(inv.shipping.amount), font: 'bold', color: INK }],
    });
  }

  ensure(22 + rowHeight(rows[0] ?? {}));
  y = drawHeader(y);
  rows.forEach((row, k) => {
    ensure(rowHeight(row), { tableHeader: true });
    y = drawRow(row, y, k % 2 === 1);
  });

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
  const wordsH = measure(amountInWords(inv.totals.total), sideW - 20, { font: 'bold', size: 8.5 }) + 30;
  const summaryH = 18 + 16 * (summary.length + 1);
  const blockH = Math.max(wordsH + 10 + summaryH, totalRows.length * 17 + 70);
  ensure(blockH + 16);
  y += 16;
  const blockTop = y;

  // Right: totals panel.
  let ty = blockTop;
  for (const [l, v] of totalRows) {
    text(l, totalsX + 8, ty + 3, { size: 8.5, color: MUTED, width: 100 });
    text(v, totalsX + 100, ty + 3, { size: 8.5, color: INK, width: totalsW - 108, align: 'right' });
    ty += 17;
    hline(ty, totalsX, right, '#e3ebe6', 0.5);
  }
  ty += 6;
  doc.roundedRect(totalsX, ty, totalsW, 32, 5).fill(ACCENT);
  doc.roundedRect(totalsX, ty, totalsW, 30, 5).fill(PRIMARY);
  text('Grand total', totalsX + 10, ty + 9, { font: 'bold', size: 10, color: '#ffffff', width: 100 });
  text(money(inv.totals.total), totalsX + 90, ty + 8, { font: 'bold', size: 12, color: '#ffffff', width: totalsW - 100, align: 'right' });
  ty += 40;
  if (inv.totals.discount) {
    text(`You saved ${money(inv.totals.discount)} on this order`, totalsX, ty, {
      font: 'bold',
      size: 7.8,
      color: PRIMARY,
      width: totalsW,
      align: 'right',
    });
    ty = doc.y + 2;
  }
  text('All prices include GST.\nTax payable on reverse charge: No.', totalsX, ty, {
    size: 7.2,
    color: MUTED,
    width: totalsW,
    align: 'right',
  });
  const totalsBottom = doc.y;

  // Left: amount in words.
  doc.roundedRect(left, blockTop, sideW, wordsH, 5).fill(TINT);
  label('Amount in words', left + 10, blockTop + 9, { color: PRIMARY });
  text(amountInWords(inv.totals.total), left + 10, blockTop + 20, { font: 'bold', size: 8.5, color: INK, width: sideW - 20 });

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
    cells.forEach((cell, k) => {
      const w = sCols[k].w * sideW;
      const opts = head
        ? { font: 'bold', size: 6.6, color: MUTED, characterSpacing: 0.4 }
        : { font: bold ? 'bold' : 'body', size: 7.8, color: bold ? INK : BODY };
      text(head ? cell.toUpperCase() : cell, x + 6, rowY + 4, { ...opts, width: w - 12, align: sCols[k].align, lineBreak: false });
      x += w;
    });
  };
  sRow(
    sCols.map((c) => c.label),
    sy,
    { head: true },
  );
  sy += 16;
  hline(sy, left, left + sideW, RULE, 0.7);
  for (const [rate, g] of summary) {
    const split = inv.interState ? `${rate}%` : `${rate / 2}% + ${rate / 2}%`;
    sRow([`${rate}%`, money(g.taxable), split, money(g.tax)], sy);
    sy += 16;
    hline(sy, left, left + sideW, '#e3ebe6', 0.5);
  }
  const totalTax = (inv.totals.igst ?? 0) + (inv.totals.cgst ?? 0) + (inv.totals.sgst ?? 0);
  sRow(['Total', money(inv.totals.taxable), '', money(totalTax)], sy, { bold: true });
  sy += 18;

  y = Math.max(totalsBottom, sy) + 18;

  /* ── Declaration & signature ── */
  ensure(96);
  const declW = width - totalsW - 18;
  const declText =
    'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.';
  const declH = Math.max(measure(declText, declW - 20, { size: 7.8 }) + 34, 78);
  doc.roundedRect(left, y, declW, declH, 5).lineWidth(0.7).strokeColor(RULE).stroke();
  label('Declaration', left + 10, y + 9, { color: PRIMARY });
  text(declText, left + 10, y + 20, { size: 7.8, width: declW - 20 });

  doc.roundedRect(totalsX, y, totalsW, declH, 5).lineWidth(0.7).strokeColor(RULE).stroke();
  text(`For ${siteName}`, totalsX + 10, y + 9, { font: 'bold', size: 8.5, color: INK, width: totalsW - 20, align: 'right' });
  hline(y + declH - 22, totalsX + 60, right - 10, '#94a3b8', 0.6);
  text('Authorised signatory', totalsX + 10, y + declH - 17, { size: 7.2, color: MUTED, width: totalsW - 20, align: 'right' });
  y += declH + 14;

  ensure(20);
  text(`Thank you for shopping with ${siteName}!`, left, y, { font: 'bold', size: 9.5, color: PRIMARY, width, align: 'center' });

  /* ── Footer on every page ── */
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Written inside the bottom margin; lift the margin while doing so, or pdfkit starts a blank page.
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - FOOTER_H;
    hline(fy, left, right, RULE, 0.7);
    text(`Sold by ${inv.seller.name} through ${siteName}. This is a computer-generated invoice.`, left, fy + 8, {
      size: 7,
      color: MUTED,
      width: width - 80,
      lineBreak: false,
    });
    if (contact) text(`Customer support: ${contact}`, left, fy + 19, { size: 7, color: MUTED, width: width - 80, lineBreak: false });
    text(`Page ${i - range.start + 1} of ${range.count}`, right - 80, fy + 8, {
      size: 7,
      color: MUTED,
      width: 80,
      align: 'right',
      lineBreak: false,
    });
    doc.rect(0, doc.page.height - 4, pageW, 4).fill(PRIMARY);
    doc.page.margins.bottom = margin;
  }

  doc.end();
  return done;
}
