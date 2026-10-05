/**
 * Item-code suggestion.
 *
 * A code is a group prefix plus a numeric sequence inside it, so the sequence has
 * to be compared as a *number*: `K9` is textually greater than `K010` while
 * numerically less, and following the text order once made the endpoint suggest a
 * code the catalog already had.
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

import { parseItemCode, suggestNextItemCode, lastItemCode, itemCodePrefix } from '../src/utils/itemCode.js';
import { createSchema } from '../src/db.js';

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

/** A scratch database with just the catalog table and the codes given. */
async function buildDatabase(dbPath, codes) {
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await createSchema(db);
  for (const kod_kala of codes) {
    await db.run(
      `INSERT INTO kala (kod_kala, naam_kala, vahed, is_active) VALUES (?, 'کالا', 'عدد', 1)`,
      [kod_kala]
    );
  }
  return db;
}

// ------------------------------------------------------------------ parsing

test('parseItemCode splits a prefix from its numeric suffix', () => {
  assert.deepEqual(parseItemCode('K001'), { prefix: 'K', digits: '001', number: 1, rest: '' });
  assert.deepEqual(parseItemCode('T005'), { prefix: 'T', digits: '005', number: 5, rest: '' });
  assert.deepEqual(parseItemCode('K9'), { prefix: 'K', digits: '9', number: 9, rest: '' });
});

test('parseItemCode keeps any trailing text after the digits', () => {
  // A code with a Persian suffix still has a numeric part to increment.
  assert.deepEqual(parseItemCode('K019-ب'), { prefix: 'K', digits: '019', number: 19, rest: '-ب' });
});

test('parseItemCode reports a code with no digits at all', () => {
  assert.equal(parseItemCode('KNAUF'), null);
});

test('itemCodePrefix reads the letters a code is grouped under', () => {
  // The suggestion endpoint reads this off whatever the user typed, so the form
  // does not re-parse the code's shape in the browser.
  assert.equal(itemCodePrefix('K019'), 'K');
  assert.equal(itemCodePrefix('k019'), 'K');
  assert.equal(itemCodePrefix('  KA1  '), 'KA');
  assert.equal(itemCodePrefix('E'), 'E');
  assert.equal(itemCodePrefix('001'), '');
  assert.equal(itemCodePrefix(''), '');
});

// ------------------------------------------------------- numeric ordering

test('K001, K009, K010 suggest K011 — width is not assumed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itemcode-'));
  const db = await buildDatabase(path.join(dir, 'a.db'), ['K001', 'K009', 'K010']);
  try {
    assert.equal(await suggestNextItemCode(db, 'K'), 'K011');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('a bare K9 is followed by K10, not a padded guess', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itemcode-'));
  const db = await buildDatabase(path.join(dir, 'b.db'), ['K9']);
  try {
    assert.equal(await suggestNextItemCode(db, 'K'), 'K10');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('the suggestion is the numeric maximum, not the textually-highest code', async () => {
  // This is the actual defect: as text, K9 sorts above K010, so the old query
  // read 9 off it and suggested K010 — a code the catalog already has. Numerically
  // the maximum is 10, so the suggestion is K011 and cannot collide.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itemcode-'));
  const db = await buildDatabase(path.join(dir, 'c.db'), ['K9', 'K010']);
  try {
    const suggested = await suggestNextItemCode(db, 'K');
    assert.equal(suggested, 'K011');
    const rows = await db.all('SELECT kod_kala FROM kala WHERE kod_kala = ?', [suggested]);
    assert.equal(rows.length, 0, 'the suggestion must not be a code that already exists');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('a code with a letter suffix does not break the sequence', async () => {
  // `parseInt('019-ب')` is still 19, so such a code participates as 19.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itemcode-'));
  const db = await buildDatabase(path.join(dir, 'd.db'), ['K019-ب']);
  try {
    assert.equal(await suggestNextItemCode(db, 'K'), 'K020');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('a prefix with no codes yet starts at the padding the catalog uses', async () => {
  // The new group has no width of its own, so it inherits the one the rest of
  // the catalog uses — a `K###` catalog starts `E` at `E001`, which is the shape
  // the suggestion offers the user. The width is read off the data, not assumed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itemcode-'));
  const db = await buildDatabase(path.join(dir, 'e.db'), ['K001', 'K002']);
  try {
    assert.equal(await suggestNextItemCode(db, 'S'), 'S001');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('a catalog of bare codes gives a new prefix an unpadded start', async () => {
  // `K9`-shaped codes carry no padding to inherit, so a new group starts at 1
  // without invented zeros.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itemcode-'));
  const db = await buildDatabase(path.join(dir, 'e2.db'), ['K9']);
  try {
    assert.equal(await suggestNextItemCode(db, 'S'), 'S1');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('lastItemCode reports the highest-numbered code of a prefix', async () => {
  // The suggestion panel shows the last code the catalog has alongside the next
  // free one, and both come from the same read of the sequence.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itemcode-'));
  const db = await buildDatabase(path.join(dir, 'h.db'), ['K003', 'K018', 'K004', 'KA1']);
  try {
    assert.equal(await lastItemCode(db, 'K'), 'K018');
    assert.equal(await lastItemCode(db, 'KA'), 'KA1');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('lastItemCode reports null for a prefix the catalog does not use', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itemcode-'));
  const db = await buildDatabase(path.join(dir, 'i.db'), ['K001']);
  try {
    assert.equal(await lastItemCode(db, 'E'), null);
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('a code that merely starts with the prefix does not join its sequence', async () => {
  // KA1 begins with the letters K but its own prefix is KA, so it must not count
  // towards the K sequence.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itemcode-'));
  const db = await buildDatabase(path.join(dir, 'f.db'), ['K005', 'KA1']);
  try {
    assert.equal(await suggestNextItemCode(db, 'K'), 'K006');
    assert.equal(await suggestNextItemCode(db, 'KA'), 'KA2');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('the prefix is upper-cased and trimmed like the API argument', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itemcode-'));
  const db = await buildDatabase(path.join(dir, 'g.db'), ['K003']);
  try {
    assert.equal(await suggestNextItemCode(db, ' k '), 'K004');
  } finally {
    await db.close();
    await removeDir(dir);
  }
});
