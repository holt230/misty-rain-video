import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibraryConfigStore, PlaybackCacheRepository, QuarkCredentialStore } from '../server/storage.js';
import { QuarkGateway } from '../server/quarkGateway.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '..', 'data');
const user = { username: 'admin', folder: 'admin', role: 'admin' };
const gateway = new QuarkGateway({
  credentialStore: new QuarkCredentialStore(dataDir),
  playbackCache: new PlaybackCacheRepository(dataDir),
  libraryConfigStore: new LibraryConfigStore(dataDir)
});

const library = await gateway.listLibrary(user);
const target = library.find(item => item.title === (process.argv[2] || '仙逆')) || library[0];
const report = {
  library: library.map(item => ({ title: item.title, category: item.category })),
  playback: null
};

if (target) {
  const session = await gateway.createPlaybackSession({ quarkFid: target.quarkFid, title: target.title }, user);
  const prepared = await gateway.prepareEpisode(session.sessionId, session.episodes[0].fid, user);
  const firstSource = prepared.sources[0];
  let manifest = null;
  if (firstSource?.isHls) {
    const sourceState = gateway.getStreamSource(session.sessionId, firstSource.id, user);
    const response = await gateway.fetchMedia(sourceState.source.upstreamUrl);
    const text = await response.text();
    const audioMetadata = text.split(/\r?\n/)
      .filter(line => /dolby|eac3|ec-3|ac-3|atmos|audio|codec|channel/i.test(line))
      .slice(0, 20)
      .map(line => line
        .replace(/URI=("|')[^"']+(\1)/gi, 'URI="$REDACTED"')
        .replace(/https?:\/\/[^\s,"']+/gi, '$REDACTED_URL'));
    manifest = {
      sourceHost: new URL(sourceState.source.upstreamUrl).hostname,
      httpStatus: response.status,
      audioRenditionCount: (text.match(/#EXT-X-MEDIA:[^\n]*TYPE=AUDIO/gi) || []).length,
      subtitleRenditionCount: (text.match(/#EXT-X-MEDIA:[^\n]*TYPE=SUBTITLES/gi) || []).length,
      codecs: [...new Set([...text.matchAll(/CODECS="([^"]+)"/gi)].map(match => match[1]))],
      hasDolbyMarker: /dolby|eac3|ec-3|ac-3|atmos/i.test(text),
      audioMetadata
    };
  }
  report.playback = {
    title: session.title,
    episodeCount: session.episodes.length,
    firstEpisode: session.episodes[0].fileName,
    transferredDuringPlayback: prepared.transferred,
    sources: prepared.sources.map(source => ({
      label: source.label,
      resolution: source.resolution,
      width: source.width,
      height: source.height,
      fps: source.fps,
      codec: source.codec,
      mimeType: source.mimeType,
      isHls: source.isHls
    })),
    audioTracks: prepared.audioTracks.map(track => ({
      label: track.label,
      language: track.language,
      codec: track.codec,
      channels: track.channels
    })),
    manifest
  };
}

console.log(JSON.stringify(report, null, 2));
