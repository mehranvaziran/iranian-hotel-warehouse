/**
 * Centralized Inventory Domain Service
 *
 * This is the single source of truth for inventory calculations.
 * All inventory queries must use this service.
 *
 * Business Rule: Current Stock = Baseline + Receipts - Issues
 */

export class InventoryService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Get current stock for a single item
   * @param {string} itemCode - Item kod_kala
   * @returns {Promise<number>} Current stock quantity
   */
  async getCurrentStock(itemCode) {
    const result = await this.db.get(
      `SELECT
        COALESCE(
          (SELECT SUM(mabna_qty) FROM mojoodi_mabna WHERE kala_id = ?), 0
        ) +
        COALESCE(
          (SELECT SUM(rl.maqdar) FROM receipt_lines rl WHERE rl.kala_id = ?), 0
        ) -
        COALESCE(
          (SELECT SUM(il.maqdar) FROM issue_lines il WHERE il.kala_id = ?), 0
        ) as current_stock`,
      [itemCode, itemCode, itemCode]
    );
    return result.current_stock || 0;
  }

  /**
   * Get inventory for all items
   * @returns {Promise<Array>} Array of inventory records
   */
  async getAllInventory() {
    const items = await this.db.all(`SELECT * FROM kala WHERE is_active = 1 ORDER BY naam_kala`);

    const inventory = await Promise.all(
      items.map(async (item) => {
        const baseline = await this.db.get(
          `SELECT COALESCE(SUM(mabna_qty), 0) as qty FROM mojoodi_mabna WHERE kala_id = ?`,
          [item.kod_kala]
        );

        const receipts = await this.db.get(
          `SELECT COALESCE(SUM(rl.maqdar), 0) as qty FROM receipt_lines rl WHERE rl.kala_id = ?`,
          [item.kod_kala]
        );

        const issues = await this.db.get(
          `SELECT COALESCE(SUM(il.maqdar), 0) as qty FROM issue_lines il WHERE il.kala_id = ?`,
          [item.kod_kala]
        );

        const currentStock = baseline.qty + receipts.qty - issues.qty;

        return {
          ...item,
          baseline_qty: baseline.qty,
          total_receipts: receipts.qty,
          total_issues: issues.qty,
          current_stock: currentStock,
          status: currentStock === 0 ? 'تمام شده' :
                  currentStock < item.hadd_aqal_mojoodi ? 'زیر حد مجاز' : 'موجود'
        };
      })
    );

    return inventory;
  }

  /**
   * Get item cardex (movement history with running balance)
   * @param {string} itemCode - Item kod_kala
   * @returns {Promise<Array>} Cardex entries
   */
  async getItemCardex(itemCode) {
    // Get baseline
    const baseline = await this.db.all(
      `SELECT tarikh_mabna as date, mabna_qty as quantity, tavazihat as note
       FROM mojoodi_mabna
       WHERE kala_id = ?
       ORDER BY tarikh_mabna`,
      [itemCode]
    );

    // Get receipts
    const receipts = await this.db.all(
      `SELECT r.tarikh as date, r.receipt_number as doc_num, rl.maqdar as quantity,
              rl.tavazihat as note, rl.radif
       FROM receipt_lines rl
       JOIN receipts r ON rl.receipt_id = r.id
       WHERE rl.kala_id = ?
       ORDER BY r.tarikh, rl.radif, rl.id`,
      [itemCode]
    );

    // Get issues
    const issues = await this.db.all(
      `SELECT i.tarikh as date, i.issue_number as doc_num, il.maqdar as quantity,
              il.tavazihat as note, i.tahvil_gir, i.mahl_masraf, il.radif
       FROM issue_lines il
       JOIN issues i ON il.issue_id = i.id
       WHERE il.kala_id = ?
       ORDER BY i.tarikh, il.radif, il.id`,
      [itemCode]
    );

    // Combine and sort chronologically
    const movements = [];

    baseline.forEach(b => {
      movements.push({
        type: 'baseline',
        date: b.date,
        doc_num: 'موجودی مبنا',
        receipt_qty: b.quantity,
        issue_qty: 0,
        note: b.note
      });
    });

    receipts.forEach(r => {
      movements.push({
        type: 'receipt',
        date: r.date,
        doc_num: r.doc_num,
        receipt_qty: r.quantity,
        issue_qty: 0,
        note: r.note,
        radif: r.radif
      });
    });

    issues.forEach(i => {
      movements.push({
        type: 'issue',
        date: i.date,
        doc_num: i.doc_num,
        receipt_qty: 0,
        issue_qty: i.quantity,
        note: i.note,
        tahvil_gir: i.tahvil_gir,
        mahl_masraf: i.mahl_masraf,
        radif: i.radif
      });
    });

    // Sort: baseline first, then by date, then by type (receipt before issue), then by radif
    movements.sort((a, b) => {
      if (a.type === 'baseline' && b.type !== 'baseline') return -1;
      if (a.type !== 'baseline' && b.type === 'baseline') return 1;

      if (a.date !== b.date) return a.date < b.date ? -1 : 1;

      if (a.type !== b.type) {
        if (a.type === 'receipt') return -1;
        if (b.type === 'receipt') return 1;
      }

      return (a.radif || 0) - (b.radif || 0);
    });

    // Calculate running balance
    let balance = 0;
    movements.forEach(m => {
      balance += m.receipt_qty - m.issue_qty;
      m.balance = balance;
    });

    return movements;
  }

  /**
   * Check if an issue can be fulfilled
   * @param {string} itemCode - Item kod_kala
   * @param {number} quantity - Quantity to issue
   * @param {string} excludeIssueNum - Issue number to exclude (for edits)
   * @returns {Promise<{canIssue: boolean, currentStock: number, message: string}>}
   */
  async canIssue(itemCode, quantity, excludeIssueNum = null) {
    let currentStock = await this.getCurrentStock(itemCode);

    // If editing an existing issue, add back its quantity
    if (excludeIssueNum) {
      const existing = await this.db.get(
        `SELECT COALESCE(SUM(il.maqdar), 0) as qty
         FROM issue_lines il
         JOIN issues i ON il.issue_id = i.id
         WHERE i.issue_number = ? AND il.kala_id = ?`,
        [excludeIssueNum, itemCode]
      );
      currentStock += existing.qty;
    }

    if (currentStock < quantity) {
      return {
        canIssue: false,
        currentStock,
        message: `موجودی ناکافی. موجودی فعلی: ${currentStock}`
      };
    }

    return {
      canIssue: true,
      currentStock,
      message: 'OK'
    };
  }

  /**
   * Get dashboard statistics
   * @returns {Promise<Object>} Dashboard stats
   */
  async getDashboardStats() {
    const inventory = await this.getAllInventory();

    const totalInventory = inventory.reduce((sum, item) => sum + item.current_stock, 0);
    const itemsCount = inventory.length;
    const stockedItems = inventory.filter(item => item.current_stock > 0).length;
    const lowStockItems = inventory.filter(
      item => item.current_stock > 0 && item.current_stock < item.hadd_aqal_mojoodi
    ).length;
    const outOfStockItems = inventory.filter(item => item.current_stock === 0).length;

    return {
      totalInventory,
      itemsCount,
      stockedItems,
      lowStockItems,
      outOfStockItems,
      minStockWarnings: lowStockItems
    };
  }

  /**
   * Get low stock warnings
   * @returns {Promise<Array>} Items below minimum stock
   */
  async getLowStockWarnings() {
    const inventory = await this.getAllInventory();
    return inventory
      .filter(item => item.current_stock > 0 && item.current_stock < item.hadd_aqal_mojoodi)
      .sort((a, b) => (a.hadd_aqal_mojoodi - a.current_stock) - (b.hadd_aqal_mojoodi - b.current_stock))
      .slice(0, 10);
  }

  /**
   * Movement totals for a single item (used by cardex print header).
   * @param {string} itemCode - Item kod_kala
   * @returns {Promise<Object>} { baseline, receipts, issues, current }
   */
  async getItemTotals(itemCode) {
    const rows = await this.db.get(
      `SELECT
         COALESCE((SELECT SUM(mabna_qty) FROM mojoodi_mabna WHERE kala_id = ?), 0) AS baseline,
         COALESCE((SELECT SUM(maqdar)  FROM receipt_lines WHERE kala_id = ?), 0) AS receipts,
         COALESCE((SELECT SUM(maqdar)  FROM issue_lines  WHERE kala_id = ?), 0) AS issues`,
      [itemCode, itemCode, itemCode]
    );
    const baseline = Number(rows.baseline || 0);
    const receipts = Number(rows.receipts || 0);
    const issues = Number(rows.issues || 0);
    return { baseline, receipts, issues, current: baseline + receipts - issues };
  }

  /**
   * Receipts report with their lines, optionally filtered by date range.
   * @param {Object} [filters] - { from, to } Persian-date bounds (inclusive)
   * @returns {Promise<Array>} Receipt headers each with a `lines` array
   */
  async getReceiptsReport(filters = {}) {
    const where = [];
    const params = [];
    if (filters.from) { where.push('r.tarikh >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('r.tarikh <= ?'); params.push(filters.to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const receipts = await this.db.all(
      `SELECT r.* FROM receipts r ${whereSql} ORDER BY r.tarikh DESC, r.id DESC`,
      params
    );

    return Promise.all(receipts.map(async (r) => {
      const lines = await this.db.all(
        `SELECT rl.*, k.naam_kala
         FROM receipt_lines rl
         LEFT JOIN kala k ON rl.kala_id = k.kod_kala
         WHERE rl.receipt_id = ?
         ORDER BY rl.radif, rl.id`,
        [r.id]
      );
      return { ...r, lines };
    }));
  }

  /**
   * Issues report with their lines, optionally filtered by date range.
   * @param {Object} [filters] - { from, to } Persian-date bounds (inclusive)
   * @returns {Promise<Array>} Issue headers each with a `lines` array
   */
  async getIssuesReport(filters = {}) {
    const where = [];
    const params = [];
    if (filters.from) { where.push('i.tarikh >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('i.tarikh <= ?'); params.push(filters.to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const issues = await this.db.all(
      `SELECT i.* FROM issues i ${whereSql} ORDER BY i.tarikh DESC, i.id DESC`,
      params
    );

    return Promise.all(issues.map(async (i) => {
      const lines = await this.db.all(
        `SELECT il.*, k.naam_kala
         FROM issue_lines il
         LEFT JOIN kala k ON il.kala_id = k.kod_kala
         WHERE il.issue_id = ?
         ORDER BY il.radif, il.id`,
        [i.id]
      );
      return { ...i, lines };
    }));
  }

  /**
   * All-item movement report (flat cardex across every item).
   * @param {Object} [filters] - { from, to, kala_id }
   * @returns {Promise<Array>} Movements with item name and direction
   */
  async getMovementsReport(filters = {}) {
    const where = [];
    const params = [];
    if (filters.from) { where.push('m.tarikh >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('m.tarikh <= ?'); params.push(filters.to); }
    if (filters.kala_id) { where.push('m.kala_id = ?'); params.push(filters.kala_id); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const movements = await this.db.all(
      `SELECT m.* FROM (
         SELECT 'baseline' AS kind, kala_id, tarikh_mabna AS tarikh, '' AS doc_number,
                mabna_qty AS qty, '' AS party, tavazihat
         FROM mojoodi_mabna
         UNION ALL
         SELECT 'receipt' AS kind, rl.kala_id, r.tarikh, r.receipt_number,
                rl.maqdar AS qty, '' AS party, rl.tavazihat
         FROM receipt_lines rl JOIN receipts r ON rl.receipt_id = r.id
         UNION ALL
         SELECT 'issue' AS kind, il.kala_id, i.tarikh, i.issue_number,
                il.maqdar AS qty, i.tahvil_gir AS party, il.tavazihat
         FROM issue_lines il JOIN issues i ON il.issue_id = i.id
       ) m ${whereSql}
       ORDER BY m.tarikh DESC, m.kind DESC`,
      params
    );

    // Attach item names in one pass
    const codes = [...new Set(movements.map((m) => m.kala_id))];
    const names = new Map();
    for (const code of codes) {
      const row = await this.db.get(`SELECT naam_kala FROM kala WHERE kod_kala = ?`, [code]);
      names.set(code, row?.naam_kala || null);
    }

    return movements.map((m) => ({
      ...m,
      naam_kala: names.get(m.kala_id),
      direction: m.kind === 'issue' ? -1 : 1,
    }));
  }
}
