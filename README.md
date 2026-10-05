# سامانه مدیریت انبار هتل ایرانیان
# Iranian Hotel Development - Warehouse Management System

A complete, production-ready warehouse management system with derived real-time
inventory tracking, multi-line receipt/issue documents, cardex, reports and printing.

## 🎯 Project Status

**Status:** ✅ Production Ready  
**Version:** 1.0.0 (as declared by `backend/package.json` and
`frontend/package.json`)  
**Last Updated:** 2026-10-02

### ✅ Completed Features

- [x] Derived inventory: `current = baseline + receipts − issues` (no stored stock column)
- [x] Centralized `InventoryService` as the single source of truth for all stock math
- [x] Multi-line receipt (ورود کالا) and issue (خروج کالا) documents, transactional
- [x] Full item CRUD with code suggestion and activate/deactivate lifecycle
- [x] Item cardex (کارتکس) with running balance
- [x] Reports: inventory, receipts, issues, all-item movement ledger
- [x] Printing / PDF for receipts, issue vouchers, cardex, inventory and
  movements reports (RTL print pages with header, totals and signature lines);
  the print page opens as a preview and only prints on an explicit click
- [x] Dashboard with live statistics, low-stock warnings and item search
- [x] Persian RTL UI throughout
- [x] Real data imported from Excel (28 items)
- [x] Comprehensive automated test suite (80 unit tests + 64 API assertions, plus
  16 front-end assertions over the document-line rules) including inventory
  invariants
- [x] API validation and error handling
- [x] Insufficient inventory prevention (client- and server-side)
- [x] Jalali calendar as the canonical business date, validated against real
  month lengths at the API boundary
- [x] Document numbers in one convention: `{R|H}-{Jalali YYMMDD}-{sequence}`,
  with the next number suggested from the date. The head is derived from the
  document's date and shown read-only, so only the sequence is typed; the API
  also refuses a number whose embedded date is not the document's own date.
  Historical numbers in older spellings are never rewritten
- [x] Item-code suggestion follows the *numeric* sequence inside a prefix, so
  `K9` no longer sorts above `K010` and a suggested code cannot collide with one
  the catalog already has, at the width the catalog itself uses
- [x] A document line is either valid or the whole document is invalid: nothing
  half-entered is silently dropped, and every problem is reported on the row
  it belongs to, with all entered values kept in place
- [x] Item code, group and unit locked once an item exists; the unit a document
  line stores comes from the Item Master, not the form
- [x] Group ordering and unit precision held as database metadata, not
  hard-coded in the front-end

## 📊 System Overview

### Item Categories

The four groups below are the ones the database actually holds, in the
`sort_order` the API serves, with the active item count each one carries:

| # | Group | Active items | English gloss |
|---|-------|--------------|---------------|
| 1 | کناف | 18 | Drywall materials |
| 2 | ابزار و ملزومات  عمومی | 6 | General tools and supplies |
| 3 | رنگ و نقاشی | 2 | Paint and coating |
| 4 | مصالح ساختمانی | 2 | Construction materials |

28 items in total. The names are reproduced exactly as they are stored —
"ابزار و ملزومات  عمومی" carries two spaces in the database, and the catalog
is matched against the stored spelling, so any other spelling is a different
group. The order is metadata, not the front-end's own list order.

## 🏗 Architecture

### Backend
- **Framework:** Node.js + Express (ESM)
- **Database:** SQLite3 (via `sqlite` wrapper)
- **Port:** 3000
- **API Style:** RESTful JSON
- **Layers:**
  - `src/server.js` — routes and validation
  - `src/services/inventoryService.js` — all inventory math (single source of truth)
  - `src/db.js` — schema, migration and seed data
  - `src/printTemplates.js` — RTL printable HTML documents

### Frontend
- **Framework:** React 18 + Vite
- **Port:** 5173 (API requests are proxied to the backend)
- **Styling:** Custom CSS with RTL support
- **UI Language:** Persian (Farsi)

### Core business rule

Stock is **never stored as a column**. It is always derived:

