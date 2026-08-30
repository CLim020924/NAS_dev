import {
  buildMultipartUploadHeaders,
  isCanceledUploadError,
  isTransientUploadError
} from './uploadRequestPolicy';

describe('uploadRequestPolicy', () => {
  test('브라우저가 multipart boundary를 만들도록 Content-Type을 직접 지정하지 않는다', () => {
    expect(buildMultipartUploadHeaders({ 'x-upload-session': 'session-1' })).toEqual({
      'x-upload-session': 'session-1'
    });
  });

  test('UPLOAD_CANCELED 응답만 409 취소로 분류한다', () => {
    expect(isCanceledUploadError({ response: { status: 409, data: { error: 'UPLOAD_CANCELED' } } })).toBe(true);
    expect(isCanceledUploadError({ response: { status: 409, data: { error: '같은 이름의 폴더가 이미 있습니다.' } } })).toBe(false);
  });

  test('응답 없는 네트워크 오류와 일시 HTTP 오류만 재연결 대상으로 분류한다', () => {
    expect(isTransientUploadError({ message: 'Network Error' })).toBe(true);
    expect(isTransientUploadError({ response: { status: 503 } })).toBe(true);
    expect(isTransientUploadError({ response: { status: 409, data: { error: 'conflict' } } })).toBe(false);
    expect(isTransientUploadError({ response: { status: 401 } })).toBe(false);
  });
});
