/**
 * Document-number convention and unit-precision rules.
 *
 * A document number is `{R|H}-{Jalali YYMMDD}-{seq}` — the format the existing
 * seeded documents use. The six digits in the middle are a Jalali date, not a
 * Gregorian one, which is the detail this suite exists to pin down: the two
 * calendars with identical digits land decades apart, so a number is only
 * self-describing when the right calendar is inside it.
 *
 * Unit precision is business metadata held in `unit_precision`; the backend
 * refuses a quantity a unit cannot express rather than rounding it.
 *
 * Run:  node --test ./tests   (from the backend directory)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

import {
  RECEIPT_PREFIX,
  ISSUE_PREFIX,
  isValidDocNumber,
  assertValidDocNumber,
  assertDocNumberMatchesTarikh,
  suggestDocNumber,
  formatDocNumber,
  jalaliHead,
  docNumberEmbeddedDate,
} from '../src/utils/docNumber.js';
import { normalizeJalaliDate } from '../src/utils/jalali.js';
import { InventoryService } from '../src/services/inventoryService.js';
import { createSchema, ensureGroupOrder, ensureUnitPrecision, initDatabase } from '../src/db.js';

/** Bounded Windows-tolerant teardown (see the other suites for the same note). */
async function removeDir(dir) {
  let lastErr = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw lastErr;
}

/**
 * A database with the schema, reference data and one stocked item. Opened by
 * path, never through the env-var default, so a test cannot reach the live
 * warehouse.db.
 */
async function buildDatabase(dbPath, { itemCode = 'P001', unit = 'عدد', baseline = 100 } = {}) {
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await createSchema(db);
  await ensureGroupOrder(db);
  await ensureUnitPrecision(db);
  await db.run(
    `INSERT INTO kala (kod_kala, naam_kala, goh, vahed, is_active)
     VALUES (?, 'کالای آزمایشی', 'آزمایش', ?, 1)`,
    [itemCode, unit]
  );
  await db.run(
    `INSERT INTO mojoodi_mabna (kala_id, mabna_qty, tarikh_mabna, tavazihat)
     VALUES (?, ?, '1405/07/01', 'موجودی مبنا آزمایشی')`,
    [itemCode, baseline]
  );
  return db;
}

// ------------------------------------------------------------- the number shape

test('a real receipt number is well-formed', () => {
  assert.ok(isValidDocNumber('R-050617-173'));
});

test('a real issue number is well-formed', () => {
  assert.ok(isValidDocNumber('H-050617-3'));
});

test('the prefix must be R or H', () => {
  assert.ok(!isValidDocNumber('X-050617-1'));
});

test('the date part must be six digits', () => {
  assert.ok(!isValidDocNumber('R-05061-1'), 'five digits is not a YYMMDD');
  assert.ok(!isValidDocNumber('R-0506173-1'), 'seven digits is not a YYMMDD');
});

test('the sequence must be digits only', () => {
  // The seeded issue numbers use a separator inside the *stored* value, but the
  // stored values are historical and read as-is; a newly created number is a
  // plain integer.
  assert.ok(!isValidDocNumber('H-050617-1/2'));
});

test('the shape rule does not itself judge whether the embedded date is real', () => {
  // A six-digit tail is well-formed even when those digits are not a Jalali date
  // anyone would issue. Which calendar the number encodes is pinned by the date
  // field on the document, validated separately — this is why the two are
  // checked independently rather than the number being trusted on its own.
  assert.ok(isValidDocNumber('R-999999-1'));
});

test('the prefixes are exported for callers to use', () => {
  assert.equal(RECEIPT_PREFIX, 'R');
  assert.equal(ISSUE_PREFIX, 'H');
});

// --------------------------------------------------------- validation refusal

test('an empty number is refused with a Persian message', () => {
  assert.throws(() => assertValidDocNumber('', RECEIPT_PREFIX), /الزامی/);
});

test('a malformed number is refused naming the expected shape', () => {
  assert.throws(() => assertValidDocNumber('WHATEVER-1', ISSUE_PREFIX), /H-YYMMDD/);
});

test('the refusal names the document kind', () => {
  assert.throws(() => assertValidDocNumber('bad', RECEIPT_PREFIX), /رسید/);
  assert.throws(() => assertValidDocNumber('bad', ISSUE_PREFIX), /حواله/);
});

