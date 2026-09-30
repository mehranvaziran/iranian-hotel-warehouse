/**
 * Jalali (Persian) calendar helpers.
 *
 * Business rule: the canonical business date throughout this system is a
 * Jalali date stored as text in `YYYY/MM/DD` form. Gregorian strings such as
 * "2026-09-30" must never reach the business-date columns — mixing calendars
 * breaks every lexicographic range filter and every date-ordered list, because
 * the two calendars sort into disjoint ranges.
 *
 * The canonical form is validated against the *real* calendar, not just against
 * rough field ranges: months 1–6 have 31 days, months 7–11 have 30, and Esfand
 * (month 12) has 29 days, or 30 in a leap year. A plain `day <= 31` check used
 * to accept "1405/07/31" and "1405/12/31", neither of which can ever occur.
 */

const JALALI_DATE_RE = /^(\d{4})\/(\d{2})\/(\d{2})$/;

/**
 * Jalali leap years follow the same 33-year arithmetic cycle the Gregorian↔Jalali
 * conversion in frontend/src/utils/jalali.js is built on: a year is leap when its
 * position in the cycle is one of these remainders. This keeps the backend and the
 * client UI agreeing on which Esfand has a 30th day.
 */
const LEAP_YEAR_REMAINDERS = new Set([1, 5, 9, 13, 17, 22, 26, 30]);

/** True when `jy` is a Jalali leap year (Esfand has 30 days). */
export function isJalaliLeapYear(jy) {
  // The double modulo keeps a negative year from producing a negative remainder.
  return LEAP_YEAR_REMAINDERS.has(((jy % 33) + 33) % 33);
}

/** Number of days in a Jalali month of a given year. */
export function jalaliMonthLength(jy, jm) {
  if (jm >= 1 && jm <= 6) return 31;
  if (jm >= 7 && jm <= 11) return 30;
  // Esfand
  return isJalaliLeapYear(jy) ? 30 : 29;
}

/**
 * True when `value` is a Jalali date in the canonical zero-padded YYYY/MM/DD
 * form with a month and day that can actually occur — including the Esfand leap
 * day. Used to reject Gregorian input at the API boundary before it is written
 * to a business-date column.
 */
export function isValidJalaliDate(value) {
  if (typeof value !== 'string') return false;
  const m = value.match(JALALI_DATE_RE);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return year >= 1300 && year <= 1500 &&
    month >= 1 && month <= 12 &&
    day >= 1 && day <= jalaliMonthLength(year, month);
}

/** Reject with a 400-shaped Error if the value is not a canonical Jalali date. */
export function assertJalaliDate(value, field) {
  if (!isValidJalaliDate(value)) {
    const err = new Error(
      `تاریخ ${field} باید به صورت شمسی و در قالب YYYY/MM/DD باشد (مثال: 1405/07/01)`
    );
    err.statusCode = 400;
    throw err;
  }
  return value;
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Convert a Gregorian date to Jalali. Algorithm from the public-domain
 * jalaali-js conversion tables; identical to the copy the frontend uses so a
 * date computed on either side of the API lands on the same day.
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

/**
 * Today's date as a canonical Jalali `YYYY/MM/DD` string. Replaces
 * `new Date().toISOString().split('T')[0]`, which is Gregorian — a business date
 * rendered that way sorts into a range no Jalali filter can ever match.
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
