/**
 * Jalali calendar validation.
 *
 * The canonical business date is Jalali `YYYY/MM/DD`, and it has to be validated
 * against the real calendar: months 1–6 have 31 days, months 7–11 have 30, and
 * Esfand (month 12) has 29 days or 30 in a leap year. The old `day <= 31`
 * check accepted dates that can never occur.
 *
 * Run:  node --test ./tests   (from the backend directory)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidJalaliDate,
  isJalaliLeapYear,
  jalaliMonthLength,
  gregorianToJalali,
} from '../src/utils/jalali.js';

// ------------------------------------------------------------------ month lengths

test('months 1-6 have 31 days', () => {
  for (const month of [1, 2, 3, 4, 5, 6]) {
    assert.equal(jalaliMonthLength(1405, month), 31);
  }
});

test('months 7-11 have 30 days', () => {
  for (const month of [7, 8, 9, 10, 11]) {
    assert.equal(jalaliMonthLength(1405, month), 30);
  }
});

test('Esfand has 29 days normally and 30 in a leap year', () => {
  assert.equal(jalaliMonthLength(1405, 12), 29, '1405 is not a leap year');
  assert.equal(jalaliMonthLength(1403, 12), 30, '1403 is a leap year');
});

test('the leap years follow the 33-year cycle the conversion uses', () => {
  // Mostly every fourth year, with a five-year step at the cycle's break — the
  // arithmetic conversion in this module is built on this cycle.
  for (const year of [1391, 1395, 1399, 1403, 1408, 1412, 1424, 1436, 1441, 1498, 1519]) {
    assert.equal(isJalaliLeapYear(year), true, `${year} should be a leap year`);
  }
  for (const year of [1390, 1392, 1400, 1404, 1405, 1407, 1425, 1520]) {
    assert.equal(isJalaliLeapYear(year), false, `${year} should not be a leap year`);
  }
});

// ------------------------------------------------------------------ valid dates

test('accepts every real Jalali date', () => {
  const valid = [
    '1405/01/01',
    '1405/01/31',
    '1405/06/31',   // last long day of the first half
    '1405/07/01',
    '1405/07/30',   // month 7 ends on the 30th
    '1405/11/30',
    '1405/12/29',   // Esfand in a common year
    '1403/12/30',   // Esfand in a leap year
    '1300/01/01',
    '1499/12/29',
  ];
  for (const date of valid) {
    assert.equal(isValidJalaliDate(date), true, `${date} should be valid`);
  }
});

test('accepts a full calendar sweep: every day of a leap year', () => {
  // Walking every month/day pair of a leap year catches an off-by-one in any
  // month boundary, including Esfand.
  const lengths = [0, 31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 30];
  for (let month = 1; month <= 12; month++) {
    for (let day = 1; day <= lengths[month]; day++) {
      const date = `1403/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
      assert.equal(isValidJalaliDate(date), true, `${date} should be valid`);
    }
    // One day past the month's end must fail.
    const overflow = `1403/${String(month).padStart(2, '0')}/${String(lengths[month] + 1).padStart(2, '0')}`;
    assert.equal(isValidJalaliDate(overflow), false, `${overflow} must be invalid`);
  }
});

// ------------------------------------------------------------------ invalid dates

test('rejects month 13', () => {
  assert.equal(isValidJalaliDate('1405/13/01'), false);
});

test('rejects day 32', () => {
  assert.equal(isValidJalaliDate('1405/01/32'), false);
});

test('rejects the 31st of a 30-day month', () => {
  for (const month of [7, 8, 9, 10, 11]) {
    const date = `1405/${String(month).padStart(2, '0')}/31`;
    assert.equal(isValidJalaliDate(date), false, `${date} must be invalid`);
  }
});

test('rejects Esfand 30 in a common year and Esfand 31 always', () => {
  assert.equal(isValidJalaliDate('1405/12/30'), false, '1405 is common: Esfand has 29 days');
  assert.equal(isValidJalaliDate('1403/12/31'), false, 'even a leap Esfand ends on the 30th');
});

test('accepts Esfand 30 in a leap year', () => {
  assert.equal(isValidJalaliDate('1403/12/30'), true);
});

test('rejects Gregorian dates at the API boundary', () => {
  // A Gregorian string sorts into a range no Jalali filter can match, so it must
  // never reach a business-date column.
  for (const gregorian of ['2026-09-30', '2026/09/30', '09/30/2026', '2026-09-30T00:00:00.000Z']) {
    assert.equal(isValidJalaliDate(gregorian), false, `${gregorian} must be rejected`);
  }
});

test('rejects malformed input', () => {
  for (const bad of [null, undefined, '', '1405', '1405/07', 'not a date', '1405/7', 14050701, '۱۴۰۵/۰۷/۰۱']) {
    assert.equal(isValidJalaliDate(bad), false, `${JSON.stringify(bad)} must be rejected`);
  }
});

test('requires the canonical zero-padded form', () => {
  // The API contract is YYYY/MM/DD with two-digit fields; the client normalises
  // user input before sending.
  assert.equal(isValidJalaliDate('1405/7/1'), false);
});

test('rejects years outside the plausible range', () => {
  assert.equal(isValidJalaliDate('1299/01/01'), false);
  assert.equal(isValidJalaliDate('1501/01/01'), false);
});

// ------------------------------------------------- conversion agrees with itself

test('gregorianToJalali lands on the expected day', () => {
  // Nowruz and the leap day are the two anchors any Jalali converter has to get
  // right: 1404/01/01 is 2025-03-21, and the leap day 1403/12/30 is the day
  // before it.
  assert.deepEqual(gregorianToJalali(2025, 3, 20), { jy: 1403, jm: 12, jd: 30 });
  assert.deepEqual(gregorianToJalali(2025, 3, 21), { jy: 1404, jm: 1, jd: 1 });
  assert.deepEqual(gregorianToJalali(2026, 3, 21), { jy: 1405, jm: 1, jd: 1 });
});
