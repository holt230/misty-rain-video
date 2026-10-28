import crypto from 'node:crypto';
import { shareSelectionKey } from './shareSelection.js';

const MINUTE = 60_000;
const FAILURE_POLICY_VERSION = 1;
const UNAVAILABLE_THRESHOLD = 3;
const sourceFingerprint = card => crypto.createHash('sha256')
  .update(JSON.stringify([card.quarkShareUrl || '', card.quarkPasscode || '', shareSelectionKey(card.quarkSelectionFids)])).digest('hex');
const unavailableCodes = new Set(['QUARK_SHARE_UNAVAILABLE', 'QUARK_SHARE_EMPTY', 'LIBRARY_SOURCE_MISSING']);
const messageForError = error => error?.code === 'QUARK_AUTH_REQUIRED'
  ? '网盘认证需要更新，已保存的内容不受影响'
  : '本次维护未完成，将稍后重试；已保存的内容不受影响';

export class LibraryMaintenance {
  constructor(context, { enabled = process.env.LIBRARY_AUTO_MAINTENANCE !== 'false',
    intervalMs = Math.max(15, Math.min(1440, Number(process.env.LIBRARY_MAINTENANCE_MINUTES) || 30)) * MINUTE,
    now = Date.now } = {}) {
    this.context = context;
    this.enabled = enabled;
    this.intervalMs = intervalMs;
    this.now = now;
    this.running = false;
    this.started = false;
    this.timer = null;
    this.stopped = false;
  }

  start() {
    if (this.started || !this.enabled) return;
    this.started = true;
    this.stopped = false;
    this.schedule(MINUTE);
  }

  schedule(delay) {
    this.timer = setTimeout(async () => {
      try { await this.runOnce(); }
      catch { /* Next cycle retries; per-user errors are persisted below. */ }
      finally { if (!this.stopped) this.schedule(this.intervalMs); }
    }, delay);
    this.timer.unref?.();
  }

  stop() {
    this.stopped = true;
    this.started = false;
    clearTimeout(this.timer);
  }

  status(user) {
    const data = this.context.userContext(user);
    const state = data.maintenanceRepository.read();
    const fids = new Set(data.mediaRepository.all().map(card => card.quarkFid));
    return {
      enabled: this.enabled && this.started,
      running: this.running,
      intervalMinutes: this.intervalMs / MINUTE,
      checkedAt: state.checkedAt,
      message: state.message,
      items: Object.entries(state.items || {}).filter(([fid]) => fids.has(fid)).map(([quarkFid, item]) => ({
        quarkFid, title: data.libraryViewRepository?.titleFor(quarkFid) || item.title, checkedAt: item.checkedAt, nextCheckAt: item.nextCheckAt,
        status: item.status, message: item.message, addedCount: item.addedCount || 0,
        code: item.code || '', unavailableCount: item.unavailableCount || 0,
        lastActionAt: item.lastActionAt || '', lastAction: item.lastAction || ''
      }))
    };
  }

