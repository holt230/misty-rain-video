import Foundation

struct Media: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let category: String
    let poster: String?
    let quarkFid: String?
    let quarkShareUrl: String?
    let quarkPasscode: String?
    let localEpisodeCount: Int?

    var playable: Bool { !(quarkFid ?? "").isEmpty || !(quarkShareUrl ?? "").isEmpty }
    var categoryName: String {
        ["tv": "电视剧", "movie": "电影", "anime": "动漫", "variety": "综艺"][category] ?? "影片"
    }

    func matches(_ other: Media) -> Bool {
        if let fid = quarkFid, !fid.isEmpty, let otherFID = other.quarkFid, !otherFID.isEmpty {
            return fid == otherFID
        }
        return id == other.id
    }
}

struct Episode: Decodable, Identifiable {
    let fid: String
    let fileName: String
    let episodeNumber: Int
    let episodeTitle: String
    var id: String { fid }
    var label: String {
        if !episodeTitle.isEmpty { return episodeTitle }
        return episodeNumber > 0 ? "第 \(episodeNumber) 集" : fileName
    }
}

struct PlaybackSession: Decodable {
    let sessionId: String
    let episodes: [Episode]
}

struct PlaybackSource: Decodable, Identifiable {
    let id: String
    let label: String
    let resolution: String
    let height: Int?
    let isHls: Bool
    let delivery: String?
    let mimeType: String?
    let url: String
    let proxyUrl: String?

    var isNativeFormat: Bool {
        if isHls { return true }
        let mime = mimeType?.lowercased() ?? ""
        return mime.isEmpty || mime == "application/octet-stream" || mime.contains("mp4") || mime.contains("quicktime")
    }

    static func preferred(_ list: [Self]) -> Self? {
        let native = list.filter(\.isNativeFormat)
        let directHLS = native.filter { $0.delivery == "direct" && $0.isHls }
        let direct = native.filter { $0.delivery == "direct" }
        let pool = !directHLS.isEmpty ? directHLS : !direct.isEmpty ? direct : native
        let efficient = pool.filter { ($0.height ?? 0) > 0 && ($0.height ?? 0) <= 1080 }
        return efficient.max { ($0.height ?? 0) < ($1.height ?? 0) }
            ?? pool.first(where: { $0.resolution == "super" || $0.resolution == "high" })
            ?? pool.first
    }
}

struct ViewingEntry: Decodable, Identifiable {
    let id: String
    let media: Media
    let episodeFid: String
    let episodeNumber: Int
    let episodeTitle: String
    let position: Double
    let duration: Double
    let completed: Bool
    let updatedAt: String

    func canResume(_ episode: Episode) -> Bool {
        !completed && episode.fid == episodeFid && position.isFinite && position > 0
    }
}

struct ProgressUpdate: Encodable {
    let media: Media
    let playbackSessionId: String
    let episodeFid: String
    let episodeNumber: Int
    let episodeTitle: String
    let position: Double
    let duration: Double
    let completed: Bool
}

enum PlaybackSelection {
    static func initialEpisode(_ episodes: [Episode], history: ViewingEntry?) -> Episode? {
        guard let history, let i = episodes.firstIndex(where: { $0.fid == history.episodeFid }) else {
            return episodes.first
        }
        if history.completed && i + 1 < episodes.count { return episodes[i + 1] }
        return episodes[i]
    }
}

struct AuthSession: Decodable {
    struct User: Decodable { let username: String }
    let authenticated: Bool
    let user: User?
}

enum MistyError: LocalizedError {
    case sessionExpired
    case invalidResponse
    case noEpisodes
    case noSource
    case server(String)

    var errorDescription: String? {
        switch self {
        case .sessionExpired: return "登录已过期，请重新登录。"
        case .invalidResponse: return "烟雨影视服务器返回了无法识别的内容。"
        case .noEpisodes: return "片库里没有可播放的视频。"
        case .noSource: return "未取得 iPhone 可播放的片源。可试试兼容播放。"
        case .server(let message): return message
        }
    }
}

struct MistyEndpoint {
    let base: URL

    func api(_ segments: [String]) -> URL {
        segments.reduce(base) { url, segment in
            url.appendingPathComponent(segment, isDirectory: false)
        }
    }

