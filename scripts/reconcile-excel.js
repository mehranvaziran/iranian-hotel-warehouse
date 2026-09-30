/**
 * Reconcile the Excel source of truth with the JSON seed.
 *
 * Background: the original `extract-data.js` parsed worksheet cells with
 * `/<c r="([A-Z]+)(\d+)"[^>]*>.*?<\/c>/gs`. A self-closing cell such as
 * `<c r="F2" s="18"/>` has no `</c>`, so that regex swallowed the *next* cell
 * that did. The result was a one-column shift on any row containing an empty
 * cell — which is why 17 of 27 baseline rows in `real-warehouse-data.json`
 * lost `kala_id` and carry the following item's code in `tavazihat`.
 *
 * This script parses cells correctly (row-scoped, attribute-aware, handling
 * both `<c .../>` and `<c ...>...</c>` forms), rebuilds the canonical dataset
 * from `warehouse-source.xlsx`, reports the differences against the current
 * JSON seed, and — with `--write` — rewrites the seed to match the Excel.
 *
 * Usage:
 *   node scripts/reconcile-excel.js            # report only
 *   node scripts/reconcile-excel.js --write    # update the JSON seed
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const EXCEL_PATH = path.join(ROOT, 'warehouse-source.xlsx');
const JSON_PATH = path.join(ROOT, 'backend', 'data', 'real-warehouse-data.json');

// ---------------------------------------------------------------- worksheet IO

function unzipExcel(xlsxPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-excel-'));
  execSync(`unzip -q -o "${xlsxPath}" -d "${tempDir}"`);
  return tempDir;
}

function readSharedStrings(dir) {
  const xml = fs.readFileSync(path.join(dir, 'xl', 'sharedStrings.xml'), 'utf-8');
  return (xml.match(/<si>.*?<\/si>/gs) || []).map((si) =>
    (si.match(/<t[^>]*>([^<]*)<\/t>/g) || [])
      .map((t) => t.replace(/<t[^>]*>|<\/t>/g, ''))
      .join('')
  );
}

/**
 * Parse one worksheet into { rowNumber: { COLUMN: value } }.
 *
 * Cells come in two shapes and both must be handled without letting a
 * self-closing cell run into the next one:
 *   <c r="A2" s="8" t="s"><v>27</v></c>   -> shared string
 *   <c r="F2" s="18"/>                     -> empty
 */
function readSheet(dir, sheetName, sharedStrings) {
  const xml = fs.readFileSync(path.join(dir, 'xl', 'worksheets', sheetName), 'utf-8');
  const rows = {};

  const rowRe = /<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const rowNum = Number(rowMatch[1]);
    const body = rowMatch[2];
    const row = {};

    const cellRe = /<c r="([A-Z]+)(\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(body)) !== null) {
      const col = cellMatch[1];
      const attrs = cellMatch[3];
      const inner = cellMatch[5] === undefined ? '' : cellMatch[5];

      if (/t="s"/.test(attrs)) {
        const v = inner.match(/<v>([^<]*)<\/v>/);
        row[col] = v ? (sharedStrings[Number(v[1])] || '') : '';
      } else {
        const v = inner.match(/<v>([^<]*)<\/v>/);
        row[col] = v ? v[1] : '';
      }
    }

    rows[rowNum] = row;
  }

  return rows;
}

/** Rows of a sheet as an array of objects keyed by header, skipping the header row. */
function readTable(dir, sheetName, sharedStrings, headers) {
  const rows = readSheet(dir, sheetName, sharedStrings);
  return Object.keys(rows)
    .filter((r) => Number(r) > 1)
    .sort((a, b) => Number(a) - Number(b))
    .map((r) => rows[r])
    .filter((row) => String(row['A'] ?? '').trim() !== '')
    .map((row) => {
      const out = {};
      for (const [col, field] of Object.entries(headers)) {
        out[field] = row[col] ?? '';
      }
      return out;
    });
}

// ---------------------------------------------------------------- canonical build

const clean = (v) => String(v ?? '').trim();
const toNumber = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};

/** Jalali business date in canonical YYYY/MM/DD form. */
const toJalaliDate = (v) => {
  const s = clean(v);
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) throw new Error(`Not a Jalali date in canonical form: ${JSON.stringify(s)}`);
  return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
};

