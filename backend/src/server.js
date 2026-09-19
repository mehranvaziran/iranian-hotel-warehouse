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
       LEFT JOIN kala k ON r.kala_id = k.id
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
       LEFT JOIN kala k ON i.kala_id = k.id
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
       LEFT JOIN kala k ON r.kala_id = k.id
       UNION ALL
       SELECT 'issue' as type, i.tarikh as timestamp, CONCAT('خروج کالا: ', k.naam_kala) as description
       FROM khorooj i
       LEFT JOIN kala k ON i.kala_id = k.id
       ORDER BY timestamp DESC
       LIMIT 10`
    );

    res.json(activities || []);
  } catch (error) {
    console.error('Error fetching activity:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
