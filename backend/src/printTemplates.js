/**
 * Printable document templates (RTL Persian).
 *
 * These render standalone HTML pages optimised for the browser print dialog
 * (Ctrl+P) and for "Save as PDF". No external runtime dependency is required.
 */

const HOTEL_TITLE = 'هتل ایرانیان';
const HOTEL_SUBTITLE = 'پروژه توسعه هتل ایرانیان – واحد انبار';
const REPORT_FOOTER = 'سامانه مدیریت انبار هتل ایرانیان';

/** Convert Western digits in a value to Persian digits. */
function toPersian(value) {
  return String(value ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

/** Format a number with Persian digit grouping. */
function persianNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return toPersian(num.toLocaleString('en-US'));
}

/** Escape user-supplied text before injecting it into HTML. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Shared CSS for every printable document. */
const baseCss = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { direction: rtl; }
  body {
    font-family: 'Vazirmatn', 'Segoe UI', Tahoma, 'Iranian Sans', sans-serif;
    color: #1a1a1a;
    background: #ffffff;
    padding: 18mm 16mm;
    font-size: 12pt;
  }
  .doc { width: 100%; }
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 3px double #1a1a1a;
    padding-bottom: 10px;
    margin-bottom: 14px;
  }
  .hotel-name { font-size: 17pt; font-weight: 700; }
  .hotel-sub { font-size: 9.5pt; color: #555; margin-top: 2px; }
  .doc-badge {
    text-align: left;
  }
  .doc-title { font-size: 14pt; font-weight: 700; }
  .doc-number { font-size: 10pt; color: #444; margin-top: 3px; }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 22px;
    margin: 12px 0 16px;
    font-size: 10.5pt;
  }
  .meta-item { white-space: nowrap; }
  .meta-item .label { color: #555; margin-left: 4px; }
  .meta-item .value { font-weight: 600; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5pt;
  }
  th, td {
    border: 1px solid #333;
    padding: 6px 8px;
    text-align: center;
  }
  th { background: #f0f0f0; font-weight: 700; }
  td.right, th.right { text-align: right; }
  tfoot td { font-weight: 700; background: #fafafa; }
  .notes {
    margin-top: 14px;
    font-size: 10pt;
    border: 1px dashed #999;
    border-radius: 4px;
    padding: 8px 10px;
    min-height: 34px;
  }
  .notes .label { color: #555; font-weight: 700; margin-left: 6px; }
  .signatures {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    margin-top: 42px;
    page-break-inside: avoid;
  }
  .sig-box { flex: 1; text-align: center; }
  .sig-line {
    border-top: 1px solid #1a1a1a;
    margin: 52px 6px 0;
    padding-top: 6px;
    font-size: 9.5pt;
    color: #444;
  }
  .doc-footer {
    margin-top: 26px;
    padding-top: 8px;
    border-top: 1px solid #bbb;
    font-size: 8.5pt;
    color: #777;
    text-align: center;
  }
  .empty { padding: 18px; text-align: center; color: #666; }
  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
    .doc-header { border-bottom: 3px double #000; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
  }
`;

/**
 * Page chrome shared by all printable documents.
 * @param {Object} opts
 * @param {string} opts.title - Document title shown in the badge area.
 * @param {string} [opts.number] - Document number line.
 * @param {string} bodyHtml - Inner HTML of the document.
 * @param {string} [signatures] - Signature row HTML.
 */
function printLayout({ title, number, bodyHtml, signatures = '' }) {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}${number ? ' – ' + escapeHtml(number) : ''}</title>
  <style>${baseCss}</style>
</head>
<body>
  <div class="no-print" style="display:flex; gap:8px; margin-bottom:14px;">
    <button onclick="window.print()" style="font-size:11pt; padding:6px 16px; cursor:pointer;">🖨️ چاپ</button>
    <button onclick="window.close()" style="font-size:11pt; padding:6px 16px; cursor:pointer;">بستن</button>
  </div>
  <div class="doc">
    <div class="doc-header">
      <div>
        <div class="hotel-name">${HOTEL_TITLE}</div>
        <div class="hotel-sub">${HOTEL_SUBTITLE}</div>
      </div>
      <div class="doc-badge">
        <div class="doc-title">${escapeHtml(title)}</div>
        ${number ? `<div class="doc-number">${escapeHtml(number)}</div>` : ''}
      </div>
    </div>
    ${bodyHtml}
    ${signatures}
    <div class="doc-footer">${REPORT_FOOTER} – تاریخ چاپ: ${toPersian(new Date().toLocaleDateString('en-CA'))}</div>
  </div>
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { try { window.print(); } catch (e) {} }, 350);
    });
  </script>
</body>
</html>`;
}

/** Standard three-signature row used by movement documents. */
const warehouseSignatures = `<div class="signatures">
  <div class="sig-box"><div class="sig-line">امضاء انباردار</div></div>
  <div class="sig-box"><div class="sig-line">امضاء تحویل‌دهنده</div></div>
  <div class="sig-box"><div class="sig-line">امضاء تحویل‌گیرنده / مسئول</div></div>
</div>`;

/** Two-signature row used by static reports. */
const reportSignatures = `<div class="signatures">
  <div class="sig-box"><div class="sig-line">امضاء انباردار</div></div>
  <div class="sig-box"><div class="sig-line">امضاء مدیر پروژه</div></div>
</div>`;

/** Render a printable receipt (رسید ورود کالا). */
export function receiptHtml(receipt, lines) {
  const rows = (lines || []).map((l, i) => `<tr>
      <td>${toPersian(i + 1)}</td>
      <td class="right">${escapeHtml(l.kala_id)}</td>
      <td class="right">${escapeHtml(l.naam_kala || '-')}</td>
      <td>${persianNumber(l.maqdar)}</td>
      <td>${escapeHtml(l.vahed || '-')}</td>
      <td class="right">${escapeHtml(l.tavazihat || '')}</td>
    </tr>`).join('');

  const totalQty = (lines || []).reduce((s, l) => s + Number(l.maqdar || 0), 0);

  const body = `
    <div class="meta">
      <span class="meta-item"><span class="label">شماره رسید:</span><span class="value">${escapeHtml(receipt.receipt_number)}</span></span>
      <span class="meta-item"><span class="label">تاریخ:</span><span class="value">${escapeHtml(receipt.tarikh)}</span></span>
      <span class="meta-item"><span class="label">تعداد اقلام:</span><span class="value">${toPersian(lines?.length || 0)}</span></span>
    </div>
    <table>
      <thead>
        <tr><th style="width:34px">ردیف</th><th>کد کالا</th><th>نام کالا</th><th>مقدار</th><th>واحد</th><th>توضیحات</th></tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty">این رسید فاقد ردیف است</td></tr>'}</tbody>
      <tfoot><tr>
        <td colspan="3">جمع کل</td>
        <td>${persianNumber(totalQty)}</td>
        <td colspan="2"></td>
      </tr></tfoot>
    </table>
    <div class="notes"><span class="label">توضیحات:</span>${escapeHtml(receipt.tavazihat || '-')}</div>`;

  return printLayout({
    title: 'رسید ورود کالا',
    number: receipt.receipt_number,
    bodyHtml: body,
    signatures: warehouseSignatures,
  });
}

/** Render a printable issue voucher (حواله خروج کالا). */
export function issueHtml(issue, lines) {
  const rows = (lines || []).map((l, i) => `<tr>
      <td>${toPersian(i + 1)}</td>
      <td class="right">${escapeHtml(l.kala_id)}</td>
      <td class="right">${escapeHtml(l.naam_kala || '-')}</td>
      <td>${persianNumber(l.maqdar)}</td>
      <td>${escapeHtml(l.vahed || '-')}</td>
      <td class="right">${escapeHtml(l.tavazihat || '')}</td>
    </tr>`).join('');

  const totalQty = (lines || []).reduce((s, l) => s + Number(l.maqdar || 0), 0);

  const body = `
    <div class="meta">
      <span class="meta-item"><span class="label">شماره حواله:</span><span class="value">${escapeHtml(issue.issue_number)}</span></span>
      <span class="meta-item"><span class="label">تاریخ:</span><span class="value">${escapeHtml(issue.tarikh)}</span></span>
      <span class="meta-item"><span class="label">تحویل‌گیرنده:</span><span class="value">${escapeHtml(issue.tahvil_gir || '-')}</span></span>
      <span class="meta-item"><span class="label">محل مصرف:</span><span class="value">${escapeHtml(issue.mahl_masraf || '-')}</span></span>
    </div>
    <table>
      <thead>
        <tr><th style="width:34px">ردیف</th><th>کد کالا</th><th>نام کالا</th><th>مقدار</th><th>واحد</th><th>توضیحات</th></tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty">این حواله فاقد ردیف است</td></tr>'}</tbody>
      <tfoot><tr>
        <td colspan="3">جمع کل</td>
        <td>${persianNumber(totalQty)}</td>
        <td colspan="2"></td>
      </tr></tfoot>
    </table>
    <div class="notes"><span class="label">توضیحات:</span>${escapeHtml(issue.tavazihat || '-')}</div>`;

  return printLayout({
    title: 'حواله خروج کالا',
    number: issue.issue_number,
    bodyHtml: body,
    signatures: warehouseSignatures,
  });
}

/** Render a printable cardex (کارتکس کالا) with running balance. */
export function cardexHtml(item, cardex, totals) {
  const rows = (cardex || []).map((c, i) => {
    const typeLabel = c.type === 'baseline' ? 'موجودی مبنا' : c.type === 'receipt' ? 'ورود' : 'خروج';
    return `<tr>
      <td>${toPersian(i + 1)}</td>
      <td>${escapeHtml(typeLabel)}</td>
      <td>${escapeHtml(c.date || '-')}</td>
      <td>${escapeHtml(c.doc_num || '-')}</td>
      <td>${c.receipt_qty ? persianNumber(c.receipt_qty) : '-'}</td>
      <td>${c.issue_qty ? persianNumber(c.issue_qty) : '-'}</td>
      <td>${persianNumber(c.balance)}</td>
      <td class="right">${escapeHtml(c.note || '')}</td>
    </tr>`;
  }).join('');

  const body = `
    <div class="meta">
      <span class="meta-item"><span class="label">کد کالا:</span><span class="value">${escapeHtml(item.kod_kala)}</span></span>
      <span class="meta-item"><span class="label">نام کالا:</span><span class="value">${escapeHtml(item.naam_kala)}</span></span>
      <span class="meta-item"><span class="label">گروه:</span><span class="value">${escapeHtml(item.goh || '-')}</span></span>
      <span class="meta-item"><span class="label">واحد:</span><span class="value">${escapeHtml(item.vahed || '-')}</span></span>
      <span class="meta-item"><span class="label">موجودی مبنا:</span><span class="value">${persianNumber(totals.baseline)}</span></span>
      <span class="meta-item"><span class="label">جمع ورود:</span><span class="value">${persianNumber(totals.receipts)}</span></span>
      <span class="meta-item"><span class="label">جمع خروج:</span><span class="value">${persianNumber(totals.issues)}</span></span>
      <span class="meta-item"><span class="label">موجودی فعلی:</span><span class="value">${persianNumber(totals.current)}</span></span>
    </div>
    <table>
      <thead>
        <tr>
          <th style="width:34px">ردیف</th><th>نوع حرکت</th><th>تاریخ</th><th>شماره سند</th>
          <th>ورود</th><th>خروج</th><th>مانده</th><th>توضیحات</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="8" class="empty">حرکتی برای این کالا ثبت نشده است</td></tr>'}</tbody>
      <tfoot><tr>
        <td colspan="4">مانده نهایی</td>
        <td colspan="3">${persianNumber(totals.current)}</td>
        <td></td>
      </tr></tfoot>
    </table>`;

  return printLayout({
    title: 'کارتکس کالا',
    number: item.kod_kala,
    bodyHtml: body,
    signatures: reportSignatures,
  });
}

/** Render a printable inventory report (گزارش موجودی انبار). */
export function inventoryHtml(inventory, meta = {}) {
  const rows = (inventory || []).map((i, idx) => `<tr>
      <td>${toPersian(idx + 1)}</td>
      <td class="right">${escapeHtml(i.kod_kala)}</td>
      <td class="right">${escapeHtml(i.naam_kala || '-')}</td>
      <td>${escapeHtml(i.goh || '-')}</td>
      <td>${persianNumber(i.baseline_qty)}</td>
      <td>${persianNumber(i.total_receipts)}</td>
      <td>${persianNumber(i.total_issues)}</td>
      <td>${persianNumber(i.current_stock)}</td>
      <td>${escapeHtml(i.vahed || '-')}</td>
      <td>${escapeHtml(i.hadd_aqal_mojoodi ? persianNumber(i.hadd_aqal_mojoodi) : '-')}</td>
      <td>${escapeHtml(i.status || '-')}</td>
    </tr>`).join('');

  const totals = (inventory || []).reduce(
    (t, i) => ({
      baseline: t.baseline + Number(i.baseline_qty || 0),
      receipts: t.receipts + Number(i.total_receipts || 0),
      issues: t.issues + Number(i.total_issues || 0),
      current: t.current + Number(i.current_stock || 0),
    }),
    { baseline: 0, receipts: 0, issues: 0, current: 0 }
  );

  const body = `
    <div class="meta">
      <span class="meta-item"><span class="label">تاریخ گزارش:</span><span class="value">${escapeHtml(meta.reportDate || '-')}</span></span>
      <span class="meta-item"><span class="label">تعداد کالاها:</span><span class="value">${toPersian(inventory?.length || 0)}</span></span>
      <span class="meta-item"><span class="label">گروه:</span><span class="value">${escapeHtml(meta.group || 'همه گروه‌ها')}</span></span>
    </div>
    <table>
      <thead>
        <tr>
          <th style="width:34px">ردیف</th><th>کد کالا</th><th>نام کالا</th><th>گروه</th>
          <th>مبنا</th><th>ورود</th><th>خروج</th><th>موجودی فعلی</th><th>واحد</th>
          <th>حداقل</th><th>وضعیت</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="11" class="empty">کالایی برای نمایش وجود ندارد</td></tr>'}</tbody>
      <tfoot><tr>
        <td colspan="4">جمع کل</td>
        <td>${persianNumber(totals.baseline)}</td>
        <td>${persianNumber(totals.receipts)}</td>
        <td>${persianNumber(totals.issues)}</td>
        <td>${persianNumber(totals.current)}</td>
        <td colspan="3"></td>
      </tr></tfoot>
    </table>`;

  return printLayout({
    title: 'گزارش موجودی انبار',
    bodyHtml: body,
    signatures: reportSignatures,
  });
}
