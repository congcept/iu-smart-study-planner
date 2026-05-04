const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

async function scrapeComputerScienceCourses() {
  try {
    console.log('Starting to scrape Computer Science course data...');
    const url = 'https://hcmiu.edu.vn/en/academic-programs/undergraduate-programs/school-of-computer-science-and-engineering/';
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    // Find all tables
    const tables = $('table');
    console.log(`Found ${tables.length} tables`);
    
    const allCourses = [];
    
    // Process each table
    tables.each((tableIndex, table) => {
      const rows = $(table).find('tr');
      
      let currentYear = 0;
      let currentSemester = 0;
      let inElectiveGroup = false;
      let currentElectiveGroup = null;
      let electiveSelectCount = 0;
      
      // Process each row in the table
      rows.each((rowIndex, row) => {
        const cells = $(row).find('td, th');
        const cellTexts = [];
        cells.each((cellIndex, cell) => {
          cellTexts.push($(cell).text().trim());
        });
        
        // Skip empty rows
        if (cellTexts.length === 0 || 
            (cellTexts.length === 1 && cellTexts[0] === '')) {
          return;
        }
        
        // Check for year/semester indicators in the cells
        const rowText = cellTexts.join(' ');
        const yearSemesterMatch = rowText.match(/(\d+)(?:st|nd|rd|th)\s+Year\s+–\s+Semester\s+(\d+)/i);
        if (yearSemesterMatch) {
          currentYear = parseInt(yearSemesterMatch[1]);
          currentSemester = parseInt(yearSemesterMatch[2]);
          inElectiveGroup = false;
          currentElectiveGroup = null;
          electiveSelectCount = 0;
          return;
        }
        
        // Check for elective group indicators
        const electiveMatch = rowText.match(/Elective\s+(\d+)/i);
        if (electiveMatch) {
          inElectiveGroup = true;
          currentElectiveGroup = `Elective ${electiveMatch[1]}`;
          electiveSelectCount = 1;
          return;
        }
        
        const electiveSelectMatch = rowText.match(/Elective\s+group\s*\(select\s+(\d+)\s+of\s+following\s+.*?courses\)/i);
        if (electiveSelectMatch) {
          inElectiveGroup = true;
          currentElectiveGroup = `Elective group (select ${electiveSelectMatch[1]} of following courses)`;
          electiveSelectCount = parseInt(electiveSelectMatch[1]);
          return;
        }
        
        // Check for free elective
        if (rowText.match(/Free\s+elective/i)) {
          inElectiveGroup = true;
          currentElectiveGroup = 'Free elective';
          electiveSelectCount = 1; // Treat as select 1 for simplicity
          return;
        }
        
        // Check for GPA-based sections (these don't affect course parsing but we should note them)
        if (rowText.includes('For students with GPA > 70') || 
            rowText.includes('For students with GPA <= 70')) {
          // These are informational, don't change parsing state
          return;
        }
        
        // Debug elective detection
        if (rowText.match(/Elective/i)) {
          console.log(`Elective detected: "${rowText}"`);
        }
        
        // Check if this row looks like a course row (first cell is a course ID)
        // Updated regex to match 3-4 digits (most are 3 digits like MA001IU)
        if (cellTexts.length >= 5 && /^[A-Z]{2,}\d{3,4}IU$/.test(cellTexts[0])) {
          const courseId = cellTexts[0];
          const name = cellTexts[1];
          const credits = parseInt(cellTexts[2]);
          const lectureHours = parseInt(cellTexts[3]);
          const labHours = parseInt(cellTexts[4]);
          
            // Only add if we have valid data and we're in a reasonable year/semester
            if (!isNaN(credits) && credits > 0 && courseId && name && 
                currentYear > 0 && currentSemester > 0 && currentYear <= 4 && currentSemester <= 3) {
              allCourses.push({
                id: courseId,
                name: name,
                credits: credits,
                lectureHours: lectureHours,
                labHours: labHours,
                year: currentYear,
                semester: currentSemester,
                isElective: inElectiveGroup,
                electiveGroup: inElectiveGroup ? currentElectiveGroup : undefined,
                selectCount: inElectiveGroup ? electiveSelectCount : 0
              });
              
              // Debug: Log when we find an elective course
              if (inElectiveGroup) {
                console.log(`Found elective course: ${courseId} in group ${currentElectiveGroup} (isElective: ${inElectiveGroup})`);
              }
              
              // Special debug for IT120IU
              if (courseId === 'IT120IU') {
                console.log(`IT120IU processed: isElective=${inElectiveGroup}, group=${currentElectiveGroup}, year=${currentYear}, semester=${currentSemester}`);
              }
            }
        }
      });
    });
    
    console.log(`Found ${allCourses.length} courses`);
    
    // Remove duplicates based on course ID, keeping the "best" entry
    // Best is defined as: elective > non-elective, then has electiveGroup, then lower year/semester
    const coursesById = {};
    allCourses.forEach(course => {
      const existing = coursesById[course.id];
      if (!existing) {
        coursesById[course.id] = course;
        return;
      }
      
      // Compare and keep the better course
      let shouldReplace = false;
      
      // Prefer elective over non-elective
      if (course.isElective && !existing.isElective) {
        shouldReplace = true;
      } else if (!course.isElective && existing.isElective) {
        shouldReplace = false;
      } 
      // If both same elective status, prefer one with electiveGroup
      else if (course.electiveGroup && !existing.electiveGroup) {
        shouldReplace = true;
      } else if (!course.electiveGroup && existing.electiveGroup) {
        shouldReplace = false;
      }
      // If both same on above, prefer lower year, then lower semester
      else {
        if (course.year !== existing.year) {
          shouldReplace = course.year < existing.year;
        } else if (course.semester !== existing.semester) {
          shouldReplace = course.semester < existing.semester;
        }
        // If still tied, keep existing (no change)
      }
      
      if (shouldReplace) {
        coursesById[course.id] = course;
      }
    });
    
    const uniqueCourses = Object.values(coursesById);
    
    console.log(`After removing duplicates: ${uniqueCourses.length} courses`);
    
    // Group courses by year and semester for better organization
    const groupedCourses = {};
    uniqueCourses.forEach(course => {
      const key = `Y${course.year}S${course.semester}`;
      if (!groupedCourses[key]) {
        groupedCourses[key] = {
          year: course.year,
          semester: course.semester,
          courses: []
        };
      }
      groupedCourses[key].courses.push(course);
    });
    
    // Convert to array and sort
    const result = Object.values(groupedCourses).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.semester - b.semester;
    });
    
    // Save to file
    fs.writeFileSync('../scraped-courses.json', JSON.stringify(result, null, 2));
    console.log('Data saved to scraped-courses.json');
    
    // Print summary
    let totalCredits = 0;
    let requiredCredits = 0;
    let electiveCredits = 0;
    
    result.forEach(semester => {
      semester.courses.forEach(course => {
        totalCredits += course.credits;
        if (course.isElective) {
          electiveCredits += course.credits;
        } else {
          requiredCredits += course.credits;
        }
      });
    });
    
    console.log(`Total credits across all courses: ${totalCredits}`);
    console.log(`Required credits: ${requiredCredits}`);
    console.log(`Elective credits: ${electiveCredits}`);
    
    // Count courses by type
    const requiredCount = uniqueCourses.filter(c => !c.isElective).length;
    const electiveCount = uniqueCourses.filter(c => c.isElective).length;
    console.log(`Required courses: ${requiredCount}`);
    console.log(`Elective courses: ${electiveCount}`);
    
    // Show some sample courses
    console.log('\nSample courses:');
    uniqueCourses.slice(0, 15).forEach((course, index) => {
      console.log(`${index + 1}: ${course.id} - ${course.name} (${course.credits} credits) - Year ${course.year}, Semester ${course.semester} ${course.isElective ? '(Elective)' : ''}`);
    });
    
    return result;
  } catch (error) {
    console.error('Error scraping courses:', error);
    throw error;
  }
}

// Run the scraper
scrapeComputerScienceCourses().catch(console.error);