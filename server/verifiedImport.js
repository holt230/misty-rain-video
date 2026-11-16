const changed = message => Object.assign(new Error(message), { code: 'QUARK_SOURCE_CHANGED', statusCode: 409 });
const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();

export function assertVerifiedImport({ expectedTitle, shareTitle, requiredEpisodes }, episodeNumbers) {
  if (expectedTitle !== undefined && normalize(expectedTitle) !== normalize(shareTitle)) throw changed('片源内容已变化，请重新搜索核对后保存');
  if (requiredEpisodes === undefined) return;
  if (!Array.isArray(requiredEpisodes) || requiredEpisodes.length > 5000 || requiredEpisodes.some(n => !Number.isInteger(n) || n < 1 || n > 5000)) {
    throw Object.assign(new Error('待保存剧集范围不正确'), { code: 'INVALID_EPISODE_REQUIREMENT', statusCode: 400 });
  }
  const available = new Set(episodeNumbers);
  const missing = [...new Set(requiredEpisodes)].filter(number => !available.has(number));
  if (missing.length) throw changed(`片源已变化，第 ${missing.slice(0, 5).join('、')} 集已不可用，请重新搜索。未保存到片库。`);
}
