import express from 'express';
import cors from 'cors';
import { initDatabase } from './db.js';
import { InventoryService } from './services/inventoryService.js';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

let db = null;
let inventoryService = null;

// Initialize database on startup
(async () => {
  db = await initDatabase();
  inventoryService = new InventoryService(db);
  console.log('✅ Database initialized');
  console.log('✅ Inventory service ready');
})();

// Middleware to check DB ready
const requireDB = (req, res, next) => {
  if (!db || !inventoryService) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  next();
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dbReady: !!db,
    inventoryServiceReady: !!inventoryService
  });
});

// Dashboard statistics - using centralized inventory
app.get('/api/dashboard/stats', requireDB, async (req, res) => {
  try {
    const stats = await inventoryService.getDashboardStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Recent receipts
app.get('/api/dashboard/recent-receipts', requireDB, async (req, res) => {
  try {
    const receipts = await db.all(
      `SELECT r.id, r.receipt_number, r.tarikh,
              COUNT(DISTINCT rl.id) as item_count,
              SUM(rl.maqdar) as total_quantity,
              r.tavazihat
       FROM receipts r
       LEFT JOIN receipt_lines rl ON r.id = rl.receipt_id
       GROUP BY r.id
       ORDER BY r.tarikh DESC, r.id DESC
       LIMIT 5`
    );
    res.json(receipts || []);
  } catch (error) {
    console.error('Error fetching receipts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Recent issues
app.get('/api/dashboard/recent-issues', requireDB, async (req, res) => {
  try {
    const issues = await db.all(
      `SELECT i.id, i.issue_number, i.tarikh, i.tahvil_gir, i.mahl_masraf,
              COUNT(DISTINCT il.id) as item_count,
              SUM(il.maqdar) as total_quantity,
              i.tavazihat
       FROM issues i
       LEFT JOIN issue_lines il ON i.id = il.issue_id
       GROUP BY i.id
       ORDER BY i.tarikh DESC, i.id DESC
       LIMIT 5`
    );
    res.json(issues || []);
  } catch (error) {
    console.error('Error fetching issues:', error);
    res.status(500).json({ error: error.message });
  }
});

// Inventory warnings - using centralized inventory
app.get('/api/dashboard/warnings', requireDB, async (req, res) => {
  try {
    const warnings = await inventoryService.getLowStockWarnings();
    res.json(warnings);
  } catch (error) {
    console.error('Error fetching warnings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Recent activity
app.get('/api/dashboard/activity', requireDB, async (req, res) => {
  try {
    const activities = await db.all(
      `SELECT 'receipt' as type, r.tarikh as date, r.receipt_number as doc_num,
              'ورود کالا' as description, r.created_at as timestamp
       FROM receipts r
       UNION ALL
       SELECT 'issue' as type, i.tarikh as date, i.issue_number as doc_num,
              'خروج کالا' as description, i.created_at as timestamp
       FROM issues i
       ORDER BY timestamp DESC
       LIMIT 10`
    );
    res.json(activities || []);
  } catch (error) {
    console.error('Error fetching activity:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all items - using centralized inventory
app.get('/api/items', requireDB, async (req, res) => {
  try {
    const inventory = await inventoryService.getAllInventory();
    res.json(inventory);
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single item with inventory
app.get('/api/items/:kod_kala', requireDB, async (req, res) => {
  try {
    const item = await db.get(
      `SELECT * FROM kala WHERE kod_kala = ?`,
      [req.params.kod_kala]
    );

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const currentStock = await inventoryService.getCurrentStock(req.params.kod_kala);

    res.json({
      ...item,
      current_stock: currentStock
    });
  } catch (error) {
    console.error('Error fetching item:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get item cardex
app.get('/api/items/:kod_kala/cardex', requireDB, async (req, res) => {
  try {
    const cardex = await inventoryService.getItemCardex(req.params.kod_kala);
    res.json(cardex);
  } catch (error) {
    console.error('Error fetching cardex:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get inventory - using centralized service
app.get('/api/inventory', requireDB, async (req, res) => {
  try {
    const inventory = await inventoryService.getAllInventory();
    res.json(inventory);
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all receipts with lines
app.get('/api/receipts', requireDB, async (req, res) => {
  try {
    const receipts = await db.all(
      `SELECT r.id, r.receipt_number, r.tarikh, r.tavazihat,
              COUNT(DISTINCT rl.id) as line_count
       FROM receipts r
       LEFT JOIN receipt_lines rl ON r.id = rl.receipt_id
       GROUP BY r.id
       ORDER BY r.tarikh DESC, r.id DESC`
    );
    res.json(receipts || []);
  } catch (error) {
    console.error('Error fetching receipts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single receipt with lines
app.get('/api/receipts/:id', requireDB, async (req, res) => {
  try {
    const receipt = await db.get(
      `SELECT * FROM receipts WHERE id = ?`,
      [req.params.id]
    );

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    const lines = await db.all(
      `SELECT rl.*, k.naam_kala
       FROM receipt_lines rl
       LEFT JOIN kala k ON rl.kala_id = k.kod_kala
       ORDER BY rl.radif, rl.id`,
      [req.params.id]
    );

    res.json({ ...receipt, lines });
  } catch (error) {
    console.error('Error fetching receipt:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create receipt (transactional multi-line)
app.post('/api/receipts', requireDB, async (req, res) => {
  try {
    const { receipt_number, tarikh, tavazihat, lines } = req.body;

    if (!receipt_number || !tarikh || !lines || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate all lines
    for (const line of lines) {
      if (!line.kala_id || !line.maqdar || line.maqdar <= 0) {
        return res.status(400).json({ error: 'Invalid line data' });
      }
    }

    await db.run('BEGIN TRANSACTION');

    try {
      // Insert receipt header
      const receiptResult = await db.run(
        `INSERT INTO receipts (receipt_number, tarikh, tavazihat) VALUES (?, ?, ?)`,
        [receipt_number, tarikh, tavazihat || '']
      );

      // Insert lines
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        await db.run(
          `INSERT INTO receipt_lines (receipt_id, kala_id, maqdar, vahed, tavazihat, radif)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [receiptResult.lastID, line.kala_id, line.maqdar, line.vahed || '', line.tavazihat || '', i + 1]
        );
      }

      await db.run('COMMIT');

      res.json({
        id: receiptResult.lastID,
        receipt_number,
        message: 'Receipt created successfully'
      });
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  } catch (error) {
    console.error('Error creating receipt:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all issues with lines
app.get('/api/issues', requireDB, async (req, res) => {
  try {
    const issues = await db.all(
      `SELECT i.id, i.issue_number, i.tarikh, i.tahvil_gir, i.mahl_masraf, i.tavazihat,
              COUNT(DISTINCT il.id) as line_count
       FROM issues i
       LEFT JOIN issue_lines il ON i.id = il.issue_id
       GROUP BY i.id
       ORDER BY i.tarikh DESC, i.id DESC`
    );
    res.json(issues || []);
  } catch (error) {
    console.error('Error fetching issues:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single issue with lines
app.get('/api/issues/:id', requireDB, async (req, res) => {
  try {
    const issue = await db.get(
      `SELECT * FROM issues WHERE id = ?`,
      [req.params.id]
    );

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    const lines = await db.all(
      `SELECT il.*, k.naam_kala
       FROM issue_lines il
       LEFT JOIN kala k ON il.kala_id = k.kod_kala
       WHERE il.issue_id = ?
       ORDER BY il.radif, il.id`,
      [req.params.id]
    );

    res.json({ ...issue, lines });
  } catch (error) {
    console.error('Error fetching issue:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create issue (transactional multi-line with stock validation)
app.post('/api/issues', requireDB, async (req, res) => {
  try {
    const { issue_number, tarikh, tahvil_gir, mahl_masraf, tavazihat, lines } = req.body;

    if (!issue_number || !tarikh || !lines || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate all lines
    for (const line of lines) {
      if (!line.kala_id || !line.maqdar || line.maqdar <= 0) {
        return res.status(400).json({ error: 'Invalid line data' });
      }
    }

    // Check stock for all items BEFORE starting transaction
    for (const line of lines) {
      const check = await inventoryService.canIssue(line.kala_id, line.maqdar);
      if (!check.canIssue) {
        const item = await db.get(`SELECT naam_kala FROM kala WHERE kod_kala = ?`, [line.kala_id]);
        return res.status(400).json({
          error: `موجودی ناکافی برای ${item?.naam_kala || line.kala_id}. ${check.message}`
        });
      }
    }

    await db.run('BEGIN TRANSACTION');

    try {
      // Insert issue header
      const issueResult = await db.run(
        `INSERT INTO issues (issue_number, tarikh, tahvil_gir, mahl_masraf, tavazihat)
         VALUES (?, ?, ?, ?, ?)`,
        [issue_number, tarikh, tahvil_gir || '', mahl_masraf || '', tavazihat || '']
      );

      // Insert lines
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        await db.run(
          `INSERT INTO issue_lines (issue_id, kala_id, maqdar, vahed, tavazihat, radif)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [issueResult.lastID, line.kala_id, line.maqdar, line.vahed || '', line.tavazihat || '', i + 1]
        );
      }

      await db.run('COMMIT');

      res.json({
        id: issueResult.lastID,
        issue_number,
        message: 'Issue created successfully'
      });
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  } catch (error) {
    console.error('Error creating issue:', error);
    res.status(500).json({ error: error.message });
  }
});

// Suggest next item code
app.get('/api/items/suggest-code/:prefix', requireDB, async (req, res) => {
  try {
    const prefix = req.params.prefix.toUpperCase();

    const lastItem = await db.get(
      `SELECT kod_kala FROM kala
       WHERE kod_kala LIKE ?
       ORDER BY kod_kala DESC
       LIMIT 1`,
      [`${prefix}%`]
    );

    let nextCode;
    if (!lastItem) {
      nextCode = `${prefix}001`;
    } else {
      const numPart = parseInt(lastItem.kod_kala.substring(prefix.length));
      const nextNum = (numPart + 1).toString().padStart(3, '0');
      nextCode = `${prefix}${nextNum}`;
    }

    res.json({ suggested_code: nextCode });
  } catch (error) {
    console.error('Error suggesting code:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create item
app.post('/api/items', requireDB, async (req, res) => {
  try {
    const { kod_kala, naam_kala, goh, zirgoh, vahed, hadd_aqal_mojoodi, tavazihat } = req.body;

    if (!kod_kala || !naam_kala) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await db.run(
      `INSERT INTO kala (kod_kala, naam_kala, goh, zirgoh, vahed, hadd_aqal_mojoodi, tavazihat)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [kod_kala, naam_kala, goh || '', zirgoh || '', vahed || '', hadd_aqal_mojoodi || 0, tavazihat || '']
    );

    res.json({ id: result.lastID, kod_kala, message: 'Item created successfully' });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Item code already exists' });
    }
    console.error('Error creating item:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update item
app.put('/api/items/:kod_kala', requireDB, async (req, res) => {
  try {
    const { naam_kala, goh, zirgoh, vahed, hadd_aqal_mojoodi, tavazihat } = req.body;

    await db.run(
      `UPDATE kala
       SET naam_kala = ?, goh = ?, zirgoh = ?, vahed = ?, hadd_aqal_mojoodi = ?, tavazihat = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE kod_kala = ?`,
      [naam_kala, goh, zirgoh, vahed, hadd_aqal_mojoodi, tavazihat, req.params.kod_kala]
    );

    res.json({ message: 'Item updated successfully' });
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete or deactivate item
app.delete('/api/items/:kod_kala', requireDB, async (req, res) => {
  try {
    const kodKala = req.params.kod_kala;

    // Check if item has movement history
    const baseline = await db.get(
      `SELECT COUNT(*) as count FROM mojoodi_mabna WHERE kala_id = ?`,
      [kodKala]
    );

    const receipts = await db.get(
      `SELECT COUNT(*) as count FROM receipt_lines WHERE kala_id = ?`,
      [kodKala]
    );

    const issues = await db.get(
      `SELECT COUNT(*) as count FROM issue_lines WHERE kala_id = ?`,
      [kodKala]
    );

    const hasHistory = baseline.count > 0 || receipts.count > 0 || issues.count > 0;

    if (hasHistory) {
      // Deactivate instead of delete
      await db.run(
        `UPDATE kala SET is_active = 0 WHERE kod_kala = ?`,
        [kodKala]
      );
      res.json({ message: 'Item deactivated (has history)', deactivated: true });
    } else {
      // Hard delete
      await db.run(`DELETE FROM kala WHERE kod_kala = ?`, [kodKala]);
      res.json({ message: 'Item deleted', deleted: true });
    }
  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
});
