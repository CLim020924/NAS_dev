const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const archiver = require('archiver');

const MAX_ENTRY_COUNT = 50_000;

const zipCreationError = (message, status = 400, code = 'ZIP_CREATION_FAILED') => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

const toArchivePath = (relativePath) => relativePath.split(path.sep).join('/');

const collectDirectoryEntries = async (sourceDirectory) => {
  const sourceRoot = path.resolve(sourceDirectory);
  const entries = [];
  let sourceBytes = 0;
  let fileCount = 0;
  let directoryCount = 0;

  const visit = async (directory, relativeDirectory = '') => {
    const children = await fsp.readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      const relativePath = relativeDirectory ? path.join(relativeDirectory, child.name) : child.name;
      const stat = await fsp.lstat(absolutePath);
      if (stat.isSymbolicLink()) {
        throw zipCreationError(
          `심볼릭 링크는 안전을 위해 ZIP에 포함할 수 없습니다: ${toArchivePath(relativePath)}`,
          400,
          'ZIP_SOURCE_SYMLINK'
        );
      }
      if (stat.isDirectory()) {
        entries.push({ absolutePath, relativePath, directory: true });
        directoryCount += 1;
        if (entries.length > MAX_ENTRY_COUNT) {
          throw zipCreationError(`폴더 항목은 최대 ${MAX_ENTRY_COUNT.toLocaleString()}개까지 압축할 수 있습니다.`, 413, 'ZIP_TOO_MANY_ENTRIES');
        }
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!stat.isFile()) {
        throw zipCreationError(`일반 파일이 아닌 항목은 ZIP에 포함할 수 없습니다: ${toArchivePath(relativePath)}`, 400, 'ZIP_SOURCE_UNSUPPORTED');
      }
      entries.push({ absolutePath, relativePath, directory: false });
      fileCount += 1;
      sourceBytes += stat.size;
      if (!Number.isSafeInteger(sourceBytes)) {
        throw zipCreationError('압축할 폴더의 크기가 안전 범위를 초과합니다.', 413, 'ZIP_SOURCE_TOO_LARGE');
      }
      if (entries.length > MAX_ENTRY_COUNT) {
        throw zipCreationError(`폴더 항목은 최대 ${MAX_ENTRY_COUNT.toLocaleString()}개까지 압축할 수 있습니다.`, 413, 'ZIP_TOO_MANY_ENTRIES');
      }
    }
  };

  await visit(sourceRoot);
  return { entries, fileCount, directoryCount, sourceBytes };
};

const createZipFromDirectory = async (sourceDirectory, outputPath) => {
  const sourceStat = await fsp.stat(sourceDirectory).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw zipCreationError('압축할 폴더를 찾을 수 없습니다.', 404, 'ZIP_SOURCE_NOT_FOUND');
  }

  const collected = await collectDirectoryEntries(sourceDirectory);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
    const archive = archiver('zip', { zlib: { level: 4 } });
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { archive.abort(); } catch {}
      output.destroy();
      reject(error);
    };

    output.once('close', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    output.once('error', fail);
    archive.once('error', fail);
    archive.on('warning', (error) => {
      if (error.code !== 'ENOENT') fail(error);
      else fail(zipCreationError('압축 중 원본 파일이 사라졌습니다.', 409, 'ZIP_SOURCE_CHANGED'));
    });
    archive.pipe(output);

    for (const entry of collected.entries) {
      const archivePath = toArchivePath(entry.relativePath);
      if (entry.directory) archive.append('', { name: `${archivePath}/` });
      else archive.file(entry.absolutePath, { name: archivePath });
    }
    archive.finalize().catch(fail);
  });

  const zipStat = await fsp.stat(outputPath);
  return {
    entryCount: collected.entries.length,
    fileCount: collected.fileCount,
    directoryCount: collected.directoryCount,
    sourceBytes: collected.sourceBytes,
    zipBytes: zipStat.size
  };
};

module.exports = {
  createZipFromDirectory,
  collectDirectoryEntries,
  MAX_ENTRY_COUNT
};
