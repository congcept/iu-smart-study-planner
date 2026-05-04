const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://hcmiu.edu.vn/en/academic-programs/undergraduate-programs/school-of-computer-science-and-engineering/')
  .then(response => {
    const $ = cheerio.load(response.data);
    const text = $('body').text();
    console.log('First 2000 chars:');
    console.log(text.substring(0, 2000));
    console.log('\n---\n');
    console.log('Looking for COMPUTER SCIENCE...');
    const index = text.indexOf('COMPUTER SCIENCE');
    if (index !== -1) {
      console.log('Found at index:', index);
      console.log('Context:', text.substring(Math.max(0, index - 100), index + 200));
    } else {
      console.log('NOT FOUND');
      // Let's see what similar text exists
      const lines = text.split('\n');
      for (let i = 0; i < Math.min(lines.length, 100); i++) {
        if (lines[i].includes('COMPUTER') || lines[i].includes('SCIENCE')) {
          console.log(`Line ${i}: ${lines[i]}`);
        }
      }
    }
  })
  .catch(console.error);