import { fileURLToPath } from 'node:url';
import { importBlindRatings } from './lib/blind-review.mjs';

const args = process.argv.slice(2);
const files = {};
let destinationDir = fileURLToPath(new URL('./runs/matrix/ratings/', import.meta.url));

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--putin') files.putin = args[++index];
  else if (arg === '--peskov') files.peskov = args[++index];
  else if (arg === '--durov') files.durov = args[++index];
  else if (arg === '--dest') destinationDir = args[++index];
  else {
    console.error('Usage: node import-blind-ratings.mjs --putin file --peskov file --durov file [--dest directory]');
    process.exit(1);
  }
}

try {
  const result = importBlindRatings({ files, destinationDir });
  console.log(`Imported ${result.imported.length} rating files. Mapping was not read.`);
} catch (error) {
  console.error(error.code || 'ratings-invalid');
  if (error.errors) console.error(error.errors.join('\n'));
  process.exit(1);
}
