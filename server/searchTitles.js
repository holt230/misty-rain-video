export const searchTitleKey = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}\p{Cf}]+/gu, '');

const romanNumerals = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];
// Limit numeral conversion to a sequel marker after Han text, away from Latin words and years.
const sequelMarker = /(?<=\p{Script=Han})[\s\p{P}]*([1-9]|1\d|20|[ivx]{1,5})(?=[\s\p{P}]*(?:(?![集话期季部])\p{Script=Han}|$))/iu;

const digits = '零一二三四五六七八九';
export function seasonQuery(title) {
  const match = String(title || '').normalize('NFKC').trim().match(/^(.{2,}?)\s*第\s*(\d{1,2}|[一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九])\s*季$/u);
  if (!match) return undefined;
  const [tens, ones] = match[2].split('十');
  const number = /^\d+$/.test(match[2]) ? Number(match[2]) : ones === undefined ? digits.indexOf(tens)
    : (tens ? digits.indexOf(tens) : 1) * 10 + (ones ? digits.indexOf(ones) : 0);
  if (number < 1 || number > 99) return undefined;
  const han = number < 10 ? digits[number] : (number < 20 ? '' : digits[Math.floor(number / 10)]) + '十' + (number % 10 ? digits[number % 10] : '');
  return { base: match[1].trim(), number, han };
}

// Compare edition names without weakening the distinction between an original and its numbered season.
export function sameWorkEdition(left, right) {
  const a = workTitleKeys(left), b = workTitleKeys(right);
  return Boolean(a[0] && a.some(key => b.includes(key)));
}

export function workTitleKeys(title) {
  const text = String(title || '').normalize('NFKC');
  const key = searchTitleKey(text);
  const season = seasonQuery(title);
  if (season) return [...new Set([key, ...[`${season.base}第${season.number}季`, `${season.base}第${season.han}季`, `${season.base}${season.number}`].map(searchTitleKey)])];
  const number = text.match(sequelMarker)?.[1].toLowerCase();
  if (!number) return [key];
  const alternate = /^\d+$/.test(number) ? romanNumerals[Number(number)] : String(romanNumerals.indexOf(number));
  return alternate && alternate !== '-1' ? [key, searchTitleKey(text.replace(sequelMarker, alternate))] : [key];
}

export function hasConflictingOfficialEditions(works) {
  // 央视频 may carry a TV cut with different numbering from a streaming release.
  const comparable = works.some(work => work.platform === '央视频') ? works : works.filter(work => work.completed);
  return new Set(comparable.map(work => work.latestEpisode)).size > 1;
}

/** Source work titles, unlike full-text descriptions, must name the submitted work. */
export function isExactWorkTitle(keyword, title) {
  const wanted = searchTitleKey(keyword);
  const actual = searchTitleKey(title);
  if (!wanted || !actual) return false;
  return sameWorkEdition(keyword, title) || workTitleKeys(keyword).some(key => actual.startsWith(key)
    && /^(?:年番|第[\d一二三四五六七八九十百]+季|s\d+|国语版|粤语版|日语版|英语版)+$/i.test(actual.slice(key.length)));
}
