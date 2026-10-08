import { promisify } from 'node:util';
import zlib from 'node:zlib';
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { ApiError } from '#core/errors/ApiError.js';

/** Hard ceilings for an uploaded workbook once unzipped (a 5 MB .xlsx is normally < 40 MB inside). */
const MAX_UNZIPPED_BYTES = 80 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;
const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export const SHEET_FORMATS = ['csv', 'xlsx'];
export const formatOf = (fileName) => (/\.xlsx$/i.test(fileName ?? '') ? 'xlsx' : /\.csv$/i.test(fileName ?? '') ? 'csv' : null);

const unsupported = (message) => ApiError.badRequest(message, { code: 'UNSUPPORTED_FILE' });

const inflateRaw = promisify(zlib.inflateRaw);

/**
 * Refuses archives that would inflate beyond the limit ("zip bombs") before ExcelJS sees them.
 * The sizes an archive declares are written by whoever made it, so each entry is actually inflated
 * with a hard output cap: a bomb fails at the cap instead of after filling memory.
 * ZIP64 isn't needed for spreadsheets this size.
 */
export async function assertSafeZip(buffer) {
  const minEocd = 22;
  let eocd = -1;
  for (let i = buffer.length - minEocd; i >= Math.max(0, buffer.length - minEocd - 0xffff); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw unsupported('This Excel file is damaged. Open it in Excel and save it again.');
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (entries > MAX_ZIP_ENTRIES || offset === 0xffffffff) throw unsupported('This Excel file is too complex to import.');

  const tooLarge = () => unsupported('This Excel file is too large to import. Split it into smaller files.');
  const damaged = () => unsupported('This Excel file is damaged.');
  let total = 0;
  let declared = 0;
  for (let n = 0; n < entries; n += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw damaged();
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const declaredSize = buffer.readUInt32LE(offset + 24);
    const localHeader = buffer.readUInt32LE(offset + 42);
    if (declaredSize === 0xffffffff || compressedSize === 0xffffffff) throw tooLarge();
    declared += declaredSize;
    if (declared > MAX_UNZIPPED_BYTES) throw tooLarge(); // cheap early reject for honest-but-huge archives
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);

    if (localHeader + 30 > buffer.length || buffer.readUInt32LE(localHeader) !== 0x04034b50) throw damaged();
    const dataStart = localHeader + 30 + buffer.readUInt16LE(localHeader + 26) + buffer.readUInt16LE(localHeader + 28);
    if (dataStart + compressedSize > buffer.length) throw damaged();

    const remaining = MAX_UNZIPPED_BYTES - total;
    if (method === 0) {
      total += compressedSize;
    } else if (method === 8) {
      try {
        total += (await inflateRaw(buffer.subarray(dataStart, dataStart + compressedSize), { maxOutputLength: remaining + 1 })).length;
      } catch (err) {
        throw err?.code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError ? tooLarge() : damaged();
      }
    } else {
      throw unsupported('This Excel file uses an unsupported compression. Open it in Excel and save it again.');
    }
    if (total > MAX_UNZIPPED_BYTES) throw tooLarge();
  }
}

/** Excel cell value → the text a person typed (formulas give their result, dates become YYYY-MM-DD). */
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value.richText)) return value.richText.map((r) => r.text ?? '').join('');
  if ('result' in value) return cellText(value.result);
  if ('hyperlink' in value) return /^https?:\/\//i.test(value.text ?? '') ? value.text : (value.hyperlink ?? cellText(value.text));
  if ('text' in value) return cellText(value.text);
  if ('error' in value) return '';
  return String(value);
}

/**
 * Reads the uploaded file into rows of strings (header first). For workbooks the "Products"
 * sheet is used, or the first sheet when there isn't one.
 */
