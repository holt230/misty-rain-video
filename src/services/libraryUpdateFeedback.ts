import type { MediaItem } from '../types/media';

type UpdateFeedbackMedia = Pick<MediaItem, 'updateMessage' | 'updateCheckAvailable'>;

/** 更新接口目前只返回说明文案；仅识别已知原因，未知错误一律作为检查失败。 */
export const getLibraryUpdateFeedback = (media: UpdateFeedbackMedia) => {
  const message = media.updateMessage?.trim() || '';
  if (!message && media.updateCheckAvailable !== false) return null;

  if (message === '当前卡片没有可持续检查的原片源') {
    return {
      label: '未关联原分享',
      detail: '片库中已保存的剧集不受影响。如需自动检查新剧集，可通过“更换资源”关联原分享链接。'
    };
  }
  // 旧接口将失效、访问限制和提取码问题合并返回，不能据此断言分享已失效。
  if (message.startsWith('原片源已失效') || message.startsWith('原分享不可用')) {
    return {
      label: '原分享不可用',
      detail: '暂时无法从原分享检查或补充新剧集，已保存的剧集不受影响。如需追更，可通过“更换资源”选择其他分享。'
    };
  }
  if (message === '补充内容暂未完成，请稍后重试') {
    return { label: '剧集补充未完成', detail: '本次未完成新剧集补充，请稍后重试，无需立即更换资源。' };
  }
  return {
    label: '暂时无法检查更新',
    detail: message === '片库目录已变更，请刷新片库后重试'
      ? message
      : '可能是网络或访问暂时受限，请稍后点击片库的“检查更新”重试。这不代表已保存的剧集无法播放。'
  };
};
