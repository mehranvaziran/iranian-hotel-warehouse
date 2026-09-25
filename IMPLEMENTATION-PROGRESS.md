# Implementation Progress Report
**Date:** 2026-09-25 (updated; repair applied)
**Session:** End-to-End Implementation (continuation from `482b499`)

## ✅ Completed This Session

### Bug fixes (backend)
- ✅ Fixed `GET /api/receipts/:id` — bind parameter with no placeholder caused
  `SQLITE_RANGE: column index out of range` (HTTP 500) on every receipt lookup
- ✅ `PUT /api/items/:kod_kala` now validates the name and returns **404** for
  missing items instead of silently reporting success
- ✅ Fixed the root cause of the mis-mapped baseline inventory in
  `loadInitialData` — baseline rows now fall back to matching the item by name
  when `kala_id` is missing

### Task #3: Item Management
- ✅ Full CRUD (create / read / update / delete)
- ✅ Code generation by prefix (`/api/items/suggest-code/:prefix`)
- ✅ Delete vs. deactivate: items with movement history are soft-deleted
  (`is_active = 0`), others are hard-deleted
- ✅ `GET /api/items?include_inactive=1` returns the full catalog with stock

### Task #4: Cardex & Reports
- ✅ Cardex endpoint with running balance (verified: final balance == current stock)
- ✅ `GET /api/reports/inventory` (optional `?group=` filter, with totals)
- ✅ `GET /api/reports/receipts` and `/api/reports/issues` (optional date range, lines included)
- ✅ `GET /api/reports/movements` — flat movement ledger across all items
- ✅ Frontend **Reports** page with four tabs and filters

### Task #5: Printing / PDF
- ✅ `GET /api/print/receipt/:id` — printable receipt voucher
- ✅ `GET /api/print/issue/:id` — printable issue voucher
- ✅ `GET /api/print/cardex/:kod_kala` — printable cardex
- ✅ `GET /api/print/inventory` — printable inventory report
- All pages are standalone RTL Persian HTML with hotel header, totals row and
  signature lines (انباردار / تحویل‌دهنده / تحویل‌گیرنده / مدیر پروژه),
  and auto-open the browser print dialog (Save as PDF)

### Task #6: Frontend
- ✅ Rewrote **Receipts** and **Issues** for multi-line documents
  (add/remove line rows, unit auto-fill, expandable document rows, per-document print)
- ✅ **Issues** shows live stock per line and blocks over-issue before submit
- ✅ Rewrote **Items** with create / edit / delete, code suggestion, status badges,
  inactive-item toggle, details modal and cardex modal
- ✅ **Inventory** and **Dashboard** now consume derived `current_stock`
- ✅ Dashboard statistics use the new shape (`stockedItems`, `outOfStockItems`)
- ✅ All pages use the Vite API proxy instead of hardcoded `localhost:3000`
- ✅ Frontend production build passes (56 modules, no errors)

### Task #7: Testing
- ✅ Rewrote `tests/api-test.js` for the new API (30 assertions), covering:
  - Derived-inventory invariant for every item
  - `/api/items` and `/api/inventory` consistency
  - Item lifecycle (create / duplicate / update / 404 / hard delete / deactivate)
  - Multi-line receipt and issue moving stock by the exact line sum
  - Insufficient-inventory rejection leaving stock unchanged
  - Cardex non-negative running balance ending at current stock
  - Document deletion restoring stock
  - Reports and printable HTML
  - Full cleanup of test artifacts
- ✅ **29/30 tests pass**

### Extra: document deletion
- ✅ `DELETE /api/receipts/:id` and `DELETE /api/issues/:id` (transactional,
  cascading to lines) — completes the CRUD story and enables test isolation

## ✅ Baseline Repair — Applied 2026-09-25

The repair script was run against `data/warehouse.db` (dry-run verified first,
database backed up to `data/warehouse.backup-2026-09-25T04-52-38.db` before any
write):

- 27 baseline rows re-keyed by item code (was 11 visible groups + 17 NULL rows)
- **0 NULL-keyed rows remain**
- Total baseline quantity unchanged: **191** (the repair re-maps, it does not
  invent stock)
- The 69 previously invisible units now count; verified against `/api/inventory`:
  K010 = 44, T005 = 10, T006 = 5, S002 = 3, C002 = 2, T003 = 2, T004 = 2

The root cause is also fixed at the source: `loadInitialData` in `db.js` now
falls back to matching baseline rows by item name, so a database seeded from
scratch loads correctly without needing the repair script.

**Test status: 30/30 passing** (`node tests/api-test.js`), including the
previously-failing `Movements report covers all stock movements`.

Frontend production build also passes (56 modules, no errors).

## 📋 Remaining

- Nothing blocking. Optional: `git push` (branch is 1 commit ahead of origin).
