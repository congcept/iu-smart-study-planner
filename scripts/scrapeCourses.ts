import axios from 'axios';
import * as cheerio from 'cheerio';

interface Course {
  id: string;
  name: string;
  credits: number;
  lectureHours: number;
  labHours: number;
  year: number;
  semester: number;
  isElective: boolean;
  electiveGroup?: string;
}

interface ElectiveGroup {
  name: string;
  selectCount: number;
  courses: Course[];
}

interface YearSemesterData {
  year: number;
  semester: number;
  requiredCourses: Course[];
  electiveGroups: ElectiveGroup[];
}

async function scrapeComputerScienceCourses(): Promise<YearSemesterData[]> {
  try {
    const url = 'https://hcmiu.edu.vn/en/academic-programs/undergraduate-programs/school-of-computer-science-and-engineering/';
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    // Find the Computer Science section
    const csSection = $('strong:contains("2.  **COMPUTER SCIENCE")').parent();
    
    if (!csSection.length) {
      throw new Error('Could not find Computer Science section');
    }

    // Get all content after the CS section until the next major section
    const csContent = csSection.parent().find('*').slice(csSection.parent().index(csSection), 
      csSection.parent().find('strong:contains("3.  **DATA SCIENCE")').parent().index());

    const yearSemesterData: YearSemesterData[] = [];
    let currentYear = 0;
    let currentSemester = 0;
    let currentRequiredCourses: Course[] = [];
    let currentElectiveGroups: ElectiveGroup[] = [];

    // Process elements to extract course data
    csContent.each((_, element) => {
      const text = $(element).text().trim();
      
      // Check for year/semester headers
      const yearSemesterMatch = text.match(/(\d+)(?:st|nd|rd|th)\s+Year\s+–\s+Semester\s+(\d+)/i);
      if (yearSemesterMatch) {
        // Save previous year/semester data
        if (currentYear > 0 && currentSemester > 0) {
          yearSemesterData.push({
            year: currentYear,
            semester: currentSemester,
            requiredCourses: currentRequiredCourses,
            electiveGroups: currentElectiveGroups
          });
        }
        
        // Start new year/semester
        currentYear = parseInt(yearSemesterMatch[1]);
        currentSemester = parseInt(yearSemesterMatch[2]);
        currentRequiredCourses = [];
        currentElectiveGroups = [];
        return;
      }

      // Check for elective group headers
      const electiveMatch = text.match(/\\*\\*\\*Elective group\s+(\d+)\s*\(select\s+(\d+)\s+of\s+following\s+courses\)\\*\\*\\*/i);
      if (electiveMatch) {
        // Save current elective group if we were building one
        // Actually, we'll handle this differently - we'll collect courses until next section
        return;
      }

      // Check if this looks like a course row (has subject ID pattern)
      const courseMatch = text.match(/^([A-Z]{2,}\d{4}IU)/);
      if (courseMatch && currentYear > 0 && currentSemester > 0) {
        // This is likely a course row, parse it
        const courseId = courseMatch[1];
        // Extract the rest of the data from the row
        // This is simplified - in reality we'd need to parse the table structure properly
        const course = parseCourseRow($(element), courseId, currentYear, currentSemester);
        if (course) {
          // Determine if it's part of an elective group
          // For simplicity, we'll assume all courses in elective sections are electives
          // A more sophisticated approach would track when we're in an elective section
          currentRequiredCourses.push(course);
        }
        return;
      }
    });

    // Don't forget the last year/semester
    if (currentYear > 0 && currentSemester > 0) {
      yearSemesterData.push({
        year: currentYear,
        semester: currentSemester,
        requiredCourses: currentRequiredCourses,
        electiveGroups: currentElectiveGroups
      });
    }

    return yearSemesterData;
  } catch (error) {
    console.error('Error scraping courses:', error);
    throw error;
  }
}

function parseCourseRow(element: cheerio.Element, courseId: string, year: number, semester: number): Course | null {
  const $element = $(element);
  const text = $element.text().trim();
  
  // Extract course details from the row
  // This is a simplified parser - would need to be adjusted based on actual HTML structure
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  // Find indices of relevant data
  let nameIndex = -1;
  let creditsIndex = -1;
  let lectureIndex = -1;
  let labIndex = -1;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === courseId) {
      nameIndex = i + 1;
    } else if (lines[i] === 'Credits' || lines[i] === 'Credit') {
      creditsIndex = i + 1;
    } else if (lines[i] === 'Total' || lines[i] === 'Lecture') {
      lectureIndex = i + 1;
    } else if (lines[i] === 'Lab') {
      labIndex = i + 1;
    }
  }
  
  // Extract values with fallbacks
  const name = nameIndex >= 0 && nameIndex < lines.length ? lines[nameIndex] : 'Unknown Course';
  const credits = creditsIndex >= 0 && creditsIndex < lines.length ? parseInt(lines[creditsIndex]) || 3 : 3;
  const lectureHours = lectureIndex >= 0 && lectureIndex < lines.length ? parseInt(lines[lectureIndex]) || 3 : 3;
  const labHours = labIndex >= 0 && labIndex < lines.length ? parseInt(lines[labIndex]) || 0 : 0;
  
  return {
    id: courseId,
    name,
    credits,
    lectureHours,
    labHours,
    year,
    semester,
    isElective: false, // Would need to determine based on context
    electiveGroup: undefined
  };
}

// Main execution
async function main() {
  try {
    console.log('Starting to scrape Computer Science course data...');
    const data = await scrapeComputerScienceCourses();
    
    console.log('Successfully scraped data:');
    console.log(JSON.stringify(data, null, 2));
    
    // Save to file for inspection
    const fs = require('fs');
    fs.writeFileSync('../scraped-courses.json', JSON.stringify(data, null, 2));
    console.log('Data saved to scraped-courses.json');
    
  } catch (error) {
    console.error('Failed to scrape courses:', error);
    process.exit(1);
  }
}

main();