const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://hcmiu.edu.vn/en/academic-programs/undergraduate-programs/school-of-computer-science-and-engineering/')
  .then(response => {
    const $ = cheerio.load(response.data);
    const text = $('body').text();
    
    // Look for various patterns that might indicate the Computer Science section
    const patterns = [
      '2.  **COMPUTER SCIENCE**',
      '2. **COMPUTER SCIENCE**',
      '2. COMPUTER SCIENCE',
      'COMPUTER SCIENCE',
      '– COMPUTER SCIENCE',
      '- COMPUTER SCIENCE'
    ];
    
    for (const pattern of patterns) {
      const index = text.indexOf(pattern);
      if (index !== -1) {
        console.log(`Found pattern "${pattern}" at index: ${index}`);
        console.log('Context:', text.substring(Math.max(0, index - 100), index + 200));
        return;
      }
    }
    
    console.log('None of the patterns were found. Let\'s look at the beginning of the text:');
    console.log(text.substring(0, 5000));
  })
  .catch(console.error);