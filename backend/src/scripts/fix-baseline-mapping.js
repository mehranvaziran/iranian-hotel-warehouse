/**
 * Fix the baseline inventory mapping (mojoodi_mabna).
 *
 * Background: the original Excel extraction shifted the item-code column into
 * the notes field, so most baseline rows were stored with kala_id = NULL and
 * the item code sitting in tavazihat. NULL-keyed baselines are invisible to
 * every stock calculation, so those items reported zero stock.
 *
 * This script re-derives kala_id from the item NAME, which is present and
 * correct on every baseline row. It only touches the mojoodi_mabna table,
 * leaving receipts/issues untouched, and it backs up the database first.
 *
 * Usage:  node backend/src/scripts/fix-baseline-mapping.js [--dry-run]
 */

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, copyFileSync, existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..', '..');
const DB_PATH = path.join(ROOT, 'data', 'warehouse.db');
const DATA_PATH = path.join(ROOT, 'backend', 'data', 'real-warehouse-data.json');
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error('❌ Database not found:', DB_PATH);
    process.exit(1);
  }
  if (!existsSync(DATA_PATH)) {
    console.error('❌ Source data not found:', DATA_PATH);
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

  // Guard: name-based mapping is only safe if item names are unique
  const nameCounts = {};
  for (const item of data.items) {
    nameCounts[item.naam_kala] = (nameCounts[item.naam_kala] || 0) + 1;
  }
  const duplicates = Object.entries(nameCounts).filter(([, count]) => count > 1);
  if (duplicates.length > 0) {
    console.error('❌ Duplicate item names found - name mapping is unsafe:', duplicates);
    process.exit(1);
  }

  const codeByName = new Map(data.items.map((i) => [i.naam_kala, i.kod_kala]));

  // Aggregate baseline by item code (a code may appear on more than one row)
  const aggregated = new Map();
  let unmatched = 0;
  for (const b of data.baseline) {
    const code = b.kala_id || codeByName.get(b.naam_kala);
    if (!code) {
      unmatched++;
      continue;
    }
    const entry = aggregated.get(code) || { kala_id: code, mabna_qty: 0, tarikh_mabna: b.tarikh_mabna, vahed: b.vahed };
    entry.mabna_qty += Number(b.mabna_qty || 0);
    aggregated.set(code, entry);
  }

  if (unmatched > 0) {
    console.error(`❌ ${unmatched} baseline rows could not be mapped to an item`);
    process.exit(1);
  }

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec('PRAGMA foreign_keys = ON');

  const before = await db.all(`
    SELECT kala_id, COALESCE(SUM(mabna_qty), 0) AS qty
    FROM mojoodi_mabna
    GROUP BY kala_id
    ORDER BY kala_id
  `);
  const beforeTotal = before.reduce((s, r) => s + Number(r.qty), 0);
  const nullRows = await db.get(`SELECT COUNT(*) AS c FROM mojoodi_mabna WHERE kala_id IS NULL`);

  console.log('--- Current baseline ---');
  console.log(`groups: ${before.length}, total qty: ${beforeTotal}, NULL-keyed rows: ${nullRows.c}`);
  console.log('currently NULL-keyed quantity:',
    (await db.get(`SELECT COALESCE(SUM(mabna_qty),0) AS q FROM mojoodi_mabna WHERE kala_id IS NULL`)).q);

  const afterTotal = [...aggregated.values()].reduce((s, r) => s + r.mabna_qty, 0);
  console.log('\n--- Repaired baseline ---');
  console.log(`items with baseline: ${aggregated.size}, total qty: ${afterTotal}`);
  console.log('delta vs current:', afterTotal - beforeTotal);
  console.log([...aggregated.values()].map((r) => `  ${r.kala_id} = ${r.mabna_qty} ${r.vahed || ''}`).join('\n'));

  if (DRY_RUN) {
    console.log('\n[dry-run] No changes written.');
    await db.close();
    return;
  }

  // Back up before writing
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(ROOT, 'data', `warehouse.backup-${stamp}.db`);
  copyFileSync(DB_PATH, backupPath);
  console.log(`\n💾 Backup written: ${path.basename(backupPath)}`);

  await db.exec('BEGIN TRANSACTION');
  try {
    await db.run(`DELETE FROM mojoodi_mabna`);
    for (const entry of aggregated.values()) {
      await db.run(
        `INSERT INTO mojoodi_mabna (kala_id, mabna_qty, tarikh_mabna, tavazihat)
         VALUES (?, ?, ?, ?)`,
        [entry.kala_id, entry.mabna_qty, entry.tarikh_mabna, `اصلاح نگاشت موجودی مبنا (${entry.vahed || ''})`.trim()]
      );
    }
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    console.error('❌ Repair failed, rolled back:', err.message);
    await db.close();
    process.exit(1);
  }

  const verify = await db.get(`SELECT COUNT(*) AS c, COALESCE(SUM(mabna_qty),0) AS total FROM mojoodi_mabna`);
  console.log(`\n✅ Repair complete: ${verify.c} rows, total qty ${verify.total}`);
  const stillNull = await db.get(`SELECT COUNT(*) AS c FROM mojoodi_mabna WHERE kala_id IS NULL`);
  console.log(`NULL-keyed rows remaining: ${stillNull.c}`);

  await db.close();
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
