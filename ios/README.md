# 烟雨影视 · iPhone 版

iPhone App 用 WebKit 打开描述文件现有的 `/misty-rain/launch/ios` 入口，渲染正式站的同一套页面和播放器。网页、描述文件以及服务端都不需要修改。App 的登录会话独立，首次打开请用原有烟雨影视账号登录。

1. 从 GitHub Actions 的 **iOS 样机 IPA** 下载 `MistyRain-iOS-WebClip`，解压得到 `MistyRain-WebClip-unsigned.ipa`。这是未签名的真机包。
2. 保持 iPhone 解锁、连接运行 AltServer 的 Mac；在手机上的 AltStore Classic 里选择 **My Apps → +**，打开该 IPA 签名安装。按 iOS 提示完成开发者信任或开发者模式设置。
3. 在同一台 iPhone 上对比描述文件和 App 的首页、找片、片库、「我的」和播放页。再检查选集、全屏横屏、弹幕、返回和续看。两种入口可以并存。

工作流仅构建测试包，不发布镜像、不部署正式站，也不需要上传 Apple 账号或签名证书。
