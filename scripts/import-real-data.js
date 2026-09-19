const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Real Excel Data Importer
 * Extracts actual warehouse data from سیستم انبار.xlsx
 * Exports as JSON for database import
 */

const tempDir = './.temp_excel_import';

async function importRealExcelData() {
  try {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║         REAL EXCEL DATA IMPORTER                           ║');
    console.log('║         سیستم انبار - Iranian Hotel Warehouse              ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    execSync(`unzip -q "سیستم انبار.xlsx" -d "${tempDir}"`);

    // Load shared strings
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

    function extractSheet(sheetNum) {
      const sheetXml = fs.readFileSync(`${tempDir}/xl/worksheets/sheet${sheetNum}.xml`, 'utf-8');
      const cells = sheetXml.match(/<c r="([A-Z]+)(\d+)"[^>]*>.*?<\/c>/gs) || [];

      const cellsByRow = {};
      cells.forEach(cell => {
        const match = cell.match(/r="([A-Z]+)(\d+)"/);
        if (match) {
          const col = match[1];
          const row = parseInt(match[2]);
          const value = getCellValue(cell);

          if (!cellsByRow[row]) cellsByRow[row] = {};
          cellsByRow[row][col] = value;
        }
      });

      return cellsByRow;
    }

    // ═══════════════════════════════════════════════════════════
    // Extract Sheet 4 (موجودی) - THE REAL INVENTORY
    // ═══════════════════════════════════════════════════════════
    console.log('📊 Extracting Sheet 4: موجودی (REAL INVENTORY)\n');

    const sheet4 = extractSheet(4);
    const items = [];

    Object.keys(sheet4)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .slice(1) // Skip header
      .forEach(row => {
        const r = sheet4[row];
        if (r['A']) {
          // Extract minimum stock from Excel formula result
          // The minimum stock is looked up from tblkala but shown in column I
          const itemCode = r['A'];
          const itemName = r['B'];
          const group = r['C'];
          const subgroup = r['D'];
          const unit = r['E'];
          const totalReceipts = parseInt(r['F']) || 0;
          const totalIssues = parseInt(r['G']) || 0;
          const currentStock = parseInt(r['H']) || 0;
          const minimumStock = r['I'] ? parseInt(r['I']) : 0;
          const status = r['J'] || '';

          items.push({
            kod_kala: itemCode,
            naam_kala: itemName,
            goh: group,
            zirgoh: subgroup,
            vahed: unit,
            hadd_aqal_mojoodi: minimumStock,
            mojoodi_fael: currentStock,
            total_receipts: totalReceipts,
            total_issues: totalIssues,
            status: status
          });
        }
      });

    console.log(`✅ Extracted ${items.length} items from Sheet 4\n`);
    items.slice(0, 5).forEach(item => {
      console.log(`  ${item.kod_kala}: ${item.naam_kala}`);
      console.log(`     موجود: ${item.mojoodi_fael} ${item.vahed} | حداقل: ${item.hadd_aqal_mojoodi}`);
    });

    // ═══════════════════════════════════════════════════════════
    // Extract Sheet 2 (رسید انبار) - RECEIPTS
    // ═══════════════════════════════════════════════════════════
    console.log('\n\n📝 Extracting Sheet 2: رسید انبار (RECEIPTS)\n');

    const sheet2 = extractSheet(2);
    const receipts = [];

    Object.keys(sheet2)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .slice(1) // Skip header
      .forEach(row => {
        const r = sheet2[row];
        if (r['A']) {
          receipts.push({
            receipt_num: r['A'],
            tarikh: r['B'],
            radif: r['C'],
            kala_id: r['D'],
            naam_kala: r['E'],
            maqdar: parseInt(r['F']) || 0,
            vahed: r['G'],
            tavazihat: r['H']
          });
        }
      });

    console.log(`✅ Extracted ${receipts.length} receipt transactions\n`);
    receipts.forEach(r => {
      console.log(`  ${r.receipt_num}: ${r.naam_kala} (${r.kala_id})`);
      console.log(`     مقدار: ${r.maqdar} ${r.vahed} | تاریخ: ${r.tarikh}`);
    });

    // ═══════════════════════════════════════════════════════════
    // Extract Sheet 3 (خروج انبار) - ISSUES
    // ═══════════════════════════════════════════════════════════
    console.log('\n\n📤 Extracting Sheet 3: خروج انبار (ISSUES)\n');

    const sheet3 = extractSheet(3);
    const issues = [];

    Object.keys(sheet3)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .slice(1) // Skip header
      .forEach(row => {
        const r = sheet3[row];
        if (r['A']) {
          issues.push({
            issue_num: r['A'],
            tarikh: r['B'],
            radif: r['C'],
            kala_id: r['D'],
            naam_kala: r['E'],
            maqdar: parseInt(r['F']) || 0,
            vahed: r['G'],
            tahvil_gir: r['H'],
            mahl_masraf: r['I'],
            tavazihat: r['J']
          });
        }
      });

    console.log(`✅ Extracted ${issues.length} issue transactions\n`);
    issues.forEach(i => {
      console.log(`  ${i.issue_num}: ${i.naam_kala} (${i.kala_id})`);
      console.log(`     مقدار: ${i.maqdar} ${i.vahed} | تحویل: ${i.tahvil_gir}`);
    });

    // ═══════════════════════════════════════════════════════════
    // Extract Sheet 8 (موجودی مبنا) - BASELINE INVENTORY
    // ═══════════════════════════════════════════════════════════
    console.log('\n\n📊 Extracting Sheet 8: موجودی مبنا (BASELINE INVENTORY)\n');

    const sheet8 = extractSheet(8);
    const baseline = [];

    Object.keys(sheet8)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .slice(1) // Skip header
      .forEach(row => {
        const r = sheet8[row];
        if (r['A']) {
          baseline.push({
            kala_id: r['A'],
            naam_kala: r['B'],
            vahed: r['C'],
            mabna_qty: parseInt(r['D']) || 0,
            tarikh_mabna: r['E'],
            tavazihat: r['F']
          });
        }
      });

    console.log(`✅ Extracted ${baseline.length} baseline inventory records\n`);
    baseline.slice(0, 5).forEach(m => {
      console.log(`  ${m.kala_id}: ${m.naam_kala}`);
      console.log(`     مقدار مبنا: ${m.mabna_qty} ${m.vahed} | تاریخ: ${m.tarikh_mabna}`);
    });

    // ═══════════════════════════════════════════════════════════
    // EXPORT DATA
    // ═══════════════════════════════════════════════════════════
    const exportData = {
      items,
      receipts,
      issues,
      baseline,
      metadata: {
        extracted_at: new Date().toISOString(),
        source_file: 'سیستم انبار.xlsx',
        total_items: items.length,
        total_receipts: receipts.length,
        total_issues: issues.length,
        total_baseline: baseline.length
      }
    };

    fs.writeFileSync('backend/data/real-warehouse-data.json', JSON.stringify(exportData, null, 2));

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    EXPORT COMPLETE                         ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log('✅ Real data exported to: backend/data/real-warehouse-data.json\n');
    console.log('📊 Summary:');
    console.log(`   Items:    ${items.length}`);
    console.log(`   Receipts: ${receipts.length}`);
    console.log(`   Issues:   ${issues.length}`);
    console.log(`   Baseline: ${baseline.length}\n`);

    return exportData;

  } catch (err) {
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    try {
      execSync(`rm -rf "${tempDir}"`);
    } catch(e) {}
  }
}

importRealExcelData();
