const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const yauzl = require('yauzl');

const MAX_ENTRY_COUNT = 50_000;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 250 * 1024 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 1_000;
const RATIO_CHECK_MIN_BYTES = 100 * 1024 * 1024;

const zipError = (message, status = 400, code = 'INVALID_ZIP') =>
  Object.assign(new Error(message), { status, code });

const normalizeEntryPath = (value) => {
  const raw = String(value || '').replace(/\\/g, '/');
  if (!raw || raw.includes('\0') || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) {
    throw zipError('ZIP 안에 안전하지 않은 경로가 있습니다.', 400, 'UNSAFE_ZIP_PATH');
  }
  const segments = raw.split('/').filter((segment) => segment && segment !== '.');
  if (!segments.length || segments.some((segment) => segment === '..')) {
    throw zipError('ZIP 안에 상위 폴더로 벗어나는 경로가 있습니다.', 400, 'UNSAFE_ZIP_PATH');
  }
  return segments.join('/');
};

const isDirectoryEntry = (entry) => /[\\/]$/.test(String(entry.fileName || ''))
  || (Number(entry.externalFileAttributes || 0) & 0x10) === 0x10;

const isSymlinkEntry = (entry) => {
  const unixMode = (Number(entry.externalFileAttributes || 0) >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
};

const openZip = (zipPath) => new Promise((resolve, reject) => {
  yauzl.open(zipPath, {
    lazyEntries: true,
    autoClose: true,
    decodeStrings: true,
    validateEntrySizes: true
  }, (error, zipfile) => error ? reject(zipError('ZIP 파일을 읽을 수 없습니다.', 400, 'INVALID_ZIP')) : resolve(zipfile));
});

const forEachEntry = async (zipPath, handler) => {
  const zipfile = await openZip(zipPath);
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { zipfile.close(); } catch {}
      reject(error);
    };
    zipfile.once('error', (error) => fail(zipError(error.message || 'ZIP 파일이 손상되었습니다.', 400, 'INVALID_ZIP')));
    zipfile.once('end', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    zipfile.on('entry', (entry) => {
      Promise.resolve(handler(entry, zipfile))
        .then(() => { if (!settled) zipfile.readEntry(); })
        .catch(fail);
    });
    zipfile.readEntry();
  });
};

const validateEntry = (entry) => {
  if ((Number(entry.generalPurposeBitFlag || 0) & 0x1) !== 0) {
    throw zipError('암호가 설정된 ZIP 파일은 아직 풀 수 없습니다.', 400, 'ENCRYPTED_ZIP');
  }
  if (isSymlinkEntry(entry)) {
    throw zipError('심볼릭 링크가 포함된 ZIP 파일은 안전을 위해 풀 수 없습니다.', 400, 'ZIP_SYMLINK');
  }
  const relativePath = normalizeEntryPath(entry.fileName);
  const directory = isDirectoryEntry(entry);
  const uncompressedSize = directory ? 0 : Number(entry.uncompressedSize || 0);
  const compressedSize = directory ? 0 : Number(entry.compressedSize || 0);
  if (!Number.isSafeInteger(uncompressedSize) || uncompressedSize < 0 || !Number.isSafeInteger(compressedSize) || compressedSize < 0) {
    throw zipError('ZIP 파일의 크기 정보가 올바르지 않습니다.', 400, 'INVALID_ZIP_SIZE');
  }
  if (uncompressedSize >= RATIO_CHECK_MIN_BYTES && uncompressedSize / Math.max(1, compressedSize) > MAX_COMPRESSION_RATIO) {
    throw zipError('비정상적으로 압축률이 높은 항목이 있어 압축 해제를 중단했습니다.', 413, 'ZIP_BOMB');
  }
  return { relativePath, directory, uncompressedSize, compressedSize };
};

