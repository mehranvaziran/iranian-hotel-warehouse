import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, readFileSync, existsSync } from 'fs';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '..', '..', 'data');
mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'warehouse.db');

export async function initDatabase() {
  // Use a timestamped database or check for real data requirements
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec('PRAGMA foreign_keys = ON');

  // Check if tables exist and contain data
  const tableCheck = await db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='kala'"
  );

  // Create tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS kala (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kod_kala TEXT UNIQUE NOT NULL,
      naam_kala TEXT NOT NULL,
      goh TEXT,
      zirgoh TEXT,
      vahed TEXT,
      hadd_aqal_mojoodi REAL DEFAULT 0,
      mojoodi_fael REAL DEFAULT 0,
      tavazihat TEXT
    );

    CREATE TABLE IF NOT EXISTS vorood (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_num TEXT UNIQUE NOT NULL,
      tarikh DATE,
      radif INTEGER,
      kala_id TEXT,
      naam_kala TEXT,
      maqdar REAL,
      vahed TEXT,
      tavazihat TEXT
    );

    CREATE TABLE IF NOT EXISTS khorooj (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_num TEXT UNIQUE NOT NULL,
      tarikh DATE,
      radif INTEGER,
      kala_id TEXT,
      naam_kala TEXT,
      maqdar REAL,
      vahed TEXT,
      tahvil_gir TEXT,
      mahl_masraf TEXT,
      tavazihat TEXT
    );

    CREATE TABLE IF NOT EXISTS mojoodi_mabna (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kala_id TEXT,
      kod_kala TEXT,
      naam_kala TEXT,
      vahed TEXT,
      mabna_qty REAL,
      tarikh_mabna DATE,
      tavazihat TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_kala_kod ON kala(kod_kala);
    CREATE INDEX IF NOT EXISTS idx_vorood_tarikh ON vorood(tarikh);
    CREATE INDEX IF NOT EXISTS idx_khorooj_tarikh ON khorooj(tarikh);
  `);

  // Load real data if table is empty
  if (tableCheck) {
    const itemCount = await db.get('SELECT COUNT(*) as count FROM kala');
    if (itemCount.count === 0) {
      await loadSampleData(db);
    } else {
      console.log(`Database already initialized with ${itemCount.count} items`);
    }
  } else {
    await loadSampleData(db);
  }

  return db;
}

async function loadSampleData(db) {
  // Load REAL data from Excel export
  const realDataPath = path.join(__dirname, '..', 'data', 'real-warehouse-data.json');

  if (!fs.existsSync(realDataPath)) {
    console.log('⚠️  Real data file not found. Skipping data load.');
    console.log('   Run: node scripts/import-real-data.js');
    return;
  }

  try {
    const realData = JSON.parse(fs.readFileSync(realDataPath, 'utf-8'));

    console.log('Loading REAL warehouse data from Excel...');

    // Load items (کالاها) - 28 real items from Excel
    for (const item of realData.items) {
      await db.run(
        `INSERT INTO kala (kod_kala, naam_kala, goh, zirgoh, vahed, hadd_aqal_mojoodi, mojoodi_fael)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          item.kod_kala,
          item.naam_kala,
          item.goh,
          item.zirgoh,
          item.vahed,
          item.hadd_aqal_mojoodi,
          item.mojoodi_fael
        ]
      );
    }
    console.log(`  ✓ Loaded ${realData.items.length} items`);

    // Load receipts (رسید‌ها) - 5 real receipt transactions
    for (const receipt of realData.receipts) {
      await db.run(
        `INSERT INTO vorood (receipt_num, tarikh, radif, kala_id, naam_kala, maqdar, vahed, tavazihat)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          receipt.receipt_num,
          receipt.tarikh,
          receipt.radif,
          receipt.kala_id,
          receipt.naam_kala,
          receipt.maqdar,
          receipt.vahed,
          receipt.tavazihat
        ]
      );
    }
    console.log(`  ✓ Loaded ${realData.receipts.length} receipt transactions`);

    // Load issues (خروج‌ها) - 3 real issue transactions
    for (const issue of realData.issues) {
      await db.run(
        `INSERT INTO khorooj (issue_num, tarikh, radif, kala_id, naam_kala, maqdar, vahed, tahvil_gir, mahl_masraf, tavazihat)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          issue.issue_num,
          issue.tarikh,
          issue.radif,
          issue.kala_id,
          issue.naam_kala,
          issue.maqdar,
          issue.vahed,
          issue.tahvil_gir,
          issue.mahl_masraf,
          issue.tavazihat
        ]
      );
    }
    console.log(`  ✓ Loaded ${realData.issues.length} issue transactions`);

    // Load baseline inventory (موجودی مبنا) - 10 real baseline records
    for (const mabna of realData.baseline) {
      await db.run(
        `INSERT INTO mojoodi_mabna (kala_id, kod_kala, naam_kala, vahed, mabna_qty, tarikh_mabna, tavazihat)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          mabna.kala_id,
          mabna.kala_id,
          mabna.naam_kala,
          mabna.vahed,
          mabna.mabna_qty,
          mabna.tarikh_mabna,
          mabna.tavazihat
        ]
      );
    }
    console.log(`  ✓ Loaded ${realData.baseline.length} baseline inventory records`);

    console.log('\n✅ REAL warehouse data loaded successfully from Excel');
    console.log(`   Source: سیستم انبار.xlsx`);
    console.log(`   ${realData.metadata.total_items} items | ${realData.metadata.total_receipts} receipts | ${realData.metadata.total_issues} issues`);

  } catch (err) {
    console.error('Error loading real data:', err.message);
    throw err;
  }
}
