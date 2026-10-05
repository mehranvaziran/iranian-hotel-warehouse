/**
 * Document-number convention, shared by the front-end forms.
 *
 * A document number is `{R|H}-{Jalali YYMMDD}-{seq}` — the same rule the backend
 * enforces in `backend/src/utils/docNumber.js`. The head is fixed by the
 * document's date, so a form shows it as read-only context and offers only the
 * sequence for the user to change.
 *
 * The six digits in the middle are a *Jalali* YYMMDD, never a Gregorian one;
 * the two calendars with the same digits are decades apart, which is exactly why
 * the number is self-describing about which calendar the document's date is in.
 * The API rejects a number whose embedded date is not the document's own `tarikh`.
 */

import { normalizeJalaliDate, isValidJalaliDate } from './jalali';

export const RECEIPT_PREFIX = 'R';
export const ISSUE_PREFIX = 'H';

const DOC_NUMBER_RE = /^([RH])-(\d{6})-(\d+)$/;

/**
 * The date-bearing head of a document number, e.g. `H-050701-`.
 *
 * The date is canonicalised first: `1405/7/1` is a real day the user typed, and
 * reading the digits straight off it yields a four-digit head (`0571`) and an
 * unusable number. Padding the fields keeps the head whole for any valid date.
 *
 * The head appears only for a date that is a *real day*. While the user is still
 * typing — `1405/06/`, `1405/0/17` — there is no day to encode, so the bare
 * prefix is shown rather than a head built from digits that are not a date yet.
 * This is what keeps an incomplete date from leaving the form: `RegExp.exec`
 * returning no match must not be read as an array.
 *
 * @param {'R'|'H'} prefix
 * @param {string} jalaliDate - any recognisable Jalali date
 */
export function docNumberHead(prefix, jalaliDate) {
  const normalised = normalizeJalaliDate(jalaliDate);
  if (!isValidJalaliDate(normalised)) return `${prefix}-`;
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalised);
  if (!m) return `${prefix}-`;
  const yy = m[1].slice(2);
  return `${prefix}-${yy}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}-`;
}

/**
 * Assemble a full document number from a kind, a Jalali date and a sequence.
 * @param {'R'|'H'} prefix
 * @param {string} jalaliDate
 * @param {string|number} seq - the editable tail
 * @returns {string} e.g. 'H-050617-4'
 */
export function formatDocNumber(prefix, jalaliDate, seq) {
  return `${docNumberHead(prefix, jalaliDate)}${seq}`;
}

/** True when `value` follows the convention end to end. */
export function isValidDocNumber(value) {
  return DOC_NUMBER_RE.test(String(value ?? '').trim());
}

/**
 * The editable sequence tail of a document number, or '' when the value does not
 * yet follow the convention.
 */
export function docNumberSequence(value) {
  const m = DOC_NUMBER_RE.exec(String(value ?? '').trim());
  return m ? m[3] : '';
}

/**
 * Ask the API for the next sequence number for a kind and date. Returns the
 * sequence only — the head is derived from the date locally, so the two can
 * never disagree.
 *
 * @param {'receipt'|'issue'} kind
 * @param {string} jalaliDate
 * @returns {Promise<string>} e.g. '174'
 */
export async function suggestDocSequence(kind, jalaliDate) {
  const url = `/api/doc-numbers/suggest/${kind}?tarikh=${encodeURIComponent(jalaliDate)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('خطا در دریافت شماره پیشنهادی');
  const data = await res.json();
  return String(data.sequence ?? '');
}

/**
 * Unit precision is business metadata held in the database, so the form derives
 * its `step` from the same rows the backend enforces instead of carrying a unit
 * map in React. Fetch it once per form.
 *
 * @returns {Promise<Map<string, number>>} unit name -> allowed decimal places
 */
export async function fetchUnitPrecision() {
  const res = await fetch('/api/unit-precision');
  if (!res.ok) throw new Error('خطا در دریافت دقت واحدها');
  const rows = await res.json();
  const map = new Map();
  for (const row of rows) map.set(row.vahed, Number(row.decimals) || 0);
  return map;
}

/**
 * Allowed decimal places for a unit. An unknown unit is whole-quantity, which is
 * what every quantity in this system already is.
 */
export function decimalsForUnit(precision, unit) {
  const key = unit ?? '';
  return precision.has(key) ? precision.get(key) : 0;
}

/** The `step` an `<input type="number">` needs for a given decimal precision. */
export function stepForDecimals(decimals) {
  return decimals > 0 ? (1 / 10 ** decimals).toFixed(decimals) : '1';
}

/**
 * True when a quantity is expressible in the unit's precision. Deliberately does
 * not *round*: a quantity the unit cannot express must be refused, not quietly
 * rewritten to something the user did not type.
 */
export function quantityFitsPrecision(qty, decimals) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return false;
  return Number.isInteger(n * 10 ** decimals);
}
