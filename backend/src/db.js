import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '..', '..', 'data');
const dbPath = path.join(dbDir, 'warehouse.db');

export async function initDatabase() {
  mkdirSync(dbDir, { recursive: true });

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec('PRAGMA foreign_keys = ON');

  const tableCheck = await db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='kala'"
  );

  // Create new schema tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS kala (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kod_kala TEXT UNIQUE NOT NULL,
      naam_kala TEXT NOT NULL,
      goh TEXT,
      zirgoh TEXT,
      vahed TEXT,
      hadd_aqal_mojoodi REAL DEFAULT 0,
      tavazihat TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mojoodi_mabna (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kala_id TEXT NOT NULL,
      mabna_qty REAL NOT NULL,
      tarikh_mabna DATE,
      tavazihat TEXT,
      FOREIGN KEY (kala_id) REFERENCES kala(kod_kala)
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_number TEXT UNIQUE NOT NULL,
      tarikh DATE NOT NULL,
      tavazihat TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS receipt_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL,
      kala_id TEXT NOT NULL,
      maqdar REAL NOT NULL,
      vahed TEXT,
      tavazihat TEXT,
      radif INTEGER,
      FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE,
      FOREIGN KEY (kala_id) REFERENCES kala(kod_kala)
    );

    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_number TEXT UNIQUE NOT NULL,
      tarikh DATE NOT NULL,
      tahvil_gir TEXT,
      mahl_masraf TEXT,
      tavazihat TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS issue_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL,
      kala_id TEXT NOT NULL,
      maqdar REAL NOT NULL,
      vahed TEXT,
      tavazihat TEXT,
      radif INTEGER,
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
      FOREIGN KEY (kala_id) REFERENCES kala(kod_kala)
    );

    CREATE INDEX IF NOT EXISTS idx_kala_kod ON kala(kod_kala);
    CREATE INDEX IF NOT EXISTS idx_kala_active ON kala(is_active);
    CREATE INDEX IF NOT EXISTS idx_receipt_lines_receipt ON receipt_lines(receipt_id);
    CREATE INDEX IF NOT EXISTS idx_receipt_lines_item ON receipt_lines(kala_id);
    CREATE INDEX IF NOT EXISTS idx_issue_lines_issue ON issue_lines(issue_id);
    CREATE INDEX IF NOT EXISTS idx_issue_lines_item ON issue_lines(kala_id);
    CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(tarikh);
    CREATE INDEX IF NOT EXISTS idx_issues_date ON issues(tarikh);
  `);

  if (tableCheck) {
    await migrateToNewSchema(db);
  } else {
    await loadInitialData(db);
  }

  return db;
}

async function migrateToNewSchema(db) {
  console.log('Checking schema migration...');

  // Check kala columns
  const cols = await db.all(`PRAGMA table_info(kala)`);
  const hasMojoodi = cols.some(c => c.name === 'mojoodi_fael');
  const hasActive = cols.some(c => c.name === 'is_active');

  if (hasMojoodi || !hasActive) {
    console.log('Migrating kala table...');
    // Already migrated manually, skip
    console.log('✅ kala table ready');
  }

  // Check for old tables
  const hasVorood = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='vorood'");

  if (!hasVorood) {
    console.log('✅ No migration needed');
    return;
  }

  const receiptCount = await db.get(`SELECT COUNT(*) as c FROM receipts`);

  if (receiptCount.c > 0) {
    console.log('Data already migrated, cleaning up old tables...');
    await db.exec(`DROP TABLE IF EXISTS vorood`);
    await db.exec(`DROP TABLE IF EXISTS khorooj`);
    console.log('✅ Migration complete');
    return;
  }

  console.log('Migrating documents...');

  // Migrate receipts
  const oldReceipts = await db.all(`
    SELECT DISTINCT receipt_num, tarikh, tavazihat
    FROM vorood WHERE receipt_num IS NOT NULL
    ORDER BY tarikh, receipt_num
  `);

  for (const r of oldReceipts) {
    const res = await db.run(
      `INSERT INTO receipts (receipt_number, tarikh, tavazihat) VALUES (?, ?, ?)`,
      [r.receipt_num, r.tarikh, r.tavazihat || '']
    );

    const lines = await db.all(
      `SELECT kala_id, maqdar, vahed, tavazihat, radif
       FROM vorood WHERE receipt_num = ?
       ORDER BY COALESCE(radif, 999), id`,
      [r.receipt_num]
    );

    for (let i = 0; i < lines.length; i++) {
      await db.run(
        `INSERT INTO receipt_lines (receipt_id, kala_id, maqdar, vahed, tavazihat, radif)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [res.lastID, lines[i].kala_id, lines[i].maqdar, lines[i].vahed, lines[i].tavazihat || '', i + 1]
      );
    }
  }

  console.log(`✅ Migrated ${oldReceipts.length} receipts`);

  // Migrate issues
  const hasKhorooj = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='khorooj'");

  if (hasKhorooj) {
    const oldIssues = await db.all(`
      SELECT DISTINCT issue_num, tarikh, tahvil_gir, mahl_masraf, tavazihat
      FROM khorooj WHERE issue_num IS NOT NULL
      ORDER BY tarikh, issue_num
    `);

    for (const iss of oldIssues) {
      const res = await db.run(
        `INSERT INTO issues (issue_number, tarikh, tahvil_gir, mahl_masraf, tavazihat)
         VALUES (?, ?, ?, ?, ?)`,
        [iss.issue_num, iss.tarikh, iss.tahvil_gir || '', iss.mahl_masraf || '', iss.tavazihat || '']
      );

      const lines = await db.all(
        `SELECT kala_id, maqdar, vahed, tavazihat, radif
         FROM khorooj WHERE issue_num = ?
         ORDER BY COALESCE(radif, 999), id`,
        [iss.issue_num]
      );

      for (let i = 0; i < lines.length; i++) {
        await db.run(
          `INSERT INTO issue_lines (issue_id, kala_id, maqdar, vahed, tavazihat, radif)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [res.lastID, lines[i].kala_id, lines[i].maqdar, lines[i].vahed, lines[i].tavazihat || '', i + 1]
        );
      }
    }

    console.log(`✅ Migrated ${oldIssues.length} issues`);
  }

  // Drop old tables
  await db.exec(`DROP TABLE IF EXISTS vorood`);
  await db.exec(`DROP TABLE IF EXISTS khorooj`);
  console.log('✅ Migration complete');
}

async function loadInitialData(db) {
  const dataPath = path.join(__dirname, '..', 'data', 'real-warehouse-data.json');

  if (!existsSync(dataPath)) {
    console.log('⚠️  No initial data');
    return;
  }

  try {
    const data = JSON.parse(readFileSync(dataPath, 'utf-8'));
    console.log('Loading initial data...');

    for (const item of data.items) {
      await db.run(
        `INSERT INTO kala (kod_kala, naam_kala, goh, zirgoh, vahed, hadd_aqal_mojoodi)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [item.kod_kala, item.naam_kala, item.goh, item.zirgoh, item.vahed, item.hadd_aqal_mojoodi || 0]
      );
    }

    if (data.baseline) {
      // The Excel extraction shifted the item code into the notes column for
      // most baseline rows, so kala_id is often missing. Fall back to matching
      // the item by name, which is present on every row.
      const codeByName = new Map(data.items.map((i) => [i.naam_kala, i.kod_kala]));
      for (const b of data.baseline) {
        const kalaId = b.kala_id || codeByName.get(b.naam_kala);
        if (!kalaId) {
          console.warn(`⚠️  Baseline row for "${b.naam_kala}" could not be mapped to an item, skipped`);
          continue;
        }
        await db.run(
          `INSERT INTO mojoodi_mabna (kala_id, mabna_qty, tarikh_mabna, tavazihat)
           VALUES (?, ?, ?, ?)`,
          [kalaId, b.mabna_qty, b.tarikh_mabna, b.tavazihat || '']
        );
      }
    }

    console.log('✅ Initial data loaded');
  } catch (err) {
    console.error('Error loading data:', err.message);
  }
}
