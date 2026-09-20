const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { whenSuccessfulResponseFinishes } = require('../shareDownloadCompletion');

test('only a completed successful response counts as a share download', () => {
  for (const [status, eventName, expected] of [
    [200, 'finish', 1],
    [206, 'finish', 1],
    [404, 'finish', 0],
    [500, 'finish', 0],
    [200, 'close', 0]
  ]) {
    const response = new EventEmitter();
    response.statusCode = status;
    let count = 0;
    whenSuccessfulResponseFinishes(response, () => { count += 1; });
    response.emit(eventName);
    assert.equal(count, expected, `${status} ${eventName}`);
  }
});
