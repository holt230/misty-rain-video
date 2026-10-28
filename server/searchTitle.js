const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN')
  .replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
const compact = value => value.replace(/[\s\p{P}\p{S}]+/gu, '');
const digits = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const number = value => {
  if (/^\d+$/.test(value)) return Number(value);
  if (value.includes('十')) { const [tens, ones] = value.split('十'); return (digits[tens] || 1) * 10 + (digits[ones] || 0); }
  return digits[value] || 0;
};
const seasonPattern = /第\s*([\d一二两三四五六七八九十]{1,3})\s*季|(?:season\s*|(?<![a-z])s)0*(\d{1,2})(?=$|[^a-z0-9]|e\d)/giu;
const parse = value => {
  const raw = normalize(value), seasons = [];
  const base = raw.replace(seasonPattern, (_, chinese, arabic) => { const season = number(chinese || arabic); if (season) seasons.push(season); return ' '; });
  return { raw, base, key: compact(base), seasons };
};

/** One bounded provider query. Season spelling and title punctuation belong in
 * local relevance matching, not in a fan-out of upstream retries. */
export function resourceSearchKeyword(value) {
  const { base } = parse(value);
  return base.replace(/[\p{P}\p{S}]+/gu, ' ').replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '')
    .replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Discovery may be fuzzy; automatic replacement still uses libraryPolicy's
 * strict work/season/file identity checks. Explicitly different seasons never
 * become candidates for a season-specific interactive query either. */
export function resourceTitleRelevance(query, title) {
  const expected = parse(query), actual = parse(title);
  if (!expected.key || !actual.key || expected.key.length < 2) return 0;
  if (expected.seasons.length && actual.seasons.length && !expected.seasons.some(season => actual.seasons.includes(season))) return 0;
  const seasonBonus = expected.seasons.length && actual.seasons.length ? 5 : 0;
  if (expected.key === actual.key) return 120 + seasonBonus;
  const index = actual.key.indexOf(expected.key);
  if (index >= 0) {
    // Short names remain useful prefixes, but two characters buried inside an
    // unrelated title (仙逆 / 剑仙逆世) are not meaningful fuzzy matches.
    const characters = [...expected.key];
    const pattern = characters.map(character => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\p{P}\\p{S}]*');
    const atBoundary = new RegExp(`(?:^|[^\\p{L}])${pattern}`, 'iu').test(actual.base);
    const atEnd = new RegExp(`${pattern}(?=$|[^\\p{L}])`, 'iu').test(actual.base);
    if (characters.length < 3 && !atBoundary && !atEnd) return 0;
    if (/^[a-z\d]+$/i.test(expected.key) && (!atBoundary || !atEnd)) return 0;
    return (atBoundary ? 100 : 75) + seasonBonus;
  }
  // Multiple meaningful fragments may be separated by edition text or entered
  // in a different order. Single-character fragments are deliberately excluded.
  const parts = expected.base.split(/[\s\p{P}\p{S}]+/u).filter(Boolean);
  if (parts.length > 1 && parts.every(part => [...part].length >= 2 && actual.key.includes(compact(part)))) return 65 + seasonBonus;
  return 0;
}
