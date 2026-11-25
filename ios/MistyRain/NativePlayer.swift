import AVKit
import SwiftUI

@MainActor
final class NativePlayerModel: ObservableObject {
    let player = AVPlayer()
    let media: Media
    private let api: MistyAPI
    private let initialHistory: ViewingEntry?
    private let didSave: (ViewingEntry) -> Void
    private var session: PlaybackSession?
    private var loading: Task<Void, Never>?
    private var writes: Task<Void, Never>?
    private var generation = 0
    private var statusObservation: NSKeyValueObservation?
    private var active: (episode: Episode, sessionId: String, resumedAt: Double, didStart: Bool)?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var lastSaved = -1.0
    private var lastCompleted = false

    @Published private(set) var episodes: [Episode] = []
    @Published private(set) var selectedID: String?
    @Published private(set) var busy = false
    @Published private(set) var problem: String?
    @Published private(set) var sourceLabel: String?
    @Published private(set) var compatible = false

    init(media: Media, history: ViewingEntry?, api: MistyAPI, didSave: @escaping (ViewingEntry) -> Void) {
        self.media = media
        self.initialHistory = history
        self.api = api
        self.didSave = didSave
    }

    func start() {
        guard session == nil, !busy else { return }
        load(episode: nil, compatible: false, resume: nil)
    }

    func select(_ episode: Episode) {
        guard selectedID != episode.fid || problem != nil else { return }
        load(episode: episode, compatible: false, resume: nil)
    }

    func retry(compatible: Bool) {
        let episode = episodes.first { $0.fid == selectedID }
        let position = active?.episode.fid == episode?.fid ? player.currentTime().seconds : nil
        load(episode: episode, compatible: compatible, resume: position)
    }

    private func load(episode: Episode?, compatible: Bool, resume: Double?) {
        saveProgress()
        loading?.cancel()
        disconnectObservers()
        player.pause()
        player.replaceCurrentItem(with: nil)
        active = nil
        generation += 1
        let attempt = generation
        busy = true
        problem = nil
        sourceLabel = nil
        self.compatible = compatible
        if let episode { selectedID = episode.fid }

        loading = Task { [weak self] in
            guard let self else { return }
            do {
                let playback: PlaybackSession
                if let cached = self.session {
                    playback = cached
                } else {
                    playback = try await api.open(media)
                    try Task.checkCancellation()
                    guard attempt == generation else { return }
                    self.session = playback
                }
                episodes = playback.episodes
                guard let next = episode ?? PlaybackSelection.initialEpisode(episodes, history: initialHistory) else {
                    throw MistyError.noEpisodes
                }
                selectedID = next.fid
                let list = try await api.sources(session: playback.sessionId, episode: next, compatible: compatible)
                try Task.checkCancellation()
                guard attempt == generation else { return }
                guard let source = PlaybackSource.preferred(list),
                      let url = api.endpoint.asset(source.url) else {
                    throw MistyError.noSource
                }
                let savedPosition = initialHistory.flatMap { $0.canResume(next) ? $0.position : nil } ?? 0
                let position = resume.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? savedPosition
                beginItem(url: url, episode: next, sessionId: playback.sessionId, position: position, generation: attempt)
                let transport = source.delivery == "direct" ? "直连" : source.delivery == "proxy" ? "中转" : ""
                sourceLabel = [source.label, transport].filter { !$0.isEmpty }.joined(separator: " · ")
            } catch {
                guard !Task.isCancelled, attempt == generation else { return }
                busy = false
                problem = error.localizedDescription
            }
        }
    }

