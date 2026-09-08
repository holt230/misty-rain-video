export interface LibrarySaveFeedback {
  title: string;
  message: string;
  needsAuth?: boolean;
}

export class LibrarySaveError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'LibrarySaveError';
    this.code = code;
  }
}

/** 只识别完整的夸克分享地址；支持直接粘贴带说明和提取码的分享文案。 */
export const parseLibraryInput = (input: string) => {
  const value = input.trim();
  const match = value.match(/(?:^|[\s（(【\[：:])((?:https?:\/\/)?pan\.quark\.cn\/s\/[a-zA-Z0-9]+\/?(?:[?#][^\s，。；）)】]*)?)(?=$|[\s，。；）)】])/i);
  if (match) {
    const url = new URL(/^https?:/i.test(match[1]!) ? match[1]! : `https://${match[1]}`);
    const passcode = value.match(/(?:提取码|提取密码|访问码|密码)\s*[:：]?\s*([a-zA-Z0-9]{4,8})(?![a-zA-Z0-9])/i)?.[1]
      || url.searchParams.get('pwd') || url.searchParams.get('passcode') || '';
    return { kind: 'share' as const, url: `https://pan.quark.cn${url.pathname.replace(/\/$/, '')}`, passcode };
  }
  if (/https?:\/\/|www\.|quark\.cn|[a-z0-9-]+\.[a-z]{2,}\//i.test(value)) {
    return { kind: 'invalid' as const, message: '请粘贴完整的夸克分享链接（https://pan.quark.cn/s/…）。其他网盘链接暂不支持，也可以直接输入片名搜索。' };
  }
  return { kind: 'search' as const, keyword: value };
};

export const getLibrarySaveFeedback = (error: unknown): LibrarySaveFeedback => {
  const code = error instanceof LibrarySaveError ? error.code : '';
  const message = error instanceof Error ? error.message : '';
  if (code === 'QUARK_AUTH_REQUIRED' || code === 'ADMIN_REQUIRED') {
    return { title: '片库认证需要更新', message: '请在“我的”中更新播放与片库认证后重试；普通账户请联系管理员。', needsAuth: true };
  }
  if (/提取码|提取密码|访问码/.test(message) && !/失效或/.test(message)) {
    return { title: '未获取到有效提取码', message: '请粘贴包含提取码的完整分享文案，系统自动识别；也可以选择另一条资源。' };
  }
  if (code === 'QUARK_SHARE_UNAVAILABLE' || /取消.*分享|分享.*(?:失效|过期|不存在|违规)/.test(message)) {
    if (/取消.*分享|已失效|已过期|不存在/.test(message) && !/失效或/.test(message)) {
      return { title: '分享链接已失效', message: '请更换一条链接，或输入片名重新搜索资源。' };
    }
    return { title: '分享链接无法访问', message: '请粘贴完整分享文案重试，或更换一条资源。' };
  }
  if (code === 'INVALID_QUARK_SHARE') {
    return { title: '分享链接不完整', message: '请重新复制完整的夸克分享链接后重试。' };
  }
  if (code === 'QUARK_SHARE_EMPTY' || /没有.*(?:视频|正片)|分享目录为空/.test(message)) {
    return { title: '资源中没有可播放的视频', message: '请更换包含正片的分享链接。' };
  }
  if (code === 'NETWORK_ERROR' || /Failed to fetch|Load failed|NetworkError|fetch failed/i.test(message)) {
    return { title: '暂时无法连接片库', message: '请检查网络后刷新片库，确认是否已添加成功，再决定是否重试。' };
  }
  return { title: '添加未完成', message: message || '请稍后重试，或更换一条分享链接。' };
};
