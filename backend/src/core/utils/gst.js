/** GST state codes (first two digits of a GSTIN). */
const STATES = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  10: 'Bihar',
  11: 'Sikkim',
  12: 'Arunachal Pradesh',
  13: 'Nagaland',
  14: 'Manipur',
  15: 'Mizoram',
  16: 'Tripura',
  17: 'Meghalaya',
  18: 'Assam',
  19: 'West Bengal',
  20: 'Jharkhand',
  21: 'Odisha',
  22: 'Chhattisgarh',
  23: 'Madhya Pradesh',
  24: 'Gujarat',
  26: 'Dadra and Nagar Haveli and Daman and Diu',
  27: 'Maharashtra',
  29: 'Karnataka',
  30: 'Goa',
  31: 'Lakshadweep',
  32: 'Kerala',
  33: 'Tamil Nadu',
  34: 'Puducherry',
  35: 'Andaman and Nicobar Islands',
  36: 'Telangana',
  37: 'Andhra Pradesh',
  38: 'Ladakh',
};

const key = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z]/g, '');

const ALIASES = {
  orissa: '21',
  pondicherry: '34',
  newdelhi: '07',
  nctofdelhi: '07',
  uttaranchal: '05',
  damananddiu: '26',
  dadraandnagarhaveli: '26',
};
const BY_NAME = { ...Object.fromEntries(Object.entries(STATES).map(([code, name]) => [key(name), code.padStart(2, '0')])), ...ALIASES };

/** "Maharashtra" → "27"; null when the name isn't recognised. */
export const stateCode = (name) => BY_NAME[key(name)] ?? null;

/** "27" → "Maharashtra" */
export const stateName = (code) => STATES[String(code).padStart(2, '0')] ?? STATES[Number(code)] ?? null;

/**
 * Seller's state code: their GSTIN says it authoritatively; else their address.
 * @param {{ gstin?: string, state?: string }} party
 */
export function partyStateCode({ gstin, state }) {
  if (/^\d{2}/.test(gstin ?? '') && stateName(gstin.slice(0, 2))) return gstin.slice(0, 2);
  return stateCode(state);
}

/** Indian financial year (April–March, IST) as "25-26". */
export function financialYear(date = new Date()) {
  const ist = new Date(new Date(date).getTime() + 5.5 * 60 * 60_000);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ''}`;
  return [h ? `${ONES[h]} Hundred` : '', rest].filter(Boolean).join(' ');
}

/** Whole number in the Indian system: 12,34,567 → "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven". */
function indianWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor((n % 1e7) / 1e5);
  const thousand = Math.floor((n % 1e5) / 1e3);
  const rest = n % 1e3;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${below1000(lakh)} Lakh`);
  if (thousand) parts.push(`${below1000(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/** 123450 paise → "Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only" */
export function amountInWords(paise) {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  return `Rupees ${indianWords(rupees)}${p ? ` and ${below1000(p)} Paise` : ''} Only`;
}
