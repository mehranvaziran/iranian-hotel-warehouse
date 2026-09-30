/**
 * Jalali (Persian) calendar helpers.
 *
 * Business rule: the canonical business date throughout this system is a
 * Jalali date stored as text in `YYYY/MM/DD` form. Gregorian strings such as
 * "2026-09-30" must never reach the business-date columns — mixing calendars
 * breaks every lexicographic range filter and every date-ordered list, because
 * the two calendars sort into disjoint ranges.
 */

const JALALI_DATE_RE = /^(\d{4})\/(\d{2})\/(\d{2})$/;

/**
 * True when `value` is a Jalali date in the canonical zero-padded YYYY/MM/DD
 * form with a plausible month and day. Used to reject Gregorian input at the
 * API boundary before it is written to a business-date column.
 */
export function isValidJalaliDate(value) {
  if (typeof value !== 'string') return false;
  const m = value.match(JALALI_DATE_RE);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return year >= 1300 && year <= 1500 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
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
