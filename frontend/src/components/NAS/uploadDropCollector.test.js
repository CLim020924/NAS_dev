import { collectDroppedUploadItems } from './uploadDropCollector';

const makeFile = (name, size, lastModified) => ({ name, size, lastModified, webkitRelativePath: '' });

test('captures all DataTransfer entries before asynchronous scanning', async () => {
  let handlesReadable = true;
  const files = [makeFile('a.txt', 1, 1), makeFile('b.txt', 2, 2), makeFile('c.txt', 3, 3)];
  const entries = files.map(file => ({
    isFile: true,
    isDirectory: false,
    name: file.name,
    file(resolve) {
      Promise.resolve().then(() => {
        handlesReadable = false;
        resolve(file);
      });
    }
  }));
  const items = entries.map(entry => ({
    webkitGetAsEntry: () => (handlesReadable ? entry : null)
  }));

  const result = await collectDroppedUploadItems({ items, files });

  expect(result.map(item => item.file.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);
});

test('keeps all eleven files from one Windows Explorer drag operation', async () => {
  let dataStoreOpen = true;
  const files = Array.from({ length: 11 }, (_, index) => makeFile(`drag-${index + 1}.txt`, index + 1, 100 + index));
  const items = files.map(file => ({
    webkitGetAsEntry: () => dataStoreOpen ? ({
      isFile: true,
      isDirectory: false,
      name: file.name,
      file(resolve) {
        Promise.resolve().then(() => {
          dataStoreOpen = false;
          resolve(file);
        });
      }
    }) : null
  }));

  const result = await collectDroppedUploadItems({ items, files });

  expect(result).toHaveLength(11);
  expect(result.map(item => item.file.name)).toEqual(files.map(file => file.name));
});

test('uses DataTransfer.files to recover a failed plain-file entry', async () => {
  const first = makeFile('a.txt', 1, 1);
  const second = makeFile('b.txt', 2, 2);
  const result = await collectDroppedUploadItems({
    items: [
      { webkitGetAsEntry: () => ({ isFile: true, isDirectory: false, name: first.name, file: resolve => resolve(first) }) },
      { webkitGetAsEntry: () => ({ isFile: true, isDirectory: false, name: second.name, file: (resolve, reject) => reject(new Error('read failed')) }) }
    ],
    files: [first, second]
  });

  expect(result.map(item => item.file.name)).toEqual(['a.txt', 'b.txt']);
});