export async function readSheet(buffer, fileName, { maxRows }) {
  const format = formatOf(fileName);
  if (format === 'csv') {
    // A CSV is text; NUL bytes mean a binary file (e.g. .xls renamed to .csv).
    if (buffer.includes(0)) throw unsupported('This is not a CSV file. Save the sheet as CSV or Excel (.xlsx) and try again.');
    try {
      const rows = parseCsv(buffer, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: false, to: maxRows });
      // Undo toCsv's formula guard so exported files round-trip unchanged.
      return rows.map((row) => row.map((cell) => (/^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell)));
    } catch (err) {
      throw ApiError.unprocessable(`This file isn't valid CSV (line ${err.lines ?? '?'}): ${String(err.message).slice(0, 160)}`, {
        code: 'INVALID_FILE',
      });
    }
  }
  if (format === 'xlsx') {
    if (!buffer.subarray(0, 4).equals(XLSX_MAGIC))
      throw unsupported('This is not an Excel (.xlsx) file. Old .xls files: open in Excel and save as .xlsx.');
    await assertSafeZip(buffer);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer);
    } catch {
      throw unsupported('This Excel file could not be read. Open it in Excel and save it again as .xlsx.');
    }
    const sheet = workbook.getWorksheet('Products') ?? workbook.worksheets[0];
    if (!sheet) return [];
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= maxRows) return;
      // row.values is 1-based and sparse.
      const values = [];
      for (let c = 1; c <= row.cellCount; c += 1) values.push(cellText(row.getCell(c).value));
      rows.push(values);
    });
    return rows;
  }
  throw unsupported('Upload a .csv or .xlsx file.');
}

/* ─────────────── Writing ─────────────── */

/**
 * Spreadsheet apps run cells that start with = + - @ as formulas, so a product name like
 * `=HYPERLINK(...)` would execute for whoever opens the export. Such text cells get a leading
 * apostrophe (shown as text), which readSheet strips again when the file is re-imported.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const neutralise = (cell) => (typeof cell === 'string' && FORMULA_START.test(cell) ? `'${cell}` : cell);

export const toCsv = (rows) =>
  stringify(
    rows.map((row) => (Array.isArray(row) ? row.map(neutralise) : row)),
    { bom: true },
  );

/**
 * Builds an .xlsx. `sheets`: [{ name, rows, header?: { required: Set }, widths?, textColumns?, lists?, freeze? }]
 * `lists` maps a column key to an inline list or a range ("Categories!$A$2:$A$90") for dropdowns.
 */
export async function toXlsx(sheets) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  for (const spec of sheets) {
    const ws = workbook.addWorksheet(spec.name, { views: spec.freeze ? [{ state: 'frozen', ySplit: 1 }] : [] });
    const [header, ...body] = spec.rows;
    const keys = spec.keys ?? header;
    ws.columns = header.map((h, i) => ({
      header: h,
      key: keys[i],
      width: spec.widths?.[keys[i]] ?? Math.min(48, Math.max(12, String(h).length + 4)),
    }));
    for (const key of spec.textColumns ?? []) {
      const col = ws.getColumn(key);
      // Keep codes like HSN "0402" or long barcodes as typed (no scientific notation).
      if (col) col.numFmt = '@';
    }
    body.forEach((r) => ws.addRow(r));
    const headRow = ws.getRow(1);
    headRow.font = { bold: true, color: { argb: 'FF0F172A' } };
    headRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    headRow.eachCell((cell, i) => {
      if (spec.required?.has(keys[i - 1])) cell.font = { bold: true, color: { argb: 'FFB91C1C' } };
      if (spec.notes?.[keys[i - 1]]) cell.note = spec.notes[keys[i - 1]];
    });
    const lastRow = (spec.validationRows ?? 5000) + 1;
    for (const [key, list] of Object.entries(spec.lists ?? {})) {
      const index = keys.indexOf(key);
      if (index < 0) continue;
      const letter = ws.getColumn(index + 1).letter;
      ws.dataValidations.add(`${letter}2:${letter}${lastRow}`, {
        type: 'list',
        allowBlank: true,
        formulae: [Array.isArray(list) ? `"${list.join(',')}"` : list],
        showErrorMessage: true,
        errorStyle: 'warning',
        error: 'Pick a value from the list',
      });
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
