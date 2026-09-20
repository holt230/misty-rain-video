// addTextTrack has no removal API. Retain ownership across component remounts.
const tracks = new WeakMap<HTMLVideoElement, NativeDanmakuTrack>();

class NativeDanmakuTrack {
  private track: TextTrack | null = null;
  private active = false;
  private preference: TextTrackMode = 'showing';
  private cues = new Map<string, VTTCue>();

  constructor(private video: HTMLVideoElement) {}

  clear() {
    try {
      for (const cue of this.cues.values()) this.track?.removeCue(cue);
    } catch { /* A detached native track must not break video playback. */ }
    this.cues.clear();
  }

  suspend() {
    if (this.track && this.active) {
      this.preference = this.track.mode;
      this.track.mode = 'hidden';
    }
    this.active = false;
    this.clear();
  }

  sync(active: boolean, comments: { time: number; text: string }[]) {
    try {
      if (!active) { this.suspend(); return true; }
      if (typeof VTTCue === 'undefined' || !this.video.addTextTrack) return false;
      if (!this.track) {
        this.track = this.video.addTextTrack('captions', '弹幕', 'zh-CN');
        this.track.mode = 'hidden';
      }
      if (!this.active) {
        const filmSubtitle = Array.from(this.video.textTracks).some(track => track !== this.track
          && (track.kind === 'subtitles' || track.kind === 'captions') && track.mode === 'showing');
        this.track.mode = filmSubtitle ? 'hidden' : this.preference;
        this.active = true;
      }
      // Refresh content without changing the user's selection in native controls.
      const wanted = new Map<string, VTTCue>();
      const duration = Number.isFinite(this.video.duration) ? this.video.duration : Infinity;
      let availableAt = 0;
      for (const comment of comments) {
        const start = Math.max(0, comment.time);
        const end = Math.min(duration, start + 3.8);
        if (!Number.isFinite(start) || start < availableAt || end <= start) continue;
        const characters = Array.from(comment.text.replace(/\s+/g, ' ').trim());
        if (!characters.length) continue;
        const text = (characters.length > 36 ? characters.slice(0, 35).join('') + '…' : characters.join(''))
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const key = JSON.stringify([start, end, text]);
        const cue = this.cues.get(key) || new VTTCue(start, end, text);
        // One short caption at a time; let the native player choose safe placement.
        wanted.set(key, cue);
        availableAt = end;
      }
      for (const [key, cue] of this.cues) if (!wanted.has(key)) { this.track.removeCue(cue); this.cues.delete(key); }
      for (const [key, cue] of wanted) if (!this.cues.has(key)) { this.track.addCue(cue); this.cues.set(key, cue); }
      return true;
    } catch {
      this.clear();
      return false;
    }
  }
}

export function nativeDanmakuTrack(video: HTMLVideoElement) {
  let manager = tracks.get(video);
  if (!manager) { manager = new NativeDanmakuTrack(video); tracks.set(video, manager); }
  return manager;
}
