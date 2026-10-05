/**
 * Document-line and document-number rules, as the receipt and issue forms apply
 * them.
 *
 * The defect these guard is *filtering before validating*: both forms used to
 * drop anything that did not look complete before validating, so a document with
 * one filled row and one half-entered row submitted just the filled one and the
 * user never learned the other was gone. The validators below are pure functions
 * of the form's own rows, which is how the forms can report every problem on the
 * row it belongs to without changing anything the user typed.
 *
 * No test runner is configured for this package; the modules are plain ESM with
 * no browser dependencies, so `node --test` runs them as they are, with the
 * extensionless-import resolver registered for this directory. Name the file
 * explicitly — this Node version does not glob a directory argument.
 *
 * Run:  node --import ./tests/extensionless-resolution.js --test ./tests/document-lines.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isBlankLine,
  lineProblems,
  validateDocumentLines,
  everyEnteredLineIsValid,
} from '../src/utils/documentLines.js';
import {
  RECEIPT_PREFIX,
  ISSUE_PREFIX,
  docNumberHead,
  formatDocNumber,
  docNumberSequence,
  isValidDocNumber,
} from '../src/utils/docNumber.js';

const PRECISION = new Map([['عدد', 0], ['کیلوگرم', 3]]);
const ITEMS = [
  { kod_kala: 'K001', vahed: 'عدد' },
  { kod_kala: 'K002', vahed: 'کیلوگرم' },
];

// ------------------------------------------------------------ line validity

test('a blank line carries nothing to lose and does not block anything', () => {
  assert.equal(isBlankLine({ kala_id: '', maqdar: '', tavazihat: '' }), true);
  assert.equal(isBlankLine({ kala_id: '', maqdar: '', tavazihat: '' }), true);
  // Whitespace the user left in a note is still nothing entered.
  assert.equal(isBlankLine({ kala_id: '', maqdar: '  ', tavazihat: '   ' }), true);
});

test('a line the user touched is not blank, even when it is incomplete', () => {
  // This is the pivot of the whole rule: an incomplete line is *not* blank, so
  // the payload builder cannot quietly leave it out either — it has to be made
  // valid first, and that is what the row error asks for.
  assert.equal(isBlankLine({ kala_id: 'K001', maqdar: '', tavazihat: '' }), false);
  assert.equal(isBlankLine({ kala_id: '', maqdar: '5', tavazihat: '' }), false);
  assert.equal(isBlankLine({ kala_id: '', maqdar: '', tavazihat: 'یادداشت' }), false);
});

test('a filled line has no problems', () => {
  const line = { kala_id: 'K001', maqdar: '12', tavazihat: '' };
  assert.deepEqual(lineProblems(line, ITEMS, PRECISION), []);
});

// ------------------------------------------- the D1 regression: no silent drop

test('one valid line plus one incomplete line cannot be submitted', () => {
  const lines = [
    { kala_id: 'K001', maqdar: '5', tavazihat: '' },
    { kala_id: 'K002', maqdar: '', tavazihat: '' },
  ];

  assert.equal(everyEnteredLineIsValid(lines, ITEMS, PRECISION), false);
  // The document is refused *because* of the incomplete row, which is named.
  const issues = validateDocumentLines(lines, ITEMS, PRECISION);
  assert.deepEqual(Object.keys(issues), ['1']);
  assert.ok(
    issues[1].some((m) => m.includes('مقدار')),
    `the row must say its quantity is missing, got ${JSON.stringify(issues[1])}`
  );
});

test('an incomplete line is not silently discarded on the way to the payload', () => {
  // The payload is built from `lines.filter(l => !isBlankLine(l))`. A line the
  // user touched survives that filter, so it can never vanish into a document
  // that submits without it — it either becomes valid or stops the submission.
  const lines = [
    { kala_id: 'K001', maqdar: '5', tavazihat: '' },
    { kala_id: 'K002', maqdar: '', tavazihat: '' },
  ];
  const kept = lines.filter((l) => !isBlankLine(l));
  assert.equal(kept.length, 2, 'the incomplete row is kept, not dropped');
  assert.equal(isBlankLine(kept[1]), false);
});

test('everything the user entered stays where it was entered', () => {
  // The validators are pure: they read the rows and report problems, they never
  // rewrite or remove a value. A failed validation leaves the form exactly as it
  // was, so the user fixes rows instead of retyping them.
  const lines = [
    { kala_id: 'K001', maqdar: '5', tavazihat: 'یادداشت ردیف اول' },
    { kala_id: 'K002', maqdar: '', tavazihat: 'ردیف ناقص' },
  ];
  const snapshot = JSON.parse(JSON.stringify(lines));

  validateDocumentLines(lines, ITEMS, PRECISION);
  assert.deepEqual(lines, snapshot, 'validation must not touch the entered values');

  // ...and the second row is still reported, still carrying its note.
  assert.equal(lines[1].tavazihat, 'ردیف ناقص');
});

test('a document with several valid lines submits normally', () => {
  const lines = [
    { kala_id: 'K001', maqdar: '5', tavazihat: '' },
    { kala_id: 'K002', maqdar: '2.5', tavazihat: 'وزنی' },
    { kala_id: 'K001', maqdar: '10', tavazihat: '' },
  ];
  assert.equal(everyEnteredLineIsValid(lines, ITEMS, PRECISION), true);
  assert.deepEqual(validateDocumentLines(lines, ITEMS, PRECISION), {});
  assert.equal(lines.filter((l) => !isBlankLine(l)).length, 3);
});

test('every problem of a line is reported, not just the first one', () => {
  const issues = lineProblems({ kala_id: '', maqdar: '-3', tavazihat: '' }, ITEMS, PRECISION);
  assert.ok(issues.length >= 2, `both the missing item and the bad quantity, got ${issues}`);
  assert.ok(issues.some((m) => m.includes('کالا')));
  assert.ok(issues.some((m) => m.includes('مقدار')));
});

test('a quantity the unit cannot express is reported, never rounded', () => {
  // 'کیلوگرم' carries three decimals, so 2.25 is fine and 2.2511 is not; the line
  // is refused rather than recorded as something the user did not type.
  assert.deepEqual(lineProblems({ kala_id: 'K002', maqdar: '2.25', tavazihat: '' }, ITEMS, PRECISION), []);
  const bad = lineProblems({ kala_id: 'K002', maqdar: '2.2511', tavazihat: '' }, ITEMS, PRECISION);
  assert.equal(bad.length, 1);
  assert.ok(bad[0].includes('رقم اعشار'), `must name the precision rule, got ${bad[0]}`);
});

test('an item retired from the catalog cannot be entered', () => {
  const retired = lineProblems({ kala_id: 'K099', maqdar: '5', tavazihat: '' }, ITEMS, PRECISION);
  assert.equal(retired.length, 1);
  assert.ok(retired[0].includes('فعال'), `must say the item is not active, got ${retired[0]}`);
});

test('a document of blank rows has no row problems, and the form says so itself', () => {
  const lines = [{ kala_id: '', maqdar: '', tavazihat: '' }];
  // Nothing was entered, so no row is accused of anything...
  assert.deepEqual(validateDocumentLines(lines, ITEMS, PRECISION), {});
  // ...but the document as a whole is still empty, which the form reports
  // separately from any row.
  assert.equal(lines.every(isBlankLine), true);
});

// --------------------------------------------------- document number (D2)

test('the head of a number is fixed by the document date, padded', () => {
  assert.equal(docNumberHead(RECEIPT_PREFIX, '1405/07/01'), 'R-050701-');
  assert.equal(docNumberHead(ISSUE_PREFIX, '1405/06/17'), 'H-050617-');
});

test('a date the user did not pad still yields a whole six-digit head', () => {
  // `1405/7/1` is a real day; reading the digits off it raw would give a broken
  // head, which is why the date is canonicalised before the digits are taken.
  assert.equal(docNumberHead(RECEIPT_PREFIX, '1405/7/1'), 'R-050701-');
  assert.equal(docNumberHead(ISSUE_PREFIX, '1405/9/2'), 'H-050902-');
});

test('changing the date changes the head, so a number follows its document', () => {
  assert.equal(formatDocNumber(RECEIPT_PREFIX, '1405/07/01', '173'), 'R-050701-173');
  assert.equal(formatDocNumber(RECEIPT_PREFIX, '1405/08/01', '173'), 'R-050801-173');
});

test('only the sequence is editable, and it survives a date change', () => {
  // The head is derived from the date; the sequence is the part the user typed,
  // and reassembling the number after a date change keeps the sequence.
  assert.equal(docNumberSequence('R-050701-173'), '173');
  assert.equal(docNumberSequence('R-050801-173'), '173');
  assert.equal(docNumberSequence(''), '');
});

test('a number outside the convention is recognised as such', () => {
  assert.equal(isValidDocNumber('R-050701-173'), true);
  assert.equal(isValidDocNumber('R617-174 مهران'), false);
  assert.equal(isValidDocNumber(''), false);
});
