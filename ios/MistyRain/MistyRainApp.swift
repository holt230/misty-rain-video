import SwiftUI

@main
struct MistyRainApp: App {
    @StateObject private var model = LibraryModel()

    var body: some Scene {
        WindowGroup {
            Group {
                if model.starting {
                    ProgressView("正在连接烟雨影视…")
                } else if model.user != nil {
                    LibraryScreen(model: model)
                } else {
                    LoginScreen(model: model)
                }
            }
            .tint(Color(red: 0.67, green: 0.45, blue: 0.20))
            .task { await model.restore() }
        }
    }
}

@MainActor
final class LibraryModel: ObservableObject {
    let api = MistyAPI()
    @Published private(set) var user: AuthSession.User?
    @Published private(set) var starting = true
    @Published private(set) var busy = false
    @Published private(set) var items: [Media] = []
    @Published private(set) var history: [ViewingEntry] = []
    @Published private(set) var problem: String?
    @Published private(set) var historyProblem: String?
    private var revision = 0

    func restore() async {
        guard starting else { return }
        defer { starting = false }
        do {
            let session = try await api.currentSession()
            user = session.authenticated ? session.user : nil
        } catch { problem = error.localizedDescription }
    }

    func login(_ username: String, _ password: String) async {
        guard !busy else { return }
        busy = true
        problem = nil
        defer { busy = false }
        do {
            let session = try await api.login(username: username.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            guard session.authenticated, let user = session.user else { throw MistyError.invalidResponse }
            self.user = user
        } catch { problem = error.localizedDescription }
    }

    func refresh() async {
        guard user != nil, !busy else { return }
        busy = true
        problem = nil
        historyProblem = nil
        let atStart = revision
        defer { busy = false }
        async let films = api.library()
        async let entries = api.history()
        do {
            items = try await films
        } catch MistyError.sessionExpired {
            clearSession(message: MistyError.sessionExpired.localizedDescription)
            return
        } catch { problem = error.localizedDescription }
        do {
            let latest = try await entries
            if atStart == revision { history = latest }
        } catch MistyError.sessionExpired {
            clearSession(message: MistyError.sessionExpired.localizedDescription)
        } catch { historyProblem = "观看记录未能同步，暂不提供历史进度。可下拉重试。" }
    }

    func logout() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await api.logout()
            clearSession(message: nil)
        } catch { problem = error.localizedDescription }
    }

    func progress(for media: Media) -> ViewingEntry? {
        history.first { $0.media.matches(media) }
    }

    func player(for media: Media) -> NativePlayerModel {
        let owner = user?.username
        return NativePlayerModel(media: media, history: progress(for: media), api: api) { [weak self] entry in
            guard let self, let owner, self.user?.username == owner else { return }
            self.revision += 1
            self.history.removeAll { $0.media.matches(entry.media) }
            self.history.insert(entry, at: 0)
        }
    }

    private func clearSession(message: String?) {
        user = nil
        items = []
        history = []
        historyProblem = nil
        problem = message
        revision += 1
    }
}

private struct LoginScreen: View {
    @ObservedObject var model: LibraryModel
    @State private var username = ""
    @State private var password = ""
    @FocusState private var focus: Field?
    private enum Field { case username, password }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("用户名", text: $username)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .focused($focus, equals: .username)
                        .onSubmit { focus = .password }
                    SecureField("密码", text: $password)
                        .textContentType(.password)
                        .submitLabel(.go)
                        .focused($focus, equals: .password)
                        .onSubmit(login)
                } header: {
                    Text("使用烟雨影视的网页账号登录")
                } footer: {
                    Text("连接 linlunji.cn · 不需要 Apple 账号或网盘密码")
                }
                Section {
                    Button("登录", action: login)
                        .disabled(model.busy || username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)
                    if model.busy { ProgressView("正在登录…") }
                    if let problem = model.problem {
                        Text(problem).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("烟雨影视")
        }
    }

    private func login() {
        guard !model.busy, !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !password.isEmpty else { return }
        focus = nil
        let value = password
        password = ""
        Task { await model.login(username, value) }
    }
}

private struct LibraryScreen: View {
    @ObservedObject var model: LibraryModel
    @State private var category = "all"
    @State private var query = ""
    @State private var navigation: [Media] = []

    private let categories = [("all", "全部"), ("tv", "电视剧"), ("movie", "电影"), ("anime", "动漫"), ("variety", "综艺")]
    private var visibleItems: [Media] {
        let keyword = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return model.items.filter { item in
            (category == "all" || item.category == category) && (keyword.isEmpty || item.title.localizedCaseInsensitiveContains(keyword))
        }
    }

    var body: some View {
        NavigationStack(path: $navigation) {
            List {
                Section {
                    Picker("分类", selection: $category) {
                        ForEach(categories, id: \.0) { category in Text(category.1).tag(category.0) }
                    }
                }
                if let error = model.problem {
                    Section {
                        Text(error)
                        Button("重新加载") { Task { await model.refresh() } }
                    }
                }
                if let error = model.historyProblem {
                    Text(error).font(.footnote).foregroundStyle(.secondary)
                }
                Section("影片") {
                    if model.busy && model.items.isEmpty {
                        ProgressView("正在读取片库…")
                    } else if visibleItems.isEmpty && model.problem == nil {
                        Text(query.isEmpty ? "这个分类暂时没有影片" : "没有找到匹配的片库影片")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(visibleItems) { item in
                        NavigationLink(value: item) { row(item) }
                            .disabled(!item.playable)
                    }
                }
            }
            .navigationTitle("我的片库")
            .searchable(text: $query, prompt: "搜索已保存的影片")
            .refreshable { await model.refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if let user = model.user { Text(user.username) }
                        Button("刷新片库") { Task { await model.refresh() } }
                        Button("退出登录", role: .destructive) { Task { await model.logout() } }
                    } label: {
                        Label("账户", systemImage: "person.crop.circle")
                    }
                    .disabled(model.busy)
                }
            }
            .navigationDestination(for: Media.self) { item in
                PlaybackScreen(model: model.player(for: item))
            }
            .task { await model.refresh() }
        }
    }

    private func row(_ media: Media) -> some View {
        HStack(spacing: 14) {
            AsyncImage(url: model.api.endpoint.asset(media.poster)) { state in
                if let image = state.image {
                    image.resizable().scaledToFill()
                } else {
                    ZStack {
                        Color.secondary.opacity(0.12)
                        Image(systemName: "film").foregroundStyle(.secondary)
                    }
                }
            }
            .frame(width: 90, height: 56)
            .clipShape(.rect(cornerRadius: 8))
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(media.title).font(.headline).lineLimit(2)
                Text(summary(media)).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func summary(_ media: Media) -> String {
        if !media.playable { return "暂无可播放版本" }
        if let entry = model.progress(for: media), !entry.completed, entry.position > 0 {
            return entry.episodeNumber > 0 ? "续看第 \(entry.episodeNumber) 集" : "继续观看"
        }
        if let count = media.localEpisodeCount, count > 0, media.category != "movie" {
            return media.category == "variety" ? "可看 \(count) 期" : "可看 \(count) 集"
        }
        return media.categoryName
    }
}
