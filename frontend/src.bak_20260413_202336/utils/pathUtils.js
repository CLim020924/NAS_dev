export const ensureSlash = (p) => {
  if (!p) return '/';
  const clean = p.replace(/^(\/|\\)+/, '');
  return '/' + clean;
};

export const getRelativeSegments = (current, base) => {
  const c = current === '/' ? '/' : ensureSlash(current).replace(/\/$/, '');
  const b = base === '/' ? '/' : ensureSlash(base).replace(/\/$/, '');

  if (b === '/') return c === '/' ? [] : c.split('/').filter(Boolean);
  if (c === b) return [];
  if (c.startsWith(b + '/')) return c.slice(b.length + 1).split('/').filter(Boolean);
  return c.split('/').filter(Boolean);
};
