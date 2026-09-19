const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const tempDir = './.temp_excel_data';

try {
  // Extract Excel
  execSync(`unzip -q "سیستم انبار.xlsx" -d "${tempDir}"`);

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         EXCEL DATA INSPECTION REPORT                        ║');
  console.log('║         سیستم انبار - Iranian Hotel Warehouse              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Read workbook.xml
  const workbookXml = fs.readFileSync(`${tempDir}/xl/workbook.xml`, 'utf-8');
  const sheetMatches = workbookXml.match(/<sheet[^>]*name="([^"]*)"[^>]*>/g) || [];

  console.log('📋 WORKSHEETS (' + sheetMatches.length + '):\n');
  sheetMatches.forEach((match, idx) => {
    const nameMatch = match.match(/name="([^"]*)"/);
    console.log(`   ${String(idx + 1).padStart(2, ' ')}. ${nameMatch[1]}`);
  });

  // Read relationship file to map table locations
  const relsXml = fs.readFileSync(`${tempDir}/xl/_rels/workbook.xml.rels`, 'utf-8');

  // Read table definitions
  console.log('\n\n📊 EXCEL TABLES AND COLUMNS:\n');
  const tablesDir = `${tempDir}/xl/tables`;

  if (fs.existsSync(tablesDir)) {
    const tableFiles = fs.readdirSync(tablesDir).filter(f => f.endsWith('.xml')).sort();

    tableFiles.forEach((tableFile, tIdx) => {
      const tableXml = fs.readFileSync(path.join(tablesDir, tableFile), 'utf-8');
      const tableMatch = tableXml.match(/<table[^>]*name="([^"]*)"[^>]*ref="([^"]*)"[^>]*>/);

      if (tableMatch) {
        const tableName = tableMatch[1];
        const tableRef = tableMatch[2];
        const colMatches = tableXml.match(/<tableColumn[^>]*name="([^"]*)"[^>]*>/g) || [];

        console.log(`   ┌─ جدول #${tIdx + 1}: ${tableName}`);
        console.log(`   │  محدوده: ${tableRef}`);
        console.log(`   │  ستون‌ها (${colMatches.length}):`);

        colMatches.forEach((col, cIdx) => {
          const colName = col.match(/name="([^"]*)"/)[1];
          const isLast = cIdx === colMatches.length - 1;
          const prefix = isLast ? '   └' : '   │';
          console.log(`   ${prefix}  ${String(cIdx + 1).padStart(2, ' ')}. ${colName}`);
        });
        console.log();
      }
    });
  }

  // Analyze sheet structure to understand data location
  console.log('\n📑 SHEET STRUCTURE:\n');
  const worksheetsDir = `${tempDir}/xl/worksheets`;
  const worksheetFiles = fs.readdirSync(worksheetsDir).filter(f => f.endsWith('.xml')).sort();

  worksheetFiles.forEach((wsFile, idx) => {
    const wsXml = fs.readFileSync(path.join(worksheetsDir, wsFile), 'utf-8');
    const cellMatches = wsXml.match(/<c[^>]*r="([^"]*)"[^>]*>.*?<\/c>/g) || [];
    const tableRef = wsXml.match(/<tablePart[^>]*r:id="([^"]*)"/);

    console.log(`   Sheet ${idx + 1} (${wsFile}): ${cellMatches.length} cells`);
    if (tableRef) {
      console.log(`              └─ Contains table reference`);
    }
  });

  console.log('\n✅ Excel file structure identified. Ready for data extraction.\n');

} catch (err) {
  console.error('Error:', err.message);
} finally {
  try {
    execSync(`rm -rf "${tempDir}"`);
  } catch(e) {}
}
