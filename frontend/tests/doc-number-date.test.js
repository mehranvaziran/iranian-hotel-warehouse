/**
 * Document-number head and Jalali date display — the rules the receipt and issue
 * forms rely on while a date is being edited.
 *
 * The defect this guards is a crash in `docNumberHead`: a no-match `RegExp.exec`
 * used to fall back to `[]`, which is *truthy*, so the guard never fired and
 * reading group 1 threw `TypeError: Cannot read properties of undefined`. The
 * whole component unmounted on the first keystroke that left the date
 * incomplete — deleting a digit from `1405/06/17` closed the form. The head is
 * now derived only from a real day, so an incomplete date is displayed, not
 * fatal.
 *
 * Run:  node --import ./tests/extensionless-resolution.js --test ./tests/doc-number-date.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RECEIPT_PREFIX,
  ISSUE_PREFIX,
  docNumberHead,
  formatDocNumber,
  docNumberSequence,
} from '../src/utils/docNumber.js';
import { toJalaliDisplay } from '../src/utils/jalali.js';

// ------------------------------------------- the head follows a real date only

test('the head carries the year pair, month and day of a canonical date', () => {
  assert.equal(docNumberHead(RECEIPT_PREFIX, '1405/07/10'), 'R-050710-');
  assert.equal(docNumberHead(ISSUE_PREFIX, '1405/06/17'), 'H-050617-');
});

test('the head is padded for an unpadded but real date', () => {
  // `1405/7/1` is a real day the user typed; the head must be six digits.
  assert.equal(docNumberHead(RECEIPT_PREFIX, '1405/7/1'), 'R-050701-');
});

// ------------------------------------- an incomplete date does not crash the form

test('deleting the day digits leaves the bare prefix instead of throwing', () => {
  // `1405/06/` is the shape the input holds after the user deletes the day.
  // This is the case that used to throw and unmount the form.
  assert.equal(docNumberHead(RECEIPT_PREFIX, '1405/06/'), 'R-');
});

test('a month that is not a real month yet leaves the bare prefix', () => {
  assert.equal(docNumberHead(RECEIPT_PREFIX, '1405/0/17'), 'R-');
});

test('an empty, partial or unrecognised date leaves the bare prefix', () => {
  for (const partial of ['', '1405', '1405/', 'not-a-date', '   ']) {
    assert.equal(docNumberHead(ISSUE_PREFIX, partial), 'H-');
  }
});

test('a nullish date leaves the bare prefix rather than throwing', () => {
  assert.equal(docNumberHead(RECEIPT_PREFIX, null), 'R-');
  assert.equal(docNumberHead(RECEIPT_PREFIX, undefined), 'R-');
});

test('formatDocNumber keeps the sequence while a date is incomplete', () => {
  // The sequence the user typed is not lost while the head is not derivable;
  // the number is simply not submittable until the date is a real day.
  assert.equal(formatDocNumber(RECEIPT_PREFIX, '1405/06/', 200), 'R-200');
  assert.equal(formatDocNumber(RECEIPT_PREFIX, '1405/07/10', 174), 'R-050710-174');
});

test('the sequence tail is read back out of a complete number', () => {
  assert.equal(docNumberSequence('R-050710-174'), '174');
  assert.equal(docNumberSequence('R-200'), '');
});

// ----------------------------------------------- dates are displayed as Jalali

test('a Jalali date is displayed canonical and zero-padded', () => {
  assert.equal(toJalaliDisplay('1405/06/17'), '1405/06/17');
  assert.equal(toJalaliDisplay('1405/7/1'), '1405/07/01');
});

test('a Gregorian day is displayed as Jalali', () => {
  // The historical QA receipt recorded `2026-09-30`; it is shown as Jalali
  // without the stored row being rewritten.
  assert.equal(toJalaliDisplay('2026-09-30'), '1405/07/08');
});

test('a Gregorian timestamp keeps its time of day in Jalali', () => {
  // `created_at` values are Gregorian datetimes; the activity feed shows them
  // as Jalali with the clock preserved.
  assert.equal(toJalaliDisplay('2026-09-29 06:08:45'), '1405/07/07 06:08');
});

test('a value that is not a date spelling is passed through untouched', () => {
  assert.equal(toJalaliDisplay(''), '');
  assert.equal(toJalaliDisplay('تاریخ نامشخص'), 'تاریخ نامشخص');
});
