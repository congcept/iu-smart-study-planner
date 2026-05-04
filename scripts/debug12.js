// Test the regex on the exact strings we extracted
const testStrings = [
  "MA001IU",
  "EN008IU", 
  "EN007IU",
  "IT064IU",
  "IT116IU",
  "PT001IU",
  "IT153IU",
  "PH013IU",
  "IT067IU",
  "IT099IU",
  "IT069IU"
];

console.log('Testing regex /^[A-Z]{2,}\\d{4}IU$/ on extracted strings:');
testStrings.forEach(str => {
  const regex = /^[A-Z]{2,}\d{4}IU$/;
  const result = regex.test(str);
  console.log(`"${str}" -> ${result}`);
});

// Let's also test character by character what's happening
console.log('\nDetailed character analysis:');
testStrings.forEach(str => {
  console.log(`\nString: "${str}"`);
  console.log('Length:', str.length);
  console.log('Characters:');
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    console.log(`  [${i}] '${char}' (code: ${char.charCodeAt(0)})`);
  }
  
  // Test each part of the regex
  const firstPart = /^[A-Z]{2,}/.test(str);
  const middlePart = /\d{4}/.test(str);
  const lastPart = /IU$/.test(str);
  
  console.log(`  Starts with 2+ uppercase letters: ${firstPart}`);
  console.log(`  Has 4 digits in middle: ${middlePart}`);
  console.log(`  Ends with "IU": ${lastPart}`);
  console.log(`  Overall match: ${/^[A-Z]{2,}\d{4}IU$/.test(str)}`);
});

// Let's see what happens if we try to match against the raw text from the cell
console.log('\nTesting if there might be hidden characters:');
// Simulate what might be happening
const testWithSpace = " MA001IU "; // with spaces
const testWithNewline = "\nMA001IU\n"; // with newlines

console.log(`" MA001IU " matches: ${/^[A-Z]{2,}\d{4}IU$/.test(testWithSpace)}`);
console.log(`"\\nMA001IU\\n" matches: ${/^[A-Z]{2,}\d{4}IU$/.test(testWithNewline)}`);
console.log(`" MA001IU ".trim() matches: ${/^[A-Z]{2,}\d{4}IU$/.test(testWithSpace.trim())}`);
console.log(`"\\nMA001IU\\n".trim() matches: ${/^[A-Z]{2,}\d{4}IU$/.test(testWithNewline.trim())}`);