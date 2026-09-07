const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyCodeExecutionError } = require('../codeExecutionErrors');

test('Python NameError for console explains the correct output function', () => {
  const error = { code: 'PYTHON_EXECUTION_FAILED', result: { stderr: "NameError: name 'console' is not defined\n" } };
  assert.deepEqual(classifyCodeExecutionError({ language: 'python', error }), {
    category: 'undefined-name', errorType: 'NameError', userMessage: 'Python에서는 console.log(...) 대신 print(...)를 사용해 주세요.'
  });
});

test('JavaScript ReferenceError for print explains console.log', () => {
  const error = { code: 'JAVASCRIPT_EXECUTION_FAILED', result: { stderr: 'ReferenceError: print is not defined\n' } };
  assert.deepEqual(classifyCodeExecutionError({ language: 'javascript', error }), {
    category: 'undefined-name', errorType: 'ReferenceError', userMessage: 'JavaScript에서는 print(...) 대신 console.log(...)를 사용해 주세요.'
  });
});

test('syntax, missing modules, and runtime faults are not labeled as server outages', () => {
  assert.equal(classifyCodeExecutionError({ language: 'javascript', error: { result: { stderr: 'SyntaxError: Unexpected token' } } }).category, 'syntax');
  assert.equal(classifyCodeExecutionError({ language: 'python', error: { result: { stderr: "ModuleNotFoundError: No module named 'x'" } } }).category, 'missing-module');
  assert.match(classifyCodeExecutionError({ language: 'javascript', error: { result: { stderr: 'TypeError: bad value' } } }).userMessage, /서버 연결 문제는 아니며/);
});
