export const CATALOG_GENRES = ['剧情','喜剧','爱情','动作','科幻','动画','悬疑','犯罪','惊悚','冒险','音乐','历史','奇幻','恐怖','战争','传记','歌舞','武侠','古装','家庭','灾难','西部','纪录片','短片','运动','儿童','真人秀','脱口秀'];
export const CATALOG_COUNTRIES = ['中国大陆','中国香港','中国台湾','美国','日本','韩国','英国','法国','德国','意大利','西班牙','印度','泰国','俄罗斯','加拿大','澳大利亚','爱尔兰','瑞典','巴西','丹麦','新西兰','挪威','芬兰','荷兰','比利时','瑞士','奥地利','波兰','捷克','伊朗','土耳其','墨西哥','阿根廷','新加坡','马来西亚','印度尼西亚','菲律宾','越南','南非','苏联'];
const countryAliases = { '大陆':'中国大陆','香港':'中国香港','台湾':'中国台湾','中国':'中国大陆','西德':'德国','东德':'德国' };
const tokens = value => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,，/]+/) : []).filter(value => typeof value === 'string');
const known = (values, allowed) => [...new Set(values.filter(value => allowed.includes(value)))];

export function catalogFacets(item) {
  const parts = String(item.card_subtitle || item.description || '').split(/\s*\/\s*/);
  if (/^(?:18|19|20)\d{2}(?:\b|$)/.test(parts[0])) parts.shift();
  const countries = tokens(item.countries?.length ? item.countries : parts[0]).map(value => countryAliases[value] || value);
  const genres = tokens(item.genres?.length ? item.genres : parts[1]);
  return { countries: known(countries, CATALOG_COUNTRIES), genres: known(genres, CATALOG_GENRES) };
}

export function catalogYears(now = new Date().getFullYear()) {
  return [...Array.from({ length: 8 }, (_, index) => String(now - index)), '2020年代','2010年代','2000年代','90年代','80年代','70年代','60年代','更早'];
}
export const hasCatalogFilters = filters => Boolean(filters.genre || filters.country || filters.year);