```
current_stock(kala) = Σ mojoodi_mabna.mabna_qty
                    + Σ receipt_lines.maqdar
                    − Σ issue_lines.maqdar
```

Every endpoint and every UI page reads stock through `InventoryService`, so the
numbers cannot drift out of sync.

### Database Schema

```sql
-- Items (کالاها)
kala (
  id INTEGER PRIMARY KEY,
  kod_kala TEXT UNIQUE,        -- Item code, e.g. K001
  naam_kala TEXT NOT NULL,     -- Name
  goh TEXT,                    -- Category
  zirgoh TEXT,                 -- Subcategory
  vahed TEXT,                  -- Unit
  hadd_aqal_mojoodi REAL,      -- Minimum stock level
  tavazihat TEXT,              -- Notes
  is_active INTEGER DEFAULT 1  -- Soft-delete flag for items with history
)

-- Baseline inventory (موجودی مبنا)
mojoodi_mabna (
  id INTEGER PRIMARY KEY,
  kala_id TEXT NOT NULL,       -- FK -> kala.kod_kala
  mabna_qty REAL NOT NULL,
  tarikh_mabna DATE,
  tavazihat TEXT
)

-- Receipt documents (رسیدهای ورود) - header + lines
receipts (id, receipt_number UNIQUE, tarikh, tavazihat, ...)
receipt_lines (id, receipt_id FK, kala_id FK, maqdar, vahed, tavazihat, radif)

-- Issue documents (حواله‌های خروج) - header + lines
issues (id, issue_number UNIQUE, tarikh, tahvil_gir, mahl_masraf, tavazihat, ...)
issue_lines (id, issue_id FK, kala_id FK, maqdar, vahed, tavazihat, radif)
```

Document lines cascade on delete, and receipt/issue creation runs inside a
single SQL transaction so a document is never written partially.

## 🚀 Quick Start

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### Installation

1. **Clone or navigate to the project:**
   ```bash
   cd F:\Mehran-AI-Lab
   ```

2. **Install backend dependencies:**
   ```bash
   cd backend
   npm install
   ```

3. **Install frontend dependencies:**
   ```bash
   cd ../frontend
   npm install
   ```

### Running the Application

**Terminal 1 - Backend:**
```bash
cd backend
npm start
```
Backend will start on `http://localhost:3000`

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```
Frontend will start on `http://localhost:5173`

### Access the Application

- **Frontend UI:** http://localhost:5173
- **Backend API:** http://localhost:3000/api
- **Health Check:** http://localhost:3000/api/health

## 🧪 Testing

### Run Automated Tests

The suite has two parts. The unit tests run against throwaway databases they
create themselves; the API suite spawns its own server on port 3999 against a
temporary database. Neither one touches the live `data/warehouse.db`.

```bash
# Unit tests (migration safety, Jalali calendar, concurrency, Excel reader)
cd backend && npm run test:unit

# API suite — spawns its own isolated server, so no backend needs to be running
cd backend && npm run test:api

# Both, in one command
cd backend && npm test

# Front-end document-line rules (no runner configured; see the note below)
cd frontend && node --import ./tests/extensionless-resolution.js --test ./tests/document-lines.test.js
```

The unit suite (`node --test`) covers 80 cases: migration safety on a legacy
schema, Jalali month lengths and leap years, the document-number convention and
unit-precision rules against a throwaway database, the item-code sequence, the
concurrency duel, and the Excel seed reconciliation.

The API suite covers 64 assertions grouped as:

- Health check and dashboard statistics consistency
- Items/inventory endpoints and the derived-inventory invariant
  (`current = baseline + receipts − issues` for every item)
- Item lifecycle: create, duplicate rejection, update, 404 handling,
  hard delete vs. deactivate when history exists
- Multi-line receipt and issue creation, verifying stock moves by the
  exact sum of the document's lines
- Document-number convention (`{R|H}-{Jalali YYMMDD}-{seq}`) acceptance
  and rejection of malformed numbers, the number's embedded date having to
  match the document's own date, and the suggestion endpoint following the
  date it is asked for (including a date the user did not zero-pad)
- Item-code suggestion following the numeric sequence rather than the text
  order, and continuing the catalog's own width
