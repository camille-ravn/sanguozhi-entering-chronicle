# 《三国志·入世录》

一个关于三国正史的单页互动原型。纯静态前端（HTML / CSS / 原生 JS），**无构建步骤**，双击 `index.html` 即可打开。

## 五个板块

| | 板块 | 做什么 |
| --- | --- | --- |
| 01 | 全书底座 | 魏书 / 蜀书 / 吴书的卷目总览，可筛选、检索 |
| 02 | 人物关系 | 核心人物关系图，可拖拽、缩放、按阵营筛选 |
| 03 | 原典阅读 | 把《三国志》正文变成横版跳跃关卡——每个字是路，标点是障碍，读到哪里算到哪里 |
| 04 | 入世冒险 | 捏一个 OC 放进真实历史时点，由「史官」续写；史实大势固定，局部命运向你开放 |
| 05 | 食货志 | 经济自走棋：在钱与谷帛、铸币与通胀、编户与荫客之间取舍，敌方也像你一样招募、升星、布阵 |

## 快速开始

```bash
git clone <repo>
cd <repo>
# 方式一：直接双击 index.html
# 方式二：起个静态服务器（推荐，避免 file:// 的个别限制）
python -m http.server 8000
```

无需安装依赖，无需打包。

## 板块 04 的 AI 说明（重要）

AI 旁白是**可选增强**。页面有三级通道，打开时自动选择：

### 1. 自带 API（推荐 · 任何域名都能满血跑）

点面板 04 右上角「**接入自有 API**」，填三样即可：

| 字段 | 说明 | 例子 |
| --- | --- | --- |
| 接口地址 | OpenAI 兼容的 Base URL | `https://openrouter.ai/api/v1` |
| API Key | 你自己的 key | `sk-...` |
| 模型名 | 该接口支持的模型 | `deepseek/deepseek-chat` |

- 配置只存在**你自己的浏览器**（`localStorage` 键名 `sgz.byok`），不上传、不入库。
- 推荐 **OpenRouter**，或本地 **LM Studio / Ollama**（如 `http://localhost:1234/v1`）。部分厂商（例如原生 OpenAI）默认不允许浏览器跨域直连，会提示「无法连接」。
- ⚠️ key 存在浏览器里等同于明文。请**不要填付费工作账号的 key**。

### 2. 默认云端通道（**本仓库里已按「对外发布」置空**）

不填自带 key 时，页面本会尝试走项目作者部署的 WorkBuddy Cloud 服务。但那个通道的 `publishableKey` 指向作者自己的账号，**任何人用它都会消耗作者的额度**——所以仓库里的 [`cloud-config.js`](./cloud-config.js) 把 key **故意留空**了。

因此别人 clone 下来打开，得到的是「史笔回退」；想要完整 AI，走上面的自带 API 那条路。

作者自己那份怎么保留云端？在本目录放一个 `cloud-config.local.js`（**已 gitignore，不会进仓库**）：

```js
window.__WB_LOCAL_CONFIG__ = { publishableKey: "wbpk_..." };
```

`cloud-config.js` 会自动探测并加载它；文件不存在就静默跳过。

> 补充：该云端服务除了认 key，还按**来源域名**校验。实测白名单包含服务自身域名与 `localhost` 系列，**GitHub Pages 这类外域会被拒绝**。另外不带 `Origin` 头的裸请求不在拦截范围内，所以「key 留在前端」这件事本身只适合当作软性限制，别当硬防线。

### 3. 本地「史笔回退」

上面两条都不通时，自动切到内置的本地叙事分支——**功能完整、照常可玩**，只是旁白由本地脚本按规则生成，而非 AI 实时执笔。

> 一句话：**别人 clone 下来开箱即玩（史笔版）；想要完整 AI，填自己的 key 即可。**

## 目录结构

```
index.html              入口：五个板块 + 各弹窗
styles.css              全部样式（新粗野主义）
app.js                  板块 01/02/04 逻辑 + AI 三级通道
data.js                 人物 / 关系 / 事件 / 卷目数据
wiki-bios.js            人物资料卡数据
reading.js              板块 03 横版跳跃引擎
reading-texts.js        板块 03 正文（22 篇）
data-05-shihuozhi.js    板块 05 数据层
shihuozhi.js            板块 05 引擎
cloud-config.js         云端通道配置（对外发布版，key 留空）
cloud-config.local.js   本机私有覆盖，含真实 key（可选，已 gitignore）
```

> **三级通道的优先级**：自带 API（`localStorage`）> 云端（有 key 才启用）> 史笔回退。
> `cloud-config.js` 会异步探测 `cloud-config.local.js`，`app.js` 在握手前 await 这个探测，所以没有竞态。

> 板块 03 的地形由种子随机生成，每次打开或点「换个排版」都是新布局；种子存 `localStorage` 键 `sgz.reading.seed`。
> 板块 05 每局由种子决定；敌方每回合在你看不见的地方招募、升星、布阵，你只能看到它最终摆出的阵容。

## 原作与素材

- 原典：陈寿《三国志》及裴松之注（公有领域）。
- 正文文本：取自公开的简体整理本。
- 视觉：全部为文字、CSS 几何块与 SVG 关系线，无 AI 绘图。

## 技术备注

- CDN 上的 WorkBuddy Cloud SDK 已**固定版本**（`@tencent-ai/workbuddy-cloud-sdk@0.1.2-dev.1b37f73.202609222026`），以保证行为可复现。
- 所有数据均为静态文件，无后端、无数据库。