  async runOnce() {
    if (!this.enabled || this.running || this.stopped) return;
    this.running = true;
    try {
      for (const record of this.context.authService.users) {
        if (this.stopped) break;
        const user = this.context.authService.publicUser(record);
        const data = this.context.userContext(user);
        const state = data.maintenanceRepository.read();
        state.items ||= {};
        try {
          const library = await this.context.quarkGateway.listLibrary(user);
          const metadata = data.mediaRepository.all();
          // Exact FIDs only. Legacy title matching can associate the wrong
          // duplicate directory and is unsuitable for unattended writes.
          const cards = library.map(item => {
            const saved = metadata.find(card => card.quarkFid === item.quarkFid);
            return saved ? { ...saved, ...item, title: data.libraryViewRepository?.titleFor(item.quarkFid) || item.title,
              quarkShareUrl: saved.quarkShareUrl || '', quarkPasscode: saved.quarkPasscode || '' } : null;
          }).filter(Boolean);
          const fids = new Set(cards.map(card => card.quarkFid));
          for (const fid of Object.keys(state.items)) if (!fids.has(fid)) delete state.items[fid];
          const due = cards.filter(card => {
            const prior = state.items[card.quarkFid];
            return !prior || prior.source !== sourceFingerprint(card)
              || (prior.status === 'retrying' && prior.failurePolicyVersion !== FAILURE_POLICY_VERSION)
              || prior.nextCheckAt <= this.now();
          }).sort((a, b) => (state.items[a.quarkFid]?.nextCheckAt || 0) - (state.items[b.quarkFid]?.nextCheckAt || 0)).slice(0, 20);
          let searches = 0;
          for (const card of due) {
            if (this.stopped) break;
            const prior = state.items[card.quarkFid];
            const source = sourceFingerprint(card);
            const entry = prior?.source === source ? { ...prior } : { source, unavailableCount: 0, failures: 0 };
            // Recheck legacy HTTP failures once after this classification fix;
            // do not inherit their six-hour backoff or unverified failure count.
            if (entry.failurePolicyVersion !== FAILURE_POLICY_VERSION) {
              entry.failurePolicyVersion = FAILURE_POLICY_VERSION;
              entry.unavailableCount = 0;
              entry.failures = 0;
            }
            entry.title = card.title;
            entry.checkedAt = new Date(this.now()).toISOString();
            entry.addedCount = 0;
            let confirmedUnavailable = false;
            try {
              const [status] = await this.context.quarkGateway.checkLibraryUpdates([card], user, { force: true });
              if (status.updateCheckAvailable) {
                entry.code = '';
                entry.unavailableCount = 0;
                entry.candidateCursor = 0;
                entry.failures = 0;
                entry.status = 'current';
                entry.message = '已检查当前来源，暂无待补剧集';
                if (status.newEpisodeCount && !this.stopped) {
                  const result = await this.context.quarkGateway.applyLibraryUpdates([card], user, {
                    isCurrent: expected => !this.stopped && data.mediaRepository.matchesSource(expected)
                  });
                  if (result.failedCount) throw Object.assign(new Error('补集未完成'), { code: result.failures[0]?.code });
                  entry.addedCount = result.transferredCount;
                  entry.status = result.transferredCount ? 'updated' : 'current';
                  entry.message = result.transferredCount ? `已自动补充 ${result.transferredCount} 个正片文件` : '当前来源暂无待补剧集';
                }
              } else {
                entry.failures = (entry.failures || 0) + 1;
                const unavailable = unavailableCodes.has(status.code);
                confirmedUnavailable = unavailable;
                entry.code = status.code || '';
                entry.unavailableCount = unavailable ? (entry.unavailableCount || 0) + 1 : 0;
                entry.status = 'retrying';
                entry.message = unavailable
                  ? `原来源不可用，已确认 ${Math.min(entry.unavailableCount, UNAVAILABLE_THRESHOLD)}/${UNAVAILABLE_THRESHOLD} 次；复查后自动验证新来源，保留已有剧集`
                  : '暂时无法检查来源，稍后重试';
                if (unavailable && card.quarkSelectionFids !== undefined) {
                  entry.message = '所选来源暂不可用，保留你的选集范围等待恢复；不会自动改为保存全部';
                }
                if (entry.unavailableCount >= UNAVAILABLE_THRESHOLD && card.quarkSelectionFids === undefined && searches < 2 && !this.stopped) {
                  searches += 1;
                  const results = await this.context.resourceSearch.search(card.title, { force: true, priority: 'background' });
                  const candidatePool = [...new Map((results.merged_by_type?.quark || [])
                    .filter(item => /^https:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+$/.test(item.url) && item.url !== card.quarkShareUrl)
                    .map(item => [item.url, item])).values()];
                  const cursor = (entry.candidateCursor || 0) % Math.max(1, candidatePool.length);
                  const candidates = [...candidatePool.slice(cursor), ...candidatePool.slice(0, cursor)].slice(0, 5);
                  entry.candidateCursor = cursor;
                  let updated = false;
                  for (const candidate of candidates) {
                    if (this.stopped) break;
                    try {
                      updated = await this.context.quarkGateway.relinkLibrarySource(card, candidate, user, {
                        isCurrent: expected => !this.stopped && data.mediaRepository.matchesSource(expected),
                        commit: (expected, next) => data.mediaRepository.relinkSource(expected, next)
                      });
                    } catch (error) {
                      if (error?.code === 'QUARK_AUTH_REQUIRED' || error?.code === 'LIBRARY_MUTATION_IN_PROGRESS') throw error;
                    }
                    entry.candidateCursor = (entry.candidateCursor + 1) % candidatePool.length;
                    if (updated) break;
                  }
                  entry.message = '尚未找到可确认的同剧来源，将继续重试；已有剧集保留';
                  if (updated) {
                    entry.source = sourceFingerprint(updated);
                    entry.code = '';
                    entry.unavailableCount = 0;
                    entry.candidateCursor = 0;
                    entry.failures = 0;
                    entry.status = 'relinked';
                    entry.message = '已验证并关联新的追更来源，保留原目录和剧集';
                    const result = await this.context.quarkGateway.applyLibraryUpdates([updated], user, {
                      isCurrent: expected => !this.stopped && data.mediaRepository.matchesSource(expected)
                    });
                    entry.addedCount = result.transferredCount;
                    if (result.failedCount) entry.message += '；部分补集待重试';
                    else if (result.transferredCount) entry.message += `，补充 ${result.transferredCount} 集`;
                  }
                }
              }
            } catch (error) {
              if (error?.code === 'QUARK_AUTH_REQUIRED') throw error;
              entry.failures = (entry.failures || 0) + 1;
              entry.code = error?.code || '';
              if (!confirmedUnavailable) entry.unavailableCount = 0;
              entry.status = 'retrying';
              entry.message = confirmedUnavailable && entry.unavailableCount >= UNAVAILABLE_THRESHOLD
                ? '原来源已确认不可用，新来源检查暂未完成，将自动重试；已有剧集保留'
                : messageForError(error);
            }
            if (entry.addedCount || entry.status === 'relinked') {
              entry.lastActionAt = entry.checkedAt;
              entry.lastAction = entry.message;
            }
            // A confirmed dead share needs continued candidate discovery;
            // temporary source-check failures retain exponential backoff.
            entry.nextCheckAt = this.now() + (entry.unavailableCount >= UNAVAILABLE_THRESHOLD
              ? this.intervalMs
              : Math.min(6 * 60 * MINUTE, this.intervalMs * 2 ** Math.min(4, Math.max(0, (entry.failures || 0) - 3))));
            state.items[card.quarkFid] = entry;
            data.maintenanceRepository.write(state);
          }
          state.message = cards.length ? '' : '暂无可自动追更的来源记录；新入库影片会自动纳入维护';
        } catch (error) {
          state.message = messageForError(error);
        }
        state.checkedAt = new Date(this.now()).toISOString();
        data.maintenanceRepository.write(state);
      }
    } finally {
      this.running = false;
    }
  }
}
