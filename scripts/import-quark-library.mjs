import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibraryConfigStore, MediaRepository, PlaybackCacheRepository, QuarkCredentialStore } from '../server/storage.js';
import { QuarkGateway, QUARK_LIBRARY_FOLDERS } from '../server/quarkGateway.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.resolve(projectRoot, 'data');
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const index = value.indexOf('=');
  return index > 0 ? [value.slice(2, index), value.slice(index + 1)] : [value.replace(/^--/, ''), 'true'];
}));
const cards = JSON.parse(fs.readFileSync(path.resolve(dataDir, 'media_cards.json'), 'utf8') || '[]');
const sourceCard = args['from-card'] ? cards.find(item => item.title === args['from-card']) : null;
const shareUrl = args['share-url'] || sourceCard?.quarkShareUrl || '';
const title = args.title || sourceCard?.title || '';
const user = {
  username: args.user || 'admin',
  folder: args['user-folder'] || args.user || 'admin',
  role: 'admin'
};

if (!shareUrl || !title || !QUARK_LIBRARY_FOLDERS[args.category]) {
  console.error('用法: node scripts/import-quark-library.mjs --from-card=片名 --category=anime，或传入 --share-url 与 --title');
  process.exitCode = 1;
} else {
  const credentialStore = new QuarkCredentialStore(dataDir);
  const gateway = new QuarkGateway({
    credentialStore,
    playbackCache: new PlaybackCacheRepository(dataDir),
    libraryConfigStore: new LibraryConfigStore(dataDir)
  });
  const result = await gateway.importShare({
    shareUrl,
    title,
    category: args.category,
    passcode: args.passcode || ''
  }, user);
  const userDataDir = path.resolve(dataDir, 'users', user.folder);
  new MediaRepository(userDataDir, { legacyFilePath: path.resolve(dataDir, 'media_cards.json') }).save({
    ...(sourceCard || {}),
    ...result.item,
    category: args.category,
    poster: sourceCard?.poster || result.item.poster
  });
  console.log(JSON.stringify({
    ok: true,
    title: result.item.title,
    category: result.item.category,
    transferredCount: result.transferredCount,
    reusedCount: result.reusedCount
  }, null, 2));
}
