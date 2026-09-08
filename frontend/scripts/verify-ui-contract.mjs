import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(frontendRoot, 'src');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');
}

const failures = [];
const requireText = (relativePath, fragment, purpose) => {
  if (!read(relativePath).includes(fragment)) {
    failures.push(`${relativePath}: ${purpose}`);
  }
};

// These are platform-wide invariants. Keep this verifier narrow enough to avoid
// false positives while making accidental removal of the shared safeguards fail CI.
requireText('src/contexts/ThemeContext.js', "whiteSpace: 'nowrap'", 'button labels must stay on one line');
requireText('src/contexts/ThemeContext.js', 'MuiDialogActions', 'dialog action groups must use the shared responsive contract');
requireText('src/contexts/ThemeContext.js', "flexWrap: 'wrap'", 'action groups must wrap by whole controls');
requireText('src/contexts/ThemeContext.js', 'MuiTabs', 'tabs must remain horizontally scrollable on narrow screens');
requireText('src/contexts/ThemeContext.js', "textOverflow: 'ellipsis'", 'dynamic compact labels must truncate safely');
requireText('src/contexts/ThemeContext.js', "'.nas-dynamic-label'", 'dynamic label utility must remain available');
requireText('src/components/GlobalAppWindowLayer.js', 'className="nas-dynamic-label"', 'app window titles must not displace window controls');
requireText('src/components/NAS/Window/NASWindow.js', 'className="nas-dynamic-label"', 'file and folder window titles must not displace window controls');
requireText('src/components/TopBar.js', "display: { xs: 'none', md: 'inline-flex' }", 'minimized-task chips must not overflow the mobile top bar');

const sourceFiles = walk(sourceRoot).filter((file) => /\.[jt]sx?$/.test(file));
const longStaticLabels = [];
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const buttonPattern = /<Button\b[^>]*>\s*([^<{][^<]{15,80}?)\s*<\/Button>/gms;
  let match;
  while ((match = buttonPattern.exec(source))) {
    const label = match[1].replace(/\s+/g, ' ').trim();
    // Arrow functions and JSX expressions may contain `>` before the actual tag
    // boundary; ignore those conservative parser ambiguities instead of emitting noise.
    if (label.length < 16 || /[{}=>]/.test(label)) continue;
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    longStaticLabels.push(`${path.relative(frontendRoot, file)}:${line} “${label}”`);
  }
}

if (failures.length > 0) {
  console.error('UI contract verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`UI contract verified across ${sourceFiles.length} source files.`);
if (longStaticLabels.length > 0) {
  console.log(`Review-only long button labels (${longStaticLabels.length}); descriptive/full-width actions may be valid:`);
  longStaticLabels.forEach((item) => console.log(`- ${item}`));
}
