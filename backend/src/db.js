import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', '..', 'data', 'warehouse.db');

export async function initDatabase() {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec('PRAGMA foreign_keys = ON');

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
      kala_id INTEGER,
      naam_kala TEXT,
      maqdar REAL,
      vahed TEXT,
      tavazihat TEXT,
      FOREIGN KEY (kala_id) REFERENCES kala(id)
    );

    CREATE TABLE IF NOT EXISTS khorooj (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_num TEXT UNIQUE NOT NULL,
      tarikh DATE,
      radif INTEGER,
      kala_id INTEGER,
      naam_kala TEXT,
      maqdar REAL,
      vahed TEXT,
      tahvil_gir TEXT,
      mahl_masraf TEXT,
      tavazihat TEXT,
      FOREIGN KEY (kala_id) REFERENCES kala(id)
    );

    CREATE TABLE IF NOT EXISTS mojoodi_mabna (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kala_id INTEGER,
      kod_kala TEXT,
      naam_kala TEXT,
      vahed TEXT,
      mabna_qty REAL,
      tarikh_mabna DATE,
      tavazihat TEXT,
      FOREIGN KEY (kala_id) REFERENCES kala(id)
    );

    CREATE INDEX IF NOT EXISTS idx_kala_kod ON kala(kod_kala);
    CREATE INDEX IF NOT EXISTS idx_vorood_tarikh ON vorood(tarikh);
    CREATE INDEX IF NOT EXISTS idx_khorooj_tarikh ON khorooj(tarikh);
  `);

  // Load sample data if tables are empty
  const kalaCount = await db.get('SELECT COUNT(*) as count FROM kala');
  if (kalaCount.count === 0) {
    await loadSampleData(db);
  }

  return db;
}

async function loadSampleData(db) {
  // Sample items (کالاها)
  const items = [
    { kod: 'K001', naam: 'سیمان پرتلند', goh: 'مصالح ساختمانی', zirgoh: 'چسب و ماده اول', vahed: 'کیسه', hadd: 50, mojoodi: 45 },
    { kod: 'K002', naam: 'آجر قرمز استاندارد', goh: 'مصالح ساختمانی', zirgoh: 'آجر', vahed: 'عدد', hadd: 5000, mojoodi: 3200 },
    { kod: 'K003', naam: 'شن تصفیه‌شده', goh: 'مصالح ساختمانی', zirgoh: 'شن و ماسه', vahed: 'تن', hadd: 100, mojoodi: 45 },
    { kod: 'K004', naam: 'آهن تیرآهن', goh: 'فلزات', zirgoh: 'آهن ساختمانی', vahed: 'تن', hadd: 50, mojoodi: 12 },
    { kod: 'K005', naam: 'شیشه شفاف', goh: 'مصالح ساختمانی', zirgoh: 'شیشه', vahed: 'متر مربع', hadd: 500, mojoodi: 200 },
    { kod: 'K006', naam: 'رنگ دیواری سفید', goh: 'مصالح رنگ', zirgoh: 'رنگ داخلی', vahed: 'لیتر', hadd: 200, mojoodi: 150 },
    { kod: 'K007', naam: 'درب چوبی استاندارد', goh: 'تجهیزات', zirgoh: 'درب و پنجره', vahed: 'عدد', hadd: 30, mojoodi: 15 },
    { kod: 'K008', naam: 'سرامیک کفپوش', goh: 'مصالح ساختمانی', zirgoh: 'سرامیک', vahed: 'متر مربع', hadd: 1000, mojoodi: 350 },
  ];

  for (const item of items) {
    await db.run(
      `INSERT INTO kala (kod_kala, naam_kala, goh, zirgoh, vahed, hadd_aqal_mojoodi, mojoodi_fael)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [item.kod, item.naam, item.goh, item.zirgoh, item.vahed, item.hadd, item.mojoodi]
    );
  }

  // Sample receipts (رسید‌ها)
  const receipts = [
    { num: 'R001', tarikh: '1403-06-15', kala: 'K001', maqdar: 20, vahed: 'کیسه' },
    { num: 'R002', tarikh: '1403-06-16', kala: 'K002', maqdar: 500, vahed: 'عدد' },
    { num: 'R003', tarikh: '1403-06-17', kala: 'K003', maqdar: 10, vahed: 'تن' },
  ];

  for (const receipt of receipts) {
    const kala = await db.get('SELECT id, naam_kala FROM kala WHERE kod_kala = ?', [receipt.kala]);
    if (kala) {
      await db.run(
        `INSERT INTO vorood (receipt_num, tarikh, kala_id, naam_kala, maqdar, vahed)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [receipt.num, receipt.tarikh, kala.id, kala.naam_kala, receipt.maqdar, receipt.vahed]
      );
    }
  }

  // Sample issues (خروج‌ها)
  const issues = [
    { num: 'I001', tarikh: '1403-06-18', kala: 'K001', maqdar: 10, vahed: 'کیسه', tahvil: 'احمد حسنی', mahl: 'طبقه 3' },
    { num: 'I002', tarikh: '1403-06-19', kala: 'K002', maqdar: 250, vahed: 'عدد', tahvil: 'علی رضایی', mahl: 'طبقه 2' },
  ];

  for (const issue of issues) {
    const kala = await db.get('SELECT id, naam_kala FROM kala WHERE kod_kala = ?', [issue.kala]);
    if (kala) {
      await db.run(
        `INSERT INTO khorooj (issue_num, tarikh, kala_id, naam_kala, maqdar, vahed, tahvil_gir, mahl_masraf)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [issue.num, issue.tarikh, kala.id, kala.naam_kala, issue.maqdar, issue.vahed, issue.tahvil, issue.mahl]
      );
    }
  }

  // Sample base inventory (موجودی مبنا)
  for (const item of items) {
    const kala = await db.get('SELECT id FROM kala WHERE kod_kala = ?', [item.kod]);
    if (kala) {
      await db.run(
        `INSERT INTO mojoodi_mabna (kala_id, kod_kala, naam_kala, vahed, mabna_qty, tarikh_mabna)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [kala.id, item.kod, item.naam, item.vahed, item.mojoodi, '1403-01-01']
      );
    }
  }

  console.log('Sample data loaded successfully');
}