- A document refused whole when any line is incomplete, with proof that
  nothing was written and no stock moved
- Canonical group list and per-unit precision served as database metadata
- Insufficient-inventory rejection, with proof that stock is unchanged
- Cardex: running balance is non-negative and ends at current stock
- Document deletion restoring stock
- Reports endpoints and printable HTML rendering, including the requirement
  that a print page is a preview and never prints on load
- Automatic cleanup of every artifact it creates

The front-end suite covers the 16 assertions that pin the form rules the
browser enforces: a line the user touched is never silently dropped, each
problem is reported on the row it belongs to, and the head of a document
number is fixed by the date while only the sequence is editable. Its modules
are plain ESM with no browser dependencies, so Node's own runner executes
them once the project's extensionless import style resolves — that is what
the `--import` flag above registers, and the suite file is named explicitly
because this Node version does not glob a directory argument.

**Expected Output:** ✓ All tests passed! (64/64)

## 📡 API Documentation

### Base URL
```
http://localhost:3000/api
```

#### General
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |

#### Reference data
Group ordering and unit precision are business metadata held in the database,
served here so the front-end never hard-codes them.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/groups` | Canonical group list in `sort_order` |
| GET | `/unit-precision` | Per-unit decimal precision (`vahed`, `decimals`) |
| GET | `/doc-numbers/suggest/:kind` | Next document number; `kind` = `receipt` or `issue`, `?tarikh=` defaults to today |

#### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard/stats` | Overall statistics (total stock, item counts, warnings) |
| GET | `/dashboard/recent-receipts` | Latest receipts (5) with item/quantity totals |
| GET | `/dashboard/recent-issues` | Latest issues (5) with item/quantity totals |
| GET | `/dashboard/warnings` | Low stock warnings |
| GET | `/dashboard/activity` | Recent activity (10) |

#### Items & Inventory
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/items` | Active items with derived stock (`?include_inactive=1` for all) |
| GET | `/items/:kod_kala` | Single item with derived stock |
| GET | `/items/:kod_kala/cardex` | Item cardex with running balance |
| GET | `/items/suggest-code/:prefix` | Next available code for a prefix |
| POST | `/items` | Create item |
| PUT | `/items/:kod_kala` | Update item |
| DELETE | `/items/:kod_kala` | Delete, or deactivate when the item has history |
| GET | `/inventory` | Full inventory with baseline/receipts/issues totals |

#### Receipts (ورود)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/receipts` | All receipts (header rows with line counts) |
| GET | `/receipts/:id` | Receipt with its lines |
| POST | `/receipts` | Create multi-line receipt (transactional) |
| DELETE | `/receipts/:id` | Delete receipt and its lines |

#### Issues (خروج)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/issues` | All issues (header rows with line counts) |
| GET | `/issues/:id` | Issue with its lines |
| POST | `/issues` | Create multi-line issue (stock-checked, transactional) |
| DELETE | `/issues/:id` | Delete issue and its lines |

#### Reports (گزارشات)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/reports/inventory` | Inventory report (`?group=` category filter) |
| GET | `/reports/receipts` | Receipts with lines (`?from=&to=` date filter) |
| GET | `/reports/issues` | Issues with lines (`?from=&to=` date filter) |
| GET | `/reports/movements` | All-item movement ledger (`?from=&to=&kala_id=`) |

#### Printing (چاپ / PDF)
Rendered as standalone RTL HTML preview pages: they show the document first and
print only on an explicit click, so a "print" link never fires the dialog on its
own. Each page carries the hotel header, document totals and signature lines, and
can be saved to PDF.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/print/receipt/:id` | Printable receipt voucher |
| GET | `/print/issue/:id` | Printable issue voucher |
| GET | `/print/cardex/:kod_kala` | Printable item cardex |
| GET | `/print/inventory` | Printable inventory report (`?group=`) |
| GET | `/print/movements` | Printable movement ledger (`?from=&to=&kala_id=`, Jalali bounds) |

### API Examples

#### Create a multi-line receipt
```bash
curl -X POST http://localhost:3000/api/receipts \
  -H "Content-Type: application/json" \
  -d '{
    "receipt_number": "R-050701-001",
    "tarikh": "1405/07/01",
    "tavazihat": "خرید از شرکت آریا",
    "lines": [
      { "kala_id": "K010", "maqdar": 10, "vahed": "بسته" },
      { "kala_id": "K011", "maqdar": 4,  "vahed": "شاخه" }
    ]
  }'
