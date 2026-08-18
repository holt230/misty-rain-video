import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ensureDirectory = directory => {
  fs.mkdirSync(directory, { recursive: true });
};

const readJson = (filePath, fallback) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
};

const writeJson = (filePath, value, mode = 0o600) => {
  ensureDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode });
  fs.renameSync(tempPath, filePath);
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // Some mounted filesystems do not support chmod.
  }
};

export class MediaRepository {
  constructor(dataDir, { legacyFilePath = '' } = {}) {
    ensureDirectory(dataDir);
    this.filePath = path.resolve(dataDir, 'media_cards.json');
    if (!fs.existsSync(this.filePath)) {
      const legacy = legacyFilePath && readJson(legacyFilePath, null);
      writeJson(this.filePath, Array.isArray(legacy) ? legacy : [], 0o644);
    }
  }

  all() {
    const value = readJson(this.filePath, []);
    return Array.isArray(value) ? value : [];
  }

  save(item) {
    const cards = this.all();
    const index = cards.findIndex(card => card.title === item.title && card.category === item.category);
    if (index >= 0) cards[index] = { ...cards[index], ...item };
    else cards.unshift(item);
    writeJson(this.filePath, cards, 0o644);
    return cards;
  }

  remove(id) {
    const cards = this.all().filter(card => card.id !== id);
    writeJson(this.filePath, cards, 0o644);
    return cards;
  }

  removeTitle(title) {
    const normalized = normalizeLibraryTitle(title);
    const cards = this.all().filter(card => normalizeLibraryTitle(card.title) !== normalized);
    writeJson(this.filePath, cards, 0o644);
    return cards;
  }
}

const normalizeLibraryTitle = value => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\s·•:：—_.,，。!！?？《》“”'"【】\[\]()（）-]+/g, '');

export class LibraryViewRepository {
  constructor(dataDir, { legacyFilePath = '' } = {}) {
    ensureDirectory(dataDir);
    this.filePath = path.resolve(dataDir, 'library_view.json');
    if (!fs.existsSync(this.filePath)) {
      const legacy = legacyFilePath && readJson(legacyFilePath, null);
      writeJson(
        this.filePath,
        legacy?.categories && typeof legacy.categories === 'object' ? legacy : { version: 1, categories: {} },
        0o644
      );
    }
  }

  categoryFor(title) {
    const value = readJson(this.filePath, { version: 1, categories: {} });
    return value?.categories?.[normalizeLibraryTitle(title)] || '';
  }

  setCategory(title, category) {
    const value = readJson(this.filePath, { version: 1, categories: {} });
    const categories = value?.categories && typeof value.categories === 'object' ? value.categories : {};
    categories[normalizeLibraryTitle(title)] = category;
    writeJson(this.filePath, { version: 1, categories }, 0o644);
  }
}

export class QuarkCredentialStore {
  constructor(dataDir) {
    ensureDirectory(dataDir);
    this.configPath = path.resolve(dataDir, 'quark_config.json');
    this.keyPath = path.resolve(dataDir, '.quark_key');
    if (!fs.existsSync(this.configPath)) writeJson(this.configPath, { version: 2 }, 0o600);
    const legacyConfig = readJson(this.configPath, {});
    if (typeof legacyConfig.cookie === 'string' && legacyConfig.cookie.trim()) {
      this.saveCookie(legacyConfig.cookie);
    }
  }

  getCookie() {
    const config = readJson(this.configPath, {});
    if (typeof config.cookie === 'string' && config.cookie.trim()) return config.cookie.trim();
    return this.#decrypt(config.cookieEncrypted, config.iv, config.authTag);
  }

  saveCookie(cookie) {
    const cleanCookie = String(cookie || '').trim();
    const existing = readJson(this.configPath, {});
    if (!cleanCookie) {
      const { cookie, cookieEncrypted, iv, authTag, ...rest } = existing;
      writeJson(this.configPath, { ...rest, version: 3, updatedAt: new Date().toISOString() }, 0o600);
      return;
    }

    const encrypted = this.#encrypt(cleanCookie);
    writeJson(this.configPath, {
      ...existing,
      version: 3,
      cookieEncrypted: encrypted.value,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      updatedAt: new Date().toISOString()
    }, 0o600);
  }

  getTvAuth() {
    const config = readJson(this.configPath, {});
    return {
      deviceId: String(config.tvDeviceId || '').trim(),
      refreshToken: this.#decrypt(config.tvRefreshTokenEncrypted, config.tvRefreshIv, config.tvRefreshAuthTag),
      accessToken: this.#decrypt(config.tvAccessTokenEncrypted, config.tvAccessIv, config.tvAccessAuthTag),
      expiresAt: Number(config.tvAccessExpiresAt) || 0
    };
  }

  saveTvAuth({ deviceId, refreshToken, accessToken, expiresAt }) {
    const existing = readJson(this.configPath, {});
    const refresh = this.#encrypt(String(refreshToken || '').trim());
    const access = this.#encrypt(String(accessToken || '').trim());
    writeJson(this.configPath, {
      ...existing,
      version: 3,
      tvDeviceId: String(deviceId || existing.tvDeviceId || '').trim(),
      tvRefreshTokenEncrypted: refresh.value,
      tvRefreshIv: refresh.iv,
      tvRefreshAuthTag: refresh.authTag,
      tvAccessTokenEncrypted: access.value,
      tvAccessIv: access.iv,
      tvAccessAuthTag: access.authTag,
      tvAccessExpiresAt: Math.max(0, Number(expiresAt) || 0),
      tvUpdatedAt: new Date().toISOString()
    }, 0o600);
  }

