/**
 * Comprehensive API Test Suite
 * Tests all endpoints of the Iranian Hotel Warehouse Management System
 *
 * Validates the derived-inventory invariants:
 *   current_stock = baseline + receipts - issues
 *
 * Isolation: the suite spawns its own server against a throwaway database in
 * the OS temp dir and tears it down afterwards. It never touches the live
 * data/warehouse.db — that lack of isolation is what previously destroyed real
 * documents in the development database.
 *
 * Run:  node tests/api-test.js
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');

const TEST_PORT = '3999';
const BASE_URL = `http://localhost:${TEST_PORT}/api`;

/**
 * Document numbers follow the convention `{R|H}-{Jalali YYMMDD}-{seq}`. Every
 * document this suite posts uses one of these, so the suite exercises the real
 * numbering rule instead of an arbitrary string the API would now reject.
 *
 * The head is built from the *document's own date*, because the number is
 * self-describing: the API rejects a number whose embedded Jalali date disagrees
 * with `tarikh`. The sequence is a process-wide counter (starting well above the
 * seeded documents' own sequences) so no two generated numbers collide, and the
 * date defaults to a day the suite uses for most of its documents.
 */
let docSeq = 900;
function jalaliHead(tarikh) {
  return String(tarikh).replace(/\D/g, '').slice(2, 8);
}
function nextReceiptNumber(tarikh = '1405/07/01') {
  return `R-${jalaliHead(tarikh)}-${++docSeq}`;
}
function nextIssueNumber(tarikh = '1405/07/01') {
  return `H-${jalaliHead(tarikh)}-${++docSeq}`;
}

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

let testsPassed = 0;
let testsFailed = 0;

// Track everything this suite creates so we can remove it afterwards
const created = { items: [], receipts: [], issues: [] };

let testServer = null;
let testDbDir = null;

async function test(name, fn) {
  try {
    console.log(`${colors.cyan}Testing: ${name}${colors.reset}`);
    await fn();
    console.log(`${colors.green}✓ ${name}${colors.reset}\n`);
    testsPassed++;
  } catch (error) {
    console.log(`${colors.red}✗ ${name}${colors.reset}`);
    console.log(`  Error: ${error.message}\n`);
    testsFailed++;
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertApproxEquals(actual, expected, message, tolerance = 1e-9) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

async function request(endpoint, options = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data, text };
}

async function fetchJSON(endpoint) {
  const { ok, status, data } = await request(endpoint);
  if (!ok) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`);
  return data;
}

async function postJSON(endpoint, body) {
  const { ok, status, data } = await request(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return { ok, status, data };
}

async function sendJSON(endpoint, method, body) {
  const { ok, status, data } = await request(endpoint, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!ok) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`);
  return data;
}

/** Find an item row by kod_kala in /api/items. */
async function getItem(kodKala, includeInactive = false) {
  const items = await fetchJSON(`/items${includeInactive ? '?include_inactive=1' : ''}`);
  return items.find((i) => i.kod_kala === kodKala);
}

// ------------------------------------------------------------------ server setup

