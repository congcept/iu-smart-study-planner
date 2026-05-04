const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://hcmiu.edu.vn/en/academic-programs/undergraduate-programs/school-of-computer-science-and-engineering/')
  .then(response => {
    const $ = cheerio.load(response.data);
    const text = $('body').text();
    
    // Find the Computer Science section
    const csStartIndex = text.indexOf('2.  **COMPUTER SCIENCE**');
    if (csStartIndex === -1) {
      console.log('Could not find Computer Science section with exact pattern');
      // Try alternative patterns
      const altPatterns = [
        '2. **COMPUTER SCIENCE**',
        '2. COMPUTER SCIENCE',
        '– COMPUTER SCIENCE'
      ];
      
      for (const pattern of altPatterns) {
        const index = text.indexOf(pattern);
        if (index !== -1) {
          console.log(`Found with pattern: ${pattern}`);
          // Look for course tables after this point
          const remainingText = text.substring(index);
          console.log('First 5000 chars after pattern:');
          console.log(remainingText.substring(0, 5000));
          return;
        }
      }
      
      console.log('Could not find Computer Science section with any pattern');
      return;
    }
    
    console.log('Found Computer Science section at index:', csStartIndex);
    const remainingText = text.substring(csStartIndex);
    console.log('First 10000 chars after Computer Science section:');
    console.log(remainingText.substring(0, 10000));
    
    // Look for course tables (tables with course IDs)
    const courseIdPattern = /[A-Z]{2,}\d{4}IU/g;
    const matches = remainingText.match(courseIdPattern);
    if (matches) {
      console.log(`\nFound ${matches.length} potential course IDs:`);
      const uniqueIds = [...new Set(matches)];
      console.log('Unique IDs:', uniqueIds.slice(0, 20)); // Show first 20
      if (uniqueIds.length > 20) {
        console.log(`... and ${uniqueIds.length - 20} more`);
      }
    } else {
      console.log('\nNo course ID patterns found in the text after Computer Science section');
    }
  })
  .catch(console.error);