const fs = require('fs');
const path = require('path');

const isReadyEntry = (entry, receivedDir, requestRoot) => {
  const name = String(entry?.name || '');
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) return false;
  if (entry.relativePath !== `${requestRoot}/${name}`) return false;
  try {
    const stat = fs.statSync(path.join(receivedDir, name));
    return entry.type === (stat.isDirectory() ? 'folder' : 'file');
  } catch {
    return false;
  }
};

const ensureUniqueName = (dirPath, wantedName) => {
  const ext = path.extname(wantedName);
  const base = path.basename(wantedName, ext);
  let candidate = wantedName;
  let counter = 1;
  while (fs.existsSync(path.join(dirPath, candidate))) {
    candidate = ext ? `${base} (${counter})${ext}` : `${base} (${counter})`;
    counter += 1;
  }
  return candidate;
};

const copyReceivedBundleEntries = ({ bundleDirs, receivedDir, requestRoot, existingEntries = [], beforeCopy = () => {} }) => {
  if (existingEntries.length > 0 &&
      existingEntries.every((entry) => isReadyEntry(entry, receivedDir, requestRoot))) {
    return { savedEntries: existingEntries, createdPaths: [], alreadySaved: true };
  }

  const sources = [];
  for (const bundleDir of bundleDirs) {
    if (!fs.existsSync(bundleDir)) throw new Error('ATTACHMENT_SOURCE_MISSING');
    for (const name of fs.readdirSync(bundleDir)) {
      const source = path.join(bundleDir, name);
      const stat = fs.statSync(source);
      sources.push({ name, source, type: stat.isDirectory() ? 'folder' : 'file' });
    }
  }

  const canReuseByIndex = existingEntries.length === sources.length;
  const missingSources = sources.filter((_, index) =>
    !canReuseByIndex || !isReadyEntry(existingEntries[index], receivedDir, requestRoot));
  beforeCopy(missingSources);
  fs.mkdirSync(receivedDir, { recursive: true });
  const createdPaths = [];
  const savedEntries = [];
  try {
    for (const [index, item] of sources.entries()) {
      if (canReuseByIndex && isReadyEntry(existingEntries[index], receivedDir, requestRoot)) {
        savedEntries.push(existingEntries[index]);
        continue;
      }
      const finalName = ensureUniqueName(receivedDir, item.name);
      const destination = path.join(receivedDir, finalName);
      createdPaths.push(destination);
      if (item.type === 'folder') fs.cpSync(item.source, destination, { recursive: true });
      else fs.copyFileSync(item.source, destination);
      savedEntries.push({ name: finalName, type: item.type, relativePath: `${requestRoot}/${finalName}` });
    }
  } catch (error) {
    for (const createdPath of createdPaths.reverse()) {
      try { fs.rmSync(createdPath, { recursive: true, force: true }); } catch {}
    }
    throw error;
  }
  return { savedEntries, createdPaths, alreadySaved: false };
};

module.exports = { copyReceivedBundleEntries };
