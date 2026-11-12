const normalizeStaticPath = (filePath) => String(filePath || '').replace(/\\/g, '/');

const isImmutableFrontendAsset = (filePath) => {
  const normalizedPath = normalizeStaticPath(filePath);
  return /\/static\/(?:js|css|media)\/[^/]+\.[a-f0-9]{8,}\.[^/]+$/i.test(normalizedPath);
};

module.exports = {
  isImmutableFrontendAsset,
  normalizeStaticPath,
};
