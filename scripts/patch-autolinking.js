// One-line edge fix for expo-modules-autolinking: its package.json walk
//   for (let dir = root; path.dirname(dir) !== dir; dir = path.dirname(dir))
// never executes when the project sits at a DRIVE ROOT (e.g. the short SUBST
// path R:\ that we use to stay under Windows MAX_PATH), because
// dirname('R:\') === 'R:\' - so it throws "Couldn't find package.json up
// from path R:\" even though package.json is right there. The loop below
// checks each directory (including the root) before stopping.
// Idempotent: run before every build (scripts/dev.js and build-apk.bat do).

// Edge fix for expo-modules-autolinking's package.json walk loops:
//   for (let dir = root; path.dirname(dir) !== dir; dir = path.dirname(dir))
// never executes when the project sits at a DRIVE ROOT (e.g. the short SUBST
// path R:\ that we use to stay under Windows MAX_PATH), because
// dirname('R:\') === 'R:\' - so it throws "Couldn't find package.json up
// from path R:\" even though package.json is right there. The patched loop
// checks every directory (including the root) before stopping.
// Idempotent: scripts/dev.js / build-apk.bat run this before every build, so an
// npm install that restores the package is re-patched automatically.

const fs = require('fs');
const path = require('path');

const nm = path.join(__dirname, '..', 'node_modules', 'expo-modules-autolinking', 'build');
const targets = [
  { file: path.join(nm, 'commands', 'autolinkingOptions.js'), loopVar: 'root' },
  { file: path.join(nm, 'exports.js'), loopVar: 'cwd' },
];

for (const target of targets) {
  try {
    const src = fs.readFileSync(target.file, 'utf8');
    if (src.includes('patched-marker')) {
      console.log(`[patch] ${path.basename(target.file)} already patched`);
      continue;
    }
    const header = `for(let dir = ${target.loopVar}; _path().default.dirname(dir) !== dir; dir = _path().default.dirname(dir)){`;
    const body = `        const file = _path().default.resolve(dir, 'package.json');
        if (_fs().default.existsSync(file)) {
            return file;
        }
    }`;
    const patchedBody = `        const file = _path().default.resolve(dir, 'package.json');
        if (_fs().default.existsSync(file)) {
            return file;
        }
        if (_path().default.dirname(dir) === dir) break;
    }
    // patched-marker`;
    if (src.includes(header) && src.includes(body)) {
      fs.writeFileSync(
        target.file,
        src
          .replace(header, `for(let dir = ${target.loopVar}; ; dir = _path().default.dirname(dir)){`)
          .replace(body, patchedBody),
      );
      console.log(`[patch] ${path.basename(target.file)} root-walk patched`);
    } else {
      console.warn(`[patch] ${path.basename(target.file)} pattern not found - skipping`);
    }
  } catch (error) {
    console.warn(`[patch] ${path.basename(target.file)} failed:`, error.message);
  }
}