  clearTvAuth() {
    const config = readJson(this.configPath, {});
    const next = { ...config };
    for (const key of [
      'tvRefreshTokenEncrypted', 'tvRefreshIv', 'tvRefreshAuthTag',
      'tvAccessTokenEncrypted', 'tvAccessIv', 'tvAccessAuthTag', 'tvAccessExpiresAt'
    ]) delete next[key];
    writeJson(this.configPath, { ...next, version: 3, tvUpdatedAt: new Date().toISOString() }, 0o600);
  }

  isConfigured() {
    return this.getCookie().length > 0;
  }

  #encrypt(value) {
    if (!value) return { value: '', iv: '', authTag: '' };
    const key = this.#getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
      value: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64')
    };
  }

  #decrypt(value, iv, authTag) {
    if (!value || !iv || !authTag) return '';
    try {
      const key = this.#getEncryptionKey();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(authTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(value, 'base64')),
        decipher.final()
      ]).toString('utf8').trim();
    } catch {
      return '';
    }
  }

  #getEncryptionKey() {
    const configuredSecret = process.env.QUARK_CONFIG_SECRET?.trim();
    if (configuredSecret) return crypto.createHash('sha256').update(configuredSecret).digest();

    if (fs.existsSync(this.keyPath)) {
      const storedKey = fs.readFileSync(this.keyPath);
      if (storedKey.length === 32) return storedKey;
    }

    const generatedKey = crypto.randomBytes(32);
    fs.writeFileSync(this.keyPath, generatedKey, { mode: 0o600 });
    return generatedKey;
  }
}

export class PlaybackCacheRepository {
  constructor(dataDir) {
    ensureDirectory(dataDir);
    this.filePath = path.resolve(dataDir, 'quark_playback_cache.json');
  }

  get(key) {
    return readJson(this.filePath, {})[key] || null;
  }

  set(key, value) {
    const cache = readJson(this.filePath, {});
    cache[key] = { ...value, updatedAt: new Date().toISOString() };
    writeJson(this.filePath, cache, 0o600);
  }

  remove(key) {
    const cache = readJson(this.filePath, {});
    delete cache[key];
    writeJson(this.filePath, cache, 0o600);
  }
}

export class PlaybackHistoryRepository {
  constructor(dataDir) {
    ensureDirectory(dataDir);
    this.filePath = path.resolve(dataDir, 'playback_history.json');
    if (!fs.existsSync(this.filePath)) writeJson(this.filePath, { version: 1, entries: [] }, 0o600);
  }

  all() {
    const value = readJson(this.filePath, { version: 1, entries: [] });
    const entries = Array.isArray(value?.entries) ? value.entries : [];
    return entries
      .filter(entry => entry && typeof entry === 'object' && entry.id)
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  }

  save(entry) {
    const entries = this.all();
    const sourceKey = String(entry?.media?.quarkFid || entry?.media?.id || entry?.media?.title || '').trim();
    const id = crypto.createHash('sha256').update(sourceKey).digest('hex').slice(0, 24);
    const updated = {
      ...entry,
      id,
      position: Math.max(0, Number(entry.position) || 0),
      duration: Math.max(0, Number(entry.duration) || 0),
      completed: Boolean(entry.completed),
      updatedAt: new Date().toISOString()
    };
    const index = entries.findIndex(item => item.id === id);
    if (index >= 0) entries[index] = { ...entries[index], ...updated };
    else entries.unshift(updated);
    const next = entries
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
      .slice(0, 200);
    writeJson(this.filePath, { version: 1, entries: next }, 0o600);
    return updated;
  }

  remove(id) {
    const entries = this.all().filter(entry => entry.id !== id);
    writeJson(this.filePath, { version: 1, entries }, 0o600);
    return entries;
  }
}

export class LibraryConfigStore {
  constructor(dataDir) {
    ensureDirectory(dataDir);
    this.filePath = path.resolve(dataDir, 'library_config.json');
    if (!fs.existsSync(this.filePath)) {
      writeJson(this.filePath, { rootFolderName: '烟雨视频', rootShareUrl: '' }, 0o600);
    }
  }

  get() {
    const value = readJson(this.filePath, {});
    const environmentRoot = sanitizeConfigValue(process.env.LIBRARY_ROOT_FOLDER);
    return {
      rootFolderName: environmentRoot
        || sanitizeConfigValue(value.rootFolderName)
        || '烟雨视频',
      rootShareUrl: sanitizeConfigValue(process.env.LIBRARY_ROOT_SHARE_URL)
        || sanitizeConfigValue(value.rootShareUrl),
      legacyRootFolderName: sanitizeConfigValue(process.env.LEGACY_LIBRARY_ROOT_FOLDER) || '烟雨视频',
      preferOwnedRoot: Boolean(environmentRoot)
    };
  }
}

const sanitizeConfigValue = value => typeof value === 'string' ? value.trim() : '';
