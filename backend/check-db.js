import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'warehouse.db');

async function checkDB() {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  console.log('=== Checking vorood (receipts) ===');
  const receipts = await db.all('SELECT * FROM vorood LIMIT 2');
  console.log(JSON.stringify(receipts, null, 2));

  console.log('\n=== Checking khorooj (issues) ===');
  const issues = await db.all('SELECT * FROM khorooj LIMIT 2');
  console.log(JSON.stringify(issues, null, 2));

  console.log('\n=== Checking kala (items) with K018 ===');
  const kala = await db.all('SELECT * FROM kala WHERE kod_kala = "K018"');
  console.log(JSON.stringify(kala, null, 2));

  console.log('\n=== Testing JOIN with kod_kala ===');
  const joinTest = await db.all(`
    SELECT r.id, r.receipt_num, r.kala_id, k.id as kala_table_id, k.kod_kala, k.naam_kala
    FROM vorood r
    LEFT JOIN kala k ON r.kala_id = k.kod_kala
    LIMIT 2
  `);
  console.log(JSON.stringify(joinTest, null, 2));

  await db.close();
}

checkDB().catch(console.error);
