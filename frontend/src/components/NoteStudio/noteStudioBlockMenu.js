export const BLOCK_TRANSFORMS = [
  { id: 'paragraph', label: '본문' },
  { id: 'heading-1', label: '제목 1' },
  { id: 'heading-2', label: '제목 2' },
  { id: 'heading-3', label: '제목 3' },
  { id: 'bullet-list', label: '글머리표 목록' },
  { id: 'ordered-list', label: '번호 목록' },
  { id: 'task-list', label: '할 일 목록' },
  { id: 'quote', label: '인용문' },
  { id: 'code-block', label: '코드 블록' },
];

export const BLOCK_COLORS = [
  { id: 'default', label: '기본', value: null },
  { id: 'gray', label: '회색', value: '#6b7280' },
  { id: 'brown', label: '갈색', value: '#92400e' },
  { id: 'orange', label: '주황', value: '#c2410c' },
  { id: 'yellow', label: '노랑', value: '#a16207' },
  { id: 'green', label: '초록', value: '#15803d' },
  { id: 'blue', label: '파랑', value: '#1d4ed8' },
  { id: 'purple', label: '보라', value: '#7e22ce' },
  { id: 'pink', label: '분홍', value: '#be185d' },
  { id: 'red', label: '빨강', value: '#b91c1c' },
];

export const BLOCK_BACKGROUNDS = [
  { id: 'default', label: '기본 배경', value: null },
  { id: 'gray', label: '회색 배경', value: 'rgba(107, 114, 128, 0.14)' },
  { id: 'brown', label: '갈색 배경', value: 'rgba(146, 64, 14, 0.13)' },
  { id: 'orange', label: '주황 배경', value: 'rgba(234, 88, 12, 0.14)' },
  { id: 'yellow', label: '노랑 배경', value: 'rgba(202, 138, 4, 0.16)' },
  { id: 'green', label: '초록 배경', value: 'rgba(22, 163, 74, 0.14)' },
  { id: 'blue', label: '파랑 배경', value: 'rgba(37, 99, 235, 0.14)' },
  { id: 'purple', label: '보라 배경', value: 'rgba(147, 51, 234, 0.14)' },
  { id: 'pink', label: '분홍 배경', value: 'rgba(219, 39, 119, 0.14)' },
  { id: 'red', label: '빨강 배경', value: 'rgba(220, 38, 38, 0.14)' },
];

export const blockTextStats = (value = '') => {
  const text = String(value || '');
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  return { words, characters: [...text].length };
};

export const findContextBlock = (state) => {
  const $from = state?.selection?.$from;
  if (!$from || $from.depth < 1) return null;
  let depth = 1;
  for (let current = $from.depth; current >= 1; current -= 1) {
    const type = $from.node(current)?.type?.name;
    if (type === 'listItem' || type === 'taskItem') {
      depth = current;
      break;
    }
  }
  const node = $from.node(depth);
  const parent = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  return { depth, node, parent, index, pos: $from.before(depth) };
};
