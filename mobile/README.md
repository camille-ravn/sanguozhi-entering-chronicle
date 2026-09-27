# 移动端（Capacitor）

把仓库根目录那套静态页面包成原生 App（Android / iOS）。
**关键改动：启用 `CapacitorHttp`，让页面里的 `fetch` 走原生网络层——完全绕开浏览器 CORS。** 这样用户在 App 里填任意 OpenAI 兼容接口（包括默认不允许跨域直连的厂商）都能通。

> 根目录是页面源码的唯一来源；本目录的 `www/` 是构建产物（`npm run sync:web` 生成，已 gitignore）。**不要手改 `www/`。**

## 最省事：让 GitHub 云端编译（不用装任何东西）

仓库根的 `.github/workflows/android.yml` 会在 GitHub 上自动编译：

1. 把仓库推到 GitHub（默认分支 `main` 或 `master`）。
2. 打开仓库 **Actions** 标签 → 左侧选 **Build Android APK** → **Run workflow**。
3. 跑完（约几分钟）点进那次运行，在页面底部 **Artifacts** 下载 `sanguozhi-debug-apk`，解压得到 `app-debug.apk`。
4. 传到手机安装（需在系统里允许「未知来源 / 安装未知应用」）。

> 产出的是 **debug APK**，适合自己测试和分享；要上架应用商店需另配 release 签名（keystore）。

### 云端编出来的 APK 要不要带云端 AI 通道？

仓库根的 `cloud-config.js` 是**对外发布版**（`publishableKey` 留空），所以 CI 打出来的 APK 默认**不带**云端通道，使用者得自己填 API key（走 `CapacitorHttp` 原生直连）或落到史笔回退。

如果你想让**自己**这份 APK 保留云端通道：

1. 仓库 **Settings → Secrets and variables → Actions → New repository secret**
2. Name 填 `WB_PUBLIC_KEY`，Value 填那个 `wbpk_...`
3. 重新跑一次 workflow

工作流里有一步 `Inject cloud key (optional)` 会把它写成 `cloud-config.local.js`（该文件已 gitignore，不会入库）。不配这个 Secret 也能正常构建。

## 前置依赖（本地构建才需要）

| 目标 | 需要 |
| --- | --- |
| 通用 | **Node.js 22+**（`@capacitor/cli` 8.x 的 `engines.node` 就是 `>=22.0.0`） |
| Android | **JDK 21** + **Android Studio**（含 Android SDK）；或只装 SDK + 命令行工具 |
| iOS | macOS + Xcode（Windows 上无法构建 iOS） |

> **JDK 必须是 21，不能是 17。** `@capacitor/android` 8.x 的 `capacitor/build.gradle` 里写死了
> `sourceCompatibility/targetCompatibility = JavaVersion.VERSION_21`，用 JDK 17 编译会直接报
> `error: invalid source release: 21`。
>
> 另外 Android SDK 侧要装 **`platforms;android-36`**（`compileSdk 36`）与 Build-Tools **36.0.0**。

## 构建步骤

```bash
cd mobile
npm install

# 首次：生成原生工程（二选一或都要）
npm run android:add        # 生成 android/
npm run ios:add            # 生成 ios/（需 macOS）

# 每次改完根目录源码后：同步进原生工程
npm run sync

# 打开 IDE 或直接跑
npm run android:open       # 打开 Android Studio，Run ▶
npm run android:run        # 命令行直接装到已连接的设备/模拟器
```

装好 App 后，在 **板块 04 → 接入自有 API** 里填接口地址 / Key / 模型名即可（配置只存本机）。

## 注意（读一遍能省很多事）

1. **不再逐字流式。** `CapacitorHttp` 会把响应整段缓冲，不像浏览器那样给出可读流。`app.js` 的 `requestStoryByok` 已做兼容：拿不到 `body` 流就退回一次性解析，**最终文字一致，只是整段出现**。想要逐字，得改用原生 SSE 插件（如 `@capacitor-community/http` 之外的流式方案）或自己写原生插件。
2. **「停笔」在原生模式下可能无效。** `CapacitorHttp` 不支持 `AbortSignal`，点了停笔请求仍会跑完（文字照常落盘）。
3. **接口地址若是 `http://`（例如本地 LM Studio `http://192.168.x.x:1234/v1`）**：Android 9+ 默认**禁止明文流量**，会被拦。需要在 `android/app/src/main/AndroidManifest.xml` 的 `<application>` 上加：
   ```xml
   <application ... android:usesCleartextTraffic="true">
   ```
   或改用 https。仅用 https 接口（OpenRouter 等）则无需此步。
4. **CORS 在这里不是问题**——正因为走了原生网络。这也是把页面包成 App 的主要动机。
5. **图标 / 启动图**：用 `npx @capacitor/assets generate` 从一张 1024×1024 图生成，或手动替换 `android/app/src/main/res/` 下的资源。
6. **应用名 / 包名**：改 `capacitor.config.json` 里的 `appName` 与 `appId`（`appId` 用反向域名，全小写）。
7. **`android/` 与 `ios/` 不入库**（见本目录 `.gitignore`）。原生工程每次由 `npx cap add android|ios` 重新生成，云端 CI 也是现生成再编译。代价是：**如果你手动改过 `AndroidManifest.xml` 之类的东西，它们不会被版本控制保留**——真要长期改原生配置，就把 `android/` 从 `.gitignore` 里拿掉并入库，同时把 CI 里的 `npx cap add android` 改成「目录不存在时才生成」。
8. **云端构建踩过的两个坑**（已修，记录备查）：
   - `android-actions/setup-android@v3` 的 `packages` 默认值是 `'tools platform-tools'`，但 Google 早把旧的 `tools` 包从 SDK 仓库下架了，`sdkmanager` 会报 `Failed to find package 'tools'` 并以退出码 1 失败。**必须显式覆盖** `packages`。
   - JDK 必须是 21（见上）。

## 目录

```
capacitor.config.json    Capacitor 配置（CapacitorHttp / androidScheme）
package.json             依赖与脚本
scripts/sync-web.mjs     把仓库根的静态文件同步到 www/
www/                     同步产物（自动生成，勿手改）
android/  ios/           cap add 生成的原生工程
```

## 回退方案（不装工具链也能“当 App 用”）

如果只是想先在手机上试试、不想配 Android SDK：把仓库根目录用任意静态服务器起在本机，手机浏览器访问局域网地址即可——**但这是浏览器环境，CORS 依然存在**，只有上面这套原生封装才真正解决跨域直连。
