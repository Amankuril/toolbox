import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { settingsService } from '#services/settings/settings.service.js';

/**
 * Shared look for the PDFs sent to buyers (tax invoice, order confirmation): brand stripe, logo header,
 * info bar, party cards, a paginating table and a footer on every page.
 */

// DejaVu Sans has the ₹ sign, which PDF's built-in fonts don't.
const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONT = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

// The storefront's default logo, trimmed for print. An admin-uploaded storefront logo replaces it.
export const DEFAULT_LOGO = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets/logo.jpg'));
const BUILT_IN_LOGO_URLS = new Set(['/toolshub-logo.png', '/toolboxlogo.jpeg']);

// Brand palette (matches the storefront theme).
export const C = {
  PRIMARY: '#1e5b38',
  ACCENT: '#f5c518',
  TINT: '#eef5f0',
  ZEBRA: '#f7faf8',
  INK: '#0f172a',
  BODY: '#334155',
  MUTED: '#64748b',
  RULE: '#d7e2db',
  SOFT_RULE: '#e3ebe6',
};

const MARGIN = 36;
const FOOTER_H = 44;

export const money = (paise) => `₹${((paise ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const date = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
export const addressLines = (a) =>
  a
    ? [a.line1, a.line2, a.landmark, [a.city, a.state].filter(Boolean).join(', ') + (a.pincode ? ` – ${a.pincode}` : '')].filter(Boolean)
    : [];

/* ─────────────── Logo ─────────────── */

const logoCache = new Map();

/** The uploaded storefront logo as PNG (pdfkit reads only PNG/JPEG), or the built-in one. Never throws. */
async function loadLogo(url) {
  if (!url || BUILT_IN_LOGO_URLS.has(url)) return DEFAULT_LOGO;
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
    logo = await sharp(source).resize({ width: 900, height: 480, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch (err) {
    logger.warn({ err, url }, 'PDF logo could not be loaded; using the default');
  }
  logoCache.set(url, logo);
  return logo;
}

/** Store name, contacts and logo for the PDF header and footer. */
export async function brandForPdf() {
  const branding = await settingsService.get('branding');
  return {
    siteName: branding.siteName,
    contact: [branding.supportEmail, branding.supportPhone].filter(Boolean).join('   ·   '),
    logo: await loadLogo(branding.modules?.user?.logo?.url),
  };
}

/* ─────────────── Document ─────────────── */

/**
 * Opens an A4 document with the brand fonts and drawing helpers.
 * `kit.y` is the running cursor; blocks advance it.
 */
export function createPdf({ info, brand, runningTitle }) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: FOOTER_H + 12 },
    bufferPages: true,
    info: { Creator: brand.siteName, ...info },
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

  const kit = {
    doc,
    left,
    width,
    right,
    y: MARGIN,

    /** Writes text and returns the y below it. */
    text(s, x, y, opts = {}) {
      const { font = 'body', size = 8.5, color = C.BODY, ...rest } = opts;
      doc
        .font(font)
        .fontSize(size)
        .fillColor(color)
        .text(s ?? '', x, y, { lineGap: 1.2, ...rest });
      return doc.y;
    },
    measure(s, w, { font = 'body', size = 8.5, ...rest } = {}) {
      return doc
        .font(font)
        .fontSize(size)
        .heightOfString(String(s ?? ''), { width: w, lineGap: 1.2, ...rest });
    },
    hline(y, x1 = left, x2 = right, color = C.RULE, lw = 0.6) {
      doc.moveTo(x1, y).lineTo(x2, y).lineWidth(lw).strokeColor(color).stroke();
    },
    label(s, x, y, opts = {}) {
      return kit.text(s.toUpperCase(), x, y, { font: 'bold', size: 6.6, color: C.MUTED, characterSpacing: 0.6, ...opts });
    },
    brandStripe() {
      doc.rect(0, 0, pageW, 6).fill(C.PRIMARY);
      doc.rect(0, 6, pageW, 2).fill(C.ACCENT);
    },

    /** Starts a new page (brand stripe + a short running header) when `h` won't fit. Returns true if it did. */
    ensure(h, onNewPage) {
      if (kit.y + h <= contentBottom) return false;
      doc.addPage();
      kit.brandStripe();
      kit.y = 22;
      kit.text(`${brand.siteName}  ·  ${runningTitle}`, left, kit.y, { font: 'bold', size: 8, color: C.PRIMARY, width, lineBreak: false });
      kit.y += 20;
      onNewPage?.();
      return true;
    },

    /** Logo on the left; title, subtitle and a two-value chip (e.g. number + date) on the right. */
    header({ title, subtitle, chip }) {
      kit.brandStripe();
      const y = 26;
      kit.label('Ordered via', left, y);
      doc.image(doc.openImage(brand.logo), left, y + 11, { fit: [240, 58], align: 'left', valign: 'center' });
      if (brand.contact) kit.text(brand.contact, left, y + 74, { size: 7.5, color: C.PRIMARY, width: width * 0.55, lineBreak: false });

      const metaW = 200;
      const metaX = right - metaW;
      // Shrink long titles to fit on one line.
      const titleW = metaW + 60;
      let titleSize = 20;
      while (titleSize > 13 && doc.font('bold').fontSize(titleSize).widthOfString(title, { characterSpacing: 1 }) > titleW)
        titleSize -= 0.5;
      kit.text(title, metaX - 60, y + 2 + (20 - titleSize) * 0.6, {
        font: 'bold',
        size: titleSize,
        color: C.PRIMARY,
        width: titleW,
        align: 'right',
        characterSpacing: 1,
        lineBreak: false,
      });
      if (subtitle) kit.text(subtitle, metaX, y + 27, { size: 7.2, color: C.MUTED, width: metaW, align: 'right' });
      const chipY = y + 42;
      const chipX = metaX + 10;
      const chipW = metaW - 10;
      doc.roundedRect(chipX, chipY, chipW, 30, 4).fill(C.TINT);
      const [[l1, v1], [l2, v2]] = chip;
      const firstW = chipW * 0.58;
      const secondX = chipX + firstW;
      const secondW = chipW - firstW - 8;
      kit.label(l1, chipX + 8, chipY + 5);
      kit.text(v1, chipX + 8, chipY + 14, { font: 'bold', size: 8.5, color: C.INK, width: firstW, lineBreak: false });
      kit.label(l2, secondX, chipY + 5, { width: secondW, align: 'right' });
      kit.text(v2, secondX, chipY + 14, { font: 'bold', size: 8.5, color: C.INK, width: secondW, align: 'right', lineBreak: false });

      kit.y = y + 78 + 14;
      kit.hline(kit.y, left, right, C.RULE, 0.8);
      kit.y += 10;
    },

    /** A tinted bar of label/value pairs. */
    facts(pairs) {
      const factW = width / pairs.length;
      const h = Math.max(...pairs.map(([, v]) => kit.measure(v, factW - 16, { font: 'bold', size: 8 }))) + 26;
      doc.roundedRect(left, kit.y, width, h, 5).fill(C.TINT);
      pairs.forEach(([l, v], k) => {
        const x = left + k * factW;
        if (k)
          doc
            .moveTo(x, kit.y + 8)
            .lineTo(x, kit.y + h - 8)
            .lineWidth(0.6)
            .strokeColor('#cfe0d5')
            .stroke();
        kit.label(l, x + 8, kit.y + 8, { width: factW - 16 });
        kit.text(v ?? '—', x + 8, kit.y + 18, { font: 'bold', size: 8, color: C.INK, width: factW - 16 });
      });
      kit.y += h + 14;
    },

    /** Side-by-side address cards: { title, name, lines, strong }. */
    parties(cards) {
      const gap = 10;
      const cardW = (width - gap * (cards.length - 1)) / cards.length;
      const pad = 10;
      const innerW = cardW - pad * 2 - 3;
      const body = (p) =>
        kit.measure(p.name, innerW, { font: 'bold', size: 9.5 }) +
        kit.measure(p.lines.filter(Boolean).join('\n'), innerW, { size: 8 }) +
        (p.strong ? kit.measure(p.strong, innerW, { font: 'bold', size: 8 }) + 3 : 0);
      const h = Math.max(...cards.map(body)) + 34;
      cards.forEach((p, k) => {
        const x = left + k * (cardW + gap);
        doc.roundedRect(x, kit.y, cardW, h, 5).lineWidth(0.7).strokeColor(C.RULE).stroke();
        doc.rect(x, kit.y + 8, 3, h - 16).fill(k === 0 ? C.PRIMARY : C.ACCENT);
        const tx = x + pad + 3;
        kit.label(p.title, tx, kit.y + 9, { color: C.PRIMARY });
        let cy = kit.text(p.name, tx, kit.y + 20, { font: 'bold', size: 9.5, color: C.INK, width: innerW });
        cy = kit.text(p.lines.filter(Boolean).join('\n'), tx, cy + 1, { size: 8, width: innerW });
        if (p.strong) kit.text(p.strong, tx, cy + 3, { font: 'bold', size: 8, color: C.INK, width: innerW });
      });
      kit.y += h + 16;
    },

    /**
     * A table with a brand-coloured header row, zebra rows and page breaks that repeat the header.
     * A cell is a string or a list of styled runs ({ text, font, size, color }) stacked vertically.
     * A row may be { section: 'Title', note } for a full-width group heading.
     */
    table(cols, rows) {
      const cellPad = 4;
      const runs = (cell) => (Array.isArray(cell) ? cell.filter((r) => r && r.text) : [{ text: String(cell ?? '') }]);
      const cellH = (cell, w) => runs(cell).reduce((h, r) => h + kit.measure(r.text, w, { font: r.font, size: r.size ?? 7.8 }), 0);
      const rowH = (row) =>
        row.section
          ? 22 + (row.note ? kit.measure(row.note, width - 16, { size: 7.2 }) : 0)
          : Math.max(...cols.map((c) => cellH(row[c.key], c.w - cellPad * 2))) + cellPad * 2 + 2;
      const drawHeader = () => {
        doc.roundedRect(left, kit.y, width, 22, 4).fill(C.PRIMARY);
        let x = left;
        for (const c of cols) {
          kit.text(c.label.toUpperCase(), x + cellPad, kit.y + 7.5, {
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
        kit.y += 22;
      };
      kit.ensure(22 + rowH(rows[0] ?? {}));
      drawHeader();
      let zebra = false;
      for (const row of rows) {
        const h = rowH(row);
        kit.ensure(h, drawHeader);
        if (row.section) {
          kit.text(row.section, left + 8, kit.y + 8, { font: 'bold', size: 8, color: C.PRIMARY, width: width - 16 });
          if (row.note) kit.text(row.note, left + 8, doc.y + 1, { size: 7.2, color: C.MUTED, width: width - 16 });
          kit.y += h;
          kit.hline(kit.y, left, right, C.RULE, 0.6);
          zebra = false;
          continue;
        }
        if (zebra) doc.rect(left, kit.y, width, h).fill(C.ZEBRA);
        let x = left;
        for (const c of cols) {
          let cy = kit.y + cellPad + 1;
          for (const r of runs(row[c.key])) {
            cy = kit.text(r.text, x + cellPad, cy, {
              font: r.font,
              size: r.size ?? 7.8,
              color: r.color ?? C.BODY,
              width: c.w - cellPad * 2,
              align: c.align,
            });
          }
          x += c.w;
        }
        kit.y += h;
        kit.hline(kit.y, left, right, C.SOFT_RULE, 0.5);
        zebra = !zebra;
      }
    },

    /** Label/value rows ending in a big brand-coloured total. Returns the y below it. */
    totals(x, y, w, rows, total) {
      let ty = y;
      for (const [l, v, opts = {}] of rows) {
        kit.text(l, x + 8, ty + 3, { size: 8.5, color: opts.color ?? C.MUTED, width: w - 110 });
        kit.text(v, x + w - 110, ty + 3, { size: 8.5, color: opts.color ?? C.INK, font: opts.font, width: 102, align: 'right' });
        ty += 17;
        kit.hline(ty, x, x + w, C.SOFT_RULE, 0.5);
      }
      ty += 6;
      doc.roundedRect(x, ty, w, 32, 5).fill(C.ACCENT);
      doc.roundedRect(x, ty, w, 30, 5).fill(C.PRIMARY);
      kit.text(total[0], x + 10, ty + 9, { font: 'bold', size: 10, color: '#ffffff', width: 100 });
      kit.text(total[1], x + 90, ty + 8, { font: 'bold', size: 12, color: '#ffffff', width: w - 100, align: 'right' });
      return ty + 40;
    },

    /** Footer lines + "Page x of y" on every page, then the finished PDF. */
    async finish(footerLine) {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        // Written inside the bottom margin; lift the margin while doing so, or pdfkit starts a blank page.
        const margin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        const fy = doc.page.height - FOOTER_H;
        kit.hline(fy, left, right, C.RULE, 0.7);
        kit.text(footerLine, left, fy + 8, { size: 7, color: C.MUTED, width: width - 80, lineBreak: false });
        if (brand.contact) {
          kit.text(`Customer support: ${brand.contact}`, left, fy + 19, { size: 7, color: C.MUTED, width: width - 80, lineBreak: false });
        }
        kit.text(`Page ${i - range.start + 1} of ${range.count}`, right - 80, fy + 8, {
          size: 7,
          color: C.MUTED,
          width: 80,
          align: 'right',
          lineBreak: false,
        });
        doc.rect(0, doc.page.height - 4, pageW, 4).fill(C.PRIMARY);
        doc.page.margins.bottom = margin;
      }
      doc.end();
      return done;
    },
  };
  return kit;
}