test('a valid number is returned trimmed', () => {
  assert.equal(assertValidDocNumber('  H-050701-5  ', ISSUE_PREFIX), 'H-050701-5');
});

// ------------------------------------------------------------- formatting

test('formatDocNumber builds the number from a Jalali date', () => {
  assert.equal(formatDocNumber(RECEIPT_PREFIX, '1405/07/01', 12), 'R-050701-12');
  assert.equal(formatDocNumber(ISSUE_PREFIX, '1405/06/17', 3), 'H-050617-3');
});

// ------------------------------------------------------- suggestion from the DB

test('suggestion starts at 1 when no document of that kind exists', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docnum-'));
  const db = await buildDatabase(path.join(dir, 'a.db'));
  try {
    assert.equal(await suggestDocNumber(db, RECEIPT_PREFIX, '1405/08/01'), '1');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('suggestion continues past the highest number that kind has used', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docnum-'));
  const db = await buildDatabase(path.join(dir, 'b.db'));
  try {
    await db.run(`INSERT INTO receipts (receipt_number, tarikh) VALUES ('R-050801-7', '1405/08/01')`);
    await db.run(`INSERT INTO receipts (receipt_number, tarikh) VALUES ('R-050801-2', '1405/08/01')`);
    assert.equal(await suggestDocNumber(db, RECEIPT_PREFIX, '1405/08/01'), '8');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('the sequence continues on a different date instead of restarting', async () => {
  // The sequence is per kind and continuous across the whole table, so after
  // R-050617-173 a receipt dated 1405/07/10 is offered 174 — not R-050710-1.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docnum-'));
  const db = await buildDatabase(path.join(dir, 'cont-a.db'));
  try {
    await db.run(`INSERT INTO receipts (receipt_number, tarikh) VALUES ('R-050617-173', '1405/06/17')`);
    assert.equal(await suggestDocNumber(db, RECEIPT_PREFIX, '1405/07/10'), '174');
    // The head follows the date the user chose; the count does not.
    assert.equal(formatDocNumber(RECEIPT_PREFIX, '1405/07/10', '174'), 'R-050710-174');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('the sequence also continues from a newer date back to an older one', async () => {
  // Continuity is not direction-dependent: a document entered for a past date
  // continues the count the newer documents already used.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docnum-'));
  const db = await buildDatabase(path.join(dir, 'cont-b.db'));
  try {
    await db.run(`INSERT INTO receipts (receipt_number, tarikh) VALUES ('R-050710-20', '1405/07/10')`);
    assert.equal(await suggestDocNumber(db, RECEIPT_PREFIX, '1405/06/17'), '21');
    assert.equal(formatDocNumber(RECEIPT_PREFIX, '1405/06/17', '21'), 'R-050617-21');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('changing the date does not reset the sequence', async () => {
  // The same document, re-dated, is offered the *next* sequence for each date
  // it is tried with — the count never falls back to 1 once a kind has numbers.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docnum-'));
  const db = await buildDatabase(path.join(dir, 'cont-c.db'));
  try {
    await db.run(`INSERT INTO receipts (receipt_number, tarikh) VALUES ('R-050617-173', '1405/06/17')`);
    assert.equal(await suggestDocNumber(db, RECEIPT_PREFIX, '1405/07/10'), '174');
    assert.equal(await suggestDocNumber(db, RECEIPT_PREFIX, '1405/08/01'), '174');
    assert.equal(await suggestDocNumber(db, RECEIPT_PREFIX, '1405/06/17'), '174');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('the receipt and issue sequences are independent and each continuous', async () => {
  // The two kinds count on their own: a busy receipt day does not advance the
  // issue count, and each continues across dates.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docnum-'));
  const db = await buildDatabase(path.join(dir, 'cont-d.db'));
  try {
    await db.run(`INSERT INTO receipts (receipt_number, tarikh) VALUES ('R-050617-173', '1405/06/17')`);
    await db.run(`INSERT INTO issues (issue_number, tarikh) VALUES ('H-050617-20', '1405/06/17')`);

    assert.equal(await suggestDocNumber(db, RECEIPT_PREFIX, '1405/07/10'), '174');
    assert.equal(await suggestDocNumber(db, ISSUE_PREFIX, '1405/07/10'), '21');
    assert.equal(formatDocNumber(ISSUE_PREFIX, '1405/07/10', '21'), 'H-050710-21');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('a free-form number of the other kind does not participate in the count', async () => {
  // The live data holds a deliberately free-form receipt number; it is skipped
  // by the receipt count and irrelevant to the issue count alike.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docnum-'));
  const db = await buildDatabase(path.join(dir, 'cont-e.db'));
  try {
    await db.run(
      `INSERT INTO receipts (receipt_number, tarikh) VALUES ('R617-174 مهران', '2026-09-30')`
    );
    assert.equal(await suggestDocNumber(db, RECEIPT_PREFIX, '1405/07/10'), '1');
    assert.equal(await suggestDocNumber(db, ISSUE_PREFIX, '1405/07/10'), '1');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('suggestion is independent per kind', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docnum-'));
  const db = await buildDatabase(path.join(dir, 'c.db'));
  try {
    await db.run(`INSERT INTO receipts (receipt_number, tarikh) VALUES ('R-050801-4', '1405/08/01')`);
    assert.equal(await suggestDocNumber(db, RECEIPT_PREFIX, '1405/08/01'), '5');
    assert.equal(await suggestDocNumber(db, ISSUE_PREFIX, '1405/08/01'), '1');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('a historical number that does not end in an integer does not break the sequence', async () => {
  // The live data contains numbers with a separator inside them. Such a row must
  // not poison the suggestion — it simply does not participate.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docnum-'));
  const db = await buildDatabase(path.join(dir, 'd.db'));
  try {
    await db.run(`INSERT INTO receipts (receipt_number, tarikh) VALUES ('R-050801-3/الف', '1405/08/01')`);
    assert.equal(await suggestDocNumber(db, RECEIPT_PREFIX, '1405/08/01'), '1');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

// ------------------------------------------------------- the API boundary

test('a receipt with a malformed number is refused with 400', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docnum-'));
  const db = await buildDatabase(path.join(dir, 'e.db'));
  try {
    const service = new InventoryService(db);
    await assert.rejects(
      () =>
        service.createReceipt({
          receipt_number: 'NOT-A-NUMBER',
          tarikh: '1405/08/01',
          lines: [{ kala_id: 'P001', maqdar: 1, vahed: 'عدد' }],
        }),
      (err) => err.statusCode === 400 && /R-YYMMDD/.test(err.message),
      'the refusal must be a client error naming the shape'
    );
    const rows = await db.all('SELECT COUNT(*) AS c FROM receipts');
    assert.equal(rows[0].c, 0, 'no document may be written for a refused number');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('an issue with a Gregorian-looking number is refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docnum-'));
  const db = await buildDatabase(path.join(dir, 'f.db'));
  try {
    const service = new InventoryService(db);
    await assert.rejects(
      () =>
        service.createIssue({
          issue_number: '20260930-1',
          tarikh: '1405/08/01',
          lines: [{ kala_id: 'P001', maqdar: 1, vahed: 'عدد' }],
        }),
      (err) => err.statusCode === 400
    );
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('a convention-shaped number is accepted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docnum-'));
  const db = await buildDatabase(path.join(dir, 'g.db'));
  try {
    const service = new InventoryService(db);
    const result = await service.createReceipt({
      receipt_number: 'R-050801-1',
      tarikh: '1405/08/01',
      lines: [{ kala_id: 'P001', maqdar: 5, vahed: 'عدد' }],
    });
    assert.ok(result.id);
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

// ------------------------------------------------- unit precision enforcement

test('a whole-unit item refuses a fractional quantity', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prec-'));
  const db = await buildDatabase(path.join(dir, 'a.db'), { unit: 'شاخه' });
  try {
    const service = new InventoryService(db);
    await assert.rejects(
      () =>
        service.createReceipt({
          receipt_number: 'R-050801-1',
          tarikh: '1405/08/01',
          lines: [{ kala_id: 'P001', maqdar: 1.5, vahed: 'شاخه' }],
        }),
      (err) => err.statusCode === 400 && /رقم اعشار/.test(err.message),
      'a whole-count unit must refuse a half'
    );
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('a unit configured for two decimals accepts two and refuses three', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prec-'));
  const db = await buildDatabase(path.join(dir, 'b.db'), { unit: 'متر' });
  try {
    await db.run(`INSERT INTO unit_precision (vahed, decimals) VALUES ('متر', 2)`);
    const service = new InventoryService(db);

    const ok = await service.createReceipt({
      receipt_number: 'R-050801-1',
      tarikh: '1405/08/01',
      lines: [{ kala_id: 'P001', maqdar: 1.25, vahed: 'متر' }],
    });
    assert.ok(ok.id, 'two decimals is expressible in a two-decimal unit');

    await assert.rejects(
      () =>
        service.createReceipt({
          receipt_number: 'R-050801-2',
          tarikh: '1405/08/01',
          lines: [{ kala_id: 'P001', maqdar: 1.234, vahed: 'متر' }],
        }),
      (err) => err.statusCode === 400,
      'three decimals is not expressible and must not be rounded silently'
    );
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('precision is read from the table for the front-end', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prec-'));
  const db = await buildDatabase(path.join(dir, 'c.db'), { unit: 'متر' });
  try {
    await db.run(`INSERT INTO unit_precision (vahed, decimals) VALUES ('متر', 2)`);
    const service = new InventoryService(db);
    const rows = await service.getUnitPrecision();
    const metre = rows.find((r) => r.vahed === 'متر');
    assert.equal(metre.decimals, 2);
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('a document line keeps the Item Master unit, not the client one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prec-'));
  const db = await buildDatabase(path.join(dir, 'd.db'), { unit: 'شاخه' });
  try {
    const service = new InventoryService(db);
    await service.createReceipt({
      receipt_number: 'R-050801-1',
      tarikh: '1405/08/01',
      // The client sends a different unit; the master value must win.
      lines: [{ kala_id: 'P001', maqdar: 3, vahed: 'بسته' }],
    });
    const rows = await db.all('SELECT vahed FROM receipt_lines');
    assert.equal(rows[0].vahed, 'شاخه');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

// ------------------------------------------------- canonical group ordering

test('groups are seeded in catalog-first-appearance order', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-'));
  const db = await open({ filename: path.join(dir, 'a.db'), driver: sqlite3.Database });
  try {
    await createSchema(db);
    await db.run(`INSERT INTO kala (kod_kala, naam_kala, goh) VALUES ('B001', 'دوم', 'گروه ب')`);
    await db.run(`INSERT INTO kala (kod_kala, naam_kala, goh) VALUES ('A001', 'اول', 'گروه الف')`);
    await db.run(`INSERT INTO kala (kod_kala, naam_kala, goh) VALUES ('A002', 'سوم', 'گروه الف')`);
    await ensureGroupOrder(db);

    const groups = await db.all('SELECT name, sort_order FROM groups ORDER BY sort_order');
    assert.deepEqual(
      groups.map((g) => g.name),
      ['گروه ب', 'گروه الف'],
      'order of first appearance in the catalog, not alphabetical'
    );
    assert.deepEqual(
      groups.map((g) => g.sort_order),
      [10, 20]
    );
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('ensureGroupOrder on a populated groups table changes nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-'));
  const db = await open({ filename: path.join(dir, 'b.db'), driver: sqlite3.Database });
  try {
    await createSchema(db);
    await db.run(`INSERT INTO groups (name, sort_order) VALUES ('گروه الف', 30)`);
    await db.run(`INSERT INTO groups (name, sort_order) VALUES ('گروه ب', 10)`);
    await db.run(`INSERT INTO kala (kod_kala, naam_kala, goh) VALUES ('A001', 'x', 'گروه الف')`);
    await ensureGroupOrder(db);

    const groups = await db.all('SELECT name, sort_order FROM groups ORDER BY sort_order');
    assert.deepEqual(
      groups.map((g) => [g.name, g.sort_order]),
      [
        ['گروه ب', 10],
        ['گروه الف', 30],
      ],
      'an existing order is never rewritten'
    );
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('ensureUnitPrecision derives whole-number defaults and stays a no-op afterwards', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-'));
  const db = await open({ filename: path.join(dir, 'c.db'), driver: sqlite3.Database });
  try {
    await createSchema(db);
    await db.run(`INSERT INTO kala (kod_kala, naam_kala, vahed) VALUES ('A001', 'x', 'شاخه')`);
    await ensureUnitPrecision(db);
    let rows = await db.all('SELECT vahed, decimals FROM unit_precision');
    assert.deepEqual(rows.map((r) => [r.vahed, r.decimals]), [['شاخه', 0]]);

    // Running again must not touch what is there.
    await ensureUnitPrecision(db);
    rows = await db.all('SELECT vahed, decimals FROM unit_precision');
    assert.equal(rows.length, 1);
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('inventory is ordered by group then by the numeric part of the item code', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-'));
  const db = await open({ filename: path.join(dir, 'd.db'), driver: sqlite3.Database });
  try {
    await createSchema(db);
    // Groups deliberately named so alphabetical order would differ from the
    // stored sort_order.
    await db.run(`INSERT INTO groups (name, sort_order) VALUES ('گروه ز', 10)`);
    await db.run(`INSERT INTO groups (name, sort_order) VALUES ('گروه الف', 20)`);
    await db.run(`INSERT INTO kala (kod_kala, naam_kala, goh) VALUES ('Z019', 'z19', 'گروه ز')`);
    await db.run(`INSERT INTO kala (kod_kala, naam_kala, goh) VALUES ('Z002', 'z2', 'گروه ز')`);
    await db.run(`INSERT INTO kala (kod_kala, naam_kala, goh) VALUES ('Z100', 'z100', 'گروه ز')`);
    await db.run(`INSERT INTO kala (kod_kala, naam_kala, goh) VALUES ('A003', 'a3', 'گروه الف')`);

    const service = new InventoryService(db);
    const inventory = await service.getAllInventory();
    assert.deepEqual(
      inventory.map((i) => i.kod_kala),
      ['Z002', 'Z019', 'Z100', 'A003'],
      'group sort_order first, then the numeric sequence inside the code — not text order'
    );
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('an item whose group is not in the groups table still appears, last', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-'));
  const db = await open({ filename: path.join(dir, 'e.db'), driver: sqlite3.Database });
  try {
    await createSchema(db);
    await db.run(`INSERT INTO groups (name, sort_order) VALUES ('گروه الف', 10)`);
    await db.run(`INSERT INTO kala (kod_kala, naam_kala, goh) VALUES ('A001', 'a1', 'گروه الف')`);
    await db.run(`INSERT INTO kala (kod_kala, naam_kala, goh) VALUES ('X001', 'x1', 'نامشخص')`);

    const service = new InventoryService(db);
    const inventory = await service.getAllInventory();
    assert.equal(inventory[inventory.length - 1].kod_kala, 'X001');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

// ------------------------------------------------- the date inside the number

test('jalaliHead carries the year pair, month and day of a canonical date', () => {
  assert.equal(jalaliHead('1405/07/01'), '050701');
  assert.equal(jalaliHead('1405/06/17'), '050617');
});

test('jalaliHead reports a date that is not the canonical padded shape', () => {
  assert.equal(jalaliHead('not-a-date'), null);
});

test('docNumberEmbeddedDate reads the six digits out of a number', () => {
  assert.equal(docNumberEmbeddedDate('R-050617-173'), '050617');
  assert.equal(docNumberEmbeddedDate('H-050617-3'), '050617');
  assert.equal(docNumberEmbeddedDate('R617-174 مهران'), null, 'a historical free-form number carries no embedded date');
});

test('normalizeJalaliDate pads a valid but unpadded date', () => {
  assert.equal(normalizeJalaliDate('1405/7/1'), '1405/07/01');
  assert.equal(normalizeJalaliDate('1405/07/01'), '1405/07/01');
  // Something it cannot recognise is passed through, not invented.
  assert.equal(normalizeJalaliDate('2026-09-30'), '2026-09-30');
});

test('a number whose embedded date matches the document date is accepted', () => {
  // Neither assertion throws: the shape is right *and* the date inside the number
  // is the document's own date.
  assertDocNumberMatchesTarikh('R-050617-173', RECEIPT_PREFIX, '1405/06/17');
  assertDocNumberMatchesTarikh('H-050701-1', ISSUE_PREFIX, '1405/07/01');
});

test('a number whose embedded date disagrees with the document date is refused', () => {
  assert.throws(
    () => assertDocNumberMatchesTarikh('R-050618-1', RECEIPT_PREFIX, '1405/06/17'),
    (err) => err.statusCode === 400 && /یکی باشد/.test(err.message),
    'the refusal must name both dates so the user can see the disagreement'
  );
});

test('the date check reports the document kind', () => {
  assert.throws(
    () => assertDocNumberMatchesTarikh('H-050701-1', ISSUE_PREFIX, '1405/06/17'),
    /حواله/
  );
});

test('a receipt whose number disagrees with its date is refused with 400', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docdate-'));
  const db = await buildDatabase(path.join(dir, 'a.db'));
  try {
    const service = new InventoryService(db);
    await assert.rejects(
      () =>
        service.createReceipt({
          receipt_number: 'R-050617-1',
          tarikh: '1405/07/01',
          lines: [{ kala_id: 'P001', maqdar: 1, vahed: 'عدد' }],
        }),
      (err) => err.statusCode === 400 && /یکی باشد/.test(err.message),
      'the embedded date and the header date must agree'
    );
    const rows = await db.all('SELECT COUNT(*) AS c FROM receipts');
    assert.equal(rows[0].c, 0, 'no document may be written for a refused number');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('an issue whose number disagrees with its date is refused with 400', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docdate-'));
  const db = await buildDatabase(path.join(dir, 'b.db'));
  try {
    const service = new InventoryService(db);
    await assert.rejects(
      () =>
        service.createIssue({
          issue_number: 'H-050701-1',
          tarikh: '1405/06/17',
          lines: [{ kala_id: 'P001', maqdar: 1, vahed: 'عدد' }],
        }),
      (err) => err.statusCode === 400 && /یکی باشد/.test(err.message)
    );
    const rows = await db.all('SELECT COUNT(*) AS c FROM issues');
    assert.equal(rows[0].c, 0, 'no document may be written for a refused number');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('a number that matches its date creates the document', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docdate-'));
  const db = await buildDatabase(path.join(dir, 'c.db'));
  try {
    const service = new InventoryService(db);
    const result = await service.createReceipt({
      receipt_number: 'R-050701-1',
      tarikh: '1405/07/01',
      lines: [{ kala_id: 'P001', maqdar: 2, vahed: 'عدد' }],
    });
    assert.ok(result.id, 'a number agreeing with its date is accepted');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

// ------------------------------- historical QA numbers are never rewritten

test('the seeded QA numbers are loaded exactly as recorded', async () => {
  // The seed deliberately contains numbers the new rules would refuse if they were
  // being created: issue numbers whose embedded date is not the document's own.
  // They are evidence of the old data, so the loader writes them as-is and nothing
  // in this module normalises them.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
  const db = await initDatabase(path.join(dir, 'qa.db'));
  try {
    const receipts = await db.all('SELECT receipt_number FROM receipts');
    assert.deepEqual(
      receipts.map((r) => r.receipt_number),
      ['R-050617-173'],
      'the seeded receipt number must be present verbatim'
    );

    const issues = await db.all('SELECT issue_number, tarikh FROM issues ORDER BY id');
    assert.deepEqual(
      issues.map((i) => [i.issue_number, i.tarikh]),
      [
        ['H-050617-1', '1405/06/17'],
        // H-050617-2 is dated 1405/06/18 and H-050617-3 is dated 1405/06/19: the
        // date inside those numbers is *not* the document's own. They stay as is.
        ['H-050617-2', '1405/06/18'],
        ['H-050617-3', '1405/06/19'],
      ],
      'the three seeded issue numbers and their dates must be preserved verbatim'
    );
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('re-seeding a database that holds the QA numbers rewrites none of them', async () => {
  // The live database also carries a deliberately free-form receipt number
  // (`R617-174 مهران`) that the new rules would refuse outright if it were being
  // created. The guarantee that matters is that no code path ever *rewrites* an
  // existing row to make it compliant — validation only ever guards creation.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
  let db = await initDatabase(path.join(dir, 'qa.db'));
  try {
    await db.run(
      `INSERT INTO receipts (receipt_number, tarikh, tavazihat)
       VALUES ('R617-174 مهران', '2026-09-30', 'رکورد آزمایشی تاریخی')`
    );
    const before = await db.all(
      `SELECT receipt_number, tarikh, tavazihat FROM receipts ORDER BY id`
    );
    await db.close();

    // Re-initialising an existing catalog must be a no-op on its documents.
    db = await initDatabase(path.join(dir, 'qa.db'));
    const after = await db.all(
      `SELECT receipt_number, tarikh, tavazihat FROM receipts ORDER BY id`
    );
    assert.deepEqual(
      after,
      before,
      'an existing document — including one the new rules would refuse — must never be rewritten'
    );
  } finally {
    await db.close();
    await removeDir(dir);
  }
});
