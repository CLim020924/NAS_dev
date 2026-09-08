import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import CodeRunPanel from './CodeRunPanel';

test('sends standard input from the docked run console', () => {
  const onInput = jest.fn();
  render(<CodeRunPanel session={{ state: 'running', displayName: 'Python', noteTitle: '입력 예제' }} events={[{ sequence: 1, stream: 'stdout', text: '값: ' }]} onInput={onInput} />);
  const input = screen.getByLabelText('실행 중인 프로그램에 표준 입력');
  fireEvent.change(input, { target: { value: '177' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onInput).toHaveBeenCalledWith('177');
  expect(screen.getByText('값:')).toBeInTheDocument();
});

test('keeps completed output selectable and disables further input', () => {
  render(<CodeRunPanel session={{ state: 'finished', displayName: 'JavaScript', noteTitle: '완료 예제', exitCode: 0 }} events={[{ sequence: 1, stream: 'stdout', text: '완료' }]} />);
  expect(screen.getByText('완료')).toBeInTheDocument();
  expect(screen.getByLabelText('실행 중인 프로그램에 표준 입력')).toBeDisabled();
  expect(screen.getByText(/프로그램 종료/)).toBeInTheDocument();
});
