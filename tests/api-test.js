/**
 * Comprehensive API Test Suite
 * Tests all endpoints of the Iranian Hotel Warehouse Management System
 *
 * Validates the derived-inventory invariants:
 *   current_stock = baseline + receipts - issues
 *
 * All documents/Items created by this suite are cleaned up at the end.
 */

const BASE_URL = 'http://localhost:3000/api';

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
  if (!ok) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`);
  return data;
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
async function getItem(kodKala) {
  const items = await fetchJSON('/items');
  return items.find((i) => i.kod_kala === kodKala);
}

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

  await test('Inventory endpoint equals items endpoint', async () => {
    const [items, inventory] = await Promise.all([fetchJSON('/items'), fetchJSON('/inventory')]);
    assertEquals(items.length, inventory.length, 'Both endpoints should return same row count');
    const byCode = new Map(inventory.map((i) => [i.kod_kala, i]));
    for (const item of items) {
      const inv = byCode.get(item.kod_kala);
      assertTrue(inv, `Inventory missing item ${item.kod_kala}`);
      assertEquals(inv.current_stock, item.current_stock, `Stock mismatch for ${item.kod_kala}`);
    }
  });

  await test('Derived inventory invariant holds for every item', async () => {
    const items = await fetchJSON('/items');
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

  // ------------------------------------------------------------------
  // Item lifecycle
  // ------------------------------------------------------------------

  const testCode = `T${Date.now().toString().slice(-6)}`;

  await test('Suggest next item code', async () => {
    const data = await fetchJSON('/items/suggest-code/K');
    assertTrue(data.suggested_code, 'Should return a suggested code');
    assertTrue(data.suggested_code.startsWith('K'), 'Suggested code should honour the prefix');
  });

  await test('Create item (POST /items)', async () => {
    const result = await postJSON('/items', {
      kod_kala: testCode,
      naam_kala: 'کالای آزمایشی',
      goh: 'آزمایش',
      zirgoh: 'تست',
      vahed: 'عدد',
      hadd_aqal_mojoodi: 5,
      tavazihat: 'ایجاد شده توسط تست خودکار',
    });
    assertEquals(result.kod_kala, testCode, 'Should echo the item code');
    created.items.push(testCode);

    const item = await getItem(testCode);
    assertTrue(item, 'Created item should be retrievable');
    assertEquals(Number(item.current_stock), 0, 'New item should have zero stock');
  });

  await test('Duplicate item code is rejected', async () => {
    try {
      await postJSON('/items', {
        kod_kala: testCode,
        naam_kala: 'تکراری',
        vahed: 'عدد',
      });
      throw new Error('Should have rejected duplicate code');
    } catch (error) {
      assertTrue(error.message.includes('400'), 'Should return 400 for duplicate code');
    }
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
    const receipt = await postJSON('/receipts', {
      receipt_number: `TEST-R-${Date.now()}`,
      tarikh: '1405/07/01',
      tavazihat: 'رسید آزمایشی',
      lines: [
        { kala_id: testCode, maqdar: 20, vahed: 'عدد', tavazihat: 'ردیف اول' },
        { kala_id: testCode, maqdar: 5, vahed: 'عدد', tavazihat: 'ردیف دوم' },
      ],
    });
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

  await test('Create multi-line issue (POST /issues)', async () => {
    const before = await getItem(testCode);
    const issue = await postJSON('/issues', {
      issue_number: `TEST-I-${Date.now()}`,
      tarikh: '1405/07/02',
      tahvil_gir: 'تیم تست',
      mahl_masraf: 'واحد آزمایش',
      tavazihat: 'حواله آزمایشی',
      lines: [
        { kala_id: testCode, maqdar: 8, vahed: 'عدد' },
        { kala_id: testCode, maqdar: 2, vahed: 'عدد' },
      ],
    });
    assertTrue(issue.id, 'Issue creation should return ID');
    created.issues.push(issue.id);

    const after = await getItem(testCode);
    assertApproxEquals(
      Number(after.current_stock),
      Number(before.current_stock) - 10,
      'Stock should decrease by the sum of all lines'
    );
    assertEquals(Number(after.total_issues), 10, 'total_issues should reflect all lines');
  });

  await test('Issue is rejected when stock is insufficient', async () => {
    const before = await getItem(testCode);
    try {
      await postJSON('/issues', {
        issue_number: `TEST-FAIL-${Date.now()}`,
        tarikh: '1405/07/03',
        tahvil_gir: 'تیم تست',
        lines: [{ kala_id: testCode, maqdar: Number(before.current_stock) + 1000, vahed: 'عدد' }],
      });
      throw new Error('Should have failed with insufficient inventory');
    } catch (error) {
      assertTrue(
        error.message.includes('400') || error.message.includes('ناکافی'),
        'Should return insufficient inventory error'
      );
    }
    const after = await getItem(testCode);
    assertEquals(Number(after.current_stock), Number(before.current_stock), 'Stock must be unchanged after rejection');
  });

  await test('Receipt validation - missing fields', async () => {
    try {
      await postJSON('/receipts', { tarikh: '1405/07/01' });
      throw new Error('Should have failed validation');
    } catch (error) {
      assertTrue(error.message.includes('400'), 'Should return validation error');
    }
  });

  await test('Issue validation - empty lines', async () => {
    try {
      await postJSON('/issues', { issue_number: 'TEST-EMPTY', tarikh: '1405/07/01', lines: [] });
      throw new Error('Should have failed validation');
    } catch (error) {
      assertTrue(error.message.includes('400'), 'Should return validation error');
    }
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
    const issueId = created.issues.pop();
    const result = await sendJSON(`/issues/${issueId}`, 'DELETE');
    assertEquals(result.deleted, true, 'Delete should confirm');
    const after = await getItem(testCode);
    assertApproxEquals(
      Number(after.current_stock),
      Number(before.current_stock) + 10,
      'Deleting an issue should restore its quantity'
    );
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
    // Receipt/issue docs were removed above, so the test item has no movement history
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
      receipt_number: `TEST-H-${Date.now()}`,
      tarikh: '1405/07/01',
      lines: [{ kala_id: code, maqdar: 3, vahed: 'عدد' }],
    });

    const result = await sendJSON(`/items/${code}`, 'DELETE');
    assertEquals(result.deactivated, true, 'Item with history should be deactivated');

    const [active, all] = await Promise.all([
      fetchJSON('/items'),
      fetchJSON('/items?include_inactive=1'),
    ]);
    assertTrue(!active.some((i) => i.kod_kala === code), 'Deactivated item must not appear in active list');
    assertTrue(all.some((i) => i.kod_kala === code && i.is_active === 0), 'Deactivated item must appear with flag');

    // Clean up: remove the receipt so the item can be hard-deleted
    await sendJSON(`/receipts/${receipt.id}`, 'DELETE');
    await sendJSON(`/items/${code}`, 'DELETE');
    created.items = created.items.filter((c) => c !== code);
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

    const missingRes = await request('/print/receipt/999999');
    assertEquals(missingRes.status, 404, 'Missing receipt print should 404');
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
    const leftovers = items.filter((i) => /^(T|H)\d{6}$/.test(i.kod_kala));
    assertEquals(leftovers.length, 0, 'No test items should remain');
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
    process.exit(1);
  } else {
    console.log(`${colors.green}\n✓ All tests passed!${colors.reset}\n`);
    process.exit(0);
  }
}

// Run tests
runTests().catch((error) => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
