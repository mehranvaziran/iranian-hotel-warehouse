import express from 'express';
import cors from 'cors';
import { initDatabase } from './db.js';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

let db = null;

// Initialize database on startup
(async () => {
  db = await initDatabase();
  console.log('Database initialized');
})();

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Dashboard statistics
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not ready' });
    }

    const totalInventory = await db.get(
      'SELECT SUM(mabna_qty) as total FROM mojoodi_mabna'
    );

    const itemsCount = await db.get(
      'SELECT COUNT(*) as count FROM kala'
    );

    const minStockItems = await db.get(
      `SELECT COUNT(*) as count FROM kala
       WHERE mojoodi_fael < hadd_aqal_mojoodi`
    );

    const completedItems = await db.get(
      `SELECT COUNT(*) as count FROM kala
       WHERE mojoodi_fael >= hadd_aqal_mojoodi`
    );

    res.json({
      totalInventory: totalInventory?.total || 0,
      itemsCount: itemsCount?.count || 0,
      minStockWarnings: minStockItems?.count || 0,
      completedItems: completedItems?.count || 0,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Recent receipts
app.get('/api/dashboard/recent-receipts', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not ready' });
    }

    const receipts = await db.all(
      `SELECT r.id, r.receipt_num, r.tarikh, k.naam_kala, r.maqdar, r.vahed
       FROM vorood r
       LEFT JOIN kala k ON r.kala_id = k.kod_kala
       ORDER BY r.id DESC
       LIMIT 5`
    );

    res.json(receipts || []);
  } catch (error) {
    console.error('Error fetching receipts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Recent issues
app.get('/api/dashboard/recent-issues', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not ready' });
    }

    const issues = await db.all(
      `SELECT i.id, i.issue_num, i.tarikh, k.naam_kala, i.maqdar, i.vahed, i.tahvil_gir
       FROM khorooj i
       LEFT JOIN kala k ON i.kala_id = k.kod_kala
       ORDER BY i.id DESC
       LIMIT 5`
    );

    res.json(issues || []);
  } catch (error) {
    console.error('Error fetching issues:', error);
    res.status(500).json({ error: error.message });
  }
});

// Inventory warnings (items below minimum stock)
app.get('/api/dashboard/warnings', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not ready' });
    }

    const warnings = await db.all(
      `SELECT id, kod_kala, naam_kala, mojoodi_fael, hadd_aqal_mojoodi, vahed
       FROM kala
       WHERE mojoodi_fael < hadd_aqal_mojoodi
       ORDER BY (hadd_aqal_mojoodi - mojoodi_fael) DESC
       LIMIT 10`
    );

    res.json(warnings || []);
  } catch (error) {
    console.error('Error fetching warnings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Recent activity
app.get('/api/dashboard/activity', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not ready' });
    }

    const activities = await db.all(
      `SELECT 'receipt' as type, r.tarikh as timestamp, CONCAT('ورود کالا: ', k.naam_kala) as description
       FROM vorood r
       LEFT JOIN kala k ON r.kala_id = k.kod_kala
       UNION ALL
       SELECT 'issue' as type, i.tarikh as timestamp, CONCAT('خروج کالا: ', k.naam_kala) as description
       FROM khorooj i
       LEFT JOIN kala k ON i.kala_id = k.kod_kala
       ORDER BY timestamp DESC
       LIMIT 10`
    );

    res.json(activities || []);
  } catch (error) {
    console.error('Error fetching activity:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all items with current inventory
app.get('/api/items', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not ready' });
    }

    const items = await db.all(
      `SELECT id, kod_kala, naam_kala, goh, zirgoh, vahed,
              hadd_aqal_mojoodi, mojoodi_fael
       FROM kala
       ORDER BY naam_kala`
    );

    res.json(items || []);
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single item details
app.get('/api/items/:kod_kala', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not ready' });
    }

    const item = await db.get(
      `SELECT * FROM kala WHERE kod_kala = ?`,
      [req.params.kod_kala]
    );

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json(item);
  } catch (error) {
    console.error('Error fetching item:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get inventory with detailed info
app.get('/api/inventory', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not ready' });
    }

    const inventory = await db.all(
      `SELECT k.kod_kala, k.naam_kala, k.goh, k.zirgoh, k.vahed,
              k.mojoodi_fael, k.hadd_aqal_mojoodi,
              COALESCE(SUM(v.maqdar), 0) as total_receipts,
              COALESCE(SUM(kh.maqdar), 0) as total_issues
       FROM kala k
       LEFT JOIN vorood v ON k.kod_kala = v.kala_id
       LEFT JOIN khorooj kh ON k.kod_kala = kh.kala_id
       GROUP BY k.kod_kala
       ORDER BY k.naam_kala`
    );

    res.json(inventory || []);
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all receipts
app.get('/api/receipts', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not ready' });
    }

    const receipts = await db.all(
      `SELECT v.id, v.receipt_num, v.tarikh, v.kala_id, k.naam_kala,
              v.maqdar, v.vahed
       FROM vorood v
       LEFT JOIN kala k ON v.kala_id = k.kod_kala
       ORDER BY v.tarikh DESC, v.id DESC`
    );

    res.json(receipts || []);
  } catch (error) {
    console.error('Error fetching receipts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all issues
app.get('/api/issues', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not ready' });
    }

    const issues = await db.all(
      `SELECT kh.id, kh.issue_num, kh.tarikh, kh.kala_id, k.naam_kala,
              kh.maqdar, kh.vahed, kh.tahvil_gir
       FROM khorooj kh
       LEFT JOIN kala k ON kh.kala_id = k.kod_kala
       ORDER BY kh.tarikh DESC, kh.id DESC`
    );

    res.json(issues || []);
  } catch (error) {
    console.error('Error fetching issues:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new receipt
app.post('/api/receipts', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not ready' });
    }

    const { receipt_num, tarikh, kala_id, maqdar, vahed } = req.body;

    if (!receipt_num || !tarikh || !kala_id || !maqdar) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await db.run(
      `INSERT INTO vorood (receipt_num, tarikh, kala_id, maqdar, vahed)
       VALUES (?, ?, ?, ?, ?)`,
      [receipt_num, tarikh, kala_id, maqdar, vahed]
    );

    // Update inventory
    await db.run(
      `UPDATE kala SET mojoodi_fael = mojoodi_fael + ? WHERE kod_kala = ?`,
      [maqdar, kala_id]
    );

    res.json({ id: result.lastID, message: 'Receipt created successfully' });
  } catch (error) {
    console.error('Error creating receipt:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new issue
app.post('/api/issues', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not ready' });
    }

    const { issue_num, tarikh, kala_id, maqdar, vahed, tahvil_gir } = req.body;

    if (!issue_num || !tarikh || !kala_id || !maqdar) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check inventory
    const item = await db.get(
      `SELECT mojoodi_fael FROM kala WHERE kod_kala = ?`,
      [kala_id]
    );

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (item.mojoodi_fael < maqdar) {
      return res.status(400).json({ error: 'Insufficient inventory' });
    }

    const result = await db.run(
      `INSERT INTO khorooj (issue_num, tarikh, kala_id, maqdar, vahed, tahvil_gir)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [issue_num, tarikh, kala_id, maqdar, vahed, tahvil_gir]
    );

    // Update inventory
    await db.run(
      `UPDATE kala SET mojoodi_fael = mojoodi_fael - ? WHERE kod_kala = ?`,
      [maqdar, kala_id]
    );

    res.json({ id: result.lastID, message: 'Issue created successfully' });
  } catch (error) {
    console.error('Error creating issue:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
