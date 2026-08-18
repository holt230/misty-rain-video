import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const COOKIE_NAME = 'misty_rain_session';
const DEFAULT_SESSION_DAYS = 30;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_USERS = [{ username: 'admin', password: '666666', role: 'admin', folder: 'admin' }];

const ensureDirectory = directory => fs.mkdirSync(directory, { recursive: true });

const authError = (message = '登录状态已失效，请重新登录', statusCode = 401, code = 'APP_AUTH_REQUIRED') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const parseUsers = value => {
  let parsed = DEFAULT_USERS;
  if (String(value || '').trim()) {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('APP_USERS_JSON 不是有效的 JSON 数组');
    }
  }
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('APP_USERS_JSON 至少需要配置一个用户');

  const usernames = new Set();
  const folders = new Set();
  return parsed.map((item, index) => {
    const username = String(item?.username || '').trim();
    const password = String(item?.password || '');
    const folder = String(item?.folder || username).trim();
    const role = item?.role === 'admin' ? 'admin' : 'user';
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) {
      throw new Error(`APP_USERS_JSON 第 ${index + 1} 个用户名无效，只允许字母、数字、点、横线和下划线`);
    }
    if (!folder || folder.length > 80 || /[\\/:*?"<>|]/.test(folder) || folder === '.' || folder === '..') {
      throw new Error(`APP_USERS_JSON 第 ${index + 1} 个网盘目录名无效`);
    }
    if (!password) throw new Error(`APP_USERS_JSON 用户 ${username} 缺少密码`);
    if (usernames.has(username)) throw new Error(`APP_USERS_JSON 用户名重复：${username}`);
    if (folders.has(folder)) throw new Error(`APP_USERS_JSON 网盘目录重复：${folder}`);
    usernames.add(username);
    folders.add(folder);
    return { username, password, folder, role };
  });
};

const parseCookies = header => Object.fromEntries(String(header || '').split(';').map(part => {
  const index = part.indexOf('=');
  if (index < 0) return ['', ''];
  return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
}).filter(([name]) => name));

const timingSafeEqual = (left, right) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const requestIp = request => String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || '')
  .split(',')[0]
  .trim()
  .slice(0, 120);

const publicOrigin = request => {
  const protocol = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (request.socket?.encrypted ? 'https' : 'http');
  const host = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
  return host ? `${protocol}://${host}` : '';
};

const cookiePath = request => {
  const prefix = String(request.headers['x-forwarded-prefix'] || '').split(',')[0].trim();
  if (!prefix || prefix === '/' || !/^\/[a-zA-Z0-9._~/-]+$/.test(prefix) || prefix.includes('..')) return '/';
  return `${prefix.replace(/\/+$/, '')}/`;
};

export class AuthService {
  constructor(dataDir) {
    ensureDirectory(dataDir);
    this.keyPath = path.resolve(dataDir, '.auth_key');
    this.key = this.#loadKey();
    this.sessionDays = Math.min(365, Math.max(1, Number(process.env.AUTH_SESSION_DAYS) || DEFAULT_SESSION_DAYS));
    this.users = parseUsers(process.env.APP_USERS_JSON).map(item => {
      const salt = crypto.createHmac('sha256', this.key).update(`password:${item.username}`).digest();
      const passwordHash = crypto.scryptSync(item.password, salt, 32);
      const version = crypto.createHmac('sha256', this.key)
        .update(`${item.username}\0${item.folder}\0${item.role}\0`)
        .update(passwordHash)
        .digest('base64url')
        .slice(0, 22);
      return { username: item.username, folder: item.folder, role: item.role, passwordHash, salt, version };
    });
    this.userMap = new Map(this.users.map(user => [user.username, user]));
    this.failures = new Map();
  }

  publicUser(user) {
    return user ? { username: user.username, folder: user.folder, role: user.role } : null;
  }

  assertSameOrigin(request) {
    const origin = String(request.headers.origin || '').trim();
    if (!origin) return;
    if (origin !== publicOrigin(request)) throw authError('请求来源无效', 403, 'INVALID_REQUEST_ORIGIN');
  }

