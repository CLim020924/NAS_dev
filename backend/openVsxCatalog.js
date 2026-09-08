const axios = require('axios');

const OPEN_VSX_ORIGIN = 'https://open-vsx.org';
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RESULTS = 20;
const EXTENSION_ID = /^[a-z0-9][a-z0-9-]{0,99}\.[a-z0-9][a-z0-9-]{0,99}$/i;

const normalizeExtensionId = (value) => {
  const id = String(value || '').trim().toLowerCase();
  if (!EXTENSION_ID.test(id)) throw Object.assign(new Error('확장 ID 형식이 올바르지 않습니다.'), { status: 400, code: 'INVALID_EXTENSION_ID' });
  return id;
};

const normalizeQuery = (value) => {
  const query = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (query.length < 2) throw Object.assign(new Error('검색어를 두 글자 이상 입력해 주세요.'), { status: 400, code: 'INVALID_EXTENSION_QUERY' });
  return query;
};

const safeExternalUrl = (value) => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch { return ''; }
};

const normalizeSearchItem = (item = {}) => ({
  id: normalizeExtensionId(`${item.namespace || ''}.${item.name || ''}`),
  namespace: String(item.namespace || '').slice(0, 100),
  name: String(item.name || '').slice(0, 100),
  displayName: String(item.displayName || item.name || '').slice(0, 160),
  description: String(item.description || '').slice(0, 600),
  version: String(item.version || '').slice(0, 80),
  verified: item.verified === true,
  deprecated: item.deprecated === true,
  downloadCount: Number.isFinite(Number(item.downloadCount)) ? Number(item.downloadCount) : 0,
  averageRating: Number.isFinite(Number(item.averageRating)) ? Number(item.averageRating) : null,
  iconUrl: safeExternalUrl(item.files?.icon),
  registryUrl: `${OPEN_VSX_ORIGIN}/extension/${encodeURIComponent(item.namespace || '')}/${encodeURIComponent(item.name || '')}`,
});

const normalizeDetail = (item = {}) => {
  const base = normalizeSearchItem(item);
  const extensionKind = Array.isArray(item.extensionKind) ? item.extensionKind.filter((value) => ['ui', 'workspace', 'web'].includes(value)) : [];
  const tags = Array.isArray(item.tags) ? item.tags.map(String).slice(0, 40) : [];
  const categories = Array.isArray(item.categories) ? item.categories.map(String).slice(0, 20) : [];
  const webCompatible = extensionKind.includes('web') || tags.includes('__web_extension');
  return {
    ...base,
    extensionKind,
    categories,
    tags,
    license: String(item.license || '').slice(0, 120),
    repositoryUrl: safeExternalUrl(String(item.repository || '').replace(/\.git$/i, '')),
    homepageUrl: safeExternalUrl(item.homepage),
    vscodeEngine: String(item.engines?.vscode || '').slice(0, 80),
    webCompatible,
    nasCompatibility: webCompatible ? 'adapter-required' : 'vscode-only',
  };
};

const createOpenVsxCatalog = ({ http = axios, now = () => Date.now() } = {}) => {
  const cache = new Map();
  const request = async (url, params) => {
    const response = await http.get(url, {
      params,
      timeout: 8000,
      maxContentLength: 1024 * 1024,
      responseType: 'json',
      headers: { Accept: 'application/json', 'User-Agent': 'NAS-Note-Studio/1.0' },
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return response.data;
  };

  const search = async (rawQuery, rawSize) => {
    const query = normalizeQuery(rawQuery);
    const size = Math.max(1, Math.min(MAX_RESULTS, Number.parseInt(rawSize, 10) || 12));
    const key = `${query.toLocaleLowerCase('en-US')}:${size}`;
    const cached = cache.get(key);
    if (cached && now() - cached.at < SEARCH_CACHE_TTL_MS) return { ...cached.value, cached: true };
    try {
      const data = await request(`${OPEN_VSX_ORIGIN}/api/-/search`, { query, size });
      const value = {
        provider: 'open-vsx', query,
        total: Math.max(0, Number(data?.totalSize) || 0),
        extensions: (Array.isArray(data?.extensions) ? data.extensions : []).slice(0, size).map(normalizeSearchItem),
        cached: false,
      };
      cache.set(key, { at: now(), value });
      return value;
    } catch (error) {
      throw Object.assign(new Error('Open VSX 확장 검색 서비스에 연결하지 못했습니다.'), { status: 502, code: 'OPEN_VSX_UNAVAILABLE', cause: error });
    }
  };

  const detail = async (rawId) => {
    const id = normalizeExtensionId(rawId);
    const [namespace, name] = id.split('.');
    try {
      const data = await request(`${OPEN_VSX_ORIGIN}/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/latest`);
      return normalizeDetail(data);
    } catch (error) {
      throw Object.assign(new Error('확장 상세 정보를 불러오지 못했습니다.'), { status: error.response?.status === 404 ? 404 : 502, code: 'OPEN_VSX_DETAIL_UNAVAILABLE', cause: error });
    }
  };

  return { search, detail };
};

module.exports = { OPEN_VSX_ORIGIN, MAX_RESULTS, createOpenVsxCatalog, normalizeExtensionId, normalizeQuery, _test: { normalizeSearchItem, normalizeDetail } };