const inspectZip = async (zipPath) => {
  const entries = [];
  const seen = new Set();
  let totalUncompressedBytes = 0;
  let totalCompressedBytes = 0;
  await forEachEntry(zipPath, (entry) => {
    const inspected = validateEntry(entry);
    if (seen.has(inspected.relativePath)) {
      throw zipError('ZIP 안에 같은 경로가 두 번 들어 있습니다.', 400, 'DUPLICATE_ZIP_PATH');
    }
    seen.add(inspected.relativePath);
    entries.push(inspected);
    if (entries.length > MAX_ENTRY_COUNT) {
      throw zipError(`ZIP 항목은 최대 ${MAX_ENTRY_COUNT.toLocaleString()}개까지 풀 수 있습니다.`, 413, 'ZIP_TOO_MANY_ENTRIES');
    }
    totalUncompressedBytes += inspected.uncompressedSize;
    totalCompressedBytes += inspected.compressedSize;
    if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw zipError('압축을 푼 크기가 안전 한도를 초과합니다.', 413, 'ZIP_TOO_LARGE');
    }
  });
  if (!entries.length) throw zipError('ZIP 파일이 비어 있습니다.', 400, 'EMPTY_ZIP');
  if (totalUncompressedBytes >= RATIO_CHECK_MIN_BYTES
    && totalUncompressedBytes / Math.max(1, totalCompressedBytes) > MAX_COMPRESSION_RATIO) {
    throw zipError('비정상적으로 높은 전체 압축률이 감지되었습니다.', 413, 'ZIP_BOMB');
  }
  return {
    entries,
    entryCount: entries.length,
    fileCount: entries.filter((entry) => !entry.directory).length,
    directoryCount: entries.filter((entry) => entry.directory).length,
    totalUncompressedBytes,
    topLevelNames: [...new Set(entries.map((entry) => entry.relativePath.split('/')[0]))]
  };
};

const openEntryStream = (zipfile, entry) => new Promise((resolve, reject) => {
  zipfile.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream));
});

const extractZipToDirectory = async (zipPath, destinationDirectory, inspection) => {
  const expected = new Map(inspection.entries.map((entry) => [entry.relativePath, entry]));
  await fsp.mkdir(destinationDirectory, { recursive: true });
  let writtenBytes = 0;
  await forEachEntry(zipPath, async (entry, zipfile) => {
    const validated = validateEntry(entry);
    const planned = expected.get(validated.relativePath);
    if (!planned || planned.directory !== validated.directory || planned.uncompressedSize !== validated.uncompressedSize) {
      throw zipError('검사 후 ZIP 내용이 달라졌습니다.', 409, 'ZIP_CHANGED');
    }
    const outputPath = path.resolve(destinationDirectory, ...validated.relativePath.split('/'));
    const relativeOutput = path.relative(path.resolve(destinationDirectory), outputPath);
    if (!relativeOutput || relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
      throw zipError('ZIP 항목이 대상 폴더를 벗어납니다.', 400, 'UNSAFE_ZIP_PATH');
    }
    if (validated.directory) {
      await fsp.mkdir(outputPath, { recursive: true });
      return;
    }
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    const input = await openEntryStream(zipfile, entry);
    let entryBytes = 0;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        entryBytes += chunk.length;
        writtenBytes += chunk.length;
        if (entryBytes > validated.uncompressedSize || writtenBytes > inspection.totalUncompressedBytes) {
          callback(zipError('ZIP의 실제 압축 해제 크기가 예상보다 큽니다.', 413, 'ZIP_SIZE_MISMATCH'));
          return;
        }
        callback(null, chunk);
      }
    });
    await pipeline(input, limiter, fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }));
    if (entryBytes !== validated.uncompressedSize) {
      throw zipError('ZIP 항목의 실제 크기가 예상과 다릅니다.', 400, 'ZIP_SIZE_MISMATCH');
    }
  });
  if (writtenBytes !== inspection.totalUncompressedBytes) {
    throw zipError('ZIP 전체의 실제 크기가 예상과 다릅니다.', 400, 'ZIP_SIZE_MISMATCH');
  }
  return { writtenBytes };
};

const defaultFolderName = (zipName) => {
  const name = path.basename(String(zipName || '압축 해제'));
  return name.replace(/\.zip$/i, '').trim() || '압축 해제';
};

module.exports = {
  inspectZip,
  extractZipToDirectory,
  normalizeEntryPath,
  isSymlinkEntry,
  defaultFolderName,
  MAX_ENTRY_COUNT,
  MAX_TOTAL_UNCOMPRESSED_BYTES
};
