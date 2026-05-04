const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://hcmiu.edu.vn/en/academic-programs/undergraduate-programs/school-of-computer-science-and-engineering/')
  .then(response => {
    const $ = cheerio.load(response.data);
    
    // Find all tables
    const tables = $('table');
    console.log(`Found ${tables.length} tables`);
    
    // Let's examine the first few rows of the first table in detail
    const firstTable = $(tables[0]);
    const rows = firstTable.find('tr');
    
    console.log('\n=== DETAILED EXAMINATION OF FIRST TABLE ===');
    rows.each((rowIndex, row) => {
      const cells = $(row).find('td, th');
      const cellTexts = [];
      cells.each((cellIndex, cell) => {
        const text = $(cell).text().trim();
        cellTexts.push(text);
      });
      
      // Show first 10 rows in detail
      if (rowIndex < 10) {
        console.log(`Row ${rowIndex + 1}:`);
        console.log(`  Cell count: ${cells.length}`);
        cellTexts.forEach((text, cellIndex) => {
          console.log(`    Cell ${cellIndex + 1}: "${text}"`);
        });
        
        // Check if first cell looks like a course ID
        if (cellTexts.length > 0) {
          const firstCell = cellTexts[0];
          const isCourseId = /^[A-Z]{2,}\d{4}IU$/.test(firstCell);
          console.log(`  First cell is course ID: ${isCourseId} (${firstCell})`);
        }
        console.log('');
      }
    });
    
    // Let's also check what text we're getting from the cells
    console.log('\n=== CHECKING FOR COURSE ID PATTERNS IN CELLS ===');
    let courseCount = 0;
    tables.each((tableIndex, table) => {
      const rows = $(table).find('tr');
      rows.each((rowIndex, row) => {
        const cells = $(row).find('td, th');
        cells.each((cellIndex, cell) => {
          const text = $(cell).text().trim();
          if (/^[A-Z]{2,}\d{4}IU$/.test(text)) {
            console.log(`Found course ID: "${text}" at table ${tableIndex + 1}, row ${rowIndex + 1}, cell ${cellIndex + 1}`);
            courseCount++;
          }
        });
      });
    });
    
    console.log(`Total course IDs found in cells: ${courseCount}`);
  })
  .catch(console.error);