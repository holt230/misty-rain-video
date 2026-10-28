import type { MediaItem } from '../types/media';

type MediaIdentity = Pick<MediaItem, 'id' | 'quarkFid' | 'catalogId'>;
const fidOf = (media: MediaIdentity) => media.quarkFid || (media.id.startsWith('quark:') ? media.id.slice(6) : '');

export const sameMediaIdentity = (left: MediaIdentity, right: MediaIdentity): boolean => {
  const leftFid = fidOf(left);
  const rightFid = fidOf(right);
  if (leftFid && rightFid) return leftFid === rightFid;
  if (left.catalogId && right.catalogId) return left.catalogId === right.catalogId;
  return Boolean(left.id && left.id === right.id);
};
