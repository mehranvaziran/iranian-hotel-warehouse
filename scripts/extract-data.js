const fs = require('fs');
const { execSync } = require('child_process');

const tempDir = './.temp_excel_data';

function extractExcelData() {
  try {
    execSync(`unzip -q "سیستم انبار.xlsx" -d "${tempDir}"`);

    // Read and parse shared strings
    const sharedStringsXml = fs.readFileSync(`${tempDir}/xl/sharedStrings.xml`, 'utf-8');
    const sharedStrings = [];
    const richMatches = sharedStringsXml.match(/<si>.*?<\/si>/gs) || [];

    richMatches.forEach(si => {
      const tMatches = si.match(/<t[^>]*>([^<]*)<\/t>/g) || [];
      let combined = '';
      tMatches.forEach(t => {
        combined += t.replace(/<t[^>]*>|<\/t>/g, '');
      });
      sharedStrings.push(combined);
    });

    function getCellValue(cellXml) {
      const sMatch = cellXml.match(/t="s">\s*<v>(\d+)<\/v>/);
      if (sMatch) {
        const idx = parseInt(sMatch[1]);
        return sharedStrings[idx] || '';
      }
      const nMatch = cellXml.match(/<v>([^<]*)<\/v>/);
      if (nMatch) {
        return nMatch[1];
      }
      return '';
    }

    function extractSheetData(sheetNum, colMapping) {
      const sheetXml = fs.readFileSync(`${tempDir}/xl/worksheets/sheet${sheetNum}.xml`, 'utf-8');
      const cells = sheetXml.match(/<c r="([A-Z]+)(\d+)"[^>]*>.*?<\/c>/gs) || [];

      const rows = {};
      cells.forEach(cell => {
        const match = cell.match(/r="([A-Z]+)(\d+)"/);
        if (match) {
          const col = match[1];
          const row = parseInt(match[2]);
          const value = getCellValue(cell);

          if (!rows[row]) rows[row] = {};
          rows[row][col] = value;
        }
      });

      return rows;
    }

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     REAL WAREHOUSE DATA EXTRACTION - STEP 1                ║');
    console.log('║     سیستم انبار                                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Extract sheet1 (کالاها)
    console.log('═ ITEMS (کالاها) - Sheet 1 ═\n');
    const sheet1 = extractSheetData(1, { A: 'کد کالا', B: 'عنوان کالا', C: 'گروه', D: 'زیرگروه', E: 'واحد', F: 'حداقل موجودی' });

    const items = [];
    Object.keys(sheet1).forEach(row => {
      if (parseInt(row) > 1) { // Skip header
        const r = sheet1[row];
        if (r['A']) {
          items.push({
            row: row,
            'کد کالا': r['A'],
            'عنوان کالا': r['B'],
            'گروه': r['C'],
            'زیرگروه': r['D'],
            'واحد': r['E'],
            'حداقل موجودی': r['F'],
            'توضیحات': r['G']
          });
        }
      }
    });

    console.log(`Found ${items.length} items:\n`);
    items.forEach((item, idx) => {
      console.log(`${idx + 1}. ${item['عنوان کالا']}`);
      console.log(`   کد: ${item['کد کالا']} | واحد: ${item['واحد']}`);
      console.log(`   گروه: ${item['گروه']} / ${item['زیرگروه']}`);
      console.log(`   حداقل موجودی: ${item['حداقل موجودی']}`);
      if (item['توضیحات']) console.log(`   توضیحات: ${item['توضیحات']}`);
      console.log();
    });

    // Extract sheet2 (رسید انبار)
    console.log('\n═ RECEIPTS (رسید انبار) - Sheet 2 ═\n');
    const sheet2 = extractSheetData(2);

    const receipts = [];
    Object.keys(sheet2).forEach(row => {
      if (parseInt(row) > 1) {
        const r = sheet2[row];
        if (r['A']) {
          receipts.push({
            'شماره رسید': r['A'],
            'تاریخ': r['B'],
            'ردیف': r['C'],
            'کد کالا': r['D'],
            'عنوان کالا': r['E'],
            'مقدار': r['F'],
            'واحد': r['G'],
            'توضیحات': r['H']
          });
        }
      }
    });

    console.log(`Found ${receipts.length} receipts:\n`);
    receipts.forEach((r, idx) => {
      console.log(`${idx + 1}. رسید #${r['شماره رسید']} - ${r['تاریخ']}`);
      console.log(`   ${r['عنوان کالا']} (${r['کد کالا']}): ${r['مقدار']} ${r['واحد']}`);
      if (r['توضیحات']) console.log(`   توضیحات: ${r['توضیحات']}`);
    });

    // Extract sheet3 (خروج انبار)
    console.log('\n═ ISSUES (خروج انبار) - Sheet 3 ═\n');
    const sheet3 = extractSheetData(3);

    const issues = [];
    Object.keys(sheet3).forEach(row => {
      if (parseInt(row) > 1) {
        const r = sheet3[row];
        if (r['A']) {
          issues.push({
            'شماره حواله': r['A'],
            'تاریخ': r['B'],
            'ردیف': r['C'],
            'کد کالا': r['D'],
            'عنوان کالا': r['E'],
            'مقدار': r['F'],
            'واحد': r['G'],
            'تحویل گیرنده': r['H'],
            'محل مصرف': r['I'],
            'توضیحات': r['J']
          });
        }
      }
    });

    console.log(`Found ${issues.length} issues:\n`);
    issues.forEach((i, idx) => {
      console.log(`${idx + 1}. حواله #${i['شماره حواله']} - ${i['تاریخ']}`);
      console.log(`   ${i['عنوان کالا']} (${i['کد کالا']}): ${i['مقدار']} ${i['واحد']}`);
      console.log(`   تحویل گیرنده: ${i['تحویل گیرنده']} | محل: ${i['محل مصرف']}`);
      if (i['توضیحات']) console.log(`   توضیحات: ${i['توضیحات']}`);
    });

    // Extract sheet8 (موجودی مبنا)
    console.log('\n═ BASELINE INVENTORY (موجودی مبنا) - Sheet 8 ═\n');
    const sheet8 = extractSheetData(8);

    const baseline = [];
    Object.keys(sheet8).forEach(row => {
      if (parseInt(row) > 1) {
        const r = sheet8[row];
        if (r['A']) {
          baseline.push({
            'کد کالا': r['A'],
            'عنوان کالا': r['B'],
            'واحد': r['C'],
            'مقدار مبنا': r['D'],
            'تاریخ مبنا': r['E'],
            'توضیحات': r['F']
          });
        }
      }
    });

    console.log(`Found ${baseline.length} baseline records:\n`);
    baseline.forEach((m, idx) => {
      console.log(`${idx + 1}. ${m['عنوان کالا']} (${m['کد کالا']})`);
      console.log(`   مقدار مبنا: ${m['مقدار مبنا']} ${m['واحد']} | تاریخ: ${m['تاریخ مبنا']}`);
      if (m['توضیحات']) console.log(`   توضیحات: ${m['توضیحات']}`);
    });

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    DATA SUMMARY                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log(`  Items (کالاها):              ${items.length} records`);
    console.log(`  Receipts (رسید انبار):       ${receipts.length} records`);
    console.log(`  Issues (خروج انبار):         ${issues.length} records`);
    console.log(`  Baseline (موجودی مبنا):      ${baseline.length} records`);
    console.log(`\n  Total shared strings:        ${sharedStrings.length}`);
    console.log('\n✅ REAL DATA EXTRACTION COMPLETE\n');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    try {
      execSync(`rm -rf "${tempDir}"`);
    } catch(e) {}
  }
}

extractExcelData();
