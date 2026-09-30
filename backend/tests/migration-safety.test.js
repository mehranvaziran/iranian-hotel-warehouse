/**
 * Startup must never destroy data.
 *
 * The server used to run a schema migration on every boot that could `DROP
 * TABLE vorood` and `DROP TABLE khorooj` — the legacy movement tables. A
 * condition on it meant an ordinary restart of the development server could
 * delete real data. The conversion is now an explicit, separately-invoked tool
 * (src/scripts/migrate-legacy-schema.js) that reports first and only drops when
 * given `--write`.
 *
 * Run:  node --test ./tests   (from the backend directory)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(__dirname, '..');
const MIGRATION_SCRIPT = path.join(BACKEND, 'src', 'scripts', 'migrate-legacy-schema.js');

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
 * A database as it looked before the schema change: the legacy tables hold the
 * movements, the new tables do not exist yet.
 */
async function buildLegacyDatabase(dbPath) {
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  // The catalog as it looked before the schema change: the movement tables hold
  // the documents, the new document tables do not exist yet.
  await db.exec(`
    CREATE TABLE kala (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kod_kala TEXT UNIQUE NOT NULL,
      naam_kala TEXT NOT NULL,
      goh TEXT,
      zirgoh TEXT,
      vahed TEXT,
      hadd_aqal_mojoodi REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE vorood (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_num TEXT,
      tarikh TEXT,
      kala_id TEXT,
      maqdar REAL,
      vahed TEXT,
      tavazihat TEXT,
      radif INTEGER
    );

    CREATE TABLE khorooj (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_num TEXT,
      tarikh TEXT,
      kala_id TEXT,
      maqdar REAL,
      vahed TEXT,
      tahvil_gir TEXT,
      mahl_masraf TEXT,
      tavazihat TEXT,
      radif INTEGER
    );
  `);

  await db.run(`INSERT INTO kala (kod_kala, naam_kala) VALUES ('K001', 'کالای نمونه')`);

  await db.run(
    `INSERT INTO vorood (receipt_num, tarikh, kala_id, maqdar, vahed, tavazihat, radif)
     VALUES ('R-LEGACY-1', '1405/06/17', 'K001', 12, 'عدد', 'رسید تاریخی', 1)`
  );
  await db.run(
    `INSERT INTO khorooj (issue_num, tarikh, kala_id, maqdar, vahed, tahvil_gir, mahl_masraf, tavazihat, radif)
     VALUES ('H-LEGACY-1', '1405/06/18', 'K001', 4, 'عدد', 'انباردار', 'انبار', 'حواله تاریخی', 1)`
  );

  return db;
}

async function tableNames(db) {
  const rows = await db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  return rows.map((r) => r.name);
}

// ------------------------------------------------------- startup is non-destructive

test('initialising an existing database leaves the legacy tables and their rows alone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-migration-'));
  const dbPath = path.join(dir, 'legacy.db');
  const db = await buildLegacyDatabase(dbPath);

  try {
    await db.close();

    // initDatabase() is exactly what server startup calls, given the test
    // database explicitly so it cannot open the live one.
    const { initDatabase } = await import('../src/db.js');
    const started = await initDatabase(dbPath);

    const names = await tableNames(started);
    assert.ok(names.includes('vorood'), 'startup must not drop the legacy vorood table');
    assert.ok(names.includes('khorooj'), 'startup must not drop the legacy khorooj table');

    const vorood = await started.all(`SELECT * FROM vorood`);
    assert.equal(vorood.length, 1, 'the legacy receipt row must be untouched');
    assert.equal(vorood[0].receipt_num, 'R-LEGACY-1');

    const khorooj = await started.all(`SELECT * FROM khorooj`);
    assert.equal(khorooj.length, 1, 'the legacy issue row must be untouched');
    assert.equal(khorooj[0].issue_num, 'H-LEGACY-1');

    await started.close();
  } finally {
    await removeDir(dir);
  }
});

