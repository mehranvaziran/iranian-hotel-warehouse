/**
 * Concurrency: two independent writers spending the same stock.
 *
 * The previous test fired two `fetch` calls at the server through `Promise.all`
 * and called the result proof. It is not: Node runs one event loop, both
 * requests land on the same connection, and SQLite never sees two writers at
 * once. It proved nothing about the race.
 *
 * This test uses two real worker threads, each with its *own* SQLite
 * connection to the same file. They rendezvous on an atomic barrier so both
 * reach the critical section at the same moment, then each tries to issue the
 * item's entire stock. Only one may succeed; the other must be rejected and no
 * negative stock may result.
 *
 * The mechanism under test is `BEGIN IMMEDIATE` in the document service: the
 * write lock is taken *before* the stock check, so the second writer can only
 * proceed after the first committed — by which time the stock it reads is the
 * stock the first writer left behind. Under a deferred `BEGIN`, both would read
 * the pre-write stock and both would succeed, driving the item negative.
 *
 * Run:  node --test ./tests   (from the backend directory)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(__dirname, 'workers', 'issue-duel-worker.js');
const ROUNDS = 5;
const STAKE = 10;

/**
 * Windows sometimes keeps a directory handle a beat longer than `close()`
 * returns, so a plain `rmSync` can EPERM out on a directory the test has
 * finished with. A short retry makes teardown reliable without hiding a real
 * failure — the attempts are bounded and the last error surfaces.
 */
async function removeDir(dir) {
  let lastErr = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      lastErr = err;
      // Windows can release a directory handle a beat after close() returns.
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw lastErr;
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Build an isolated database with the schema and one stocked item per round.
 * The connection is opened explicitly — never through the env-var default — so
 * the test cannot touch the live warehouse.db by accident.
 */
async function buildDatabase(dbPath, { seed }) {
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  const { createSchema } = await import('../src/db.js');
  await createSchema(db);

  for (let round = 0; round < ROUNDS; round++) {
    const code = `DUEL${round}`;
    await db.run(
      `INSERT INTO kala (kod_kala, naam_kala, goh, vahed, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [code, `کالای رقابت ${round + 1}`, 'آزمایش', 'عدد']
    );
    await db.run(
      `INSERT INTO mojoodi_mabna (kala_id, mabna_qty, tarikh_mabna, tavazihat)
       VALUES (?, ?, '1405/07/01', 'موجودی آزمایش رقابت')`,
      [code, STAKE]
    );
  }
  if (seed) await seed(db);
  return db;
}

async function currentStock(db, code) {
  const row = await db.get(
    `SELECT
       COALESCE((SELECT SUM(mabna_qty) FROM mojoodi_mabna WHERE kala_id = ?), 0)
     + COALESCE((SELECT SUM(maqdar) FROM receipt_lines WHERE kala_id = ?), 0)
     - COALESCE((SELECT SUM(maqdar) FROM issue_lines WHERE kala_id = ?), 0) AS stock`,
    [code, code, code]
  );
  return Number(row.stock);
}

/**
 * Run one duel round in two workers. Each worker opens its own connection,
 * waits at the barrier for the other, then submits an issue for the whole stake.
 */
async function duelRound(dbPath, round) {
  const code = `DUEL${round}`;
  // A shared two-slot barrier: neither worker starts the critical section until
  // both are ready and waiting.
  const barrier = new SharedArrayBuffer(4);

  const runWorker = (index) =>
    new Promise((resolve, reject) => {
      // Set just before the worker is spawned, so its import-time read of the
      // path resolves to this database and nothing else.
      process.env.WAREHOUSE_DB_PATH = dbPath;
      const worker = new Worker(WORKER, {
        workerData: { dbPath, code, stake: STAKE, tag: `${round}-${index}`, barrier },
      });
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', (exitCode) => {
        if (exitCode !== 0) reject(new Error(`worker exited with ${exitCode}`));
      });
    });

  return Promise.all([runWorker(0), runWorker(1)]);
}

test('two concurrent writers cannot both spend the same stock', async () => {
  const dir = tempDir('warehouse-duel-');
  const dbPath = path.join(dir, 'duel.db');
  const db = await buildDatabase(dbPath, {});

  try {
    for (let round = 0; round < ROUNDS; round++) {
      const results = await duelRound(dbPath, round);

      const successes = results.filter((r) => r.ok);
      assert.equal(
        successes.length,
        1,
        `round ${round}: exactly one of the two concurrent issues must succeed` +
          ` (got ${JSON.stringify(results)})`
      );

      const failure = results.find((r) => !r.ok);
      assert.equal(failure.status, 400, `round ${round}: the loser must be rejected cleanly`);
      assert.match(
        String(failure.error),
        /ناکافی|غیرفعال|وجود ندارد/,
        `round ${round}: the loser must be told why, got: ${failure.error}`
      );
    }

    // Every round ended with the item's stock exactly spent: neither writer took
    // more than the stake, and neither partial document survived.
    for (let round = 0; round < ROUNDS; round++) {
      const code = `DUEL${round}`;
      const stock = await currentStock(db, code);
      assert.ok(stock >= 0, `${code}: stock must never go negative (got ${stock})`);
      assert.equal(stock, 0, `${code}: stock must end at exactly zero (got ${stock})`);

      const issues = await db.all(
        `SELECT i.id, il.maqdar FROM issues i
         JOIN issue_lines il ON il.issue_id = i.id
         WHERE il.kala_id = ?`,
        [code]
      );
      assert.equal(issues.length, 1, `${code}: exactly one issue document must exist`);
      assert.equal(
        Number(issues[0].maqdar),
        STAKE,
        `${code}: the surviving document must carry the whole stake`
      );
    }
  } finally {
    await db.close();
    await removeDir(dir);
  }
});

test('the stock check sees writes committed by a concurrent writer', async () => {
  // The sequential face of the same rule: one writer spends the whole stake,
  // a second writer arriving afterwards must see the committed stock and be
  // refused. This guards against a check that reads a snapshot frozen at
  // transaction start.
  const dir = tempDir('warehouse-seq-');
  const dbPath = path.join(dir, 'seq.db');
  const db = await buildDatabase(dbPath, {});

  let dbA = null;
  let dbB = null;
  try {
    dbA = await open({ filename: dbPath, driver: sqlite3.Database });
    dbB = await open({ filename: dbPath, driver: sqlite3.Database });
    const { InventoryService } = await import('../src/services/inventoryService.js');
    const a = new InventoryService(dbA);
    const b = new InventoryService(dbB);

    await a.createIssue({
      issue_number: 'DUEL-SEQ-1',
      tarikh: '1405/07/01',
      lines: [{ kala_id: 'DUEL0', maqdar: STAKE, vahed: 'عدد' }],
    });

    await assert.rejects(
      () =>
        b.createIssue({
          issue_number: 'DUEL-SEQ-2',
          tarikh: '1405/07/01',
          lines: [{ kala_id: 'DUEL0', maqdar: STAKE, vahed: 'عدد' }],
        }),
      /ناکافی/,
      'the second issue must be refused with insufficient stock'
    );

    assert.equal(await currentStock(db, 'DUEL0'), 0, 'only the first issue may have been written');
  } finally {
    if (dbA) await dbA.close();
    if (dbB) await dbB.close();
    await db.close();
    await removeDir(dir);
  }
});
