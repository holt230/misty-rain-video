export type CatalogSort = 'recommended' | 'rating' | 'popularity' | 'time';
export const catalogSortOptions: Array<{ value: CatalogSort; label: string }> = [
  { value: 'recommended', label: '推荐' }, { value: 'rating', label: '评分' },
  { value: 'popularity', label: '热度 · 评价人数' }, { value: 'time', label: '时间 · 年份' }
];
export const catalogSortDescription: Record<CatalogSort, string> = {
  recommended: '保留来源推荐顺序', rating: '按评分从高到低',
  popularity: '按评价人数从多到少', time: '按上映年份从新到旧'
};
type SortableItem = { rating: number | null; ratingCount?: number | null; year: string };
const value = (item: SortableItem, sort: CatalogSort) => {
  if (sort === 'time') return /^(19|20)\d{2}$/.test(item.year) ? Number(item.year) : -1;
  const number = sort === 'rating' ? item.rating : item.ratingCount;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : -1;
};
/** Missing metadata follows known values; ties retain the provider's ordering.
 * Popularity is the real rating count, never a synthesized popularity score. */
export function sortCatalogItems<T extends SortableItem>(items: T[], sort: CatalogSort): T[] {
  return sort === 'recommended' ? items : [...items].sort((left, right) => value(right, sort) - value(left, sort));
}
