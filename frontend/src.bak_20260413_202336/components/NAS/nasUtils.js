// 경로 맨 앞에 슬래시(/) 보장
export const ensureSlash = (p) => {
  if (!p) return '/';
  const clean = p.replace(/^(\/|\\)+/, '');
  return '/' + clean;
};

// 이름 중복 시 '새 폴더 1', '새 폴더 2' 식으로 이름 생성
export const getUniqueName = (baseName, existingNames) => {
  let name = baseName;
  let counter = 1;
  while (existingNames.includes(name)) {
    name = `${baseName} ${counter}`;
    counter++;
  }
  return name;
};

// 현재 경로를 바탕으로 상단 주소창에 표시할 세그먼트 생성
export const getRelativeSegments = (current, base) => {
  const c = current === '/' ? '/' : ensureSlash(current).replace(/\/$/, '');
  const b = base === '/' ? '/' : ensureSlash(base).replace(/\/$/, '');

  if (b === '/') return c === '/' ? [] : c.split('/').filter(Boolean);
  if (c === b) return [];
  if (c.startsWith(b + '/')) return c.slice(b.length + 1).split('/').filter(Boolean);
  return c.split('/').filter(Boolean);
};
