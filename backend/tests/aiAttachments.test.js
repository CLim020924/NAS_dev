const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareAiAttachments } = require('../aiAttachments');

const file = (name, mime, buffer) => ({ originalname: name, mimetype: mime, buffer, size: buffer.length });

test('PC 이미지와 텍스트는 이번 모델 입력에만 변환하고 이름만 반환한다', () => {
  const jpeg = file('photo.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00]));
  const textFile = file('notes.md', 'text/markdown', Buffer.from('시험 준비', 'utf8'));
  const result = prepareAiAttachments([jpeg, textFile]);
  assert.deepEqual(result.names, ['photo.jpg', 'notes.md']);
  assert.equal(result.content[1].type, 'input_image');
  assert.match(result.content[1].image_url, /^data:image\/jpeg;base64,/);
  assert.match(result.content[2].text, /시험 준비/);
});

test('PDF는 파일 입력으로 변환하며 형식 위장과 과대 첨부는 거절한다', () => {
  const pdf = prepareAiAttachments([file('exam.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n'))]);
  assert.equal(pdf.content[0].type, 'input_file');
  const docx = prepareAiAttachments([file('exam.docx', 'application/octet-stream', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))]);
  assert.equal(docx.content[0].type, 'input_file');
  assert.throws(() => prepareAiAttachments([file('fake.jpg', 'image/jpeg', Buffer.from('not an image'))]), { status: 415 });
  assert.throws(() => prepareAiAttachments([file('large.txt', 'text/plain', Buffer.alloc(321 * 1024, 65))]), { status: 413 });
  assert.throws(() => prepareAiAttachments([file('secret.bin', 'application/octet-stream', Buffer.from('x'))]), { status: 415 });
});
