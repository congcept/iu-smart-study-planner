const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://hcmiu.edu.vn/en/academic-programs/undergraduate-programs/school-of-computer-science-and-engineering/')
  .then(response => {
    const $ = cheerio.load(response.data);
    
    // Find all tables
    const tables = $('table');
    console.log(`Found ${tables.length} tables`);
    
    // Let's look at the actual content of the first few cells that should contain course IDs
    console.log('\n=== EXAMINING ACTUAL CELL CONTENT CHAR BY CHAR ===');
    let examined = 0;
    tables.each((tableIndex, table) => {
      const rows = $(table).find('tr');
      rows.each((rowIndex, row) => {
        const cells = $(row).find('td, th');
        cells.each((cellIndex, cell) => {
          const text = $(cell).text();
          // Focus on cells that look like they should contain course IDs
          if (text.length > 0 && text.length < 20 && 
              (text.includes('IU') || text.match(/[A-Z]{2,}\d{4}/))) {
            if (examined < 10) { // Only examine first 10
              console.log(`Cell [${tableIndex+1},${rowIndex+1},${cellIndex+1}]:`);
              console.log(`  Raw text: "${text}"`);
              console.log(`  Length: ${text.length}`);
              console.log('  Characters:');
              for (let i = 0; i < text.length; i++) {
                const char = text[i];
                console.log(`    [${i}] '${char}' (${char.charCodeAt(0)})`);
              }
              console.log(`  Trimmed: "${text.trim()}"`);
              console.log(`  Length after trim: ${text.trim().length}`);
              console.log('');
              examined++;
            }
          }
        });
      });
    });
  })
  .catch(console.error);