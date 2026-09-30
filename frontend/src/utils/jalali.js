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

/**
 * Jalali leap years follow the 33-year arithmetic cycle the conversion above is
 * built on — the same rule the backend validates against, so a date the client
 * accepts is a date the API accepts.
 */
const LEAP_YEAR_REMAINDERS = new Set([1, 5, 9, 13, 17, 22, 26, 30]);

export function isJalaliLeapYear(jy) {
  return LEAP_YEAR_REMAINDERS.has(((jy % 33) + 33) % 33);
}

/** Days in a Jalali month: 1–6 → 31, 7–11 → 30, Esfand → 29 (30 in a leap year). */
export function jalaliMonthLength(jy, jm) {
  if (jm >= 1 && jm <= 6) return 31;
  if (jm >= 7 && jm <= 11) return 30;
  return isJalaliLeapYear(jy) ? 30 : 29;
}

const JALALI_DATE_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;

/**
 * True when `value` is a Jalali date in `YYYY/MM/DD` form with a month and day
 * that can actually occur — including the Esfand leap day.
 */
export function isValidJalaliDate(value) {
  const m = String(value ?? '').trim().match(JALALI_DATE_RE);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return year >= 1300 && year <= 1500 &&
    month >= 1 && month <= 12 &&
    day >= 1 && day <= jalaliMonthLength(year, month);
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
