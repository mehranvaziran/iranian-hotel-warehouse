/**
 * Print and PDF are two different actions, and every printable document says so
 * the same way.
 *
 * The defect this guards is that "📄 ذخیره به‌صورت PDF" used to call
 * `window.print()` with a hint argument — the same call "🖨️ چاپ" makes, so two
 * buttons with two different labels did one thing. The PDF path now opens a
 * panel that states where a browser actually writes a PDF, and only *then*
 * offers the dialog. This suite pins the structure that keeps them apart, and
 * that printing is never triggered on load.
 *
 * Run:  node --test ./tests   (from the backend directory)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  receiptHtml,
  issueHtml,
  cardexHtml,
  inventoryHtml,
  movementsHtml,
} from '../src/printTemplates.js';

const sampleReceipt = { receipt_number: 'R-050710-1', tarikh: '1405/07/10', tavazihat: 'تست' };
const sampleIssue = { issue_number: 'H-050617-1', tarikh: '1405/06/17', tahvil_gir: 'واحد فنی', mahl_masraf: 'سایت', tavazihat: '' };
const sampleItem = { kod_kala: 'K001', naam_kala: 'کالا', goh: 'کناف', vahed: 'شاخه' };
const sampleLines = [{ kala_id: 'K001', naam_kala: 'کالا', maqdar: 4, vahed: 'شاخه', tavazihat: '' }];

const templates = {
  receipt: () => receiptHtml(sampleReceipt, sampleLines),
  issue: () => issueHtml(sampleIssue, sampleLines),
  cardex: () => cardexHtml(sampleItem, sampleLines.map((l) => ({ ...l, type: 'receipt', date: '1405/07/10' })), { baseline: 0, receipts: 4, issues: 0, current: 4 }),
  inventory: () => inventoryHtml([{ ...sampleItem, baseline_qty: 0, total_receipts: 4, total_issues: 0, current_stock: 4, hadd_aqal_mojoodi: 1, status: 'موجود' }], { reportDate: '1405/07/10', group: 'همه گروه‌ها' }),
  movements: () => movementsHtml([{ kind: 'receipt', tarikh: '1405/07/10', doc_number: 'R-050710-1', kala_id: 'K001', naam_kala: 'کالا', qty: 4, party: 'تأمین‌کننده', tavazihat: '' }], { from: '1405/07/01', to: '1405/07/31', reportDate: '1405/07/10' }),
};

// ------------------------------------------------- every printable document shares the toolbar

for (const [name, render] of Object.entries(templates)) {
  test(`the ${name} preview offers print and PDF as separate actions`, () => {
    const html = render();

    assert.match(html, /id="btn-print"/, 'a print button exists');
    assert.match(html, /id="btn-pdf"/, 'a PDF button exists');
    assert.match(html, /id="pdf-panel"/, 'the PDF explanation panel exists');

    // The labels the user reads, kept distinct.
    assert.match(html, /🖨️ چاپ/);
    assert.match(html, /📄 ذخیره به‌صورت PDF/);

    // Print means paper, so the hint says so rather than promising a file.
    assert.match(html, /«چاپ» روی کاغذ چاپ می‌کند/);
  });
}

// ------------------------------------------- the PDF path does not silently print

{
  const renderOne = templates.receipt;

  test('the print button asks the browser to print, the PDF button does not', () => {
    const html = renderOne();
    const script = html.match(/<script>([\s\S]*)<\/script>/).pop();

    // Exactly two things may open the print dialog: the paper-print button, and
    // the panel's continuation. The PDF button itself is not among them.
    const printCalls = [...script.matchAll(/window\.print\(\)/g)];
    assert.equal(printCalls.length, 2, 'only the print button and the PDF continuation print');

    // `pdfBtn` is a distinct identifier from `pdfGoBtn`, so each listener is
    // picked out unambiguously.
    const printListener = script.match(/printBtn\.addEventListener\('click',[\s\S]*?\}\);/)[0];
    const pdfListener = script.match(/pdfBtn\.addEventListener\('click',[\s\S]*?\}\);/)[0];

    assert.match(printListener, /window\.print\(\)/, 'the print button prints');
    assert.doesNotMatch(pdfListener, /window\.print\(\)/, 'the PDF button does not print directly');
    assert.match(pdfListener, /showPdfPanel\(true\)/, 'the PDF button opens the explanation first');
  });

  test('nothing prints on load — every action waits for a click', () => {
    const html = renderOne();
    const script = html.match(/<script>([\s\S]*)<\/script>/).pop();

    // Every window.print() sits inside an addEventListener block. The whole
    // script is an IIFE that only binds handlers, so no dialog is thrown at the
    // user the moment the preview appears.
    const listeners = [...script.matchAll(/addEventListener\('click'[\s\S]*?\}\);/g)];
    const printingListeners = listeners.filter((m) => m[0].includes('window.print()'));
    assert.equal(printingListeners.length, 2);
  });

  test('the PDF panel tells the user where the file actually comes from', () => {
    const html = renderOne();

    // It must not imply a standalone PDF was produced. It says the file is
    // written by the print dialog's PDF destination.
    assert.match(html, /فایل PDF از همان/);
    assert.match(html, /پنجره چاپ و با انتخاب مقصد/);
    assert.match(html, /مقصد چاپ را روی <strong>ذخیره به‌صورت PDF<\/strong> تنظیم کنید/);

    // And it starts closed: the class toggles it open, so it never appears
    // unless the user asked for a PDF.
    assert.match(html, /class="no-print pdf-panel"/);
    assert.doesNotMatch(html, /class="no-print pdf-panel open"/);
    assert.match(html, /\.pdf-panel \{\s*display: none;/);
  });
}