function buildCanonicalData(dir) {
  const sharedStrings = readSharedStrings(dir);

  const rawItems = readTable(dir, 'sheet1.xml', sharedStrings, {
    A: 'kod_kala', B: 'naam_kala', C: 'goh', D: 'zirgoh', E: 'vahed',
    F: 'hadd_aqal_mojoodi', G: 'tavazihat',
  });

  const items = rawItems.map((r) => ({
    kod_kala: clean(r.kod_kala),
    naam_kala: clean(r.naam_kala),
    goh: clean(r.goh),
    zirgoh: clean(r.zirgoh),
    vahed: clean(r.vahed),
    hadd_aqal_mojoodi: toNumber(r.hadd_aqal_mojoodi),
    tavazihat: clean(r.tavazihat),
  }));

  const byCode = new Map(items.map((i) => [i.kod_kala, i]));
  const knownCode = (code, naam) => {
    const c = clean(code);
    if (byCode.has(c)) return c;
    // Fall back to the name (the source sheets repeat the item name per line).
    const hit = items.find((i) => i.naam_kala === clean(naam));
    if (hit) return hit.kod_kala;
    throw new Error(`Unknown item in document line: code=${JSON.stringify(code)} name=${JSON.stringify(naam)}`);
  };

  const rawReceipts = readTable(dir, 'sheet2.xml', sharedStrings, {
    A: 'receipt_num', B: 'tarikh', C: 'radif', D: 'kala_id', E: 'naam_kala',
    F: 'maqdar', G: 'vahed', H: 'tavazihat',
  });

  const receipts = rawReceipts.map((r) => ({
    receipt_num: clean(r.receipt_num),
    tarikh: toJalaliDate(r.tarikh),
    radif: toNumber(r.radif),
    kala_id: knownCode(r.kala_id, r.naam_kala),
    naam_kala: clean(r.naam_kala),
    maqdar: toNumber(r.maqdar),
    vahed: clean(r.vahed),
    tavazihat: clean(r.tavazihat),
  }));

  const rawIssues = readTable(dir, 'sheet3.xml', sharedStrings, {
    A: 'issue_num', B: 'tarikh', C: 'radif', D: 'kala_id', E: 'naam_kala',
    F: 'maqdar', G: 'vahed', H: 'tahvil_gir', I: 'mahl_masraf', J: 'tavazihat',
  });

  const issues = rawIssues.map((r) => ({
    issue_num: clean(r.issue_num),
    tarikh: toJalaliDate(r.tarikh),
    radif: toNumber(r.radif),
    kala_id: knownCode(r.kala_id, r.naam_kala),
    naam_kala: clean(r.naam_kala),
    maqdar: toNumber(r.maqdar),
    vahed: clean(r.vahed),
    tahvil_gir: clean(r.tahvil_gir),
    mahl_masraf: clean(r.mahl_masraf),
    tavazihat: clean(r.tavazihat),
  }));

  const rawBaseline = readTable(dir, 'sheet8.xml', sharedStrings, {
    A: 'kala_id', B: 'naam_kala', C: 'vahed', D: 'mabna_qty', E: 'tarikh_mabna', F: 'tavazihat',
  });

  const baseline = rawBaseline.map((r) => ({
    kala_id: knownCode(r.kala_id, r.naam_kala),
    naam_kala: clean(r.naam_kala),
    vahed: clean(r.vahed),
    mabna_qty: toNumber(r.mabna_qty),
    tarikh_mabna: toJalaliDate(r.tarikh_mabna),
    tavazihat: clean(r.tavazihat),
  }));

  return {
    items,
    receipts,
    issues,
    baseline,
    metadata: {
      extracted_at: new Date().toISOString(),
      source_file: path.basename(EXCEL_PATH),
      total_items: items.length,
      total_receipts: receipts.length,
      total_issues: issues.length,
      total_baseline: baseline.length,
    },
  };
}

// ---------------------------------------------------------------- diffing

const KEY = {
  items: (r) => r.kod_kala,
  receipts: (r) => `${r.receipt_num}:${r.radif}`,
  issues: (r) => `${r.issue_num}:${r.radif}`,
  baseline: (r) => r.kala_id,
};

// Fields the seed carried that are stale computed values, not source data:
// stock is derived by the service, so they must not live in the seed.
const DROPPED_FIELDS = ['mojoodi_fael', 'total_receipts', 'total_issues', 'status'];

