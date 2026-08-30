const readAllEntries = async (reader) => {
  let all = [];
  while (true) {
    const chunk = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!chunk || chunk.length === 0) break;
    all = all.concat(chunk);
  }
  return all;
};

const scanEntry = async (entry, prefix = '') => {
  if (!entry) return [];

  if (entry.isFile) {
    try {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      if (!file) return [];
      return [{ file, relPath: `${prefix}${file.name}` }];
    } catch (err) {
      console.warn('파일 엔트리 읽기 실패:', `${prefix}${entry.name || ''}`, err);
      return [];
    }
  }

  if (entry.isDirectory) {
    const dirName = entry.name || '';
    const dirPrefix = `${prefix}${dirName}/`;
    const children = await readAllEntries(entry.createReader());
    return (await Promise.all(children.map(child => scanEntry(child, dirPrefix)))).flat();
  }

  return [];
};

export const collectDroppedUploadItems = async (dataTransfer) => {
  const items = dataTransfer?.items ? Array.from(dataTransfer.items) : [];
  const plainFiles = dataTransfer?.files ? Array.from(dataTransfer.files) : [];

  // Capture every browser entry before the first await. DataTransferItem handles
  // may become unreadable once the asynchronous drop handler yields.
  const entries = items
    .map(item => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (entries.length > 0) {
    const scanned = (await Promise.all(entries.map(entry => scanEntry(entry, '')))).flat();

    if (entries.every(entry => entry.isFile)) {
      const signature = file => [file.name, file.size, file.lastModified || 0].join(':');
      const seen = new Set(scanned.map(item => signature(item.file)));
      plainFiles.forEach(file => {
        const key = signature(file);
        if (seen.has(key)) return;
        seen.add(key);
        scanned.push({ file, relPath: file.webkitRelativePath || file.name });
      });
    }

    return scanned;
  }

  return plainFiles.map(file => ({
    file,
    relPath: file.webkitRelativePath || file.name
  }));
};
