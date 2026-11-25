import SwiftUI
import WebKit

@main
struct MistyRainApp: App {
    var body: some Scene {
        WindowGroup {
            MistyRainSite()
                .ignoresSafeArea()
        }
    }
}

private struct MistyRainSite: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> SiteViewController {
        SiteViewController()
    }

    func updateUIViewController(_ controller: SiteViewController, context: Context) {}
}

private final class SiteViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    // The existing Web Clip launch route sets the standalone flag and deployed asset revision.
    private static let launchURL = URL(string: "https://linlunji.cn/misty-rain/launch/ios")!

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        // The page already accounts for iOS safe areas with viewport-fit=cover.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        view = webView
        webView.load(URLRequest(url: Self.launchURL))
    }

    private func isSiteURL(_ url: URL) -> Bool {
        url.scheme == "https" && url.host == Self.launchURL.host && (url.port ?? 443) == 443
    }

    private func staysInApp(_ url: URL) -> Bool {
        isSiteURL(url) && url.path != "/misty-rain/install/ios.mobileconfig"
    }

    private func openInBrowser(_ url: URL) {
        guard url.scheme == "https" || url.scheme == "http" else { return }
        UIApplication.shared.open(url)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        // Leave embedded frames alone so the existing player can load its providers.
        guard action.targetFrame?.isMainFrame == true, let url = action.request.url else {
            decisionHandler(.allow)
            return
        }
        guard !staysInApp(url) else {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        if action.navigationType == .linkActivated {
            openInBrowser(url)
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard action.navigationType == .linkActivated, let url = action.request.url else { return nil }
        if staysInApp(url) {
            webView.load(action.request)
        } else {
            openInBrowser(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let failure = error as NSError
        guard !(failure.domain == NSURLErrorDomain && failure.code == NSURLErrorCancelled),
              webView.backForwardList.currentItem == nil, presentedViewController == nil else { return }
        let alert = UIAlertController(title: "暂时打不开烟雨影视", message: "检查网络后再试一次。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "重新加载", style: .default) { [weak webView] _ in
            webView?.load(URLRequest(url: Self.launchURL))
        })
        present(alert, animated: true)
    }
}
