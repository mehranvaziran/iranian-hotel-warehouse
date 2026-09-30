/**
 * Centralized Inventory Domain Service
 *
 * This is the single source of truth for inventory calculations.
 * All inventory queries must use this service.
 *
 * Business Rule: Current Stock = Baseline + Receipts - Issues
 */

import { assertJalaliDate } from '../utils/jalali.js';
import { reject } from '../utils/httpError.js';

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
    // `|| 0` would also mask a legitimate NaN from a corrupt row; Number()
    // keeps a real zero while still never returning null to callers.
    return Number(result?.current_stock ?? 0);
  }

  /**
   * Get inventory for all items.
   *
   * Inactive items are deliberately included: an item can be retired from new
   * transactions while still holding stock, and that stock must stay visible
   * in inventory, reports and totals. Hiding it would silently underreport the
   * warehouse. The `is_active` flag lets callers decide whether an item is
   * still selectable for new documents.
   *
   * @returns {Promise<Array>} Array of inventory records
   */
  async getAllInventory() {
    const items = await this.db.all(`SELECT * FROM kala ORDER BY naam_kala`);

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

        const currentStock = Number(baseline.qty) + Number(receipts.qty) - Number(issues.qty);

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
   * Verify that a set of issue lines can be fulfilled *as one document*.
   *
   * Two rules that the previous per-line check broke:
   *
   * 1. Lines must be aggregated per item. A document carrying two lines of the
   *    same item (say 8 and 7 against 10 in stock) passed the old check line
   *    by line and then drove the item negative.
   *
   * 2. The check must run *inside* the caller's transaction. Checking before
   *    BEGIN left a window in which two concurrent issues both passed against
   *    the same stock. Called mid-transaction the SELECT sees uncommitted
   *    writes, and SQLite's write lock serialises the two writers.
   *
   * @param {Array<{kala_id: string, maqdar: number}>} lines
   * @returns {Promise<{canIssue: boolean, shortages: Array, message: string}>}
   */
  async checkIssueable(lines) {
    const requested = new Map();
    for (const line of lines) {
      requested.set(line.kala_id, (requested.get(line.kala_id) || 0) + Number(line.maqdar));
    }

    const shortages = [];
    for (const [kala_id, qty] of requested) {
      const available = await this.getCurrentStock(kala_id);
      if (available < qty) {
        shortages.push({ kala_id, requested: qty, available });
      }
    }

    if (shortages.length) {
      return {
        canIssue: false,
        shortages,
        message: shortages
          .map((s) => `${s.kala_id}: درخواست ${s.requested}، موجودی ${s.available}`)
          .join('، '),
      };
    }

    return { canIssue: true, shortages: [], message: 'OK' };
  }

  /**
   * Resolve document lines against the Item Master.
   *
   * The Item Master is authoritative for the unit of measure: whatever the
   * client sends in `line.vahed` is discarded and the master's `vahed` is what
   * gets stored. The unit is immutable once an item exists, so the master value
   * can never disagree with the documents that reference it — a document line
   * carrying its own unit would let a receipt and an issue for the same item be
   * recorded in different units.
   *
   * Also enforces the catalog rules a line alone cannot check:
   *  - the item must exist (a bare foreign-key failure would surface as a 500);
   *  - the item must be active, because a retired item may still hold stock but
   *    must not be usable in *new* documents.
   *
   * Must be called inside the caller's transaction so these checks see the same
   * snapshot as the write.
   *
   * @param {Array} lines - [{ kala_id, maqdar, vahed?, tavazihat? }]
   * @returns {Promise<Array>} Lines with the authoritative `vahed` attached.
   */
  async resolveDocumentLines(lines) {
    const resolved = [];
    for (const line of lines) {
      const qty = Number(line.maqdar);
      if (!line.kala_id || !Number.isFinite(qty) || qty <= 0) {
        throw reject('ردیف سند نامعتبر است (کد کالا و مقدار مثبت الزامی است)');
      }

      const item = await this.db.get(
        `SELECT kod_kala, vahed, is_active FROM kala WHERE kod_kala = ?`,
        [line.kala_id]
      );

      if (!item) {
        throw reject(`کالای «${line.kala_id}» در تعریف کالاها وجود ندارد`);
      }

      if (item.is_active !== 1) {
        throw reject(
          `کالای «${line.kala_id}» غیرفعال است و نمی‌تواند در سند جدید وارد شود`
        );
      }

      resolved.push({
        kala_id: line.kala_id,
        maqdar: qty,
        // The Item Master unit, not the client's.
        vahed: item.vahed ?? '',
        tavazihat: line.tavazihat ?? '',
      });
    }
    return resolved;
  }

  /**
   * Create a multi-line receipt atomically.
   *
   * `BEGIN IMMEDIATE` takes the write lock *before* any SELECT, so the whole
   * validate-then-write span is a single critical section: two writers trying to
   * spend or book the same stock serialise instead of both reading a stale
   * snapshot and both succeeding.
   *
   * @returns {Promise<{ id: number, receipt_number: string }>}
   */
  async createReceipt({ receipt_number, tarikh, tavazihat, lines }) {
    assertJalaliDate(tarikh, 'رسید');

    await this.db.run('BEGIN IMMEDIATE TRANSACTION');
    try {
      const resolved = await this.resolveDocumentLines(lines);

      const existing = await this.db.get(
        `SELECT id FROM receipts WHERE receipt_number = ?`,
        [receipt_number]
      );
      if (existing) {
        throw reject(`شماره رسید ${receipt_number} قبلاً ثبت شده است`);
      }

      const header = await this.db.run(
        `INSERT INTO receipts (receipt_number, tarikh, tavazihat) VALUES (?, ?, ?)`,
        [receipt_number, tarikh, tavazihat || '']
      );

      await this.#insertLines('receipt_lines', 'receipt_id', header.lastID, resolved);

      await this.db.run('COMMIT');
      return { id: header.lastID, receipt_number };
    } catch (err) {
      await this.#rollback();
      throw err;
    }
  }

  /**
   * Create a multi-line issue atomically, with stock validated inside the
   * transaction.
   *
   * The stock check runs after `BEGIN IMMEDIATE`, so it sees committed stock and
   * no other writer can alter that stock until this document is committed or
   * rolled back. A rejected document leaves nothing behind — the header and its
   * lines commit together or not at all.
   *
   * @returns {Promise<{ id: number, issue_number: string }>}
   */
  async createIssue({ issue_number, tarikh, tahvil_gir, mahl_masraf, tavazihat, lines }) {
    assertJalaliDate(tarikh, 'حواله');

    await this.db.run('BEGIN IMMEDIATE TRANSACTION');
    try {
      const resolved = await this.resolveDocumentLines(lines);

      const check = await this.checkIssueable(resolved);
      if (!check.canIssue) {
        const names = [];
        for (const s of check.shortages) {
          const item = await this.db.get(
            `SELECT naam_kala FROM kala WHERE kod_kala = ?`,
            [s.kala_id]
          );
          names.push(
            `${item?.naam_kala || s.kala_id} (درخواست ${s.requested}، موجودی ${s.available})`
          );
        }
        throw reject(`موجودی ناکافی برای: ${names.join('، ')}`);
      }

      const existing = await this.db.get(
        `SELECT id FROM issues WHERE issue_number = ?`,
        [issue_number]
      );
      if (existing) {
        throw reject(`شماره حواله ${issue_number} قبلاً ثبت شده است`);
      }

      const header = await this.db.run(
        `INSERT INTO issues (issue_number, tarikh, tahvil_gir, mahl_masraf, tavazihat)
         VALUES (?, ?, ?, ?, ?)`,
        [issue_number, tarikh, tahvil_gir || '', mahl_masraf || '', tavazihat || '']
      );

      await this.#insertLines('issue_lines', 'issue_id', header.lastID, resolved);

      await this.db.run('COMMIT');
      return { id: header.lastID, issue_number };
    } catch (err) {
      await this.#rollback();
      throw err;
    }
  }

  /** Write the resolved lines of one document, numbered by their position. */
  async #insertLines(table, headerColumn, headerId, lines) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      await this.db.run(
        `INSERT INTO ${table} (${headerColumn}, kala_id, maqdar, vahed, tavazihat, radif)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [headerId, line.kala_id, line.maqdar, line.vahed, line.tavazihat, i + 1]
      );
    }
  }

  /**
   * Roll back, tolerating an already-ended transaction. A thrown error here
   * would swallow the original reason the caller is rolling back.
   */
  async #rollback() {
    try {
      await this.db.run('ROLLBACK');
    } catch {
      /* not in a transaction anymore */
    }
  }

  /**
   * Apply an Item Master edit.
   *
   * `goh` and `vahed` are locked after creation: they identify the item across
   * every document and every report, and the unit is what document lines store.
   * A client may send them back unchanged; a client may not change them.
   *
   * Editable: naam_kala, zirgoh, hadd_aqal_mojoodi, tavazihat, is_active.
   *
   * @returns {Promise<void>}
   */
  async updateItem(kod_kala, { naam_kala, zirgoh, hadd_aqal_mojoodi, tavazihat, is_active }) {
    if (!naam_kala) throw reject('نام کالا الزامی است');

    const existing = await this.db.get(
      `SELECT * FROM kala WHERE kod_kala = ?`,
      [kod_kala]
    );
    if (!existing) throw reject('کالای مورد نظر یافت نشد', 404);

    const active = is_active === undefined ? existing.is_active : (is_active ? 1 : 0);

    await this.db.run(
      `UPDATE kala
       SET naam_kala = ?, zirgoh = ?, hadd_aqal_mojoodi = ?, tavazihat = ?, is_active = ?
       WHERE kod_kala = ?`,
      [
        naam_kala,
        zirgoh ?? existing.zirgoh ?? '',
        hadd_aqal_mojoodi ?? existing.hadd_aqal_mojoodi ?? 0,
        tavazihat ?? existing.tavazihat ?? '',
        active,
        kod_kala,
      ]
    );
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
