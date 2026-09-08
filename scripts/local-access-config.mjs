import path from 'node:path';
import { normalizeBasePath } from '../server/basePath.js';

export const localAccessConfig = (env, runtime) => {
  const mode = env.CLOUDFLARE_TUNNEL_MODE || 'quick';
  if (!['quick', 'named'].includes(mode)) throw new Error('CLOUDFLARE_TUNNEL_MODE 只能为 quick 或 named');
  let basePath = normalizeBasePath(env.APP_BASE_PATH);
  let publicUrl = '';
  const args = ['tunnel', '--no-autoupdate', '--protocol', 'http2'];
  let tokenFile;
  if (mode === 'named') {
    const url = new URL(env.APP_PUBLIC_URL || '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('固定隧道需要不带账号、查询或片段的 HTTPS APP_PUBLIC_URL');
    }
    const publicBase = normalizeBasePath(url.pathname);
    if (env.APP_BASE_PATH && basePath !== publicBase) throw new Error('APP_BASE_PATH 与 APP_PUBLIC_URL 路径不一致');
    basePath = publicBase;
    publicUrl = `${url.origin}${basePath}/`;
    tokenFile = path.join(runtime, 'tunnel-token.txt');
    args.push('run', '--token-file', tokenFile);
  }
  return { mode, basePath, publicUrl, tokenFile, args };
};
