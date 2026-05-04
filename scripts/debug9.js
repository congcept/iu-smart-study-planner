const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://hcmiu.edu.vn/en/academic-programs/undergraduate-programs/school-of-computer-science-and-engineering/')
  .then(response => {
    const $ = cheerio.load(response.data);
    
    // Find all tables
    const tables = $('table');
    console.log(`Found ${tables.length} tables`);
    
    // Examine the first few course-like cells in detail
    console.log('\n=== EXAMINING POTENTIAL COURSE CELLS ===');
    let examined = 0;
    tables.each((tableIndex, table) => {
      const rows = $(table).find('tr');
      rows.each((rowIndex, row) => {
        const cells = $(row).find('td, th');
        cells.each((cellIndex, cell) => {
          const text = $(cell).text();
          // Check if this looks like it might contain a course ID
          if (text.length > 0 && text.length < 20 && 
              (text.includes('IU') || text.match(/[A-Z]{2,}\d{4}/))) {
            if (examined < 20) { // Only examine first 20
              console.log(`Cell [${tableIndex+1},${rowIndex+1},${cellIndex+1}]:`);
              console.log('  Raw text: "' + text + '"');
              console.log('  Char codes: ' + [...text].map(c => c.charCodeAt(0)).join(', '));
              console.log('  Trimmed: "' + text.trim() + '"');
              console.log('  Matches /^[A-Z]{2,}\\d{4}IU$/]: ' + /^[A-Z]{2,}\d{4}IU$/.test(text.trim()));
              console.log('  Matches /[A-Z]{2,}\\d{4}/]: ' + /[A-Z]{2,}\d{4}/.test(text.trim()));
              console.log('');
              examined++;
            }
          }
        });
      });
    });
    
    // Let's also try to match against the actual text from the debug output we saw earlier
    console.log('\n=== TESTING AGAINST KNOWN VALUES FROM DEBUG OUTPUT ===');
    const testValues = [
      'MA001IU',
      'EN008IU', 
      'EN007IU',
      'IT064IU',
      'IT116IU',
      'PT001IU',
      'IT153IU',
      'PH013IU',
      'IT067IU',
      'IT099IU',
      'IT069IU'
    ];
    
    testValues.forEach(value => {
      console.log('"' + value + '" matches /^[A-Z]{2,}\\d{4}IU$/]: ' + /^[A-Z]{2,}\d{4}IU$/.test(value));
    });
  })
  .catch(console.error);