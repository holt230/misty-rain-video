import Foundation

@main
enum PlaybackSelectionTests {
    static func main() throws {
        let endpoint = MistyAPI().endpoint
        precondition(endpoint.api(["api", "auth", "session"]).absoluteString == "https://linlunji.cn/misty-rain/api/auth/session")
        precondition(endpoint.asset("/api/player/sessions/s/streams/r")?.path == "/misty-rain/api/player/sessions/s/streams/r")
        precondition(endpoint.asset("/misty-rain/api/player/sessions/s/streams/r")?.path == "/misty-rain/api/player/sessions/s/streams/r")
        precondition(endpoint.asset("http://linlunji.cn/video.mp4") == nil)
        precondition(!endpoint.matchesOrigin(URL(string: "https://media.example.net/video.mp4")))

        let media = Media(id: "tv-1", title: "样片", category: "tv", poster: nil, quarkFid: "library-1",
                          quarkShareUrl: nil, quarkPasscode: nil, localEpisodeCount: 2)
        let episodes = [Episode(fid: "episode-3", fileName: "3.mp4", episodeNumber: 3, episodeTitle: ""),
                        Episode(fid: "episode-5", fileName: "5.mp4", episodeNumber: 5, episodeTitle: "第五集")]
        func history(fid: String, completed: Bool) -> ViewingEntry {
            ViewingEntry(id: "h", media: media, episodeFid: fid, episodeNumber: 3, episodeTitle: "",
                         position: 41, duration: 90, completed: completed, updatedAt: "")
        }
        let active = history(fid: "episode-3", completed: false)
        precondition(PlaybackSelection.initialEpisode(episodes, history: active)?.fid == "episode-3")
        precondition(active.canResume(episodes[0]) && !active.canResume(episodes[1]))
        precondition(PlaybackSelection.initialEpisode(episodes, history: history(fid: "episode-3", completed: true))?.episodeNumber == 5)
        precondition(PlaybackSelection.initialEpisode(episodes, history: history(fid: "deleted", completed: false))?.episodeNumber == 3)
        precondition(PlaybackSelection.initialEpisode([], history: nil) == nil)

        let found = [
            PlaybackSource(id: "mkv", label: "", resolution: "original", height: 2160, isHls: false,
                           delivery: "direct", mimeType: "video/x-matroska", url: "/api/mkv", proxyUrl: nil),
            PlaybackSource(id: "proxy", label: "", resolution: "super", height: 1080, isHls: false,
                           delivery: "proxy", mimeType: "video/mp4", url: "/api/proxy", proxyUrl: nil),
            PlaybackSource(id: "direct", label: "", resolution: "high", height: 720, isHls: true,
                           delivery: "direct", mimeType: "application/vnd.apple.mpegurl", url: "https://media.example.net/p.m3u8", proxyUrl: nil)
        ]
        precondition(PlaybackSource.preferred(found)?.id == "direct")
        precondition(PlaybackSource.preferred(Array(found.prefix(2)))?.id == "proxy")
        precondition(PlaybackSource.preferred([found[0]]) == nil)
        print("iOS endpoint, source selection and resume checks passed")
    }
}
