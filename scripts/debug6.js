const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://hcmiu.edu.vn/en/academic-programs/undergraduate-programs/school-of-computer-science-and-engineering/')
  .then(response => {
    const $ = cheerio.load(response.data);
    
    // Let's look for tables directly
    console.log('=== LOOKING FOR TABLES ===');
    const tables = $('table');
    console.log(`Found ${tables.length} tables`);
    
    tables.each((index, table) => {
      console.log(`\nTable ${index + 1}:`);
      const rows = $(table).find('tr');
      console.log(`  Rows: ${rows.length}`);
      
      // Show first few rows
      rows.slice(0, Math.min(5, rows.length)).each((rowIndex, row) => {
        const cells = $(row).find('td, th');
        const cellTexts = [];
        cells.each((cellIndex, cell) => {
          cellTexts.push($(cell).text().trim());
        });
        console.log(`    Row ${rowIndex + 1}: ${cellTexts.join(' | ')}`);
      });
    });
    
    // Let's also look for any elements that might contain course data
    console.log('\n=== LOOKING FOR ELEMENTS WITH COURSE-LIKE TEXT ===');
    const allElements = $('*');
    const courseLikeElements = [];
    
    allElements.each((index, element) => {
      const text = $(element).text().trim();
      // Look for text that contains a course ID pattern
      if (/[A-Z]{2,}\d{4}IU/.test(text) && text.length < 200) {
        courseLikeElements.push({
          element: element.tagName,
          class: $(element).attr('class') || '',
          text: text.substring(0, 100)
        });
      }
    });
    
    console.log(`Found ${courseLikeElements.length} elements with course-like text`);
    console.log('First 10:');
    courseLikeElements.slice(0, 10).forEach((el, idx) => {
      console.log(`${idx + 1}: <${el.element} class="${el.class}"> ${el.text}...`);
    });
  })
  .catch(console.error);