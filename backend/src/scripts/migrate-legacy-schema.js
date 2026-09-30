/**
 * Legacy schema conversion — explicit, opt-in, and never run by the server.
 *
 * The first version of this project stored every movement in flat `vorood` /
 * `khorooj` tables. Converting that into the document-oriented schema used now
 * is a one-off operation against one specific database, so it lives here rather
 * than on the startup path. Normal boot must never drop a table: an automatic
 * `DROP TABLE` on every server start is how a live database loses its history.
 *
 * The tool never guesses which database to touch — it requires the path as an
 * argument — and it reports what it would do first. Rows are only copied and
 * the legacy tables only dropped when `--write` is passed.
 *
 * Usage:
 *   node src/scripts/migrate-legacy-schema.js <path-to-db>           # report only
 *   node src/scripts/migrate-legacy-schema.js <path-to-db> --write   # copy + drop
 */

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { createSchema } from '../db.js';

async function listTables(db) {
  const rows = await db.all(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  );
  return rows.map((r) => r.name);
}

async function migrate(dbPath, { write }) {
  // Open the database the caller named, explicitly — never the env-var default,
  // and never the live one. A tool whose only job is to delete legacy tables
  // must not be able to open the wrong file by accident.
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await createSchema(db);

  const tables = await listTables(db);
  const hasVorood = tables.includes('vorood');
  const hasKhorooj = tables.includes('khorooj');

  if (!hasVorood && !hasKhorooj) {
    console.log('✅ No legacy vorood/khorooj tables present — nothing to convert.');
    return;
  }

  console.log(`Legacy tables found: ${[hasVorood && 'vorood', hasKhorooj && 'khorooj'].filter(Boolean).join(', ')}`);

  const summary = { receipts: 0, receiptLines: 0, issues: 0, issueLines: 0, skipped: 0 };
  const plan = [];

  if (hasVorood) {
    const documents = await db.all(`
      SELECT DISTINCT receipt_num, tarikh, tavazihat
      FROM vorood WHERE receipt_num IS NOT NULL
      ORDER BY tarikh, receipt_num
    `);

    for (const doc of documents) {
      const already = await db.get(
        `SELECT id FROM receipts WHERE receipt_number = ?`,
        [doc.receipt_num]
      );
      if (already) {
        summary.skipped++;
        continue;
      }

      const lines = await db.all(
        `SELECT kala_id, maqdar, vahed, tavazihat, radif
         FROM vorood WHERE receipt_num = ?
         ORDER BY COALESCE(radif, 999), id`,
        [doc.receipt_num]
      );

      plan.push({
        kind: 'receipt',
        number: doc.receipt_num,
        tarikh: doc.tarikh,
        tavazihat: doc.tavazihat || '',
        lines,
      });
      summary.receipts++;
      summary.receiptLines += lines.length;
    }
  }

  if (hasKhorooj) {
    const documents = await db.all(`
      SELECT DISTINCT issue_num, tarikh, tahvil_gir, mahl_masraf, tavazihat
      FROM khorooj WHERE issue_num IS NOT NULL
      ORDER BY tarikh, issue_num
    `);

    for (const doc of documents) {
      const already = await db.get(
        `SELECT id FROM issues WHERE issue_number = ?`,
        [doc.issue_num]
      );
      if (already) {
        summary.skipped++;
        continue;
      }

      const lines = await db.all(
        `SELECT kala_id, maqdar, vahed, tavazihat, radif
         FROM khorooj WHERE issue_num = ?
         ORDER BY COALESCE(radif, 999), id`,
        [doc.issue_num]
      );

      plan.push({
        kind: 'issue',
        number: doc.issue_num,
        tarikh: doc.tarikh,
        tahvil_gir: doc.tahvil_gir || '',
        mahl_masraf: doc.mahl_masraf || '',
        tavazihat: doc.tavazihat || '',
        lines,
      });
      summary.issues++;
      summary.issueLines += lines.length;
    }
  }

  console.log(
    `\nWould convert: ${summary.receipts} receipts (${summary.receiptLines} lines),` +
    ` ${summary.issues} issues (${summary.issueLines} lines);` +
    ` ${summary.skipped} document(s) already present and skipped.`
  );

  if (plan.length === 0) {
    console.log('Everything is already converted — the legacy tables can be dropped.');
    if (write) {
      await dropLegacyTables(db, { hasVorood, hasKhorooj });
    }
    return;
  }

  if (!write) {
    console.log('\nDry run — no rows copied and nothing dropped. Pass --write to convert.');
    for (const p of plan) {
      console.log(`  ${p.kind} ${p.number} (${p.tarikh}): ${p.lines.length} line(s)`);
    }
    return;
  }

  console.log('\nConverting...');
  for (const p of plan) {
    await db.run('BEGIN IMMEDIATE TRANSACTION');
    try {
      if (p.kind === 'receipt') {
        const res = await db.run(
          `INSERT INTO receipts (receipt_number, tarikh, tavazihat) VALUES (?, ?, ?)`,
          [p.number, p.tarikh, p.tavazihat]
        );
        for (let i = 0; i < p.lines.length; i++) {
          const l = p.lines[i];
          await db.run(
            `INSERT INTO receipt_lines (receipt_id, kala_id, maqdar, vahed, tavazihat, radif)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [res.lastID, l.kala_id, l.maqdar, l.vahed, l.tavazihat || '', i + 1]
          );
        }
      } else {
        const res = await db.run(
          `INSERT INTO issues (issue_number, tarikh, tahvil_gir, mahl_masraf, tavazihat)
           VALUES (?, ?, ?, ?, ?)`,
          [p.number, p.tarikh, p.tahvil_gir, p.mahl_masraf, p.tavazihat]
        );
        for (let i = 0; i < p.lines.length; i++) {
          const l = p.lines[i];
          await db.run(
            `INSERT INTO issue_lines (issue_id, kala_id, maqdar, vahed, tavazihat, radif)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [res.lastID, l.kala_id, l.maqdar, l.vahed, l.tavazihat || '', i + 1]
          );
        }
      }
      await db.run('COMMIT');
      console.log(`  ✅ ${p.kind} ${p.number} (${p.lines.length} lines)`);
    } catch (err) {
      await db.run('ROLLBACK');
      throw new Error(`Failed to convert ${p.kind} ${p.number}: ${err.message}`);
    }
  }

  await dropLegacyTables(db, { hasVorood, hasKhorooj });
  console.log('\n✅ Conversion complete.');
}

async function dropLegacyTables(db, { hasVorood, hasKhorooj }) {
  // Only after every row was copied. This is the only place in the system that
  // removes these tables.
  if (hasVorood) await db.exec('DROP TABLE IF EXISTS vorood');
  if (hasKhorooj) await db.exec('DROP TABLE IF EXISTS khorooj');
  console.log('Legacy tables dropped.');
}

async function main() {
  const dbPath = process.argv[2];
  const write = process.argv.includes('--write');

  if (!dbPath) {
    console.error(
      'Usage: node src/scripts/migrate-legacy-schema.js <path-to-db> [--write]\n\n' +
      'The database path is required on purpose — this tool must never be able\n' +
      'to run against an unintended database.'
    );
    process.exit(2);
  }

  try {
    await migrate(dbPath, { write });
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

main();
