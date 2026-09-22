/**
 * Comprehensive API Test Suite
 * Tests all endpoints of the Iranian Hotel Warehouse Management System
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

async function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

async function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertGreaterThan(actual, min, message) {
  if (actual <= min) {
    throw new Error(`${message}: expected > ${min}, got ${actual}`);
  }
}

async function fetchJSON(endpoint) {
  const response = await fetch(`${BASE_URL}${endpoint}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function postJSON(endpoint, data) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function runTests() {
  console.log(`${colors.yellow}
╔═══════════════════════════════════════════════════════════════╗
║   Iranian Hotel Warehouse Management System - API Tests      ║
╚═══════════════════════════════════════════════════════════════╝
${colors.reset}`);

  // Test 1: Health Check
  await test('Health check endpoint', async () => {
    const data = await fetchJSON('/health');
    assertEquals(data.status, 'ok', 'Health status');
    assertTrue(data.timestamp, 'Health check should return timestamp');
  });

  // Test 2: Dashboard Stats
  await test('Dashboard stats endpoint', async () => {
    const stats = await fetchJSON('/dashboard/stats');
    assertTrue(stats.itemsCount >= 28, 'Should have at least 28 items');
    assertTrue('totalInventory' in stats, 'Stats should include totalInventory');
    assertTrue('minStockWarnings' in stats, 'Stats should include warnings count');
  });

  // Test 3: Items List
  await test('Items list endpoint', async () => {
    const items = await fetchJSON('/items');
    assertTrue(Array.isArray(items), 'Items should be an array');
    assertGreaterThan(items.length, 0, 'Should have items');
    assertTrue(items[0].kod_kala, 'Item should have kod_kala');
    assertTrue(items[0].naam_kala, 'Item should have naam_kala');
  });

  // Test 4: Inventory List
  await test('Inventory endpoint', async () => {
    const inventory = await fetchJSON('/inventory');
    assertTrue(Array.isArray(inventory), 'Inventory should be an array');
    assertGreaterThan(inventory.length, 0, 'Should have inventory records');
    assertTrue('mojoodi_fael' in inventory[0], 'Inventory should have mojoodi_fael');
    assertTrue('total_receipts' in inventory[0], 'Inventory should have total_receipts');
    assertTrue('total_issues' in inventory[0], 'Inventory should have total_issues');
  });

  // Test 5: Receipts List
  await test('Receipts list endpoint', async () => {
    const receipts = await fetchJSON('/receipts');
    assertTrue(Array.isArray(receipts), 'Receipts should be an array');
    if (receipts.length > 0) {
      assertTrue(receipts[0].receipt_num, 'Receipt should have receipt_num');
      assertTrue(receipts[0].kala_id, 'Receipt should have kala_id');
      assertTrue(receipts[0].maqdar, 'Receipt should have maqdar');
    }
  });

  // Test 6: Issues List
  await test('Issues list endpoint', async () => {
    const issues = await fetchJSON('/issues');
    assertTrue(Array.isArray(issues), 'Issues should be an array');
    if (issues.length > 0) {
      assertTrue(issues[0].issue_num, 'Issue should have issue_num');
      assertTrue(issues[0].kala_id, 'Issue should have kala_id');
      assertTrue(issues[0].maqdar, 'Issue should have maqdar');
    }
  });

  // Test 7: Dashboard Warnings
  await test('Dashboard warnings endpoint', async () => {
    const warnings = await fetchJSON('/dashboard/warnings');
    assertTrue(Array.isArray(warnings), 'Warnings should be an array');
  });

  // Test 8: Recent Receipts
  await test('Recent receipts endpoint', async () => {
    const recent = await fetchJSON('/dashboard/recent-receipts');
    assertTrue(Array.isArray(recent), 'Recent receipts should be an array');
  });

  // Test 9: Recent Issues
  await test('Recent issues endpoint', async () => {
    const recent = await fetchJSON('/dashboard/recent-issues');
    assertTrue(Array.isArray(recent), 'Recent issues should be an array');
  });

  // Test 10: Dashboard Activity
  await test('Dashboard activity endpoint', async () => {
    const activity = await fetchJSON('/dashboard/activity');
    assertTrue(Array.isArray(activity), 'Activity should be an array');
  });

  // Test 11: Create Receipt
  await test('Create receipt (POST /receipts)', async () => {
    const testReceipt = {
      receipt_num: `TEST-R-${Date.now()}`,
      kala_id: 'K010',
      maqdar: 2,
      tarikh: '1405/07/01',
      vahed: 'بسته',
    };

    const items = await fetchJSON('/items');
    const k010Before = items.find(i => i.kod_kala === 'K010');
    const inventoryBefore = k010Before.mojoodi_fael;

    const result = await postJSON('/receipts', testReceipt);
    assertTrue(result.id, 'Receipt creation should return ID');

    // Verify inventory increased
    const itemsAfter = await fetchJSON('/items');
    const k010After = itemsAfter.find(i => i.kod_kala === 'K010');
    assertEquals(k010After.mojoodi_fael, inventoryBefore + 2, 'Inventory should increase by 2');
  });

  // Test 12: Create Issue
  await test('Create issue (POST /issues)', async () => {
    const items = await fetchJSON('/items');
    const k010Before = items.find(i => i.kod_kala === 'K010');
    const inventoryBefore = k010Before.mojoodi_fael;

    const testIssue = {
      issue_num: `TEST-I-${Date.now()}`,
      kala_id: 'K010',
      maqdar: 1,
      tarikh: '1405/07/01',
      vahed: 'بسته',
      tahvil_gir: 'Test Suite',
    };

    const result = await postJSON('/issues', testIssue);
    assertTrue(result.id, 'Issue creation should return ID');

    // Verify inventory decreased
    const itemsAfter = await fetchJSON('/items');
    const k010After = itemsAfter.find(i => i.kod_kala === 'K010');
    assertEquals(k010After.mojoodi_fael, inventoryBefore - 1, 'Inventory should decrease by 1');
  });

  // Test 13: Insufficient Inventory Prevention
  await test('Prevent issue when insufficient inventory', async () => {
    try {
      await postJSON('/issues', {
        issue_num: `TEST-FAIL-${Date.now()}`,
        kala_id: 'K002', // Item with 0 inventory
        maqdar: 10,
        tarikh: '1405/07/01',
        vahed: 'شاخه',
        tahvil_gir: 'Test Suite',
      });
      throw new Error('Should have failed with insufficient inventory');
    } catch (error) {
      assertTrue(
        error.message.includes('Insufficient inventory') || error.message.includes('400'),
        'Should return insufficient inventory error'
      );
    }
  });

  // Test 14: Validation - Missing Fields Receipt
  await test('Receipt validation - missing fields', async () => {
    try {
      await postJSON('/receipts', {
        kala_id: 'K010',
        maqdar: 5,
      });
      throw new Error('Should have failed validation');
    } catch (error) {
      assertTrue(
        error.message.includes('Missing required fields') || error.message.includes('400'),
        'Should return validation error'
      );
    }
  });

  // Test 15: Validation - Missing Fields Issue
  await test('Issue validation - missing fields', async () => {
    try {
      await postJSON('/issues', {
        kala_id: 'K010',
        maqdar: 5,
      });
      throw new Error('Should have failed validation');
    } catch (error) {
      assertTrue(
        error.message.includes('Missing required fields') || error.message.includes('400'),
        'Should return validation error'
      );
    }
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
runTests().catch(error => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