function diffSection(name, currentRows, canonicalRows, keyFn) {
  const current = new Map((currentRows || []).map((r) => [keyFn(r), r]));
  const canonical = new Map(canonicalRows.map((r) => [keyFn(r), r]));
  const notes = [];

  for (const key of canonical.keys()) {
    if (!current.has(key)) {
      notes.push(`  + ${name} ${key}: missing from current seed`);
      continue;
    }
    const before = current.get(key);
    const after = canonical.get(key);
    for (const field of Object.keys(after)) {
      const b = before[field];
      const a = after[field];
      const same = typeof a === 'number'
        ? Number(b ?? 0) === a
        : String(b ?? '').trim() === String(a).trim();
      if (!same) {
        notes.push(`  ~ ${name} ${key}.${field}: ${JSON.stringify(b)} -> ${JSON.stringify(a)}`);
      }
    }
    for (const field of DROPPED_FIELDS) {
      if (field in before) {
        notes.push(`  - ${name} ${key}.${field}: dropped stale computed field (${JSON.stringify(before[field])})`);
      }
    }
  }
  for (const key of current.keys()) {
    if (!canonical.has(key)) {
      notes.push(`  - ${name} ${key}: in seed but not in Excel (extra)`);
    }
  }

  return notes;
}

function reconcile() {
  if (!fs.existsSync(EXCEL_PATH)) {
    throw new Error(`Excel source not found: ${EXCEL_PATH}`);
  }

  const dir = unzipExcel(EXCEL_PATH);
  try {
    const canonical = buildCanonicalData(dir);
    const current = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   Excel ↔ JSON seed reconciliation                          ║');
    console.log(`║   source: ${path.basename(EXCEL_PATH).padEnd(45)}║`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`Excel : ${canonical.items.length} items, ${canonical.receipts.length} receipt lines,` +
      ` ${canonical.issues.length} issue lines, ${canonical.baseline.length} baseline rows`);
    console.log(`Seed  : ${(current.items || []).length} items, ${(current.receipts || []).length} receipt lines,` +
      ` ${(current.issues || []).length} issue lines, ${(current.baseline || []).length} baseline rows`);

    const baselineQty = canonical.baseline.reduce((s, b) => s + b.mabna_qty, 0);
    console.log(`Excel baseline total quantity: ${baselineQty}\n`);

    const allNotes = [
      ...diffSection('items', current.items, canonical.items, KEY.items),
      ...diffSection('receipt', current.receipts, canonical.receipts, KEY.receipts),
      ...diffSection('issue', current.issues, canonical.issues, KEY.issues),
      ...diffSection('baseline', current.baseline, canonical.baseline, KEY.baseline),
    ];

    if (allNotes.length === 0) {
      console.log('✅ Seed already matches the Excel source. No changes needed.\n');
      return null;
    }

    console.log(`Differences (${allNotes.length}):`);
    allNotes.forEach((n) => console.log(n));
    console.log();

    if (process.argv.includes('--write')) {
      fs.writeFileSync(JSON_PATH, JSON.stringify(canonical, null, 2) + '\n', 'utf-8');
      console.log(`✅ Wrote reconciled seed to ${path.relative(ROOT, JSON_PATH)}\n`);
    } else {
      console.log('Dry run — no files written. Pass --write to update the seed.\n');
    }

    return canonical;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const result = reconcile();
if (!result) process.exit(0);

// Fail loudly if the canonical data does not satisfy the core invariant the
// rest of the system depends on: baseline + receipts - issues must be >= 0 for
// every item (an issue cannot consume stock that was never there).
const stock = new Map();
for (const b of result.baseline) stock.set(b.kala_id, (stock.get(b.kala_id) || 0) + b.mabna_qty);
for (const r of result.receipts) stock.set(r.kala_id, (stock.get(r.kala_id) || 0) + r.maqdar);
for (const i of result.issues) stock.set(i.kala_id, (stock.get(i.kala_id) || 0) - i.maqdar);
const negative = [...stock.entries()].filter(([, q]) => q < 0);
if (negative.length) {
  console.error('❌ Invariant violated — these items would have negative stock:');
  negative.forEach(([code, q]) => console.error(`   ${code}: ${q}`));
  process.exit(1);
}
console.log(`✅ Invariant ok: all ${stock.size} items have non-negative stock` +
  ` (total ${[...stock.values()].reduce((a, b) => a + b, 0)})`);
