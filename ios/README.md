# 烟雨影视 · iPhone 样机

这是 SwiftUI + AVPlayer 的首版真机样机，复用现有烟雨影视网站账号、片库和播放记录。推荐、在线找片、入库、补集和弹幕仍在网页版，未改动生产服务。

## 不装 Xcode 的安装方式

1. 在 GitHub Actions 的 **iOS 样机 IPA** 运行记录下载 `MistyRain-iOS-pilot`，解压得到 `MistyRain-unsigned.ipa`。它是未签名的设备包，不能直接点开安装。
2. 在自己的 Mac 上安装 AltServer，用 USB 连接并解锁 iPhone，按 AltServer 提示安装 AltStore Classic。Apple 账号只在自己的设备上使用，不交给编译服务。
3. 把 IPA 放到 iPhone 的「文件」，在 AltStore Classic 的 **My Apps → +** 选中 IPA。如果 iOS 提示启用开发者模式，按系统提示操作。免费签名到期前用 AltStore 刷新。
4. 打开烟雨影视，用原来的站点账号登录。进片库选一部已保存的剧，检查画面、声音、全屏横转、切换剧集，再返回重进确认续播；有回声时可对比「兼容播放」。

不提交 Apple 账号或签名证书到仓库。云端构建工作流只给样机分支生成 IPA，不发布镜像，也不安装 App。
