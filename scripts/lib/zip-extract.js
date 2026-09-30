/**
 * Minimal ZIP (PKZIP) archive reader.
 *
 * Used to open an .xlsx workbook without shelling out to an external `unzip`
 * executable, which does not exist on a default Windows install. Node's own
 * `zlib` handles the deflate streams; the central directory is walked by hand.
 *
 * Supports the two methods OOXML producers use: stored (0) and deflated (8).
 */

import { inflateRawSync } from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EOCD_SIGNATURE = 0x06054b50; // PK\x05\x06 — end of central directory
const CD_SIGNATURE = 0x02014b50; // PK\x01\x02 — central directory file header
const LFH_SIGNATURE = 0x04034b50; // PK\x03\x04 — local file header

const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

/**
 * Extract every member of a ZIP archive into a Map keyed by entry name.
 *
 * @param {Buffer} buffer - The raw archive bytes.
 * @returns {Map<string, Buffer>}
 */
export function extractZip(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);

  // The end-of-central-directory record sits at the end of the file, after an
  // optional comment of up to 65535 bytes.
  if (buffer.length < 22) {
    throw new Error('Not a ZIP archive (file is smaller than the minimum record)');
  }

  const searchStart = Math.max(0, buffer.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Not a ZIP archive: no end-of-central-directory record found');
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries = new Map();

  let cursor = centralOffset;
  const centralEnd = centralOffset + centralSize;

  for (let i = 0; i < entryCount && cursor + 46 <= centralEnd; i++) {
    if (buffer.readUInt32LE(cursor) !== CD_SIGNATURE) {
      throw new Error('Corrupt archive: central directory entry has no valid signature');
    }

    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);

    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf-8');
    cursor += 46 + nameLength + extraLength + commentLength;

    // The local header's own name/extra lengths are what position the payload;
    // the central directory's sizes are what bound it.
    if (buffer.readUInt32LE(localHeaderOffset) !== LFH_SIGNATURE) {
      throw new Error(`Corrupt archive: no local header for "${name}"`);
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;

    const payload = buffer.subarray(dataOffset, dataOffset + compressedSize);

    let content;
    if (method === METHOD_STORED) {
      content = Buffer.from(payload);
    } else if (method === METHOD_DEFLATED) {
      content = inflateRawSync(payload);
    } else {
      throw new Error(`Unsupported compression method ${method} for "${name}"`);
    }

    entries.set(name, content);
  }

  return entries;
}

/**
 * Extract the archive at `archivePath` into a fresh temporary directory and
 * return that directory, matching the shape the workbook readers expect. The
 * caller removes the directory when it is done.
 */
export function extractZipToDir(archivePath) {
  const buffer = fs.readFileSync(archivePath);
  const entries = extractZip(buffer);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-excel-'));
  for (const [name, content] of entries) {
    const dest = path.join(dir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  return dir;
}