async function startTestServer() {
  testDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-test-'));
  const dbPath = path.join(testDbDir, 'warehouse-test.db');

  testServer = spawn('node', ['src/server.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PORT: TEST_PORT, WAREHOUSE_DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let bootOutput = '';
  testServer.stdout.on('data', (d) => { bootOutput += d; });
  testServer.stderr.on('data', (d) => { bootOutput += d; });

  // Wait for the health endpoint to report the database is ready. The server
  // starts listening before initDatabase() finishes, so an ok response alone
  // is not enough — every request would otherwise hit the 503 guard.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        const body = await res.json();
        if (body.dbReady && body.inventoryServiceReady) return;
      }
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  testServer.kill('SIGKILL');
  throw new Error(`Test server failed to start. Output:\n${bootOutput}`);
}

async function stopTestServer() {
  if (!testServer) return;
  try {
    testServer.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    testServer.kill('SIGKILL');
  } catch { /* already gone */ }
  testServer = null;
}

// ---------------------------------------------------------------------- tests

async function runTests() {
  console.log(`${colors.yellow}
╔═══════════════════════════════════════════════════════════════╗
║   Iranian Hotel Warehouse Management System - API Tests      ║
╚═══════════════════════════════════════════════════════════════╝
${colors.reset}`);

  // ------------------------------------------------------------------
  // Basic endpoints
  // ------------------------------------------------------------------

  await test('Health check endpoint', async () => {
    const data = await fetchJSON('/health');
    assertEquals(data.status, 'ok', 'Health status');
    assertTrue(data.timestamp, 'Health check should return timestamp');
    assertTrue(data.dbReady, 'Database should be ready');
  });

  await test('Dashboard stats endpoint', async () => {
    const stats = await fetchJSON('/dashboard/stats');
    assertTrue('totalInventory' in stats, 'Stats should include totalInventory');
    assertTrue('itemsCount' in stats, 'Stats should include itemsCount');
    assertTrue('stockedItems' in stats, 'Stats should include stockedItems');
    assertTrue('outOfStockItems' in stats, 'Stats should include outOfStockItems');
    assertTrue(stats.itemsCount > 0, 'Should have items');
    assertEquals(
      stats.stockedItems + stats.outOfStockItems,
      stats.itemsCount,
      'stocked + out-of-stock must equal item count'
    );
  });

  await test('Items list uses derived stock', async () => {
    const items = await fetchJSON('/items');
    assertTrue(Array.isArray(items), 'Items should be an array');
    assertTrue(items.length > 0, 'Should have items');
    assertTrue('current_stock' in items[0], 'Item should have current_stock');
    assertTrue('baseline_qty' in items[0], 'Item should have baseline_qty');
    assertTrue('total_receipts' in items[0], 'Item should have total_receipts');
    assertTrue('total_issues' in items[0], 'Item should have total_issues');
    assertTrue(items.every((i) => i.is_active === 1), 'Default list should only include active items');
  });

  await test('Items list can include inactive items', async () => {
    const items = await fetchJSON('/items?include_inactive=1');
    assertTrue(Array.isArray(items), 'Items should be an array');
    assertTrue(items.some((i) => i.is_active === 0 || i.is_active === 1), 'Should return items with is_active flag');
  });

  await test('Inactive items stay visible in inventory with their stock', async () => {
    // Deactivate an item that holds stock, then confirm inventory and reports
    // still report it. An item retired from new transactions is not zero stock.
    const code = `V${Date.now().toString().slice(-6)}`;
    await postJSON('/items', { kod_kala: code, naam_kala: 'کالای غیرفعال آزمایشی', vahed: 'عدد' });
    created.items.push(code);

    await postJSON('/receipts', {
      receipt_number: nextReceiptNumber(),
      tarikh: '1405/07/01',
      lines: [{ kala_id: code, maqdar: 50, vahed: 'عدد' }],
    }).then((r) => created.receipts.push(r.data.id));

    await sendJSON(`/items/${code}`, 'DELETE');
    const inactive = await getItem(code, true);
    assertEquals(inactive.is_active, 0, 'Item should be deactivated');
    assertEquals(Number(inactive.current_stock), 50, 'Inactive item should still show its stock');

    const inventory = await fetchJSON('/inventory');
    const invRow = inventory.find((i) => i.kod_kala === code);
    assertTrue(invRow, 'Inactive item must remain visible in /api/inventory');
    assertEquals(Number(invRow.current_stock), 50, 'Inventory must report the inactive item stock');

    const report = await fetchJSON('/reports/inventory');
    const repRow = report.items.find((i) => i.kod_kala === code);
    assertTrue(repRow, 'Inactive item must remain visible in the inventory report');

    // And it must not be selectable for new documents.
    const active = await fetchJSON('/items');
    assertTrue(!active.some((i) => i.kod_kala === code), 'Inactive item must not appear in the active catalog');
  });

  await test('Inventory endpoint equals full catalog', async () => {
    const [items, inventory] = await Promise.all([
      fetchJSON('/items?include_inactive=1'),
      fetchJSON('/inventory'),
    ]);
    assertEquals(items.length, inventory.length, 'Both endpoints should return the same row count');
    const byCode = new Map(inventory.map((i) => [i.kod_kala, i]));
    for (const item of items) {
      const inv = byCode.get(item.kod_kala);
      assertTrue(inv, `Inventory missing item ${item.kod_kala}`);
      assertEquals(inv.current_stock, item.current_stock, `Stock mismatch for ${item.kod_kala}`);
    }
  });

  await test('Derived inventory invariant holds for every item', async () => {
    const items = await fetchJSON('/items?include_inactive=1');
    for (const item of items) {
      const expected = item.baseline_qty + item.total_receipts - item.total_issues;
      assertApproxEquals(
        Number(item.current_stock),
        Number(expected),
        `Invariant failed for ${item.kod_kala}`
      );
    }
  });

  await test('Dashboard warnings endpoint', async () => {
    const warnings = await fetchJSON('/dashboard/warnings');
    assertTrue(Array.isArray(warnings), 'Warnings should be an array');
    for (const w of warnings) {
      assertTrue(Number(w.current_stock) > 0, 'Warnings should only include in-stock items');
      assertTrue(
        Number(w.current_stock) < Number(w.hadd_aqal_mojoodi),
        'Warnings should be below minimum stock'
      );
    }
  });

  await test('Recent receipts / issues / activity endpoints', async () => {
    const [recentReceipts, recentIssues, activity] = await Promise.all([
      fetchJSON('/dashboard/recent-receipts'),
      fetchJSON('/dashboard/recent-issues'),
      fetchJSON('/dashboard/activity'),
    ]);
    assertTrue(Array.isArray(recentReceipts), 'Recent receipts should be an array');
    assertTrue(Array.isArray(recentIssues), 'Recent issues should be an array');
    assertTrue(Array.isArray(activity), 'Activity should be an array');
    if (recentReceipts.length > 0) {
      assertTrue('receipt_number' in recentReceipts[0], 'Recent receipt should have receipt_number');
      assertTrue('item_count' in recentReceipts[0], 'Recent receipt should have item_count');
      assertTrue('total_quantity' in recentReceipts[0], 'Recent receipt should have total_quantity');
    }
  });

  await test('Receipts and issues list report total_quantity', async () => {
    const [receipts, issues] = await Promise.all([fetchJSON('/receipts'), fetchJSON('/issues')]);
    for (const r of receipts) {
      assertTrue('total_quantity' in r, `Receipt ${r.receipt_number} should report total_quantity`);
      // The listed total must equal the sum of its actual lines.
      const detail = await fetchJSON(`/receipts/${r.id}`);
      const lineSum = detail.lines.reduce((s, l) => s + Number(l.maqdar || 0), 0);
      assertApproxEquals(Number(r.total_quantity), lineSum, `Receipt ${r.receipt_number} total_quantity`);
    }
    for (const i of issues) {
      assertTrue('total_quantity' in i, `Issue ${i.issue_number} should report total_quantity`);
      const detail = await fetchJSON(`/issues/${i.id}`);
      const lineSum = detail.lines.reduce((s, l) => s + Number(l.maqdar || 0), 0);
      assertApproxEquals(Number(i.total_quantity), lineSum, `Issue ${i.issue_number} total_quantity`);
    }
  });

  // ------------------------------------------------------------------
  // Seeding regression — opening documents must be loaded
  // ------------------------------------------------------------------

  await test('Seed loads opening receipts and issues, not just items and baseline', async () => {
    const receipts = await fetchJSON('/receipts');
    const issues = await fetchJSON('/issues');
    assertTrue(receipts.length > 0, 'A freshly seeded database must contain the opening receipts');
    assertTrue(issues.length > 0, 'A freshly seeded database must contain the opening issues');

    // K010 opens with 44 and the seeded issues consume 2 + 3 + 12 = 17.
    const item = await getItem('K010');
    assertApproxEquals(Number(item.current_stock), 27, 'K010 stock must reflect seeded baseline minus seeded issues');
  });

  // ------------------------------------------------------------------
  // Jalali date boundary
  // ------------------------------------------------------------------

  await test('Gregorian receipt date is rejected', async () => {
    const { ok, status, data } = await postJSON('/receipts', {
      receipt_number: nextReceiptNumber(),
      tarikh: '2026-09-30',
      lines: [{ kala_id: 'T001', maqdar: 1, vahed: 'عدد' }],
    });
    assertFalse(ok, 'Gregorian tarikh must be rejected');
    assertEquals(status, 400, 'Should return 400 for a Gregorian date');
    assertTrue(String(data.error).includes('شمسی'), `Error should mention the Jalali requirement, got: ${data.error}`);
  });

  await test('Gregorian issue date is rejected', async () => {
    const { ok, status } = await postJSON('/issues', {
      issue_number: nextIssueNumber(),
      tarikh: '2026-09-30',
      lines: [{ kala_id: 'T001', maqdar: 1, vahed: 'عدد' }],
    });
    assertFalse(ok, 'Gregorian tarikh must be rejected');
    assertEquals(status, 400, 'Should return 400 for a Gregorian date');
  });

  await test('Jalali receipt date in canonical form is accepted', async () => {
    const before = await getItem('T001');
    const { ok, data } = await postJSON('/receipts', {
      receipt_number: nextReceiptNumber('1405/07/01'),
      tarikh: '1405/07/01',
      lines: [{ kala_id: 'T001', maqdar: 4, vahed: 'عدد' }],
    });
    assertTrue(ok, `Jalali tarikh must be accepted, got: ${JSON.stringify(data)}`);
    created.receipts.push(data.id);
    const after = await getItem('T001');
    assertApproxEquals(Number(after.current_stock), Number(before.current_stock) + 4, 'Stock should increase');
  });

  // ------------------------------------------------------------------
  // Item lifecycle
  // ------------------------------------------------------------------

  const testCode = `T${Date.now().toString().slice(-6)}`;
  let multiLineIssueId = null;

  await test('Suggest next item code', async () => {
    const data = await fetchJSON('/items/suggest-code/K');
    assertTrue(data.suggested_code, 'Should return a suggested code');
    assertTrue(data.suggested_code.startsWith('K'), 'Suggested code should honour the prefix');
  });

  await test('Suggest next item code never emits NaN', async () => {
    // A code with a non-numeric suffix used to produce `${prefix}NaN`.
    const oddCode = `Z${Date.now().toString().slice(-6)}A`;
    await postJSON('/items', { kod_kala: oddCode, naam_kala: 'کالای پسوند غیرعددی', vahed: 'عدد' });
    created.items.push(oddCode);

    const data = await fetchJSON('/items/suggest-code/Z');
    assertTrue(data.suggested_code, 'Should return a suggested code');
    assertFalse(
      data.suggested_code.includes('NaN'),
      `Suggested code must never contain NaN, got: ${data.suggested_code}`
    );
  });

  await test('Create item (POST /items)', async () => {
    const { data: result, ok } = await postJSON('/items', {
      kod_kala: testCode,
      naam_kala: 'کالای آزمایشی',
      goh: 'آزمایش',
      zirgoh: 'تست',
      vahed: 'عدد',
      hadd_aqal_mojoodi: 5,
      tavazihat: 'ایجاد شده توسط تست خودکار',
    });
    assertTrue(ok, `Item creation should succeed, got: ${JSON.stringify(result)}`);
    assertEquals(result.kod_kala, testCode, 'Should echo the item code');
    created.items.push(testCode);

    const item = await getItem(testCode);
    assertTrue(item, 'Created item should be retrievable');
    assertEquals(Number(item.current_stock), 0, 'New item should have zero stock');
  });

  await test('Duplicate item code is rejected', async () => {
    const { ok, status } = await postJSON('/items', {
      kod_kala: testCode,
      naam_kala: 'تکراری',
      vahed: 'عدد',
    });
    assertFalse(ok, 'Should have rejected duplicate code');
    assertEquals(status, 400, 'Should return 400 for duplicate code');
  });

  await test('Update item (PUT /items/:kod_kala)', async () => {
    await sendJSON(`/items/${testCode}`, 'PUT', {
      naam_kala: 'کالای آزمایشی ویرایش شده',
      goh: 'آزمایش',
      zirgoh: 'تست',
      vahed: 'عدد',
      hadd_aqal_mojoodi: 10,
      tavazihat: 'ویرایش شده',
    });
    const item = await getItem(testCode);
    assertEquals(item.naam_kala, 'کالای آزمایشی ویرایش شده', 'Name should be updated');
    assertEquals(Number(item.hadd_aqal_mojoodi), 10, 'Min stock should be updated');
  });

  await test('Update refreshes updated_at', async () => {
    const before = await getItem(testCode, true);
    await new Promise((r) => setTimeout(r, 1100));
    await sendJSON(`/items/${testCode}`, 'PUT', {
      naam_kala: 'کالای آزمایشی ویرایش شده دوباره',
      goh: 'آزمایش',
      zirgoh: 'تست',
      vahed: 'عدد',
      hadd_aqal_mojoodi: 10,
      tavazihat: 'ویرایش شده',
    });
    const after = await getItem(testCode, true);
    assertTrue(
      String(after.updated_at) > String(before.updated_at),
      `updated_at should advance on edit (${before.updated_at} -> ${after.updated_at})`
    );
  });

  await test('Update missing item returns 404', async () => {
    try {
      await sendJSON('/items/NOPE-404', 'PUT', { naam_kala: 'x' });
      throw new Error('Should have returned 404');
    } catch (error) {
      assertTrue(error.message.includes('404'), 'Should return 404 for missing item');
    }
  });

  await test('Empty cardex for a new item', async () => {
    const cardex = await fetchJSON(`/items/${testCode}/cardex`);
    assertTrue(Array.isArray(cardex), 'Cardex should be an array');
    assertEquals(cardex.length, 0, 'New item should have no movements');
  });

  // ------------------------------------------------------------------
  // Document transactions
  // ------------------------------------------------------------------

  await test('Create multi-line receipt (POST /receipts)', async () => {
    const before = await getItem(testCode);
    const { ok, data: receipt } = await postJSON('/receipts', {
      receipt_number: nextReceiptNumber(),
      tarikh: '1405/07/01',
      tavazihat: 'رسید آزمایشی',
      lines: [
        { kala_id: testCode, maqdar: 20, vahed: 'عدد', tavazihat: 'ردیف اول' },
        { kala_id: testCode, maqdar: 5, vahed: 'عدد', tavazihat: 'ردیف دوم' },
      ],
    });
    assertTrue(ok, `Receipt creation should succeed, got: ${JSON.stringify(receipt)}`);
    assertTrue(receipt.id, 'Receipt creation should return ID');
    created.receipts.push(receipt.id);

    const after = await getItem(testCode);
    assertApproxEquals(
      Number(after.current_stock),
      Number(before.current_stock) + 25,
      'Stock should increase by the sum of all lines'
    );
    assertEquals(Number(after.total_receipts), 25, 'total_receipts should reflect all lines');
  });

  await test('Receipt detail returns its lines', async () => {
    const receiptId = created.receipts[created.receipts.length - 1];
    const detail = await fetchJSON(`/receipts/${receiptId}`);
    assertTrue(Array.isArray(detail.lines), 'Detail should include a lines array');
    assertEquals(detail.lines.length, 2, 'Both lines should be returned');
    assertTrue(detail.lines[0].naam_kala !== undefined, 'Lines should include the item name');
  });

  await test('Duplicate receipt number is rejected with 400, not 500', async () => {
    // The seeded receipt R-050617-173 is dated 1405/06/17; the number's head has to
    // agree with that date, or the date rule would refuse it before the duplicate
    // rule gets to speak.
    const { ok, status, data } = await postJSON('/receipts', {
      receipt_number: 'R-050617-173',
      tarikh: '1405/06/17',
      lines: [{ kala_id: testCode, maqdar: 1, vahed: 'عدد' }],
    });
    assertFalse(ok, 'Duplicate receipt number must be rejected');
    assertEquals(status, 400, 'Should return 400 (raw UNIQUE failure would be 500)');
    assertTrue(
      String(data.error).includes('قبلاً'),
      `Error should be a clean Persian message, got: ${data.error}`
    );
  });

  await test('Create multi-line issue (POST /issues)', async () => {
    const before = await getItem(testCode);
    const { ok, data: issue } = await postJSON('/issues', {
      issue_number: nextIssueNumber('1405/07/02'),
      tarikh: '1405/07/02',
      tahvil_gir: 'تیم تست',
      mahl_masraf: 'واحد آزمایش',
      tavazihat: 'حواله آزمایشی',
      lines: [
        { kala_id: testCode, maqdar: 8, vahed: 'عدد' },
        { kala_id: testCode, maqdar: 2, vahed: 'عدد' },
      ],
    });
    assertTrue(ok, `Issue creation should succeed, got: ${JSON.stringify(issue)}`);
    assertTrue(issue.id, 'Issue creation should return ID');
    created.issues.push(issue.id);
    multiLineIssueId = issue.id;

    const after = await getItem(testCode);
    assertApproxEquals(
      Number(after.current_stock),
      Number(before.current_stock) - 10,
      'Stock should decrease by the sum of all lines'
    );
    assertEquals(Number(after.total_issues), 10, 'total_issues should reflect all lines');
  });

  await test('Duplicate issue number is rejected with 400, not 500', async () => {
    // The seeded issue H-050617-1 is dated 1405/06/17, so the head and the date
    // must agree for the duplicate rule to be the one that refuses it.
    const { ok, status } = await postJSON('/issues', {
      issue_number: 'H-050617-1',
      tarikh: '1405/06/17',
      lines: [{ kala_id: testCode, maqdar: 1, vahed: 'عدد' }],
    });
    assertFalse(ok, 'Duplicate issue number must be rejected');
    assertEquals(status, 400, 'Should return 400 (raw UNIQUE failure would be 500)');
  });

  await test('Two lines of the same item cannot jointly over-issue', async () => {
    // Two lines that each fit individually but together exceed stock. The old
    // per-line check let this through and drove the item negative.
    const before = await getItem(testCode);
    const stock = Number(before.current_stock);
    assertTrue(stock >= 2, `Test fixture should hold at least 2 units (has ${stock})`);
    const line1 = stock - 1; // fits on its own
    const line2 = 2;         // fits on its own; together they are stock + 1

    const { ok, status, data } = await postJSON('/issues', {
      issue_number: nextIssueNumber('1405/07/03'),
      tarikh: '1405/07/03',
      lines: [
        { kala_id: testCode, maqdar: line1, vahed: 'عدد' },
        { kala_id: testCode, maqdar: line2, vahed: 'عدد' },
      ],
    });
    assertFalse(ok, 'The document must be rejected');
    assertEquals(status, 400, 'Should return 400 for insufficient stock');
    assertTrue(String(data.error).includes('ناکافی'), `Error should say stock is insufficient, got: ${data.error}`);

    const after = await getItem(testCode);
    assertApproxEquals(Number(after.current_stock), stock, 'Stock must be unchanged');
  });

  await test('Issue is rejected when stock is insufficient', async () => {
    const before = await getItem(testCode);
    const { ok, status } = await postJSON('/issues', {
      issue_number: nextIssueNumber('1405/07/03'),
      tarikh: '1405/07/03',
      tahvil_gir: 'تیم تست',
      lines: [{ kala_id: testCode, maqdar: Number(before.current_stock) + 1000, vahed: 'عدد' }],
    });
    assertFalse(ok, 'Should have failed with insufficient inventory');
    assertEquals(status, 400, 'Should return insufficient inventory error');

    const after = await getItem(testCode);
    assertEquals(Number(after.current_stock), Number(before.current_stock), 'Stock must be unchanged after rejection');
  });

  await test('Concurrent issues are serialised by the service layer', async () => {
    // The genuine race — two independent connections hitting the same stock at
    // the same instant — is exercised in backend/tests/concurrency.test.js with
    // two worker threads and an atomic rendezvous barrier. Over a single
    // HTTP connection, `Promise.all` only interleaves I/O on one event loop and
    // proves nothing about the lock, so this suite no longer pretends to.
    //
    // What this test can still check is the contract a retrying client relies
    // on: an issue that cannot be covered is refused with 400, and the stock it
    // would have spent is untouched.
    const before = await getItem(testCode);
    const ask = Number(before.current_stock) + 1000;

    const { ok, status, data } = await postJSON('/issues', {
      issue_number: nextIssueNumber('1405/07/04'),
      tarikh: '1405/07/04',
      lines: [{ kala_id: testCode, maqdar: ask, vahed: 'عدد' }],
    });

    assertFalse(ok, 'An over-committed issue must be refused');
    assertEquals(status, 400, 'Should return insufficient inventory error');
    assertTrue(
      String(data.error).includes('ناکافی'),
      `The refusal should say why in Persian, got: ${data.error}`
    );

    const after = await getItem(testCode);
    assertApproxEquals(
      Number(after.current_stock),
      Number(before.current_stock),
      'Stock must be unchanged after rejection'
    );
  });

  await test('Receipt validation - missing fields', async () => {
    const { ok, status } = await postJSON('/receipts', { tarikh: '1405/07/01' });
    assertFalse(ok, 'Should have failed validation');
    assertEquals(status, 400, 'Should return validation error');
  });

  await test('Issue validation - empty lines', async () => {
    const { ok, status } = await postJSON('/issues', { issue_number: nextIssueNumber(), tarikh: '1405/07/01', lines: [] });
    assertFalse(ok, 'Should have failed validation');
    assertEquals(status, 400, 'Should return validation error');
  });

  await test('Cardex running balance ends at current stock', async () => {
    const [item, cardex] = await Promise.all([
      getItem(testCode),
      fetchJSON(`/items/${testCode}/cardex`),
    ]);
    assertTrue(cardex.length > 0, 'Cardex should now have movements');

    // Running balance must never go negative, and must finish at current stock
    for (const row of cardex) {
      assertTrue(Number(row.balance) >= 0, `Balance must be non-negative (row ${row.doc_num})`);
    }
    const last = cardex[cardex.length - 1];
    assertApproxEquals(Number(last.balance), Number(item.current_stock), 'Final balance must equal current stock');
  });

  await test('Delete issue document restores stock', async () => {
    const before = await getItem(testCode);
    const detail = await fetchJSON(`/issues/${multiLineIssueId}`);
    const issueQty = detail.lines.reduce((s, l) => s + Number(l.maqdar || 0), 0);

    const result = await sendJSON(`/issues/${multiLineIssueId}`, 'DELETE');
    assertEquals(result.deleted, true, 'Delete should confirm');
    const after = await getItem(testCode);
    assertApproxEquals(
      Number(after.current_stock),
      Number(before.current_stock) + issueQty,
      'Deleting an issue should restore its quantity'
    );
    created.issues = created.issues.filter((id) => id !== multiLineIssueId);
  });

  await test('Delete receipt document restores stock', async () => {
    const before = await getItem(testCode);
    const receiptId = created.receipts.pop();
    const result = await sendJSON(`/receipts/${receiptId}`, 'DELETE');
    assertEquals(result.deleted, true, 'Delete should confirm');
    const after = await getItem(testCode);
    assertApproxEquals(
      Number(after.current_stock),
      Number(before.current_stock) - 25,
      'Deleting a receipt should remove its quantity'
    );
  });

  await test('Item without history can be hard-deleted', async () => {
    // Clear the documents this suite still holds for other items; once they
    // are gone the test item has no movement history and must be hard-deleted.
    for (const id of created.issues) {
      try { await sendJSON(`/issues/${id}`, 'DELETE'); } catch { /* already gone */ }
      created.issues = created.issues.filter((x) => x !== id);
    }
    for (const id of created.receipts) {
      try { await sendJSON(`/receipts/${id}`, 'DELETE'); } catch { /* already gone */ }
      created.receipts = created.receipts.filter((x) => x !== id);
    }

    const result = await sendJSON(`/items/${testCode}`, 'DELETE');
    assertEquals(result.deleted, true, 'Item with no history should be hard-deleted');
    created.items = created.items.filter((c) => c !== testCode);

    const items = await fetchJSON('/items');
    assertTrue(!items.some((i) => i.kod_kala === testCode), 'Deleted item must not appear in the list');
  });

  await test('Item with history is deactivated, not deleted', async () => {
    const code = `H${Date.now().toString().slice(-6)}`;
    await postJSON('/items', { kod_kala: code, naam_kala: 'کالای دارای سابقه', vahed: 'عدد' });
    created.items.push(code);

    const receipt = await postJSON('/receipts', {
      receipt_number: nextReceiptNumber(),
      tarikh: '1405/07/01',
      lines: [{ kala_id: code, maqdar: 3, vahed: 'عدد' }],
    });
    created.receipts.push(receipt.data.id);

    const result = await sendJSON(`/items/${code}`, 'DELETE');
    assertEquals(result.deactivated, true, 'Item with history should be deactivated');

    const [active, all] = await Promise.all([
      fetchJSON('/items'),
      fetchJSON('/items?include_inactive=1'),
    ]);
    assertTrue(!active.some((i) => i.kod_kala === code), 'Deactivated item must not appear in active list');
    assertTrue(all.some((i) => i.kod_kala === code && i.is_active === 0), 'Deactivated item must appear with flag');
  });

  // ------------------------------------------------------------------
  // Hardening: authoritative units, immutable keys, retired items, dates
  // ------------------------------------------------------------------

  await test('Document lines take their unit from the item master', async () => {
    // The unit on a movement line belongs to the item definition, not to
    // whoever submitted the document. A client sending a different unit must be
    // ignored rather than recorded — otherwise the catalog and the movement
    // history can disagree about how an item is counted.
    const code = `Z${Date.now().toString().slice(-6)}`;
    await postJSON('/items', {
      kod_kala: code,
      naam_kala: 'کالای با واحد کیلوگرم',
      vahed: 'کیلوگرم',
    });
    created.items.push(code);

    const receipt = await postJSON('/receipts', {
      receipt_number: nextReceiptNumber(),
      tarikh: '1405/07/01',
      lines: [{ kala_id: code, maqdar: 10, vahed: 'واحد تقلبی' }],
    });
    assertTrue(receipt.ok, `Receipt should be accepted, got: ${JSON.stringify(receipt.data)}`);
    created.receipts.push(receipt.data.id);

    const receiptDetail = await fetchJSON(`/receipts/${receipt.data.id}`);
    assertEquals(
      receiptDetail.lines[0].vahed,
      'کیلوگرم',
      'The stored receipt line must carry the item master unit'
    );

    const issue = await postJSON('/issues', {
      issue_number: nextIssueNumber(),
      tarikh: '1405/07/01',
      lines: [{ kala_id: code, maqdar: 4, vahed: 'واحد تقلبی' }],
    });
    assertTrue(issue.ok, `Issue should be accepted, got: ${JSON.stringify(issue.data)}`);
    created.issues.push(issue.data.id);

    const issueDetail = await fetchJSON(`/issues/${issue.data.id}`);
    assertEquals(
      issueDetail.lines[0].vahed,
      'کیلوگرم',
      'The stored issue line must carry the item master unit'
    );
  });

  await test('Group cannot be changed after creation', async () => {
    const code = `Z${Date.now().toString().slice(-6)}`;
    await postJSON('/items', {
      kod_kala: code,
      naam_kala: 'کالای گروه و واحد قفل',
      goh: 'گروه الف',
      vahed: 'عدد',
    });
    created.items.push(code);

    const res = await request(`/items/${code}`, {
      method: 'PUT',
      body: JSON.stringify({ naam_kala: 'کالای گروه و واحد قفل', goh: 'گروه متفاوت' }),
    });
    assertFalse(res.ok, 'Changing the group must be refused');
    assertEquals(res.status, 400, 'Refusal must be a client error');

    const after = await getItem(code, true);
    assertEquals(after.goh, 'گروه الف', 'The group must be unchanged');
  });

  await test('Unit cannot be changed after creation', async () => {
    const code = `Z${Date.now().toString().slice(-6)}`;
    await postJSON('/items', {
      kod_kala: code,
      naam_kala: 'کالای گروه و واحد قفل',
      goh: 'گروه الف',
      vahed: 'عدد',
    });
    created.items.push(code);

    const res = await request(`/items/${code}`, {
      method: 'PUT',
      body: JSON.stringify({ naam_kala: 'کالای گروه و واحد قفل', vahed: 'متر' }),
    });
    assertFalse(res.ok, 'Changing the unit must be refused');
    assertEquals(res.status, 400, 'Refusal must be a client error');

    const after = await getItem(code, true);
    assertEquals(after.vahed, 'عدد', 'The unit must be unchanged');
  });

  await test('An edit that omits group and unit keeps both', async () => {
    // The edit form only sends the fields it actually edits. Omitting the
    // locked fields must not wipe them.
    const code = `Z${Date.now().toString().slice(-6)}`;
    await postJSON('/items', {
      kod_kala: code,
      naam_kala: 'کالای ویرایش جزئی',
      goh: 'گروه الف',
      vahed: 'کیلوگرم',
    });
    created.items.push(code);

    await sendJSON(`/items/${code}`, 'PUT', {
      naam_kala: 'کالای ویرایش جزئی - ویرایش شده',
      zirgoh: 'زیرگروه',
      hadd_aqal_mojoodi: 7,
      tavazihat: 'فقط فیلدهای قابل ویرایش',
    });
    const after = await getItem(code, true);
    assertEquals(after.naam_kala, 'کالای ویرایش جزئی - ویرایش شده', 'The editable name should change');
    assertEquals(after.goh, 'گروه الف', 'The omitted group should be kept');
    assertEquals(after.vahed, 'کیلوگرم', 'The omitted unit should be kept');
  });

  await test('A retired item is refused by new receipts and issues', async () => {
    // A retired item keeps its place in inventory and history, but it must not
    // be able to move again.
    const code = `Z${Date.now().toString().slice(-6)}`;
    await postJSON('/items', { kod_kala: code, naam_kala: 'کالای بازنشسته', vahed: 'عدد' });
    created.items.push(code);

    const receipt = await postJSON('/receipts', {
      receipt_number: nextReceiptNumber(),
      tarikh: '1405/07/01',
      lines: [{ kala_id: code, maqdar: 20, vahed: 'عدد' }],
    });
    assertTrue(receipt.ok, `The item should be able to receive stock while active, got: ${JSON.stringify(receipt.data)}`);
    created.receipts.push(receipt.data.id);

    await sendJSON(`/items/${code}`, 'DELETE');
    const retired = await getItem(code, true);
    assertEquals(retired.is_active, 0, 'The item should now be retired');

    const blockedReceipt = await postJSON('/receipts', {
      receipt_number: nextReceiptNumber(),
      tarikh: '1405/07/01',
      lines: [{ kala_id: code, maqdar: 5, vahed: 'عدد' }],
    });
    assertFalse(blockedReceipt.ok, 'A retired item must not be receivable');
    assertEquals(blockedReceipt.status, 400, 'Refusal must be a client error');
    assertTrue(
      String(blockedReceipt.data.error).includes('غیرفعال'),
      `The refusal should name retirement in Persian, got: ${blockedReceipt.data.error}`
    );

    const blockedIssue = await postJSON('/issues', {
      issue_number: nextIssueNumber(),
      tarikh: '1405/07/01',
      lines: [{ kala_id: code, maqdar: 5, vahed: 'عدد' }],
    });
    assertFalse(blockedIssue.ok, 'A retired item must not be issuable');
    assertEquals(blockedIssue.status, 400, 'Refusal must be a client error');
    assertTrue(
      String(blockedIssue.data.error).includes('غیرفعال'),
      `The refusal should name retirement in Persian, got: ${blockedIssue.data.error}`
    );

    const unchanged = await getItem(code, true);
    assertEquals(
      Number(unchanged.current_stock),
      20,
      'Neither refused document may have changed the stock'
    );
  });

  await test('Jalali month boundaries are enforced at the API', async () => {
    // Real calendar arithmetic, not a shape check: Shahrivar 31st is a real day,
    // Mehr 31st is not, and Esfand 30th only exists in a leap year.
    const code = `Z${Date.now().toString().slice(-6)}`;
    await postJSON('/items', { kod_kala: code, naam_kala: 'کالای آزمون تاریخ', vahed: 'عدد' });
    created.items.push(code);

    const cases = [
      ['1405/06/31', true, 'Shahrivar has 31 days'],
      ['1405/07/01', true, 'The first day of Mehr is valid'],
      ['1405/07/30', true, 'Mehrs last day is the 30th'],
      ['1405/07/31', false, 'A 30-day month has no 31st day'],
      ['1405/12/29', true, 'Esfand 29 is always valid'],
      ['1405/12/30', false, '1405 is not a leap year, so Esfand has no 30th'],
      ['1403/12/30', true, '1403 is a leap year, so Esfand 30 exists'],
      ['1405/13/01', false, 'There is no thirteenth month'],
      ['1405/06/32', false, 'No month has 32 days'],
      ['2026-09-30', false, 'A Gregorian date must not be accepted'],
      ['1405/7/1', false, 'The canonical form is zero-padded'],
    ];

    // The document number carries the *same* date as the case under test, so a
    // refusal can only be about the date itself: the number's head is built from
    // each case's tarikh, and the sequence counter keeps every number distinct.
    const mineNumbers = [];
    for (const [tarikh, shouldAccept, why] of cases) {
      const number = nextReceiptNumber(tarikh);
      const res = await postJSON('/receipts', {
        receipt_number: number,
        tarikh,
        lines: [{ kala_id: code, maqdar: 1, vahed: 'عدد' }],
      });
      if (shouldAccept) {
        assertTrue(res.ok, `${why} — expected acceptance, got: ${JSON.stringify(res.data)}`);
        created.receipts.push(res.data.id);
        mineNumbers.push(number);
      } else {
        assertFalse(res.ok, `${why} — expected rejection, got: ${JSON.stringify(res.data)}`);
        assertEquals(res.status, 400, `${why} — refusal must be a client error`);
      }
    }

    // Every accepted document must actually have been stored.
    const receipts = await fetchJSON('/receipts');
    const mine = receipts.filter((r) => mineNumbers.includes(r.receipt_number));
    assertEquals(mine.length, 5, 'Exactly the five valid dates must have been stored');
  });

  // ------------------------------------------------------------------
  // Reports
  // ------------------------------------------------------------------

  await test('Inventory report matches inventory endpoint', async () => {
    const [report, inventory] = await Promise.all([
      fetchJSON('/reports/inventory'),
      fetchJSON('/inventory'),
    ]);
    assertEquals(report.items.length, inventory.length, 'Report should cover all items');
    assertApproxEquals(
      Number(report.totals.current),
      Number(inventory.reduce((s, i) => s + Number(i.current_stock), 0)),
      'Report total must match the sum of inventory'
    );
  });

  await test('Receipts and issues reports include lines', async () => {
    const [receipts, issues] = await Promise.all([
      fetchJSON('/reports/receipts'),
      fetchJSON('/reports/issues'),
    ]);
    assertTrue(Array.isArray(receipts.receipts), 'Receipts report should list documents');
    assertTrue(Array.isArray(issues.issues), 'Issues report should list documents');
    if (receipts.receipts.length > 0) {
      assertTrue(Array.isArray(receipts.receipts[0].lines), 'Report receipts should include lines');
    }
  });

  await test('Date-range filters work on Jalali bounds', async () => {
    const all = await fetchJSON('/reports/receipts');
    const inRange = await fetchJSON('/reports/receipts?from=1405/06/01&to=1405/07/30');
    assertTrue(inRange.count <= all.count, 'A Jalali range must not return more than the whole set');
    assertTrue(inRange.count >= 1, 'The seeded receipt (1405/06/17) must fall inside a covering Jalali range');

    // A range far outside the Jalali data must return nothing — this is what a
    // mixed-calendar database silently got wrong.
    const away = await fetchJSON('/reports/receipts?from=1399/01/01&to=1399/12/29');
    assertEquals(away.count, 0, 'A disjoint Jalali range must return no receipts');
  });

  await test('Movements report covers all stock movements', async () => {
    const movements = await fetchJSON('/reports/movements');
    const inventory = await fetchJSON('/inventory');

    // Every movement must reference a known item
    const codes = new Set(inventory.map((i) => i.kod_kala));
    for (const m of movements.movements) {
      assertTrue(codes.has(m.kala_id), `Movement references unknown item ${m.kala_id}`);
    }

    // Net of all movements must equal current stock summed
    const net = movements.movements.reduce(
      (s, m) => s + Number(m.qty) * Number(m.direction),
      0
    );
    const totalStock = inventory.reduce((s, i) => s + Number(i.current_stock), 0);
    assertApproxEquals(net, totalStock, 'Net movements must equal total current stock');
  });

  await test('Print endpoints render HTML', async () => {
    const inventory = await fetchJSON('/inventory');

    const cardexRes = await request(`/print/cardex/${inventory[0].kod_kala}`);
    assertTrue(cardexRes.status === 200, 'Cardex print should return 200');
    assertTrue(String(cardexRes.text).includes('<html'), 'Cardex print should render HTML');
    assertTrue(String(cardexRes.text).includes('dir="rtl"'), 'Cardex print should be RTL');

    const inventoryRes = await request('/print/inventory');
    assertTrue(String(inventoryRes.text).includes('گزارش موجودی'), 'Inventory print should have a title');

    const movementsRes = await request('/print/movements');
    assertTrue(movementsRes.status === 200, 'Movements print should return 200');
    assertTrue(String(movementsRes.text).includes('ورود/خروج'), 'Movements print should have its title');

    // Every kind of printable document shares one layout, so the preview rule is
    // checked against each of them rather than assumed to carry over.
    const pages = [
      ['cardex', cardexRes],
      ['inventory', inventoryRes],
      ['movements', movementsRes],
    ];
    const receipts = await fetchJSON('/receipts');
    if (receipts.length) {
      const res = await request(`/print/receipt/${receipts[0].id}`);
      assertEquals(res.status, 200, 'Receipt print should return 200');
      pages.push(['receipt', res]);
    }
    const issues = await fetchJSON('/issues');
    if (issues.length) {
      const res = await request(`/print/issue/${issues[0].id}`);
      assertEquals(res.status, 200, 'Issue print should return 200');
      pages.push(['issue', res]);
    }

    for (const [kind, { text }] of pages) {
      assertTrue(
        !/setTimeout\([^)]*window\.print/.test(String(text)),
        `A ${kind} print page must not call window.print() on load`
      );
      assertTrue(String(text).includes('btn-print'), `A ${kind} print page must offer an explicit print action`);
      assertTrue(String(text).includes('btn-pdf'), `A ${kind} print page must offer an explicit PDF action`);
      assertTrue(String(text).includes('btn-close'), `A ${kind} print page must offer a close action`);
    }

    const missingRes = await request('/print/receipt/999999');
    assertEquals(missingRes.status, 404, 'Missing receipt print should 404');
  });

  await test('Print rejects a Gregorian date bound', async () => {
    const res = await request('/print/movements?from=2026-09-30');
    assertEquals(res.status, 400, 'A Gregorian range bound must be refused');
  });

  // ------------------------------------------------------------------
  // Document-number suggestion
  // ------------------------------------------------------------------

  await test('Document number suggestion follows the convention', async () => {
    const res = await fetchJSON('/doc-numbers/suggest/receipt?tarikh=1405/08/01');
    assertTrue(res.full_number.startsWith('R-050801-'), `Head must be the Jalali date, got ${res.full_number}`);
    assertTrue(/^\d+$/.test(res.sequence), 'The sequence must be a plain integer');

    const issueRes = await fetchJSON('/doc-numbers/suggest/issue?tarikh=1405/08/01');
    assertTrue(issueRes.full_number.startsWith('H-050801-'), `Issue head must use H, got ${issueRes.full_number}`);
  });

  await test('Document number suggestion defaults to today and rejects a bad date', async () => {
    const res = await fetchJSON('/doc-numbers/suggest/receipt');
    assertTrue(res.full_number.startsWith('R-'), 'A missing date must fall back to today, not fail');
    assertTrue(res.tarikh.length === 10, 'The date used must be reported');

    const bad = await request('/doc-numbers/suggest/receipt?tarikh=2026-09-30');
    assertEquals(bad.status, 400, 'A Gregorian date must be refused');
  });

  await test('Suggestion continues an existing sequence for that date', async () => {
    // K001 starts with no baseline, so stock it first: the point of the test is
    // the number, not the stock move.
    const stocking = await postJSON('/receipts', {
      receipt_number: nextReceiptNumber('1405/08/01'),
      tarikh: '1405/08/01',
      lines: [{ kala_id: 'K001', maqdar: 5, vahed: 'شاخه' }],
    });
    assertTrue(stocking.ok, `Stocking receipt should succeed, got ${JSON.stringify(stocking.data)}`);
    created.receipts.push(stocking.data.id);

    const first = await fetchJSON('/doc-numbers/suggest/issue?tarikh=1405/08/01');
    const { ok, data } = await postJSON('/issues', {
      issue_number: first.full_number,
      tarikh: '1405/08/01',
      tahvil_gir: 'تست پیشنهاد',
      lines: [{ kala_id: 'K001', maqdar: 1, vahed: 'شاخه' }],
    });
    assertTrue(ok, `Issue creation should succeed, got ${JSON.stringify(data)}`);
    created.issues.push(data.id);

    const second = await fetchJSON('/doc-numbers/suggest/issue?tarikh=1405/08/01');
    assertTrue(
      Number(second.sequence) > Number(first.sequence),
      `The next suggestion must continue past the one just used (${first.sequence} -> ${second.sequence})`
    );
  });

  await test('Suggestion continues the sequence across a different date', async () => {
    // The sequence is per kind and continuous over the whole table: a new date
    // chooses the head only and never restarts the count. Asking for 1405/09/02
    // after numbers recorded on 1405/08/01 must not fall back to 1.
    const before = await fetchJSON('/doc-numbers/suggest/receipt?tarikh=1405/08/01');
    const later = await fetchJSON('/doc-numbers/suggest/receipt?tarikh=1405/09/02');
    assertEquals(
      Number(later.sequence),
      Number(before.sequence),
      `A new date must not restart the receipt sequence (${before.sequence} -> ${later.sequence})`
    );
    assertTrue(
      later.full_number.startsWith('R-050902-'),
      `The head must follow the date asked for, got ${later.full_number}`
    );

    // And the two kinds still count independently.
    const issue = await fetchJSON('/doc-numbers/suggest/issue?tarikh=1405/09/02');
    assertTrue(issue.full_number.startsWith('H-050902-'), `Issue head, got ${issue.full_number}`);
  });

  // ------------------------------------------------------------------
  // Canonical groups and unit precision
  // ------------------------------------------------------------------

  await test('Groups endpoint returns the canonical ordered list', async () => {
    const groups = await fetchJSON('/groups');
    assertTrue(Array.isArray(groups), 'Groups should be an array');
    assertTrue(groups.length > 0, 'The seeded groups should be present');
    for (const g of groups) {
      assertTrue('sort_order' in g, `Group ${g.name} must carry a sort_order`);
      assertTrue('is_active' in g, `Group ${g.name} must carry an active state`);
    }
    const orders = groups.map((g) => g.sort_order);
    const sorted = [...orders].sort((a, b) => a - b);
    assertEquals(orders.join(','), sorted.join(','), 'Groups must arrive in sort_order');
  });

  await test('Unit precision endpoint lists every unit in the catalog', async () => {
    const [precision, inventory] = await Promise.all([
      fetchJSON('/unit-precision'),
      fetchJSON('/inventory'),
    ]);
    const units = new Set(inventory.map((i) => i.vahed).filter(Boolean));
    for (const u of units) {
      const row = precision.find((p) => p.vahed === u);
      assertTrue(row, `Unit "${u}" must have a precision row`);
      assertTrue(Number.isInteger(Number(row.decimals)), `Precision for "${u}" must be an integer`);
    }
  });

  await test('Creating an item in a new group registers the group', async () => {
    const code = `G${Date.now().toString().slice(-6)}`;
    const groupName = `گروه جدید ${Date.now() % 1000}`;
    const { ok } = await postJSON('/items', {
      kod_kala: code,
      naam_kala: 'کالای گروه جدید',
      goh: groupName,
      vahed: 'عدد',
    });
    assertTrue(ok, 'Item creation should succeed');
    created.items.push(code);

    const groups = await fetchJSON('/groups');
    assertTrue(groups.some((g) => g.name === groupName), 'The new group must now appear in the canonical list');
  });

  // ------------------------------------------------------------------
  // Hardening: a document is never partially saved; the number's date is the
  // document's date; the next code follows the numeric sequence
  // ------------------------------------------------------------------

  await test('A document with one valid and one incomplete line is rejected whole', async () => {
    // The line-level rules apply to the document, not to a filtered subset: a
    // second line that was selected but never given a quantity must not be
    // silently dropped while the first line is saved.
    const before = await getItem('K001');
    const receiptsBefore = await fetchJSON('/receipts');

    const { ok, status, data } = await postJSON('/receipts', {
      receipt_number: nextReceiptNumber('1405/07/01'),
      tarikh: '1405/07/01',
      lines: [
        { kala_id: 'K001', maqdar: 5, vahed: 'شاخه' },
        { kala_id: 'K002', maqdar: '', vahed: 'شاخه' },
      ],
    });
    assertFalse(ok, 'A document with an incomplete line must be refused');
    assertEquals(status, 400, 'Refusal must be a client error');
    assertTrue(
      String(data.error).includes('مقدار'),
      `The refusal should say what is wrong with the line, got: ${data.error}`
    );

    // And nothing may have been written: no new receipt, no stock move.
    const receiptsAfter = await fetchJSON('/receipts');
    assertEquals(receiptsAfter.length, receiptsBefore.length, 'No partial document may be saved');
    const after = await getItem('K001');
    assertApproxEquals(Number(after.current_stock), Number(before.current_stock), 'Stock must be unchanged');
  });

  await test('A document number whose embedded date is not the document date is rejected', async () => {
    // `R-050618-1` is a well-formed number for 1405/06/18; posting it against
    // 1405/07/01 must be refused, because the number is self-describing about
    // which day the document belongs to.
    const { ok, status, data } = await postJSON('/receipts', {
      receipt_number: 'R-050618-1',
      tarikh: '1405/07/01',
      lines: [{ kala_id: 'K001', maqdar: 1, vahed: 'شاخه' }],
    });
    assertFalse(ok, 'A number that disagrees with its date must be refused');
    assertEquals(status, 400, 'Refusal must be a client error');
    assertTrue(
      String(data.error).includes('یکی باشد'),
      `The refusal should name the disagreement between the two dates, got: ${data.error}`
    );
  });

  await test('A malformed document number is rejected', async () => {
    const { ok, status } = await postJSON('/receipts', {
      receipt_number: 'NOT-A-NUMBER',
      tarikh: '1405/07/01',
      lines: [{ kala_id: 'K001', maqdar: 1, vahed: 'شاخه' }],
    });
    assertFalse(ok, 'A malformed number must be refused');
    assertEquals(status, 400, 'Refusal must be a client error');
  });

  await test('Document number suggestion follows the date it is asked for', async () => {
    // Changing the date changes the head, which is what keeps a suggested number
    // from ever disagreeing with the document's own date.
    const aug = await fetchJSON('/doc-numbers/suggest/receipt?tarikh=1405/08/01');
    assertTrue(aug.full_number.startsWith('R-050801-'), `August head, got ${aug.full_number}`);
    const sep = await fetchJSON('/doc-numbers/suggest/issue?tarikh=1405/09/02');
    assertTrue(sep.full_number.startsWith('H-050902-'), `September head, got ${sep.full_number}`);
  });

  await test('A suggestion for a non-padded date still yields a whole number', async () => {
    // `1405/9/2` is a real day the user might type. It must be canonicalised, not
    // refused, or the field would be left empty when a head is derivable.
    const res = await fetchJSON('/doc-numbers/suggest/receipt?tarikh=1405/9/2');
    assertEquals(res.tarikh, '1405/09/02', 'The date used must be reported in canonical form');
    assertTrue(
      res.full_number.startsWith('R-050902-'),
      `The head must be padded out of a single-digit month and day, got ${res.full_number}`
    );
  });

  await test('Item code suggestion follows the numeric sequence, not the text order', async () => {
    // W9 is textually higher than W010 while numerically lower. Following the text
    // order suggested W010, a code the catalog already has; the numeric maximum is
    // 10, so the suggestion must be W011.
    await postJSON('/items', { kod_kala: 'W9', naam_kala: 'کالای آزمون ترتیب عددی', vahed: 'عدد' });
    created.items.push('W9');
    await postJSON('/items', { kod_kala: 'W010', naam_kala: 'کالای آزمون ترتیب عددی', vahed: 'عدد' });
    created.items.push('W010');

    const data = await fetchJSON('/items/suggest-code/W');
    assertEquals(data.suggested_code, 'W011', 'The next code must follow the numeric suffix');
  });

  await test('Item code suggestion continues the catalog width', async () => {
    // The seeded کناف catalog runs K001..K018, so the next code is K019 — the
    // numeric maximum plus one, at the width the catalog already uses.
    const data = await fetchJSON('/items/suggest-code/K');
    assertEquals(data.suggested_code, 'K019', 'The suggestion must continue the seeded sequence');
  });

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------

  await test('Cleanup: remove all test artifacts', async () => {
    for (const id of created.issues) {
      try { await sendJSON(`/issues/${id}`, 'DELETE'); } catch { /* may already be gone */ }
    }
    for (const id of created.receipts) {
      try { await sendJSON(`/receipts/${id}`, 'DELETE'); } catch { /* may already be gone */ }
    }
    for (const code of created.items) {
      try { await sendJSON(`/items/${code}`, 'DELETE'); } catch { /* may already be gone */ }
    }
    const items = await fetchJSON('/items?include_inactive=1');
    const leftovers = items.filter((i) => /^(T|H|V|Z)\d{6}/.test(i.kod_kala));
    assertEquals(leftovers.length, 0, `No test items should remain (found ${leftovers.map(i => i.kod_kala).join(', ')})`);
  });

  await test('Isolation: the test database is separate from the live one', async () => {
    // The seeded opening documents must still be intact after the whole suite
    // ran — if these were missing, the suite would have been mutating the
    // development database again.
    const [receipts, issues] = await Promise.all([fetchJSON('/receipts'), fetchJSON('/issues')]);
    assertTrue(receipts.some((r) => r.receipt_number === 'R-050617-173'), 'Seeded receipt must be intact');
    assertEquals(issues.length, 3, 'The three seeded issues must be intact');
  });

  // Print summary
  console.log(`${colors.yellow}
╔═══════════════════════════════════════════════════════════════╗
║                        Test Summary                           ║
╚═══════════════════════════════════════════════════════════════╝${colors.reset}`);

  const total = testsPassed + testsFailed;
  console.log(`${colors.green}Passed: ${testsPassed}/${total}${colors.reset}`);

  if (testsFailed > 0) {
    console.log(`${colors.red}Failed: ${testsFailed}/${total}${colors.reset}`);
  } else {
    console.log(`${colors.green}\n✓ All tests passed!${colors.reset}\n`);
  }
}

function assertFalse(condition, message) {
  if (condition) throw new Error(message);
}

async function main() {
  try {
    await startTestServer();
    console.log(`${colors.green}✓ Test server running on port ${TEST_PORT} (isolated database)${colors.reset}\n`);
    await runTests();
  } finally {
    await stopTestServer();
    if (testDbDir) {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    }
  }

  if (testsFailed > 0) process.exit(1);
  process.exit(0);
}

main().catch((error) => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  stopTestServer();
  if (testDbDir) fs.rmSync(testDbDir, { recursive: true, force: true });
  process.exit(1);
});
