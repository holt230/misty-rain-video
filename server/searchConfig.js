const OLD_SHIPPED_URLS = ['http://127.0.0.1:8888/api/search', 'https://so.252035.xyz/api/search'];

/** undefined selects the fixed parallel sources; [] is an invalid explicit configuration. */
export function configuredSearchUrls(value = process.env.RESOURCE_SEARCH_URLS) {
  const values = [...new Set(String(value || '').split(',').map(item => item.trim().replace(/\/$/, '')).filter(Boolean))];
  if (!values.length || (values.length === OLD_SHIPPED_URLS.length && OLD_SHIPPED_URLS.every(item => values.includes(item)))) return undefined;
  return values.filter(value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } });
}

export function needsBundledSearch(urls = configuredSearchUrls()) {
  return (urls || []).some(value => {
    try { const url = new URL(value); return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.port === '8888'; }
    catch { return false; }
  });
}
