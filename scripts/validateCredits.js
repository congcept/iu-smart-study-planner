const fs = require('fs');

/**
 * Validates that the scraped course data meets HCMIU Computer Science program requirements
 * Total required credits: 130
 */
function validateCourseCredits() {
  try {
    // Read the scraped course data
    const data = JSON.parse(fs.readFileSync('../scraped-courses.json', 'utf8'));
    
    let totalCredits = 0;
    let requiredCredits = 0;
    let electiveCredits = 0;
    let requiredCount = 0;
    let electiveCount = 0;
    let yearSemesterCredits = {};
    
    // Process all courses
    data.forEach(semester => {
      const yearSemesterKey = `Y${semester.year}S${semester.semester}`;
      yearSemesterCredits[yearSemesterKey] = 0;
      
      semester.courses.forEach(course => {
        const credits = course.credits;
        totalCredits += credits;
        yearSemesterCredits[yearSemesterKey] += credits;
        
        if (course.isElective) {
          electiveCredits += credits;
          electiveCount++;
        } else {
          requiredCredits += credits;
          requiredCount++;
        }
      });
    });
    
    // Program requirements
    const REQUIRED_TOTAL_CREDITS = 130;
    const creditDifference = totalCredits - REQUIRED_TOTAL_CREDITS;
    
    console.log('HCMIU Computer Science Program Credit Validation');
    console.log('==============================================');
    console.log(`Total Credits Found: ${totalCredits}`);
    console.log(`Required Credits: ${requiredCredits} (${requiredCount} courses)`);
    console.log(`Elective Credits: ${electiveCredits} (${electiveCount} courses)`);
    console.log('');
    console.log('Breakdown by Year/Semester:');
    
    // Sort by year and semester for consistent output
    const sortedKeys = Object.keys(yearSemesterCredits).sort((a, b) => {
      const yearA = parseInt(a.substring(1, 2));
      const yearB = parseInt(b.substring(1, 2));
      if (yearA !== yearB) return yearA - yearB;
      const semA = parseInt(a.substring(3, 4));
      const semB = parseInt(b.substring(3, 4));
      return semA - semB;
    });
    
    sortedKeys.forEach(key => {
      console.log(`  ${key}: ${yearSemesterCredits[key]} credits`);
    });
    
    console.log('');
    console.log('Validation Results:');
    console.log('==================');
    console.log(`Program Requirement: ${REQUIRED_TOTAL_CREDITS} credits`);
    console.log(`Actual Total: ${totalCredits} credits`);
    console.log(`Difference: ${creditDifference} credits`);
    
    if (creditDifference === 0) {
      console.log('✅ PASS: Total credits exactly match program requirement');
    } else if (Math.abs(creditDifference) <= 10) { // Allow small tolerance
      console.log(`⚠️  WARNING: Total credits differ by ${Math.abs(creditDifference)} credits`);
      console.log(`   ${totalCredits > REQUIRED_TOTAL_CREDITS ? 'Exceeds' : 'Below'} requirement`);
    } else {
      console.log(`❌ FAIL: Total credits differ by ${Math.abs(creditDifference)} credits`);
      console.log(`   ${totalCredits > REQUIRED_TOTAL_CREDITS ? 'Exceeds' : 'Below'} requirement by ${Math.abs(creditDifference)} credits`);
    }
    
    // Additional validations
    console.log('');
    console.log('Additional Checks:');
    console.log('==================');
    
    // Check that we have courses for all expected years/semesters
    const expectedPeriods = [];
    for (let year = 1; year <= 4; year++) {
      for (let semester = 1; semester <= 3; semester++) {
        expectedPeriods.push(`Y${year}S${semester}`);
      }
    }
    
    const missingPeriods = expectedPeriods.filter(period => !yearSemesterCredits[period]);
    if (missingPeriods.length > 0) {
      console.log(`⚠️  WARNING: Missing data for periods: ${missingPeriods.join(', ')}`);
    } else {
      console.log('✅ All expected year/semester periods have data');
    }
    
    // Check elective credit ratio (should be reasonable)
    const electiveRatio = electiveCredits / totalCredits;
    console.log(`Elective Credit Ratio: ${(electiveRatio * 100).toFixed(1)}%`);
    if (electiveRatio < 0.1) {
      console.log('⚠️  WARNING: Elective credits seem unusually low (<10%)');
    } else if (electiveRatio > 0.5) {
      console.log('⚠️  WARNING: Elective credits seem unusually high (>50%)');
    } else {
      console.log('✅ Elective credit ratio appears reasonable');
    }
    
    return {
      totalCredits,
      requiredCredits,
      electiveCredits,
      requiredCount,
      electiveCount,
      yearSemesterCredits,
      creditDifference,
      passes: Math.abs(creditDifference) <= 10 // Consider passing if within 10 credits
    };
    
  } catch (error) {
    console.error('❌ Error validating course credits:', error.message);
    process.exit(1);
  }
}

// Run validation if script is executed directly
if (require.main === module) {
  validateCourseCredits();
}

module.exports = { validateCourseCredits };