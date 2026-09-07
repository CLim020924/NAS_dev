/** @jest-environment node */

import { copyTextToClipboard } from './copyTextToClipboard';

test('copies with the modern clipboard API when available', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  await expect(copyTextToClipboard('AI answer', { clipboard: { writeText } })).resolves.toBe(true);
  expect(writeText).toHaveBeenCalledWith('AI answer');
});

test('falls back to a temporary selected textarea when clipboard access is denied', async () => {
  const textarea = {
    value: '',
    style: {},
    setAttribute: jest.fn(),
    focus: jest.fn(),
    select: jest.fn(),
  };
  const body = { appendChild: jest.fn(), removeChild: jest.fn() };
  const document = {
    body,
    createElement: jest.fn(() => textarea),
    execCommand: jest.fn(() => true),
  };
  const clipboard = { writeText: jest.fn().mockRejectedValue(new Error('denied')) };

  await expect(copyTextToClipboard('fallback', { clipboard, document })).resolves.toBe(true);
  expect(textarea.value).toBe('fallback');
  expect(textarea.select).toHaveBeenCalled();
  expect(document.execCommand).toHaveBeenCalledWith('copy');
  expect(body.removeChild).toHaveBeenCalledWith(textarea);
});

test('reports failure when neither clipboard route exists', async () => {
  await expect(copyTextToClipboard('no route', { clipboard: null, document: null })).resolves.toBe(false);
});