    private func beginItem(url: URL, episode: Episode, sessionId: String, position: Double, generation attempt: Int) {
        let cookies = api.cookies(for: url)
        let asset = AVURLAsset(url: url, options: cookies.isEmpty ? nil : [AVURLAssetHTTPCookiesKey: cookies])
        let item = AVPlayerItem(asset: asset)
        active = (episode, sessionId, position, false)
        lastSaved = position
        lastCompleted = false
        player.replaceCurrentItem(with: item)
        statusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in self?.handleItemStatus(generation: attempt) }
        }
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 12, preferredTimescale: 600), queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == attempt else { return }
                self.saveProgress()
            }
        }
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == attempt else { return }
                self.saveProgress(completed: true)
            }
        }
    }

    private func handleItemStatus(generation attempt: Int) {
        guard generation == attempt, let item = player.currentItem, let active else { return }
        switch item.status {
        case .failed:
            busy = false
            problem = "当前视频无法播放。可重试，或切换兼容播放。"
        case .readyToPlay:
            busy = false
            guard !active.didStart else { return }
            self.active?.didStart = true
            let duration = item.duration.seconds
            let target = duration.isFinite && duration > 0 ? min(active.resumedAt, max(0, duration - 1)) : active.resumedAt
            if target > 0 {
                player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] ok in
                    guard ok else { return }
                    Task { @MainActor [weak self] in
                        guard let self, self.generation == attempt else { return }
                        self.player.play()
                    }
                }
            } else {
                player.play()
            }
        default: break
        }
    }

    func saveProgress(completed: Bool = false) {
        guard let active, active.didStart, let item = player.currentItem, item.status == .readyToPlay else { return }
        let position = player.currentTime().seconds
        let duration = item.duration.seconds
        guard position.isFinite, position > 0, duration.isFinite, duration > 0 else { return }
        let finished = completed || (lastCompleted && abs(position - lastSaved) < 1)
        guard abs(position - lastSaved) >= 1 || finished != lastCompleted else { return }
        lastSaved = position
        lastCompleted = finished
        let update = ProgressUpdate(media: media, playbackSessionId: active.sessionId, episodeFid: active.episode.fid,
                                    episodeNumber: active.episode.episodeNumber, episodeTitle: active.episode.label,
                                    position: position, duration: duration, completed: finished)
        let previous = writes
        writes = Task { [api, didSave] in
            await previous?.value
            if let result = try? await api.save(update) { didSave(result) }
        }
    }

    func close() {
        saveProgress()
        generation += 1
        loading?.cancel()
        disconnectObservers()
        player.pause()
        player.replaceCurrentItem(with: nil)
        active = nil
    }

    private func disconnectObservers() {
        statusObservation = nil
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        timeObserver = nil
        endObserver = nil
    }
}

struct NativePlayer: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.showsPlaybackControls = true
        controller.allowsPictureInPicturePlayback = false
        controller.videoGravity = .resizeAspect
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player { controller.player = player }
    }
}

struct PlaybackScreen: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject var model: NativePlayerModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                NativePlayer(player: model.player)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .background(.black)
                    .accessibilityLabel("影片播放器")

                if model.busy {
                    ProgressView("正在准备播放…")
                }
                if let problem = model.problem {
                    Text(problem).foregroundStyle(.secondary)
                    Button("重试") { model.retry(compatible: model.compatible) }
                        .buttonStyle(.bordered)
                }
                HStack {
                    if let sourceLabel = model.sourceLabel {
                        Text(sourceLabel).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if model.selectedID != nil && !model.busy {
                        Button(model.compatible ? "恢复原片源" : "兼容播放") {
                            model.retry(compatible: !model.compatible)
                        }
                        .font(.subheadline)
                    }
                }
                if !model.episodes.isEmpty {
                    Text("选集").font(.headline)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 115), spacing: 8)], spacing: 8) {
                        ForEach(model.episodes) { episode in
                            Button { model.select(episode) } label: {
                                Text(episode.label)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.center)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }
                            .buttonStyle(.bordered)
                            .tint(model.selectedID == episode.id ? .orange : .secondary)
                            .accessibilityAddTraits(model.selectedID == episode.id ? .isSelected : [])
                        }
                    }
                }
            }
            .padding()
        }
        .navigationTitle(model.media.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { model.start() }
        .onChange(of: scenePhase) { _, next in
            if next == .background { model.saveProgress() }
        }
        .onDisappear { model.close() }
    }
}
