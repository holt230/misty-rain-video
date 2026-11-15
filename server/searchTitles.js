export const searchTitleKey = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}\p{Cf}]+/gu, '');

/** Source work titles, unlike full-text descriptions, must name the submitted work. */
export function isExactWorkTitle(keyword, title) {
  const wanted = searchTitleKey(keyword);
  const actual = searchTitleKey(title);
  if (!wanted || !actual) return false;
  if (actual === wanted) return true;
  if (!actual.startsWith(wanted)) return false;
  const suffix = actual.slice(wanted.length);
  return /^(?:年番|第[\d一二三四五六七八九十百]+季|s\d+|国语版|粤语版|日语版|英语版)+$/i.test(suffix);
}
