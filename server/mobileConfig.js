import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Bump this value whenever the installed Web Clip launch contract changes.
const WEB_CLIP_RELEASE = '20260812.1';

const escapeXml = value => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const deterministicUuid = seed => {
  const hex = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32).toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const publicAppUrl = request => {
  const configured = String(process.env.APP_PUBLIC_URL || '').trim();
  if (configured) return `${configured.replace(/\/+$/, '')}/`;
  const protocol = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (request.socket?.encrypted ? 'https' : 'http');
  const host = String(request.headers['x-forwarded-host'] || request.headers.host || 'localhost').split(',')[0].trim();
  const prefix = String(request.headers['x-forwarded-prefix'] || '').split(',')[0].trim().replace(/\/+$/, '');
  return `${protocol}://${host}${prefix}/`;
};

const readIcon = distDir => {
  for (const fileName of ['apple-touch-icon.png', 'logo.png']) {
    const filePath = path.resolve(distDir, fileName);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath).toString('base64');
  }
  return '';
};

const currentAppRelease = distDir => {
  const indexPath = path.resolve(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) return WEB_CLIP_RELEASE;
  return crypto.createHash('sha256').update(fs.readFileSync(indexPath)).digest('hex').slice(0, 12);
};

const webClipProfileUrl = appUrl => {
  const launchUrl = new URL('launch/ios', appUrl);
  launchUrl.searchParams.set('v', WEB_CLIP_RELEASE);
  return launchUrl.toString();
};

const webClipAppUrl = (appUrl, distDir) => {
  const targetUrl = new URL(appUrl);
  targetUrl.searchParams.set('webclip', '1');
  targetUrl.searchParams.set('v', currentAppRelease(distDir));
  return targetUrl.toString();
};

const profileIdentifier = () => {
  const configured = String(process.env.APP_PROFILE_IDENTIFIER || '').trim();
  const sanitized = configured.replace(/[^a-zA-Z0-9.-]/g, '').replace(/\.{2,}/g, '.').replace(/^\.|\.$/g, '');
  return sanitized || 'com.mistyrain.video';
};

const createProfile = (appUrl, iconBase64) => {
  const label = String(process.env.APP_DISPLAY_NAME || '烟雨影视').trim() || '烟雨影视';
  const identifier = profileIdentifier();
  const launchUrl = webClipProfileUrl(appUrl);
  const profileUuid = deterministicUuid(`misty-rain-profile:${launchUrl}`);
  const webClipUuid = deterministicUuid(`misty-rain-webclip:${launchUrl}`);
  const iconEntry = iconBase64 ? `<key>Icon</key><data>${iconBase64}</data>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key><true/>
      ${iconEntry}
      <key>IgnoreManifestScope</key><true/>
      <key>IsRemovable</key><true/>
      <key>Label</key><string>${escapeXml(label)}</string>
      <key>PayloadDescription</key><string>从主屏幕全屏打开${escapeXml(label)}（${WEB_CLIP_RELEASE}）</string>
      <key>PayloadDisplayName</key><string>${escapeXml(label)}</string>
      <key>PayloadIdentifier</key><string>${identifier}.webclip</string>
      <key>PayloadType</key><string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key><string>${webClipUuid}</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>Precomposed</key><true/>
      <key>URL</key><string>${escapeXml(launchUrl)}</string>
    </dict>
  </array>
  <key>PayloadDescription</key><string>安装${escapeXml(label)}桌面应用入口</string>
  <key>PayloadDisplayName</key><string>${escapeXml(label)}</string>
  <key>PayloadIdentifier</key><string>${identifier}.profile</string>
  <key>PayloadOrganization</key><string>${escapeXml(label)}</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${profileUuid}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>`;
};

export const handleMobileConfigRequest = (request, response, { distDir }) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/launch/ios') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      response.end();
      return true;
    }
    response.statusCode = 302;
    response.setHeader('Location', webClipAppUrl(publicAppUrl(request), distDir));
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
    response.end();
    return true;
  }
  if (url.pathname !== '/install/ios.mobileconfig') return false;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD');
    response.end();
    return true;
  }
  const body = createProfile(publicAppUrl(request), readIcon(distDir));
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/x-apple-aspen-config');
  response.setHeader('Content-Disposition', 'attachment; filename="misty-rain.mobileconfig"');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  if (request.method === 'HEAD') response.end();
  else response.end(body);
  return true;
};
