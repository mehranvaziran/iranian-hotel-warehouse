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
}