  login(request, username, password) {
    const normalizedUsername = String(username || '').trim();
    const failureKey = `${requestIp(request)}:${normalizedUsername.toLowerCase()}`;
    const current = this.failures.get(failureKey);
    if (current?.blockedUntil > Date.now()) {
      const seconds = Math.max(1, Math.ceil((current.blockedUntil - Date.now()) / 1000));
      const error = authError(`尝试次数过多，请在 ${seconds} 秒后重试`, 429, 'LOGIN_RATE_LIMITED');
      error.retryAfter = seconds;
      throw error;
    }

    const user = this.userMap.get(normalizedUsername);
    const salt = user?.salt || crypto.createHmac('sha256', this.key).update(`password:${normalizedUsername}`).digest();
    const candidate = crypto.scryptSync(String(password || ''), salt, 32);
    const valid = Boolean(user && timingSafeEqual(candidate, user.passwordHash));
    if (!valid) {
      const recent = current && Date.now() - current.firstAt < LOGIN_WINDOW_MS
        ? current
        : { count: 0, firstAt: Date.now(), blockedUntil: 0 };
      recent.count += 1;
      if (recent.count >= MAX_LOGIN_FAILURES) recent.blockedUntil = Date.now() + LOGIN_WINDOW_MS;
      this.failures.set(failureKey, recent);
      throw authError('账号或密码错误', 401, 'LOGIN_FAILED');
    }

    this.failures.delete(failureKey);
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
      u: user.username,
      v: user.version,
      iat: now,
      exp: now + this.sessionDays * 24 * 60 * 60,
      n: crypto.randomBytes(9).toString('base64url')
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', this.key).update(payload).digest('base64url');
    return { user, token: `${payload}.${signature}` };
  }

  authenticate(request, required = true) {
    const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
    if (!token) {
      if (required) throw authError();
      return null;
    }
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) {
      if (required) throw authError();
      return null;
    }
    const expected = crypto.createHmac('sha256', this.key).update(payload).digest('base64url');
    if (!timingSafeEqual(signature, expected)) {
      if (required) throw authError();
      return null;
    }
    try {
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      const user = this.userMap.get(value.u);
      if (!user || value.v !== user.version || !Number.isFinite(value.exp) || value.exp <= Math.floor(Date.now() / 1000)) {
        if (required) throw authError();
        return null;
      }
      return user;
    } catch (error) {
      if (error?.code === 'APP_AUTH_REQUIRED') throw error;
      if (required) throw authError();
      return null;
    }
  }

  setSessionCookie(request, response, token) {
    const maxAge = this.sessionDays * 24 * 60 * 60;
    const secure = publicOrigin(request).startsWith('https://') || String(process.env.APP_PUBLIC_URL || '').startsWith('https://');
    response.setHeader('Set-Cookie', [
      `${COOKIE_NAME}=${token}`,
      `Path=${cookiePath(request)}`,
      `Max-Age=${maxAge}`,
      'HttpOnly',
      'SameSite=Lax',
      ...(secure ? ['Secure'] : [])
    ].join('; '));
  }

  clearSessionCookie(request, response) {
    const secure = publicOrigin(request).startsWith('https://') || String(process.env.APP_PUBLIC_URL || '').startsWith('https://');
    response.setHeader('Set-Cookie', [
      `${COOKIE_NAME}=`,
      `Path=${cookiePath(request)}`,
      'Max-Age=0',
      'HttpOnly',
      'SameSite=Lax',
      ...(secure ? ['Secure'] : [])
    ].join('; '));
  }

  #loadKey() {
    if (fs.existsSync(this.keyPath)) {
      const value = fs.readFileSync(this.keyPath);
      if (value.length === 32) return value;
    }
    const value = crypto.randomBytes(32);
    fs.writeFileSync(this.keyPath, value, { mode: 0o600 });
    return value;
  }
}
