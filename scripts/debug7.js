const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://hcmiu.edu.vn/en/academic-programs/undergraduate-programs/school-of-computer-science-and-engineering/')
  .then(response => {
    const $ = cheerio.load(response.data);
    
    // Find all tables
    const tables = $('table');
    console.log(`Found ${tables.length} tables`);
    
    // Examine each table in detail
    tables.each((tableIndex, table) => {
      console.log(`\n=== TABLE ${tableIndex + 1} ===`);
      const rows = $(table).find('tr');
      console.log(`Total rows: ${rows.length}`);
      
      // Show all rows with their cell data
      rows.each((rowIndex, row) => {
        const cells = $(row).find('td, th');
        const cellTexts = [];
        cells.each((cellIndex, cell) => {
          const text = $(cell).text().trim();
          cellTexts.push(`"${text}"`);
        });
        
        // Only show rows that have non-empty cells or look interesting
        const hasContent = cellTexts.some(text => text !== '""' && text.length > 2);
        const isHeader = cellTexts.some(text => text.includes('Subject') || text.includes('ID') || text.includes('Credit'));
        
        if (hasContent || isHeader || rowIndex < 5) { // Show first 5 rows regardless
          console.log(`  Row ${rowIndex + 1}: [${cellTexts.join(', ')}]`);
        }
      });
      
      // Look for course ID patterns in this table
      const tableText = $(table).text();
      const courseMatches = tableText.match(/[A-Z]{2,}\d{4}IU/g);
      if (courseMatches && courseMatches.length > 0) {
        console.log(`  Found ${courseMatches.length} potential course IDs in this table:`);
        const uniqueIds = [...new Set(courseMatches)];
        console.log(`    Unique IDs: ${uniqueIds.join(', ')}`);
      }
    });
  })
  .catch(console.error);