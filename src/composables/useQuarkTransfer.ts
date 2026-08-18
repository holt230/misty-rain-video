import { ref } from 'vue';
import type { MediaItem } from '../types/media';
import type { ResourceItem } from '../types/search';
import { SilentSearchEngine } from '../services/silentSearchEngine';
import { copyText } from '../services/clipboard';
import { useToast } from './useToast';

const engine = new SilentSearchEngine();

export function useQuarkTransfer() {
  const toast = useToast();

  const isOpen = ref(false);
  const isAnalyzing = ref(false);
  const currentMedia = ref<MediaItem | null>(null);
  const quarkResources = ref<ResourceItem[]>([]);
  const allResources = ref<ResourceItem[]>([]);
  const searchError = ref('');
  const searchKeyword = ref('');
  let searchSequence = 0;

  /**
   * 在当前资源面板内执行检索。关键词与媒体标题分离，允许用户使用别名
   * 重搜，同时仍把最终资源保存到原来的媒体卡片。
   */
  const searchResources = async (keyword: string) => {
    const normalizedKeyword = keyword.trim();
    if (!currentMedia.value || !normalizedKeyword) return;
    const sequence = ++searchSequence;
    searchKeyword.value = normalizedKeyword;
    isOpen.value = true;
    isAnalyzing.value = true;
    searchError.value = '';
    quarkResources.value = [];
    allResources.value = [];

    try {
      const res = await engine.search(normalizedKeyword);
      if (sequence !== searchSequence || !isOpen.value) return;
      if (!res.success) {
        searchError.value = res.message || '资源检索服务暂时不可用，请稍后重试';
        toast.show(searchError.value, '!', 3800);
        return;
      }
      allResources.value = res.items || [];
      quarkResources.value = res.quarkItems && res.quarkItems.length > 0
        ? res.quarkItems
        : res.items.filter(i => i.driveType === 'quark');
    } catch (error) {
      if (sequence !== searchSequence || !isOpen.value) return;
      searchError.value = error instanceof Error ? error.message : '资源检索失败，请稍后重试';
      toast.show(searchError.value, '!', 3800);
    } finally {
      if (sequence === searchSequence) isAnalyzing.value = false;
    }
  };

  /**
   * 打开网盘分析与转存面板
   */
  const openTransferModal = async (media: MediaItem) => {
    currentMedia.value = media;
    await searchResources(media.title);
  };

  const closeTransferModal = () => {
    searchSequence += 1;
    isOpen.value = false;
    isAnalyzing.value = false;
    searchError.value = '';
    searchKeyword.value = '';
  };

  const retrySearch = () => {
    if (currentMedia.value && !isAnalyzing.value) {
      void searchResources(searchKeyword.value || currentMedia.value.title);
    }
  };

  /**
   * 一键转存到夸克网盘
   */
  const transferToQuark = async (res: ResourceItem) => {
    const pwdText = res.password ? `提取码: ${res.password}` : '';
    const shareText = res.password ? `${res.url} ${pwdText}` : res.url;

    const copied = await copyText(shareText);

    toast.show(
      copied && res.password
        ? `已复制提取码【${res.password}】，可将该真实链接保存为播放源`
        : copied
          ? '已复制真实网盘分享链接，可直接保存为播放源'
          : '当前环境无法复制链接，请长按资源链接后手动复制',
      copied ? '✓' : '!',
      3500
    );
  };

  /**
   * 复制链接与提取码
   */
  const copyResource = async (res: ResourceItem) => {
    const text = res.password ? `${res.url} 提取码: ${res.password}` : res.url;
    if (await copyText(text)) {
      toast.show('已复制网盘转存链接与提取码！', '✓');
    } else {
      toast.show('当前环境无法复制链接，请长按资源链接后手动复制', '!', 3200);
    }
  };

  return {
    isOpen,
    isAnalyzing,
    currentMedia,
    quarkResources,
    allResources,
    searchError,
    searchKeyword,
    openTransferModal,
    searchResources,
    closeTransferModal,
    retrySearch,
    transferToQuark,
    copyResource
  };
}
