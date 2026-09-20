/**
 * Create fresh real warehouse database
 * Loads real data from Excel export
 */
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'warehouse_real.db');

async function createRealDatabase() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         CREATE REAL WAREHOUSE DATABASE                      ║');
  console.log('║         Loading actual data from Excel export               ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Delete old real database if it exists
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
      console.log('✓ Removed old real database\n');
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
    const dataPath = path.join(__dirname, 'data', 'real-warehouse-data.json');
    const realData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    console.log('Loading real items (کالاها)...\n');
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

    console.log('\nLoading real receipts (رسید‌ها)...\n');
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
    console.log(`✅ Loaded ${realData.receipts.length} receipt transactions`);

    console.log('\nLoading real issues (خروج‌ها)...\n');
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
    console.log(`✅ Loaded ${realData.issues.length} issue transactions`);

    console.log('\nLoading baseline inventory (موجودی مبنا)...\n');
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

    // Verify data
    const itemCount = await db.get('SELECT COUNT(*) as count FROM kala');
    const receiptCount = await db.get('SELECT COUNT(*) as count FROM vorood');
    const issueCount = await db.get('SELECT COUNT(*) as count FROM khorooj');
    const baselineCount = await db.get('SELECT COUNT(*) as count FROM mojoodi_mabna');

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║              DATABASE CREATION COMPLETE                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`✅ Database: warehouse_real.db\n`);
    console.log('Data Summary:');
    console.log(`   Items:        ${itemCount.count}`);
    console.log(`   Receipts:     ${receiptCount.count}`);
    console.log(`   Issues:       ${issueCount.count}`);
    console.log(`   Baseline:     ${baselineCount.count}\n`);

    // Sample data verification
    const sampleItem = await db.get('SELECT * FROM kala WHERE kod_kala = ?', ['K010']);
    if (sampleItem) {
      console.log('Sample Item Verification:');
      console.log(`   کد: ${sampleItem.kod_kala}`);
      console.log(`   نام: ${sampleItem.naam_kala}`);
      console.log(`   موجودی: ${sampleItem.mojoodi_fael} ${sampleItem.vahed}`);
      console.log(`   حداقل: ${sampleItem.hadd_aqal_mojoodi}\n`);
    }

    await db.close();
    console.log('✅ Real database ready for use!\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

createRealDatabase();
