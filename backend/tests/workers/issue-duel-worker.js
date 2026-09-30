/**
 * One contestant in the concurrency duel (see concurrency.test.js).
 *
 * Runs in its own worker thread with its own SQLite connection. Waits at the
 * shared barrier so both contestants reach the critical section together, then
 * submits an issue for the item's entire stock.
 */

import { parentPort, workerData } from 'node:worker_threads';

const { dbPath, code, stake, tag, barrier } = workerData;

// The database this worker uses — never the env default, and never the live one.
process.env.WAREHOUSE_DB_PATH = dbPath;

const { initDatabase } = await import('../../src/db.js');
const { InventoryService } = await import('../../src/services/inventoryService.js');

const db = await initDatabase();
const service = new InventoryService(db);

// Rendezvous: announce arrival, then wait until the other contestant is here too.
const flags = new Int32Array(barrier);
Atomics.add(flags, 0, 1);
Atomics.notify(flags, 0);
while (Atomics.load(flags, 0) < 2) {
  Atomics.wait(flags, 0, Atomics.load(flags, 0), 200);
}

try {
  const result = await service.createIssue({
    issue_number: `DUEL-${tag}`,
    tarikh: '1405/07/01',
    lines: [{ kala_id: code, maqdar: stake, vahed: 'عدد' }],
  });
  parentPort.postMessage({ ok: true, id: result.id });
} catch (err) {
  parentPort.postMessage({
    ok: false,
    status: err.statusCode ?? 500,
    error: err.message,
  });
} finally {
  await db.close();
}
