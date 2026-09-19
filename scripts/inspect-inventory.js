const fs = require('fs');
const { execSync } = require('child_process');

const tempDir = './.temp_excel_inv';

function inspectInventorySheets() {
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
    console.log('║         SHEET 4: موجودی (INVENTORY)                        ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const sheet4Xml = fs.readFileSync(`${tempDir}/xl/worksheets/sheet4.xml`, 'utf-8');
    const cells4 = sheet4Xml.match(/<c r="([A-Z]+)(\d+)"[^>]*>.*?<\/c>/gs) || [];

    const cellsByRow4 = {};
    cells4.forEach(cell => {
      const match = cell.match(/r="([A-Z]+)(\d+)"/);
      if (match) {
        const col = match[1];
        const row = parseInt(match[2]);
        const value = getCellValue(cell);

        if (!cellsByRow4[row]) cellsByRow4[row] = {};
        cellsByRow4[row][col] = value;
      }
    });

    console.log('Sheet 4 - All rows:\n');
    Object.keys(cellsByRow4)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .slice(0, 35)
      .forEach(row => {
        const r = cellsByRow4[row];
        const cells = Object.keys(r)
          .sort()
          .map(col => `${col}:"${r[col]}"`)
          .join(' | ');
        console.log(`Row ${row.padStart(2)}: ${cells}`);
      });

    // Check for formulas in sheet4
    console.log('\n═ FORMULAS IN SHEET 4 ═\n');
    const formulaMatches = sheet4Xml.match(/<f[^>]*>([^<]*)<\/f>/g) || [];
    console.log(`Found ${formulaMatches.length} formulas\n`);
    formulaMatches.slice(0, 20).forEach((f, idx) => {
      const formula = f.replace(/<\/?f[^>]*>/g, '');
      console.log(`${idx + 1}. ${formula}`);
    });

    console.log('\n\n╔════════════════════════════════════════════════════════════╗');
    console.log('║         SHEET 5: فرم رسید (RECEIPT FORM)                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const sheet5Xml = fs.readFileSync(`${tempDir}/xl/worksheets/sheet5.xml`, 'utf-8');
    const cells5 = sheet5Xml.match(/<c r="([A-Z]+)(\d+)"[^>]*>.*?<\/c>/gs) || [];

    const cellsByRow5 = {};
    cells5.forEach(cell => {
      const match = cell.match(/r="([A-Z]+)(\d+)"/);
      if (match) {
        const col = match[1];
        const row = parseInt(match[2]);
        const value = getCellValue(cell);

        if (!cellsByRow5[row]) cellsByRow5[row] = {};
        cellsByRow5[row][col] = value;
      }
    });

    console.log('Sheet 5 - All rows:\n');
    Object.keys(cellsByRow5)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .forEach(row => {
        const r = cellsByRow5[row];
        const cells = Object.keys(r)
          .sort()
          .map(col => `${col}:"${r[col]}"`)
          .join(' | ');
        console.log(`Row ${row.padStart(2)}: ${cells}`);
      });

    // Check for formulas in sheet5
    console.log('\n═ FORMULAS IN SHEET 5 ═\n');
    const formulaMatches5 = sheet5Xml.match(/<f[^>]*>([^<]*)<\/f>/g) || [];
    console.log(`Found ${formulaMatches5.length} formulas\n`);
    formulaMatches5.forEach((f, idx) => {
      const formula = f.replace(/<\/?f[^>]*>/g, '');
      console.log(`${idx + 1}. ${formula}`);
    });

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    try {
      execSync(`rm -rf "${tempDir}"`);
    } catch(e) {}
  }
}

inspectInventorySheets();
