import { ref, computed } from 'vue';
import type { MediaItem, CategoryType } from '../types/media';
import type { ResourceItem, DriveType, DriveCountMap } from '../types/search';
import { SilentSearchEngine } from '../services/silentSearchEngine';
import { useToast } from './useToast';

const engine = new SilentSearchEngine();

export function useSilentSearch() {
  const toast = useToast();

  const isDrawerOpen = ref(false);
  const isSearching = ref(false);
  const currentMedia = ref<MediaItem | null>(null);
  const allResources = ref<ResourceItem[]>([]);
  const selectedDrive = ref<DriveType | 'all'>('all');

  const driveCounts = computed<DriveCountMap>(() => {
    const counts: DriveCountMap = {
      all: allResources.value.length,
      quark: 0,
      aliyun: 0,
      baidu: 0,
      xunlei: 0,
      115: 0,
      uc: 0,
      tianyi: 0
    };
    allResources.value.forEach(item => {
      if (counts[item.driveType] !== undefined) {
        counts[item.driveType]++;
      }
    });
    return counts;
  });

  const filteredResources = computed(() => {
    if (selectedDrive.value === 'all') {
      return allResources.value;
    }
    return allResources.value.filter(item => item.driveType === selectedDrive.value);
  });

  /**
   * 静默触发搜索
   */
  const triggerSearch = async (media: { title: string; category?: CategoryType; desc?: string; poster?: string; tag?: string }) => {
    const fullMedia: MediaItem = {
      id: (media as MediaItem).id || 'custom-' + Date.now(),
      title: media.title,
      category: media.category || 'tv',
      desc: media.desc || '全网聚合检索',
      poster: media.poster || 'https://images.unsplash.com/photo-1578836537282-3171d77f8632?w=600&q=80',
      tag: media.tag || '4K 高清',
      status: '完结'
    };

    currentMedia.value = fullMedia;
    selectedDrive.value = 'all';
    isDrawerOpen.value = true;
    isSearching.value = true;
    allResources.value = [];

    try {
      const res = await engine.search(fullMedia.title);
      if (!res.success) {
        toast.show(res.message || '资源检索服务暂时不可用，请稍后重试', '!', 3800);
        return;
      }
      allResources.value = res.items || [];
      toast.show(
        allResources.value.length
          ? `已为您聚合检索到 ${allResources.value.length} 个网盘资源`
          : '暂未检索到可用资源，可稍后再试',
        allResources.value.length ? '✓' : '·'
      );
    } finally {
      isSearching.value = false;
    }
  };

  const closeDrawer = () => {
    isDrawerOpen.value = false;
  };

  return {
    engine,
    isDrawerOpen,
    isSearching,
    currentMedia,
    allResources,
    selectedDrive,
    driveCounts,
    filteredResources,
    triggerSearch,
    closeDrawer
  };
}