test('a fresh startup still creates the schema and seeds it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-fresh-'));
  const dbPath = path.join(dir, 'fresh.db');

  try {
    const { initDatabase } = await import('../src/db.js');
    const db = await initDatabase(dbPath);

    const names = await tableNames(db);
    assert.ok(names.includes('kala'), 'the catalog table must exist');
    assert.ok(names.includes('receipts'), 'the receipts table must exist');
    assert.ok(names.includes('issues'), 'the issues table must exist');

    const items = await db.all(`SELECT kod_kala FROM kala`);
    assert.ok(items.length > 0, 'a fresh database must be seeded with the catalog');

    await db.close();
  } finally {
    await removeDir(dir);
  }
});

// ------------------------------------------- the migration tool is explicit opt-in

async function runMigrationTool(...args) {
  return new Promise((resolve) => {
    const child = spawn('node', [MIGRATION_SCRIPT, ...args], {
      cwd: BACKEND,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

test('the migration tool refuses to run without an explicit database path', async () => {
  const { code, out } = await runMigrationTool();
  assert.notEqual(code, 0, 'running with no path must fail, not pick a default database');
  assert.match(out, /Usage/, 'the failure must explain how to invoke it');
});

test('the migration tool reports only, and keeps the legacy tables, without --write', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-migration-'));
  const dbPath = path.join(dir, 'legacy.db');
  const db = await buildLegacyDatabase(dbPath);

  try {
    await db.close();

    const { code, out } = await runMigrationTool(dbPath);
    assert.equal(code, 0, 'a dry run must exit successfully');
    assert.match(out, /Dry run/, 'it must say it changed nothing');
    assert.match(out, /Would convert: 1 receipts/, 'it must report the receipt it found');

    const check = await open({ filename: dbPath, driver: sqlite3.Database });
    const names = await tableNames(check);
    assert.ok(names.includes('vorood'), 'a dry run must keep the legacy tables');

    const receipts = await check.all(`SELECT * FROM receipts`);
    assert.equal(receipts.length, 0, 'a dry run must copy no rows');
    await check.close();
  } finally {
    await removeDir(dir);
  }
});

test('the migration tool converts and drops only when given --write', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-migration-'));
  const dbPath = path.join(dir, 'legacy.db');
  const db = await buildLegacyDatabase(dbPath);

  try {
    await db.close();

    const { code, out } = await runMigrationTool(dbPath, '--write');
    assert.equal(code, 0, out);
    assert.match(out, /Conversion complete/, 'it must report what it did');

    const check = await open({ filename: dbPath, driver: sqlite3.Database });
    const names = await tableNames(check);
    assert.ok(!names.includes('vorood'), 'only --write may drop the legacy tables');
    assert.ok(!names.includes('khorooj'), 'only --write may drop the legacy tables');

    const receipts = await check.all(`SELECT * FROM receipts`);
    assert.equal(receipts.length, 1, 'the legacy receipt must have been converted');
    assert.equal(receipts[0].receipt_number, 'R-LEGACY-1');

    const receiptLines = await check.all(`SELECT * FROM receipt_lines`);
    assert.equal(receiptLines.length, 1);
    assert.equal(Number(receiptLines[0].maqdar), 12);

    const issues = await check.all(`SELECT * FROM issues`);
    assert.equal(issues.length, 1, 'the legacy issue must have been converted');
    assert.equal(issues[0].issue_number, 'H-LEGACY-1');

    const issueLines = await check.all(`SELECT * FROM issue_lines`);
    assert.equal(issueLines.length, 1);
    assert.equal(Number(issueLines[0].maqdar), 4);

    await check.close();
  } finally {
    await removeDir(dir);
  }
});

test('running the tool twice is a no-op the second time', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-migration-'));
  const dbPath = path.join(dir, 'legacy.db');
  const db = await buildLegacyDatabase(dbPath);

  try {
    await db.close();

    const first = await runMigrationTool(dbPath, '--write');
    assert.equal(first.code, 0, first.out);

    const second = await runMigrationTool(dbPath, '--write');
    assert.equal(second.code, 0, second.out);

    const check = await open({ filename: dbPath, driver: sqlite3.Database });
    const receipts = await check.all(`SELECT * FROM receipts`);
    assert.equal(receipts.length, 1, 're-running must not duplicate the converted document');
    const receiptLines = await check.all(`SELECT * FROM receipt_lines`);
    assert.equal(receiptLines.length, 1, 're-running must not duplicate the converted lines');
    await check.close();
  } finally {
    await removeDir(dir);
  }
});
