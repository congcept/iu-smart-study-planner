const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://hcmiu.edu.vn/en/academic-programs/undergraduate-programs/school-of-computer-science-and-engineering/')
  .then(response => {
    const $ = cheerio.load(response.data);
    let text = $('body').text();
    
    console.log('=== FULL TEXT LENGTH ===');
    console.log(text.length);
    
    console.log('\n=== LOOKING FOR SPECIFIC PATTERNS ===');
    const patterns = [
      '2.  **COMPUTER SCIENCE**',
      '2. **COMPUTER SCIENCE**',
      '2. COMPUTER SCIENCE',
      '– COMPUTER SCIENCE',
      '- COMPUTER SCIENCE',
      'COMPUTER SCIENCE'
    ];
    
    for (const pattern of patterns) {
      const index = text.indexOf(pattern);
      if (index !== -1) {
        console.log(`Found pattern "${pattern}" at index: ${index}`);
        console.log('Context (500 chars):');
        console.log(text.substring(Math.max(0, index - 200), Math.min(text.length, index + 800)));
        break;
      }
    }
    
    console.log('\n=== LOOKING FOR COURSE ID PATTERNS ===');
    const courseIdPattern = /[A-Z]{2,}\d{4}IU/g;
    const matches = text.match(courseIdPattern);
    if (matches) {
      console.log(`Found ${matches.length} potential course ID matches:`);
      const uniqueIds = [...new Set(matches)];
      console.log('Unique IDs (first 30):');
      uniqueIds.slice(0, 30).forEach((id, idx) => {
        console.log(`${idx + 1}: ${id}`);
      });
      if (uniqueIds.length > 30) {
        console.log(`... and ${uniqueIds.length - 30} more`);
      }
    } else {
      console.log('No course ID patterns found');
    }
    
    console.log('\n=== LOOKING FOR YEAR/SEMESTER PATTERNS ===');
    const yearSemesterPattern = /(\d+)(?:st|nd|rd|th)\s+Year\s+–\s+Semester\s+(\d+)/gi;
    let match;
    while ((match = yearSemesterPattern.exec(text)) !== null) {
      console.log(`Found year/semester: Year ${match[1]}, Semester ${match[2]} at index ${match.index}`);
      console.log('Context:', text.substring(Math.max(0, match.index - 100), Math.min(text.length, match.index + 200)));
    }
  })
  .catch(console.error);