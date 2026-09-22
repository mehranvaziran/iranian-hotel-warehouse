import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'warehouse.db');

async function rebuildDatabase() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         REBUILD WAREHOUSE DATABASE WITH REAL DATA          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Delete old database
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
      console.log('✓ Removed old database\n');
    }

    // Open new database
    const db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database,
    });

    console.log('Creating tables...\n');

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

    // Load real data from JSON
    const dataPath = path.join(__dirname, '..', 'backend', 'data', 'real-warehouse-data.json');
    const realData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    console.log('Loading real items...\n');
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
    console.log(`✅ Loaded ${realData.items.length} items`);

    console.log('\nLoading real receipts...\n');
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
    console.log(`✅ Loaded ${realData.receipts.length} receipts`);

    console.log('\nLoading real issues...\n');
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
    console.log(`✅ Loaded ${realData.issues.length} issues`);

    console.log('\nLoading baseline inventory...\n');
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
    console.log(`✅ Loaded ${realData.baseline.length} baseline records\n`);

    // Verify counts
    const itemCount = await db.get('SELECT COUNT(*) as count FROM kala');
    const receiptCount = await db.get('SELECT COUNT(*) as count FROM vorood');
    const issueCount = await db.get('SELECT COUNT(*) as count FROM khorooj');
    const baselineCount = await db.get('SELECT COUNT(*) as count FROM mojoodi_mabna');

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║              DATABASE REBUILD COMPLETE                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`Database: ${DB_PATH}\n`);
    console.log('Record Counts:');
    console.log(`   Items:        ${itemCount.count}`);
    console.log(`   Receipts:     ${receiptCount.count}`);
    console.log(`   Issues:       ${issueCount.count}`);
    console.log(`   Baseline:     ${baselineCount.count}\n`);

    await db.close();

    // Verify against expected counts
    const expected = { items: 28, receipts: 2, issues: 3, baseline: 27 };
    const actual = {
      items: itemCount.count,
      receipts: receiptCount.count,
      issues: issueCount.count,
      baseline: baselineCount.count
    };

    let mismatch = false;
    if (actual.items !== expected.items) {
      console.log(`⚠️  Items mismatch: expected ${expected.items}, got ${actual.items}`);
      mismatch = true;
    }
    if (actual.receipts !== expected.receipts) {
      console.log(`⚠️  Receipts mismatch: expected ${expected.receipts}, got ${actual.receipts}`);
      mismatch = true;
    }
    if (actual.issues !== expected.issues) {
      console.log(`⚠️  Issues mismatch: expected ${expected.issues}, got ${actual.issues}`);
      mismatch = true;
    }
    if (actual.baseline !== expected.baseline) {
      console.log(`⚠️  Baseline mismatch: expected ${expected.baseline}, got ${actual.baseline}`);
      mismatch = true;
    }

    if (mismatch) {
      console.log('\n❌ Data count mismatch detected!\n');
      process.exit(1);
    } else {
      console.log('✅ All record counts match expected values!\n');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

rebuildDatabase();
