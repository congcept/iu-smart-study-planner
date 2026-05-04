const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://hcmiu.edu.vn/en/academic-programs/undergraduate-programs/school-of-computer-science-and-engineering/')
  .then(response => {
    const $ = cheerio.load(response.data);
    const text = $('body').text();
    
    // Find the Computer Science section
    const csStartIndex = text.indexOf('2.  **COMPUTER SCIENCE**');
    const dsStartIndex = text.indexOf('3.  **DATA SCIENCE**');
    
    if (csStartIndex === -1) {
      console.log('Could not find Computer Science section');
      return;
    }
    
    const csContent = text.substring(csStartIndex, dsStartIndex !== -1 ? dsStartIndex : text.length);
    console.log('Computer Science section content:');
    console.log(csContent.substring(0, 3000));
    console.log('\n---\n');
    
    // Look for course patterns
    const lines = csContent.split('\n');
    console.log('Looking for course patterns...');
    let foundCourses = 0;
    for (let i = 0; i < Math.min(lines.length, 200); i++) {
      const line = lines[i].trim();
      // Look for lines that start with a course ID pattern like ITxxxxIU
      if (/^[A-Z]{2,}\d{4}IU/.test(line)) {
        console.log(`Course line ${i}: ${line}`);
        foundCourses++;
        if (foundCourses > 20) break; // Limit output
      }
    }
    
    if (foundCourses === 0) {
      console.log('No course lines found with pattern [A-Z]{2,}\\d{4}IU');
      // Let's see what lines we do have
      console.log('First 50 lines of CS content:');
      for (let i = 0; i < Math.min(50, lines.length); i++) {
        if (lines[i].trim().length > 0) {
          console.log(`${i}: ${lines[i].trim()}`);
        }
      }
    }
  })
  .catch(console.error);