    func asset(_ value: String?) -> URL? {
        guard let value, !value.isEmpty else { return nil }
        if value.hasPrefix("/api/") { return URL(string: String(value.dropFirst()), relativeTo: base)?.absoluteURL }
        guard let url = URL(string: value, relativeTo: base)?.absoluteURL,
              url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }

    func matchesOrigin(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == base.scheme && url.host == base.host && (url.port ?? 443) == (base.port ?? 443)
    }
}

private final class MistyRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        guard let original = task.originalRequest?.url,
              MistyEndpoint(base: original).matchesOrigin(request.url),
              task.originalRequest?.httpMethod == request.httpMethod else {
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }
}

final class MistyAPI {
    private struct Envelope<T: Decodable>: Decodable {
        let code: Int?
        let data: T?
        let message: String?

        enum CodingKeys: CodingKey { case code, data, message }
        init(from decoder: Decoder) throws {
            let fields = try decoder.container(keyedBy: CodingKeys.self)
            code = try? fields.decode(Int.self, forKey: .code)
            message = try fields.decodeIfPresent(String.self, forKey: .message)
            data = code == 0 ? try fields.decodeIfPresent(T.self, forKey: .data) : nil
        }
    }
    private struct Empty: Encodable {}
    private struct Credentials: Encodable { let username: String; let password: String }
    private struct OpenSession: Encodable {
        let quarkFid: String?
        let shareUrl: String?
        let passcode: String?
        let title: String
    }
    private struct Capability: Encodable { let nativeHls = true }
    private struct Prepared: Decodable { let sources: [PlaybackSource] }

    let endpoint = MistyEndpoint(base: URL(string: "https://linlunji.cn/misty-rain/")!)
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.httpCookieAcceptPolicy = .onlyFromMainDocumentDomain
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config, delegate: MistyRedirects(), delegateQueue: nil)
    }

    func currentSession() async throws -> AuthSession {
        try await read(["api", "auth", "session"])
    }
    func login(username: String, password: String) async throws -> AuthSession {
        try await request(["api", "auth", "login"], method: "POST", body: Credentials(username: username, password: password))
    }
    func logout() async throws {
        let _: AuthSession = try await request(["api", "auth", "logout"], method: "POST", body: Empty())
    }
    func library() async throws -> [Media] { try await read(["api", "media-cards"]) }
    func history() async throws -> [ViewingEntry] { try await read(["api", "playback-history"]) }
    func open(_ media: Media) async throws -> PlaybackSession {
        try await request(["api", "player", "sessions"], method: "POST", body: OpenSession(
            quarkFid: media.quarkFid, shareUrl: media.quarkShareUrl, passcode: media.quarkPasscode, title: media.title
        ))
    }
    func sources(session id: String, episode: Episode, compatible: Bool) async throws -> [PlaybackSource] {
        let result: Prepared = try await request(
            ["api", "player", "sessions", id, "episodes", episode.fid, compatible ? "compatible-audio" : "prepare"],
            method: "POST", body: Capability()
        )
        return result.sources.filter(\.isNativeFormat)
    }
    func save(_ update: ProgressUpdate) async throws -> ViewingEntry {
        try await request(["api", "playback-history"], method: "PUT", body: update)
    }
    func cookies(for url: URL) -> [HTTPCookie] {
        guard endpoint.matchesOrigin(url) else { return [] }
        return session.configuration.httpCookieStorage?.cookies(for: endpoint.base) ?? []
    }

    private func read<T: Decodable>(_ path: [String]) async throws -> T {
        try await request(path, method: "GET", body: Optional<Empty>.none)
    }

    private func request<T: Decodable, Body: Encodable>(_ path: [String], method: String, body: Body?) async throws -> T {
        var request = URLRequest(url: endpoint.api(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (bytes, reply) = try await session.data(for: request)
        guard let http = reply as? HTTPURLResponse else { throw MistyError.invalidResponse }
        let value = try? JSONDecoder().decode(Envelope<T>.self, from: bytes)
        if !path.starts(with: ["api", "auth"]) && http.statusCode == 401 { throw MistyError.sessionExpired }
        guard (200..<300).contains(http.statusCode), value?.code == 0, let data = value?.data else {
            if let message = value?.message, !message.isEmpty { throw MistyError.server(message) }
            throw MistyError.invalidResponse
        }
        return data
    }
}
