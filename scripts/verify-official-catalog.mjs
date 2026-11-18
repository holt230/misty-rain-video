import { OfficialCatalogProviders } from '../server/officialCatalogProviders.js';
import { PLATFORM_NAMES } from '../server/officialCatalogData.js';

const providers = new OfficialCatalogProviders();
const selected = process.argv.find(value => value.startsWith('--channel='))?.slice(10);
const channels = selected ? [selected] : ['tv', 'movie', 'anime', 'variety'];
if (channels.some(channel => !['tv', 'movie', 'anime', 'variety'].includes(channel))) throw new Error('无效的频道');
let failures = 0;
for (const platform of Object.keys(PLATFORM_NAMES)) for (const channel of channels) {
  const started = Date.now();
  try {
    const rows = await providers.fetch(platform, channel);
    const result = { platform, channel, count: rows.length, durationMs: Date.now() - started,
      sample: rows.slice(0, 2).map(row => ({ title: row.title, year: row.year, poster: Boolean(row.posterUrl), backdrop: Boolean(row.backdropUrl) })) };
    if (process.argv.includes('--metadata') && channel === 'tv' && rows[0]) {
      const first = rows[0];
      try { result.metadata = await providers.metadata({ ...first, platforms: [{ id: platform, name: PLATFORM_NAMES[platform], providerId: first.providerId, videoId: first.videoId, url: first.sourceUrl }] }); }
      catch (error) { result.metadataError = error.message; }
    }
    console.log(JSON.stringify(result));
  } catch (error) {
    failures++; console.log(JSON.stringify({ platform, channel, status: 'unavailable', message: error.message, durationMs: Date.now() - started }));
  }
}
process.exitCode = failures ? 1 : 0;
