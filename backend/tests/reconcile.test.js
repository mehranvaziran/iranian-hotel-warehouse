/**
 * The Excel reconciler must run on a stock Windows install.
 *
 * It used to shell out to an external `unzip` binary, which is not present on a
 * default Windows machine — so the same script that worked in CI silently
 * failed locally. It now reads the workbook in-process, which means the failure
 * modes it can hit are ones this test gets to see: a file that is not an
 * archive, an archive that is, and a path that does not exist.
 *
 * Run:  node --test ./tests   (from the backend directory)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { extractZipToDir, extractZip } from '../../scripts/lib/zip-extract.js';
import { reconcile } from '../../scripts/reconcile-excel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

async function removeDir(dir) {
  let lastErr = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      lastErr = err;
      // Windows can hold a directory handle a beat after the last close().
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw lastErr;
}

// ------------------------------------------------------------- the ZIP reader

/**
 * Build a minimal ZIP archive in memory, the way the writer of an .xlsx would:
 * one entry stored raw and one deflated. Hand-built rather than taken from a
 * library so the reader is the only thing under test.
 */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, 'utf-8');
    const method = name.endsWith('.bin') ? 0 : 8;
    const payload =
      method === 0 ? Buffer.from(data) : zlib.deflateRawSync(Buffer.from(data));

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mtime
    local.writeUInt16LE(0, 12); // mdate
    local.writeUInt32LE(0, 14); // crc32 — not checked by the reader
    local.writeUInt32LE(payload.length, 18); // compressed size
    local.writeUInt32LE(Buffer.from(data).length, 22); // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    chunks.push(local, nameBytes, payload);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); // central directory signature
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(payload.length, 20); // compressed size
    entry.writeUInt32LE(Buffer.from(data).length, 24); // uncompressed size
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(0, 30); // extra length
    entry.writeUInt16LE(0, 32); // comment length
    entry.writeUInt32LE(offset, 42); // relative offset of the local header
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + payload.length;
  }

  const centralBlob = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, centralBlob, eocd]);
}

test('the reader reads both stored and deflated entries', () => {
  const archive = buildZip([
    ['hello.txt', 'سلام دنیا'],
    ['nested/sheet.xml', '<sheet/>'],
    ['payload.bin', 'raw bytes'],
  ]);

  const extracted = extractZip(archive);
  assert.deepEqual([...extracted.keys()], ['hello.txt', 'nested/sheet.xml', 'payload.bin']);
  assert.equal(extracted.get('hello.txt').toString('utf-8'), 'سلام دنیا');
  assert.equal(extracted.get('nested/sheet.xml').toString('utf-8'), '<sheet/>');
  assert.equal(extracted.get('payload.bin').toString('utf-8'), 'raw bytes');
});

test('the reader rejects something that is not a ZIP archive', () => {
  assert.throws(
    () => extractZip(Buffer.from('this is clearly not an archive')),
    /not a ZIP archive/i,
    'a plain file must be refused with a clear message, not a cryptic crash'
  );
});

test('extractZipToDir writes the entries to a directory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-zip-'));
  const archivePath = path.join(dir, 'workbook.xlsx');
  fs.writeFileSync(archivePath, buildZip([['xl/workbook.xml', '<workbook/>']]));

  try {
    const out = extractZipToDir(archivePath);
    const written = path.join(out, 'xl', 'workbook.xml');
    assert.ok(fs.existsSync(written), 'the nested entry must be written out');
    assert.equal(fs.readFileSync(written, 'utf-8'), '<workbook/>');
  } finally {
    await removeDir(dir);
  }
});

// ------------------------------------------------------------- the reconciler

test('a dry run against the checked-in workbook reports a match', () => {
  // This is the path that used to need an external `unzip`. Reaching the match
  // report means the workbook was read, parsed, and diffed entirely in-process.
  const result = reconcile({});
  assert.equal(result, null, 'the seed already matches the Excel source');
});

test('a missing workbook is reported clearly', () => {
  assert.throws(
    () => reconcile({ excelPath: path.join(os.tmpdir(), 'warehouse-nope-1234.xlsx') }),
    /Excel source not found/i,
    'the failure must name the missing file'
  );
});

test('a file that is not a workbook fails, not the whole tool', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-bad-'));
  const bogus = path.join(dir, 'broken.xlsx');
  fs.writeFileSync(bogus, Buffer.from('not a zip at all'));

  try {
    assert.throws(
      () => reconcile({ excelPath: bogus }),
      /Could not read the Excel workbook/i,
      'the error must say the workbook could not be read'
    );
  } finally {
    await removeDir(dir);
  }
});
