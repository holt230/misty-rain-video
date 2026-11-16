interface Episode { fid: string; episodeNumber: number }
interface Resume { episodeFid: string; position: number; completed: boolean }

/** An explicit episode must exist. Never silently play the first/previous episode instead. */
export function libraryPlaybackSelection(episodes: Episode[], history?: Resume | null, requestedEpisode?: number, firstIndex = 0) {
  let index = history ? episodes.findIndex(episode => episode.fid === history.episodeFid) : -1;
  if (requestedEpisode !== undefined) {
    const matches = episodes.map((episode, index) => ({ episode, index })).filter(row => row.episode.episodeNumber === requestedEpisode);
    if (!matches.length) throw Object.assign(new Error(`当前片库没有第 ${requestedEpisode} 集，可返回找片页继续查找其他片源。`), { code: 'LIBRARY_EPISODE_NOT_FOUND' });
    if (matches.length > 1) throw Object.assign(new Error(`片库有多个第 ${requestedEpisode} 集，请在选集中选择对应季度。`), { code: 'LIBRARY_EPISODE_AMBIGUOUS' });
    index = matches[0].index;
  }
  const selected = index >= 0 ? index : firstIndex;
  return { index: selected, position: history && episodes[selected]?.fid === history.episodeFid && !history.completed ? history.position : 0 };
}
