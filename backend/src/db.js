import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '..', '..', 'data');
// Overridable so the test suite can build an isolated throwaway database
// instead of mutating the live warehouse.db.
const dbPath = process.env.WAREHOUSE_DB_PATH || path.join(dbDir, 'warehouse.db');

export async function initDatabase() {
  mkdirSync(path.dirname(dbPath), { recursive: true });

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

  // Keep updated_at honest: the column existed but was never maintained, so it
  // always held the creation timestamp. Created after the tables exist, and
  // SQLite has recursive_triggers OFF by default so they do not re-fire
  // themselves.
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_kala_updated_at
    AFTER UPDATE ON kala FOR EACH ROW
    BEGIN
      UPDATE kala SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_receipts_updated_at
    AFTER UPDATE ON receipts FOR EACH ROW
    BEGIN
      UPDATE receipts SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_issues_updated_at
    AFTER UPDATE ON issues FOR EACH ROW
    BEGIN
      UPDATE issues SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;
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

    // Items: idempotent so re-seeding an existing catalog is a no-op.
    for (const item of data.items) {
      await db.run(
        `INSERT OR IGNORE INTO kala (kod_kala, naam_kala, goh, zirgoh, vahed, hadd_aqal_mojoodi)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [item.kod_kala, item.naam_kala, item.goh, item.zirgoh, item.vahed, item.hadd_aqal_mojoodi || 0]
      );
    }

    const codeByName = new Map(data.items.map((i) => [i.naam_kala, i.kod_kala]));
    const resolveCode = (row) => row.kala_id || codeByName.get(row.naam_kala);

    if (data.baseline) {
      // The seed extraction historically shifted the item code into the notes
      // column for most baseline rows, so kala_id may be missing. Fall back to
      // matching the item by name, which is present on every row.
      for (const b of data.baseline) {
        const kalaId = resolveCode(b);
        if (!kalaId) {
          console.warn(`⚠️  Baseline row for "${b.naam_kala}" could not be mapped to an item, skipped`);
          continue;
        }
        await db.run(
          `INSERT OR IGNORE INTO mojoodi_mabna (kala_id, mabna_qty, tarikh_mabna, tavazihat)
           VALUES (?, ?, ?, ?)`,
          [kalaId, b.mabna_qty, b.tarikh_mabna, b.tavazihat || '']
        );
      }
    }

    // Opening receipts and issues. These used to be silently dropped — the
    // loader only ever read `items` and `baseline` — which is how a rebuilt
    // database lost every opening document. They are part of the seed.
    if (data.receipts) {
      const headers = new Map();
      for (const r of data.receipts) {
        const kalaId = resolveCode(r);
        if (!kalaId) {
          console.warn(`⚠️  Receipt line for "${r.naam_kala}" could not be mapped to an item, skipped`);
          continue;
        }
        if (!headers.has(r.receipt_num)) {
          const res = await db.run(
            `INSERT OR IGNORE INTO receipts (receipt_number, tarikh, tavazihat)
             VALUES (?, ?, ?)`,
            [r.receipt_num, r.tarikh, r.tavazihat || '']
          );
          // INSERT OR IGNORE returns lastID 0 when the row already existed;
          // look the id up so re-seeding a live database is still a no-op.
          headers.set(
            r.receipt_num,
            res.lastID ||
              (await db.get(`SELECT id FROM receipts WHERE receipt_number = ?`, [r.receipt_num])).id
          );
        }
        await db.run(
          `INSERT INTO receipt_lines (receipt_id, kala_id, maqdar, vahed, tavazihat, radif)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [headers.get(r.receipt_num), kalaId, r.maqdar, r.vahed || '', r.tavazihat || '', r.radif]
        );
      }
      console.log(`✅ Seeded ${headers.size} receipts (${data.receipts.length} lines)`);
    }

    if (data.issues) {
      const headers = new Map();
      for (const i of data.issues) {
        const kalaId = resolveCode(i);
        if (!kalaId) {
          console.warn(`⚠️  Issue line for "${i.naam_kala}" could not be mapped to an item, skipped`);
          continue;
        }
        if (!headers.has(i.issue_num)) {
          const res = await db.run(
            `INSERT OR IGNORE INTO issues (issue_number, tarikh, tahvil_gir, mahl_masraf, tavazihat)
             VALUES (?, ?, ?, ?, ?)`,
            [i.issue_num, i.tarikh, i.tahvil_gir || '', i.mahl_masraf || '', i.tavazihat || '']
          );
          headers.set(
            i.issue_num,
            res.lastID ||
              (await db.get(`SELECT id FROM issues WHERE issue_number = ?`, [i.issue_num])).id
          );
        }
        await db.run(
          `INSERT INTO issue_lines (issue_id, kala_id, maqdar, vahed, tavazihat, radif)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [headers.get(i.issue_num), kalaId, i.maqdar, i.vahed || '', i.tavazihat || '', i.radif]
        );
      }
      console.log(`✅ Seeded ${headers.size} issues (${data.issues.length} lines)`);
    }

    console.log('✅ Initial data loaded');
  } catch (err) {
    console.error('Error loading data:', err.message);
  }
}
