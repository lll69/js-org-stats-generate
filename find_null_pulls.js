const fs = require('fs');
const path = require('path');

// Resolve the JSON file path (can be passed as a CLI argument, defaults to dist/cname.json)
const filePath = path.resolve(process.argv[2] || 'dist/cname.json');

try {
  // Read and parse the JSON file synchronously
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  // Iterate over all entries and filter items whose first history entry has pull === null
  const result = Object.values(data).filter(item => {
    const history = item && item.history;
    return Array.isArray(history) &&
           history.length > 0 &&
           history[0] != null &&
           history[0].pull === null;
  });

  // Print the name field
  if (result.length === 0) {
    console.log('No items found whose first history entry has pull === null');
  } else {
    console.log('Items matching the criteria (name):');
    result.forEach(item => console.log(item.name));
    console.log(`\nTotal: ${result.length}`);
  }
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error(`File not found: ${filePath}`);
  } else if (err instanceof SyntaxError) {
    console.error('Failed to parse JSON:', err.message);
  } else {
    console.error('An error occurred:', err);
  }
  process.exitCode = 1;
}