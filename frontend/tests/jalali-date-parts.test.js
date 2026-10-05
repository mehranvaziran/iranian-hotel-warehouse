/**
 * The Jalali date parts the report range fields are built from.
 *
 * The report range used to be two empty text fields the user had to fill with
 * eight digits and two slashes; it is now year/month/day controls that read and
 * write the canonical string the rest of the app speaks. This suite pins the two
 * rules those controls depend on: a partial value is reported rather than
 * thrown, and rebuilding a date clamps the day to the month's length instead of
 * producing a day that cannot occur — the backend would reject such a date, and
 * the range would quietly match nothing.
 *
 * Run:  node --import ./tests/extensionless-resolution.js --test ./tests/jalali-date-parts.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  jalaliDateParts,
  formatJalaliDateParts,
  jalaliMonthLength,
  todayJalali,
} from '../src/utils/jalali';

// ------------------------------------------------------------- reading parts

test('a canonical date splits into its year, month and day', () => {
  assert.deepEqual(jalaliDateParts('1405/07/13'), { jy: 1405, jm: 7, jd: 13 });
});

test('an unpadded but real date splits without padding being assumed', () => {
  assert.deepEqual(jalaliDateParts('1405/7/1'), { jy: 1405, jm: 7, jd: 1 });
});

test('a partial date reports null instead of throwing', () => {
  // Deleting the day leaves `1405/07/`; the field shows today rather than
  // unmounting the form the way the old date parsing could.
  for (const partial of ['', '1405', '1405/', '1405/07/', 'not-a-date']) {
    assert.equal(jalaliDateParts(partial), null);
  }
});

test('a nullish value reports null rather than throwing', () => {
  assert.equal(jalaliDateParts(null), null);
  assert.equal(jalaliDateParts(undefined), null);
});

// ---------------------------------------------------------- rebuilding dates

test('parts rebuild to the canonical zero-padded form', () => {
  assert.equal(formatJalaliDateParts(1405, 7, 13), '1405/07/13');
  assert.equal(formatJalaliDateParts(1405, 7, 1), '1405/07/01');
  // 1408 is a leap year of this cycle, so its Esfand really has a 30th day.
  assert.equal(formatJalaliDateParts(1408, 12, 30), '1408/12/30');
});

test('a day beyond the month length steps back to the last legal day', () => {
  // Shahrivar has 30 days, so a 31st day asked of it becomes the 30th. The rest
  // of the form keeps what it had — only the day moves.
  assert.equal(formatJalaliDateParts(1405, 6, 31), '1405/06/31');
  assert.equal(formatJalaliDateParts(1405, 7, 31), '1405/07/30');
  assert.equal(formatJalaliDateParts(1405, 12, 31), '1405/12/29');
});

test('Esfand takes its leap day in a leap year', () => {
  // The 33-year cycle this app uses calls 1408 leap (1408 % 33 = 22) and 1404
  // not, so Esfand has 30 days in one and 29 in the other.
  assert.equal(jalaliMonthLength(1408, 12), 30, '1408 is a leap year');
  assert.equal(formatJalaliDateParts(1408, 12, 30), '1408/12/30');
  assert.equal(jalaliMonthLength(1404, 12), 29);
  assert.equal(formatJalaliDateParts(1404, 12, 30), '1404/12/29');
});

test('a month outside the year is held inside it', () => {
  assert.equal(formatJalaliDateParts(1405, 13, 10), '1405/12/10');
  assert.equal(formatJalaliDateParts(1405, 0, 10), '1405/01/10');
});

// ------------------------------------------------- the round trip is a no-op

test('a canonical date survives a read and a rebuild', () => {
  const today = todayJalali();
  const parts = jalaliDateParts(today);
  assert.equal(formatJalaliDateParts(parts.jy, parts.jm, parts.jd), today);
});
