// 云端 AI 通道配置（默认通道：WorkBuddy Cloud）
//
// ─────────────────────────────────────────────────────────────
// 这一份是「对外发布」的版本：publishableKey 故意留空。
// ─────────────────────────────────────────────────────────────
// key 为空时，app.js 的 initAI() 创建云客户端会失败，页面自动落到
// 「史笔回退」（纯本地文案，零成本）。使用者若想拿完整 AI，
// 到「板块 04 → 接入自有 API」填自己的 OpenAI 兼容接口即可——
// 走的是他自己的额度，不会消耗本仓库作者账号的积分。
//
// ─────────────────────────────────────────────────────────────
// 想让「你自己那份」保留云端通道，怎么办？
// ─────────────────────────────────────────────────────────────
// 在本目录新建 cloud-config.local.js（已加入 .gitignore，不会进仓库）：
//
//     window.__WB_LOCAL_CONFIG__ = {
//       publishableKey: "wbpk_你的key"
//     };
//
// 本文件会自动探测并加载它，存在就覆盖下面的默认值。
// 探测失败只是静默跳过，不影响页面。
//
// 云端构建（GitHub Actions）读不到本机文件，改为从仓库 Secret
// `WB_PUBLIC_KEY` 注入同名文件，见 .github/workflows/android.yml。
(function () {
  var BASE = {
    resourceId: "wbcs_FQaP5DGtNIGarPOjtyOcQJ",
    endpoint: "https://sanguozhi-chronicle.app.workbuddy.host",
    publishableKey: ""
  };

  function compose(local) {
    var l = local || {};
    return Object.freeze({
      resourceId: l.resourceId || BASE.resourceId,
      endpoint: l.endpoint || BASE.endpoint,
      // 只接受非空字符串，其余一律视为「未配置」
      publishableKey: typeof l.publishableKey === "string" ? l.publishableKey.trim() : BASE.publishableKey
    });
  }

  // 先按空 key 立即可用，保证任何情况下 window.__WB_PUBLIC_CONFIG__ 都存在
  window.__WB_PUBLIC_CONFIG__ = compose(null);

  // 再异步探测本机私有覆盖；app.js 的 initAI() 会 await 这个 Promise，
  // 所以不存在「配置还没到位就开始握手」的竞态。
  window.__WB_CONFIG_READY__ = new Promise(function (resolve) {
    var script = document.createElement("script");
    script.src = "./cloud-config.local.js";
    script.onload = function () {
      window.__WB_PUBLIC_CONFIG__ = compose(window.__WB_LOCAL_CONFIG__);
      resolve(window.__WB_PUBLIC_CONFIG__);
    };
    script.onerror = function () {
      // 文件不存在（发布版本）属正常情况，静默跳过
      resolve(window.__WB_PUBLIC_CONFIG__);
    };
    document.head.appendChild(script);
  });
})();
