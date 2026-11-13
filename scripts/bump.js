// Raise the version shown on both pages and in version.json, so a phone can tell whether it has the latest.
// Run before each push: npm run bump
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), vf = path.join(root, 'version.json');
const v = JSON.parse(fs.readFileSync(vf, 'utf8')).v + 1;
for (const f of ['index.html', 'studio/index.html']) {
  const p = path.join(root, f), s = fs.readFileSync(p, 'utf8'), out = s.replace(/const VERSION = \d+;/, 'const VERSION = ' + v + ';');
  if (out === s) throw new Error('No VERSION line in ' + f);
  fs.writeFileSync(p, out);
}
fs.writeFileSync(vf, JSON.stringify({ v }) + '\n');
console.log('v' + v);
