const fs = require('fs');
const { execSync } = require('child_process');

const tempDir = './.temp_excel_inspect';

function inspectExcelStructure() {
  try {
    execSync(`unzip -q "سیستم انبار.xlsx" -d "${tempDir}"`);

    // Get shared strings
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

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║         DETAILED EXCEL STRUCTURE INSPECTION                ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Inspect sheet1 in detail
    console.log('═ SHEET 1 (کالاها) - ALL CELLS ═\n');
    const sheet1Xml = fs.readFileSync(`${tempDir}/xl/worksheets/sheet1.xml`, 'utf-8');
    const cells1 = sheet1Xml.match(/<c r="([A-Z]+)(\d+)"[^>]*>.*?<\/c>/gs) || [];

    console.log('All cells with coordinates and values:\n');
    const cellsByRow = {};
    cells1.forEach((cell, idx) => {
      const match = cell.match(/r="([A-Z]+)(\d+)"/);
      if (match) {
        const col = match[1];
        const row = parseInt(match[2]);
        const value = getCellValue(cell);

        if (!cellsByRow[row]) cellsByRow[row] = {};
        cellsByRow[row][col] = value;

        // Print first 50 rows
        if (row <= 50 && value) {
          console.log(`[${row.toString().padStart(2)}][${col}] = "${value}"`);
        }
      }
    });

    console.log('\n═ SHEET 1 - GROUPED BY ROW ═\n');
    Object.keys(cellsByRow)
      .slice(0, 35)
      .forEach(row => {
        const r = cellsByRow[row];
        const cells = Object.keys(r)
          .sort()
          .map(col => `${col}:"${r[col]}"`)
          .join(' | ');
        console.log(`Row ${row.padStart(2)}: ${cells}`);
      });

    // Check for table definitions
    console.log('\n═ TABLE DEFINITIONS ═\n');
    const tablesDir = `${tempDir}/xl/tables`;
    if (fs.existsSync(tablesDir)) {
      const tableFiles = fs.readdirSync(tablesDir).filter(f => f.endsWith('.xml')).sort();
      tableFiles.forEach(tableFile => {
        const tableXml = fs.readFileSync(`${tablesDir}/${tableFile}`, 'utf-8');
        const tableMatch = tableXml.match(/<table[^>]*name="([^"]*)"[^>]*ref="([^"]*)"[^>]*>/);
        if (tableMatch) {
          console.log(`Table: ${tableMatch[1]}`);
          console.log(`Range: ${tableMatch[2]}`);

          // Extract column definitions
          const colMatches = tableXml.match(/<tableColumn[^>]*name="([^"]*)"[^>]*>/g) || [];
          console.log(`Columns (${colMatches.length}):`);
          colMatches.forEach((col, idx) => {
            const colName = col.match(/name="([^"]*)"/)[1];
            console.log(`  ${idx + 1}. ${colName}`);
          });
          console.log();
        }
      });
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    try {
      execSync(`rm -rf "${tempDir}"`);
    } catch(e) {}
  }
}

inspectExcelStructure();
