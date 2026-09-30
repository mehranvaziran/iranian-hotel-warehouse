/**
 * Jalali (Persian) calendar helpers — dependency free.
 *
 * Business rule: the canonical business date is a Jalali date in `YYYY/MM/DD`
 * form. The `<input type="date">` element and `Date.prototype.toISOString()`
 * both produce *Gregorian* strings ("2026-09-30"), and writing one of those
 * into a Jalali column silently breaks every date filter and date-ordered list
 * in the system — the two calendars sort into disjoint ranges. Everything the
 * user enters or the app defaults must go through here instead.
 */

/**
 * Convert a Gregorian date to Jalali.
 * Algorithm from the public-domain jalaali-js conversion tables.
 */
export function gregorianToJalali(gy, gm, gd) {
  const gDaysInMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;

  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    gDaysInMonth[gm - 1];

  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;

  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }

  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);

  return { jy, jm, jd };
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Today's date as a canonical Jalali `YYYY/MM/DD` string.
 * Replaces `new Date().toISOString().split('T')[0]`, which is Gregorian.
 */
export function todayJalali() {
  const now = new Date();
  const { jy, jm, jd } = gregorianToJalali(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate()
  );
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

const JALALI_DATE_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;

/** True when `value` looks like a Jalali date in `YYYY/MM/DD` form. */
export function isValidJalaliDate(value) {
  const m = String(value ?? '').trim().match(JALALI_DATE_RE);
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * Normalise user input into the canonical zero-padded `YYYY/MM/DD` form so the
 * backend's lexicographic range filters behave. Returns the input unchanged
 * when it is not in a recognisable shape.
 */
export function normalizeJalaliDate(value) {
  const m = String(value ?? '').trim().match(JALALI_DATE_RE);
  if (!m) return String(value ?? '').trim();
  return `${m[1]}/${pad(Number(m[2]))}/${pad(Number(m[3]))}`;
}