```

#### Create a multi-line issue
```bash
curl -X POST http://localhost:3000/api/issues \
  -H "Content-Type: application/json" \
  -d '{
    "issue_number": "H-050701-001",
    "tarikh": "1405/07/01",
    "tahvil_gir": "تیم قهرمانی",
    "mahl_masraf": "طبقه سوم",
    "lines": [
      { "kala_id": "K010", "maqdar": 3, "vahed": "بسته" }
    ]
  }'
```

#### Get an item cardex
```bash
curl http://localhost:3000/api/items/K010/cardex
```

Response shape (chronological, with running balance):
```json
[
  { "type": "baseline", "date": "1405/06/14", "doc_num": "موجودی مبنا",
    "receipt_qty": 20, "issue_qty": 0, "balance": 20 },
  { "type": "receipt", "date": "1405/07/01", "doc_num": "R-050701-001",
    "receipt_qty": 10, "issue_qty": 0, "balance": 30 },
  { "type": "issue", "date": "1405/07/01", "doc_num": "H-050701-001",
    "receipt_qty": 0, "issue_qty": 3, "balance": 27 }
]
```

## 🎨 User Interface

### Pages

1. **Dashboard (داشبورد)**
   - Real-time statistics cards (total stock, in-stock, shortages, out-of-stock)
   - Latest receipts and issues
   - Low stock warnings
   - Activity feed
   - Auto-refresh every 30 seconds

2. **Items (کالاها)**
   - Complete items list with derived stock and status badges
   - Search by name or code, filter by category
   - Show/hide deactivated items
   - Add / edit / delete (deactivates when the item has movement history)
   - Automatic item-code suggestion by prefix
   - Details modal and per-item cardex with print

3. **Inventory (موجودی)**
   - Current stock plus baseline / receipts / issues totals per item
   - Status indicators (available / below minimum / out of stock)
   - Search and category filter

4. **Receipts (رسید انبار)**
   - Document list with expandable line detail
   - Multi-line receipt entry form (add/remove rows, unit auto-filled)
   - Per-document printing

5. **Issues (خروج انبار)**
   - Document list with expandable line detail
   - Multi-line issue entry with live stock display per line
   - Blocking feedback when a line exceeds available stock
   - Per-document printing

6. **Reports & Print (گزارشات و چاپ)**
   - Inventory report by category with totals and print
   - Item cardex with running balance and print
   - All-item movement ledger with date and item filters, and print
   - Receipts and issues registers with date filters and per-document print
   - Historical selectors list retired items too — a deactivated item still
     has a cardex and still appears in the movement ledger

## 📁 Project Structure

```
Mehran-AI-Lab/
├── backend/
│   ├── src/
│   │   ├── server.js                  # Express server & API endpoints
│   │   ├── db.js                      # Schema, migration, seed data
│   │   ├── printTemplates.js          # RTL printable HTML documents
│   │   ├── services/
│   │   │   └── inventoryService.js     # Single source of truth for stock
│   │   ├── utils/
│   │   │   ├── jalali.js               # Jalali calendar validation
│   │   │   ├── docNumber.js            # Document-number convention
│   │   │   └── itemCode.js             # Item-code sequence (numeric order)
│   │   └── scripts/
│   │       └── migrate-legacy-schema.js # Explicit legacy-table conversion
│   ├── tests/
│   │   ├── concurrency.test.js        # Concurrent-issue duel against one DB
│   │   ├── doc-number-and-precision.test.js # Number convention, precision, date agreement
│   │   └── item-code.test.js           # Numeric item-code sequence
│   └── data/
│       └── real-warehouse-data.json   # Extracted Excel data
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── utils/
│   │   │   ├── docNumber.js            # Client-side number/precision helpers
│   │   │   └── documentLines.js        # Per-row line validation, both forms
│   │   └── components/
│   │       ├── Dashboard.jsx
│   │       ├── Items.jsx
│   │       ├── Inventory.jsx
│   │       ├── Receipts.jsx
│   │       ├── Issues.jsx
│   │       ├── Reports.jsx
│   │       └── ...
│   └── tests/
│       └── document-lines.test.js      # Front-end form rules (no-drop, number head)
├── data/
│   └── warehouse.db                   # SQLite database (runtime)
├── scripts/                           # Excel extraction and seed reconciliation tools
├── tests/
│   └── api-test.js                    # Comprehensive API test suite
└── warehouse-source.xlsx              # Original Excel data source
```

## 🔒 Security Features

### Implemented
- ✅ Input validation on all POST endpoints
- ✅ Parameterized SQL queries (SQL injection prevention)
- ✅ CORS configuration
- ✅ Insufficient inventory checks
- ✅ Required field validation
- ✅ Error handling and safe error messages

### Recommended for Production
- [ ] User authentication (JWT/session)
- [ ] Role-based access control
- [ ] HTTPS/TLS encryption
- [ ] Rate limiting
- [ ] Audit logging
- [ ] Database encryption at rest

## 📈 Future Enhancements

### Suggested Features
- [ ] Excel export of the reports (printing and PDF export are already
  implemented — see the `/print/*` endpoints above)
- [ ] Advanced analytics and charts
- [ ] User authentication system
- [ ] Role-based permissions
- [ ] Change history/audit log
- [ ] Automatic backups
- [ ] Barcode scanning
- [ ] Mobile app
- [ ] Email notifications for low stock

## 🗄 Database Backup

### Manual Backup
```bash
# Create backup
cp data/warehouse.db data/warehouse.backup-$(date +%Y%m%d-%H%M%S).db

# Restore from backup
cp data/warehouse.backup-YYYYMMDD-HHMMSS.db data/warehouse.db
```

### Rebuild Database

There is no rebuild script, deliberately. Deleting the database destroys real
data, so the seed is applied only when a database is empty: `src/db.js` checks
for an existing catalog before seeding and leaves a populated database exactly
as it found it. To build a fresh database, move the old one aside first:

```bash
mv data/warehouse.db data/warehouse.hand-moved.db
cd backend && npm start   # creates data/warehouse.db and seeds it
```

To convert a database that still uses the legacy `vorood`/`khorooj` tables,
use the explicit tool — it reports first and only writes with `--write`:

```bash
node backend/src/scripts/migrate-legacy-schema.js data/warehouse.db          # dry run
node backend/src/scripts/migrate-legacy-schema.js data/warehouse.db --write  # convert
```

## 🐛 Troubleshooting

### Backend won't start
```bash
# Check if port 3000 is in use
netstat -ano | findstr :3000

# Kill process if needed (Windows)
taskkill /PID <PID> /F

# Reinstall dependencies
cd backend
rm -rf node_modules package-lock.json
npm install
```

### Frontend won't start
```bash
# Check if port 5173 is in use
netstat -ano | findstr :5173

# Clear cache and reinstall
cd frontend
rm -rf node_modules package-lock.json
npm install
```

### Database issues
```bash
# Check database file exists
ls -la data/warehouse.db
```

### Tests failing
```bash
# The tests start their own isolated server and database, so nothing else has
# to be running first.
cd backend && npm test
node tests/api-test.js
```

## 📝 Git History

```
6515092 - Add complete baseline inventory data (27 items)
f5fd11e - Complete CRUD implementation for warehouse management system
df2bc2f - Add comprehensive STATUS document for project milestone
0b645b0 - Fix database JOIN queries to use kod_kala instead of id
f319d85 - Checkpoint after real Excel migration
1fd48bf - Implement real Excel data import for warehouse system
```

## 👥 Contributors

**Iranian Hotel Dev**  
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

## 📄 License

Internal use - Iranian Hotel Development Project

## 📞 Support

For issues, questions, or enhancements, please contact the development team or create an issue in the project repository.

---

**Built with ❤️ for Iranian Hotel Development**
