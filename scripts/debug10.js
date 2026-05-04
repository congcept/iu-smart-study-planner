const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://hcmiu.edu.vn/en/academic-programs/undergraduate-programs/school-of-computer-science-and-engineering/')
  .then(response => {
    const $ = cheerio.load(response.data);
    
    // Find all tables
    const tables = $('table');
    console.log(`Found ${tables.length} tables`);
    
    // Let's directly test the regex on some known values from the debug output
    console.log('\n=== TESTING REGEX ON KNOWN VALUES ===');
    const testRegex = /^[A-Z]{2,}\d{4}IU$/;
    const testValues = ['MA001IU', 'EN008IU', 'IT064IU', 'IT116IU', 'PT001IU'];
    
    testValues.forEach(value => {
      console.log(`"${value}" matches pattern: ${testRegex.test(value)}`);
    });
    
    // Now let's check what we're actually getting from the cells
    console.log('\n=== CHECKING ACTUAL CELL CONTENT ===');
    let foundCount = 0;
    tables.each((tableIndex, table) => {
      const rows = $(table).find('tr');
      rows.each((rowIndex, row) => {
        const cells = $(row).find('td, th');
        cells.each((cellIndex, cell) => {
          const text = $(cell).text();
          if (testRegex.test(text)) {
            console.log(`Found match: "${text}" at [${tableIndex+1},${rowIndex+1},${cellIndex+1}]`);
            foundCount++;
          }
        });
      });
    });
    
    console.log(`Total matches found: ${foundCount}`);
    
    // Let's also try a more relaxed pattern to see what we're getting
    console.log('\n=== CHECKING WITH RELAXED PATTERN ===');
    const relaxedRegex = /[A-Z]{2,}\d{4}/;
    let relaxedCount = 0;
    tables.each((tableIndex, table) => {
      const rows = $(table).find('tr');
      rows.each((rowIndex, row) => {
        const cells = $(row).find('td, th');
        cells.each((cellIndex, cell) => {
          const text = $(cell).text();
          if (relaxedRegex.test(text)) {
            console.log(`Relaxed match: "${text}" at [${tableIndex+1},${rowIndex+1},${cellIndex+1}]`);
            relaxedCount++;
          }
        });
      });
    });
    
    console.log(`Total relaxed matches found: ${relaxedCount}`);
  })
  .catch(console.error);