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

/**
 * Open and initialise the database.
 *
 * @param {string} [explicitPath] - Override the env-var/default path. Lets a
 *   caller (an explicit tool, a test) name the database it means instead of
 *   relying on the env var being set before this module was first imported.
 */
export async function initDatabase(explicitPath) {
  const target = explicitPath || dbPath;
  mkdirSync(path.dirname(target), { recursive: true });

  const db = await open({
    filename: target,
    driver: sqlite3.Database,
  });

  // A database that already has the catalog was seeded before; leave its data
  // alone. Checked before createSchema() because every table it creates is
  // IF NOT EXISTS, so afterwards a fresh and a populated database look alike.
  const tableCheck = await db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='kala'"
  );

  await createSchema(db);

  if (!tableCheck) {
    await loadInitialData(db);
  }
  // Reference data (group ordering, unit precision) is derived from the
  // catalog that is already there and only ever *added* — an existing row is
  // never updated or deleted, so this is safe to run on every startup against
  // a live database. Groups and units that already exist keep their order and
  // their precision.
  await ensureGroupOrder(db);
  await ensureUnitPrecision(db);
  // An existing database is left exactly as it is. Startup never deletes
  // anything: the legacy `vorood`/`khorooj` schema conversion is a one-off that
  // belongs in the explicit `src/scripts/migrate-legacy-schema.js` tool, not on
  // the boot path of every server.

  return db;
}

/**
 * Make sure a `groups` row exists for `name`.
 *
 * An item can be created in a group nobody has used before. Ordering is stored
 * data, so that group needs a row with a sort_order, or it falls to the end of
 * the list by default — which is the right place for a group that was just
 * added. Existing rows are never touched: an INSERT OR IGNORE means a group that
 * is already there keeps the order it has.
 *
 * Safe to run against a live database at any time; it only ever adds a row.
 */
export async function ensureGroup(db, name) {
  const group = String(name ?? '').trim();
  if (!group) return;
  const row = await db.get('SELECT MAX(sort_order) AS max_order FROM groups');
  const nextOrder = row && Number.isFinite(row.max_order) ? row.max_order + 10 : 10;
  await db.run(
    'INSERT OR IGNORE INTO groups (name, sort_order) VALUES (?, ?)',
    [group, nextOrder]
  );
}

/**
 * Populate `groups` from the distinct `goh` values the catalog already uses.
 *
 * The order is the order the groups first appear in the catalog (by smallest
 * kala id), which is the order the seed data has always presented them in.
 * Running this on a database whose groups table is already populated is a
 * no-op: nothing is reordered, nothing is renamed, nothing is removed.
 */
export async function ensureGroupOrder(db) {
  const existing = await db.get('SELECT COUNT(*) AS c FROM groups');
  if (existing.c > 0) return;

  const rows = await db.all(
    `SELECT goh, MIN(id) AS first_id
     FROM kala
     WHERE goh IS NOT NULL AND TRIM(goh) <> ''
     GROUP BY goh
     ORDER BY first_id`
  );

  // 10 apart so a group inserted later can slot between two existing ones
  // without renumbering anything.
  let order = 10;
  for (const row of rows) {
    await db.run(
      'INSERT OR IGNORE INTO groups (name, sort_order) VALUES (?, ?)',
      [row.goh, order]
    );
    order += 10;
  }
}

/**
 * Make sure a `unit_precision` row exists for `unit`.
 *
 * An item can be created with a unit nobody has used before. Precision is
 * business metadata, so the unit needs a row; the safe default for a unit
 * nobody has configured is whole quantities (0 decimals), which is what every
 * quantity already stored in this system is. A unit that needs decimals is
 * configured by updating that row, not by changing code.
 *
 * Only ever adds a row — an existing unit keeps the precision it has.
 */
export async function ensureUnit(db, unit) {
  const vahed = String(unit ?? '').trim();
  if (!vahed) return;
  await db.run(
    'INSERT OR IGNORE INTO unit_precision (vahed, decimals) VALUES (?, 0)',
    [vahed]
  );
}

/**
 * Populate `unit_precision` from the units the catalog already uses.
 *
 * Every quantity currently stored in this system is a whole number, so the
 * derived default for an existing unit is 0 decimals — the stored values are
 * never altered to match. The table is what makes the precision *configurable*:
 * a unit that needs one or two decimals becomes a row here.
 */
export async function ensureUnitPrecision(db) {
  const existing = await db.get('SELECT COUNT(*) AS c FROM unit_precision');
  if (existing.c > 0) return;

  // DISTINCT and an aggregate cannot share one query in SQLite, so the unit set
  // is grouped in a subquery and only then ordered by first appearance.
  const rows = await db.all(
    `SELECT vahed, MIN(id) AS first_id
     FROM kala
     WHERE vahed IS NOT NULL AND TRIM(vahed) <> ''
     GROUP BY vahed
     ORDER BY first_id`
  );

  for (const row of rows) {
    await db.run(
      'INSERT OR IGNORE INTO unit_precision (vahed, decimals) VALUES (?, 0)',
      [row.vahed]
    );
  }
}

/**
 * Create the schema and its triggers on a connection. Idempotent, and the only
 * schema-creating code in the system. Exported so an explicit tool can open a
 * specific database and build the schema there without having to go through the
 * env-var-derived default path.
 */
export async function createSchema(db) {
  await db.exec('PRAGMA foreign_keys = ON');
  // Wait for the write lock instead of failing on contact. A concurrent writer
  // is expected — `BEGIN IMMEDIATE` serialises document creation — and losing
  // the lock contest with a hard SQLITE_BUSY would turn a legitimately queued
  // request into a 500.
  await db.exec('PRAGMA busy_timeout = 5000');

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

    -- Groups: the canonical, ordered list of item categories. 'goh' on kala
    -- stays as-is (it is business data we never rewrite); this table is what
    -- gives a group its display order, so ordering is stored data rather than
    -- an alphabetically- or hard-coded convention.
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      sort_order INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Unit precision: how many decimal places a given unit of measure may carry.
    -- This is business metadata, not a front-end constant — a new unit (say
    -- "متر" needing two decimals) is a row here, not a code change in React.
    CREATE TABLE IF NOT EXISTS unit_precision (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vahed TEXT UNIQUE NOT NULL,
      decimals INTEGER NOT NULL DEFAULT 0
    );
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
