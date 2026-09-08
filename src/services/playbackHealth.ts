export interface PlaybackHealthSnapshot {
  active: boolean;
  elapsedMs: number;
}

/** Media events may be absent when Safari's native pipeline stalls. */
export const playbackHealth = ({ active, elapsedMs }: PlaybackHealthSnapshot) => {
  if (!active || elapsedMs < 3_000) return 'playing';
  if (elapsedMs < 8_000) return 'buffering';
  if (elapsedMs < 20_000) return 'stalled';
  return 'interrupted';
};
