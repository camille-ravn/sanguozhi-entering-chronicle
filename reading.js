/* 原典阅读 · 横版跳跃
   ------------------------------------------------------------------
   只有一条生成规则：把一传正文按标点断成「句」，每句铺成一段路面。

   · 段的高度 = 随机游走的坡度（种子决定）
   · 段的间距随坡度自动收窄，保证每一跳都够得着
   · 段内的标点按类别变成物件（语义固定，不随机）：
         ，、            → 低桩         。；：          → 高桩
         ！              → 尖刺         ？             → 弹板
         “”‘’《》        → 悬砖（上方浮一块可踩的砖，自身无害）
   · 约 1/8 的段上方浮一枚「印」，碰到即收
   · 每 32 段一块「歇脚石」：加宽、无标点
   · 标点判定盒随「已读」比例变宽，越往后越紧

   随机的部分全部由种子决定，所以同一篇文本每次进入（或点「换个排版」）
   都会得到一套不同的地形——这就是本模块的“肉鸽”部分：文本不变，关卡重掷。
   纯本地运算，不联网、不上传。
*/
(() => {
  "use strict";

  const CHAPTERS = Array.isArray(window.READING_CHAPTERS) ? window.READING_CHAPTERS : [];
  const panel = document.getElementById("readingPanel");
  if (!CHAPTERS.length || !panel) return;

  const $ = (sel) => panel.querySelector(sel);
  const canvas = $("#readingCanvas");
  const stage = $("#readingStage");
  const overlay = $("#readingOverlay");
  const ctx = canvas.getContext("2d");

  const SERIF = '"Songti SC", "SimSun", "Noto Serif SC", "Source Han Serif SC", serif';
  const MONO = 'ui-monospace, "Cascadia Code", Consolas, monospace';

  // ---------- 标点 -> 物件 ----------
  const P_LOW = "，、";
  const P_HIGH = "。；：";
  const P_SPIKE = "！";
  const P_BOUNCE = "？";
  const P_FLOAT = "“”‘’《》「」『』（）()";

  function kindOf(ch) {
    if (ch === "\n") return "break";
    if (P_LOW.includes(ch)) return "low";
    if (P_HIGH.includes(ch)) return "high";
    if (P_SPIKE.includes(ch)) return "spike";
    if (P_BOUNCE.includes(ch)) return "bounce";
    if (P_FLOAT.includes(ch)) return "float";
    if (/\s/.test(ch)) return "space";
    return "road";
  }
  // 两种障碍，规则不同：
  //   黑墩 low（，、）        → 侧面拦截，撞上停在原地，跳过去继续（顶面可踩）
  //   红块 high（。；：）/！  → 侧面同样拦截，但顶面致命：落在上面才中断阅读
  const isSolid = (k) => k === "low";
  const isLethal = (k) => k === "high" || k === "spike";
  const isHazard = (k) => isSolid(k) || isLethal(k);

  // ---------- 调色（与 styles.css 的变量同源） ----------
  const C = {
    paper: "#f9f5ec",
    paperDeep: "#f1eadf",
    ink: "#111111",
    red: "#b56a58",
    yellow: "#ddc06a",
    blue: "#a3bcc9",
    green: "#8db8a7",
    muted: "#6f6a5e"
  };

  // ---------- 尺寸口径 ----------
  const ROAD_H = 34;      // 路面板厚度
  const HAN_W = 27;       // 汉字占宽
  const PUN_W = 20;       // 标点占宽
  const MIN_SEG = 84;     // 一段路的最小宽度
  const HZ_TALL = { low: 26, high: 34, spike: 44 };   // 标点墩子的高度（low 拦路，其余致命）
  const HZ_MARGIN = 64;   // 起跑留白
  const GRAVITY = 1350;
  const JUMP_V = -540;
  const BOUNCE_V = -700;
  const MAX_FALL = 850;
  const STEP_H = 16;      // 坡度步长
  const Y_MIN = -48;
  const Y_MAX = 48;
  const COYOTE = 0.14;
  const AUTO_SCROLL = 0.78;  // 自动漫步时画框前移速度 = 步速的倍数
  const AUTO_LAG = 0.28;     // 画框前沿最多落在玩家身后多远（视口宽度的倍数）
  const LAG_WARN = 0.16;     // 玩家落到画框左侧这个比例以内就开始警告

  // ---------- 工具 ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fmt = (n) => n.toLocaleString("zh-CN");

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  const seedTag = (n) => n.toString(16).toUpperCase().padStart(8, "0").slice(-4);

  // ---------- 数据 ----------
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* 隐私模式忽略 */
      }
    }
  };
  const K_CHAPTER = "sgz.reading.chapter";
  const K_DONE = "sgz.reading.done";
  const K_SEED = "sgz.reading.seed";

  const game = {
    state: "ready",        // ready | playing | paused | dead | complete
    chapter: null,
    seed: 0,
    surfaces: [],
    solids: [],            // 黑墩（，、）：撞上就停住，跳过去即可，不致死
    spikes: [],            // 红块（。；：、！）：侧面拦路，顶面致命
    floats: [],
    marks: [],
    totalWidth: 0,
    readTotal: 0,
    progress: 0,
    collected: 0,
    camera: 0,
    origin: 0,
    w: 0,
    h: 0,
    safeTime: 0,
    coyote: 0,
    jumpBuffer: 0,
    auto: false,
    autoEdge: -Infinity,   // 自动漫步时画框前沿；-Infinity 表示「待以玩家位置起算」
    speed: 220,
    speedGear: 1,
    dirty: true,
    lastTime: 0,
    deathMark: "，",
    deathKind: "",
    lastSurface: 0,
    checkpoint: { x: 0, surface: 0 },
    flyer: 0,              // 悬砖踩踏计数（仅展示用）
    perfect: false,        // 本篇「印」是否收齐（触发彩蛋）
    player: { x: 0, y: 0, w: 30, h: 42, vx: 0, vy: 0, grounded: true, jumps: 0 }
  };
  const keys = new Set();
  let rafStarted = false;
  let booted = false;
  // 供页面内自测/调试读取关卡状态（不影响玩法）
  window.__SGZ_READING__ = game;

  // ---------- 难度：标点判定盒随已读比例变宽 ----------
  function hazardScale() {
    if (!game.readTotal) return 1;
    const ratio = game.progress / game.readTotal;
    return 1 + 0.45 * clamp(ratio, 0, 1);
  }

  // ============ 生成规则 ============
  function buildLevel(chapter, seed) {
    const rng = mulberry32(seed);
    const text = chapter.paras.join("\n");
    const chars = Array.from(text);

    // 1) 按标点断句：句末标点收束一句；无句读者最多 16 字强制收束
    const sentences = [];
    let run = [];
    chars.forEach((ch, index) => {
      if (ch === "\n") {
        if (run.length) sentences.push(run);
        run = [];
        return;
      }
      run.push({ ch, index, kind: kindOf(ch) });
      if (P_HIGH.includes(ch) || ch === "！" || ch === "？" || run.length >= 16) {
        sentences.push(run);
        run = [];
      }
    });
    if (run.length) sentences.push(run);

    // 2) 逐句铺路：高度随机游走，间距随爬升收窄
    const surfaces = [];
    const solids = [];     // 黑墩（，、）：拦路，顶面可踩
    const spikes = [];     // 红墩（。；：、！）：拦路，顶面致命
    const blockers = [];   // 两类合并、按 x 升序，横向碰撞统一查这张表
    const floats = [];
    const marks = [];
    let x = HZ_MARGIN;
    let y = 0;
    let prevY = 0;

    sentences.forEach((items, i) => {
      let rest = i > 0 && i % 32 === 31;
      if (i > 0) {
        if (rest) {
          y = clamp(Math.round((y + prevY) / 2), -32, 32);      // 歇脚石取缓坡
          x += 52;
        } else {
          const step = Math.round(rng() * 4 - 2);               // -2..2
          const next = clamp(y + step * STEP_H, Y_MIN, Y_MAX);
          const rise = Math.max(0, next - y);
          const gapCap = Math.max(42, 88 - rise * 0.8);         // 越陡，缝越窄
          y = next;
          x += 36 + rng() * (gapCap - 36);
        }
      }
      prevY = y;

      const start = x;
      const glyphs = items.map((it) => {
        const w = it.kind === "road" ? HAN_W : it.kind === "space" ? 13 : PUN_W;
        const glyph = { ch: it.ch, index: it.index, kind: rest ? "plain" : it.kind, x, w };
        x += w;
        return glyph;
      });
      const width = Math.max(i === 0 ? 220 : rest ? 150 : MIN_SEG, x - start);
      x = start + width;

      const p = { x: start, y, w: width, glyphs, rest, index: surfaces.length, road: true, start: items[0].index, end: items[items.length - 1].index + 1 };
      surfaces.push(p);

      glyphs.forEach((glyph) => {
        if (isHazard(glyph.kind)) {
          // 判定盒贴着墩子外形走：拦路的要与视觉同宽，致命的才随难度放宽
          const box = {
            x: glyph.x + 2, w: Math.max(14, glyph.w - 4), top: y - HZ_TALL[glyph.kind],
            base: y + 3, ch: glyph.ch, kind: glyph.kind, surf: p.index
          };
          blockers.push(box);
          if (isSolid(glyph.kind)) solids.push(box);
          else spikes.push(box);
        } else if (glyph.kind === "float") {
          floats.push({ x: glyph.x - 5, y: y - 66, w: glyph.w + 10, h: 12, kind: "float" });
        }
      });

      if (!rest && rng() < 0.125 && i > 2) {
        marks.push({ x: start + width * 0.5, y: y - 96, taken: false, bob: rng() * Math.PI * 2 });
      }
    });

    const all = surfaces.concat(floats).sort((a, b) => a.x - b.x);
    game.chapter = chapter;
    game.seed = seed;
    game.surfaces = surfaces;
    game.allSurfaces = all;
    game.solids = solids;
    game.spikes = spikes;
    game.blockers = blockers;
    game.floats = floats;
    game.marks = marks;
    game.totalWidth = surfaces.length ? surfaces[surfaces.length - 1].x + surfaces[surfaces.length - 1].w : 0;
    game.readTotal = chars.filter((c) => c !== "\n").length;
    game.progress = 0;
    game.collected = 0;
    game.flyer = 0;
    game.perfect = false;

    const first = surfaces[0];
    const p = game.player;
    p.x = first.x + 18;
    p.y = first.y - p.h;
    p.vx = 0;
    p.vy = 0;
    p.grounded = true;
    p.jumps = 0;
    game.camera = 0;
    game.checkpoint = { x: p.x, surface: 0 };
    game.lastSurface = 0;
    game.safeTime = 0;
    game.coyote = 0;
    game.jumpBuffer = 0;
    game.autoEdge = -Infinity;
    game._status = null;
    game._hint = null;
    game._track = null;
    game.dirty = true;
    return chars.length;
  }

  // ============ 画布 ============
  function resize() {
    if (!canvas || panel.hidden) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    game.w = rect.width;
    game.h = rect.height;
    game.origin = Math.round(rect.height * 0.6);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    game.dirty = true;
  }

  function firstSurfaceAt(x) {
    let lo = 0;
    let hi = game.allSurfaces.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (game.allSurfaces[mid].x + game.allSurfaces[mid].w < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function drawGrid(w, h) {
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = C.paperDeep;
    ctx.lineWidth = 1;
    const off = -(game.camera % 28);
    ctx.beginPath();
    for (let gx = off; gx < w; gx += 28) {
      ctx.moveTo(Math.round(gx) + 0.5, 0);
      ctx.lineTo(Math.round(gx) + 0.5, h);
    }
    const offY = game.origin % 28;
    for (let gy = offY; gy < h; gy += 28) {
      ctx.moveTo(0, Math.round(gy) + 0.5);
      ctx.lineTo(w, Math.round(gy) + 0.5);
    }
    ctx.stroke();
  }

  function drawShadowBox(x, y, w, h, fill, stroke = C.ink) {
    ctx.fillStyle = C.ink;
    ctx.fillRect(x + 5, y + 5, w, h);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  }

  function draw() {
    const { w, h, camera, origin } = game;
    drawGrid(w, h);

    // 自动漫步：画框持续前移，左缘就是「掉队线」
    if (game.auto) {
      const near = game.player.x - camera < w * LAG_WARN;
      ctx.save();
      ctx.strokeStyle = near ? C.red : "rgba(181,106,88,.45)";
      ctx.lineWidth = near ? 4 : 3;
      ctx.setLineDash([12, 9]);
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(4, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 地平线
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    ctx.moveTo(0, origin + 70);
    ctx.lineTo(w, origin + 70);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    const from = firstSurfaceAt(camera - 80);
    for (let i = from; i < game.allSurfaces.length; i += 1) {
      const s = game.allSurfaces[i];
      if (s.x > camera + w + 80) break;
      const x = s.x - camera;

      if (s.kind === "float") {
        drawShadowBox(x, s.y + origin, s.w, s.h, C.blue);
        continue;
      }

      const yTop = s.y + origin;
      const bodyFill = s.rest ? C.blue : C.paper;
      ctx.fillStyle = C.ink;
      ctx.fillRect(x + 5, yTop + 5, s.w, ROAD_H);
      ctx.fillStyle = bodyFill;
      ctx.fillRect(x, yTop, s.w, ROAD_H);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, yTop + 1.5, s.w - 3, ROAD_H - 3);

      if (s.rest) {
        ctx.fillStyle = C.ink;
        ctx.font = `900 11px ${MONO}`;
        ctx.fillText("驿", x + s.w - 20, yTop + 23);
      }

      for (const glyph of s.glyphs) {
        const gx = glyph.x - camera;
        if (glyph.kind === "space") continue;
        if (isSolid(glyph.kind)) {
          // 黑墩（，、）：实体拦路物，顶面留一道高光——踩上去能站住
          const tall = HZ_TALL[glyph.kind];
          ctx.fillStyle = C.ink;
          ctx.fillRect(gx + 4, yTop - tall + 5, glyph.w - 2, tall);
          ctx.fillRect(gx + 1, yTop - tall, glyph.w - 2, tall);
          ctx.fillStyle = C.muted;
          ctx.fillRect(gx + 3, yTop - tall + 4, glyph.w - 6, 3);
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 2;
          ctx.strokeRect(gx + 2, yTop - tall + 1, glyph.w - 4, tall - 2);
          ctx.fillStyle = C.ink;
          ctx.font = `26px ${SERIF}`;
          ctx.fillText(glyph.ch, gx, yTop + 25);
        } else if (isLethal(glyph.kind)) {
          // 红块（。；：、！）：侧面只是拦路，顶面带齿——踩上去才中断
          const tall = HZ_TALL[glyph.kind];
          const teeth = 3;
          const tw = (glyph.w - 2) / teeth;
          ctx.fillStyle = C.red;
          ctx.beginPath();
          for (let k = 0; k < teeth; k += 1) {
            const bx = gx + 1 + k * tw;
            ctx.moveTo(bx, yTop - tall + 4);
            ctx.lineTo(bx + tw / 2, yTop - tall - 8);
            ctx.lineTo(bx + tw, yTop - tall + 4);
          }
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 1.8;
          ctx.stroke();
          ctx.fillStyle = C.ink;
          ctx.fillRect(gx + 4, yTop - tall + 5, glyph.w - 2, tall);
          ctx.fillStyle = C.red;
          ctx.fillRect(gx + 1, yTop - tall, glyph.w - 2, tall);
          // 顶面那一道加粗的黑边：这一条线就是致命的边界
          ctx.fillStyle = C.ink;
          ctx.fillRect(gx + 1, yTop - tall, glyph.w - 2, 4);
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 2.5;
          ctx.strokeRect(gx + 2.2, yTop - tall + 1.2, glyph.w - 4.4, tall - 2.4);
          ctx.fillStyle = C.red;
          ctx.font = `26px ${SERIF}`;
          ctx.fillText(glyph.ch, gx, yTop + 25);
        } else if (glyph.kind === "bounce") {
          ctx.fillStyle = C.ink;
          ctx.fillRect(gx + 4, yTop - 6, glyph.w - 2, 10);
          ctx.fillStyle = C.green;
          ctx.fillRect(gx + 1, yTop - 11, glyph.w - 2, 11);
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 2.5;
          ctx.strokeRect(gx + 2.2, yTop - 9.8, glyph.w - 4.4, 8.6);
          ctx.fillStyle = C.green;
          ctx.font = `26px ${SERIF}`;
          ctx.fillText(glyph.ch, gx, yTop + 25);
        } else {
          ctx.fillStyle = glyph.kind === "float" ? C.muted : C.ink;
          ctx.font = `26px ${SERIF}`;
          ctx.fillText(glyph.ch, gx, yTop + 25);
        }
      }
    }

    // 文脉印
    const t = performance.now() / 520;
    for (const mark of game.marks) {
      if (mark.taken) continue;
      const x = mark.x - camera;
      if (x < -40 || x > w + 40) continue;
      const by = mark.y + origin + Math.sin(t + mark.bob) * 4;
      drawShadowBox(x - 12, by - 12, 24, 24, C.yellow);
      ctx.fillStyle = C.ink;
      ctx.font = `900 12px ${MONO}`;
      ctx.fillText("印", x - 6, by + 6);
    }

    // 终点旗
    const endX = game.totalWidth - camera;
    if (game.surfaces.length && endX < w + 40) {
      const last = game.surfaces[game.surfaces.length - 1];
      const yTop = last.y + origin;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(endX + 30, yTop - 62);
      ctx.lineTo(endX + 30, yTop + 4);
      ctx.stroke();
      ctx.fillStyle = C.yellow;
      ctx.fillRect(endX + 32, yTop - 62, 34, 20);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 3;
      ctx.strokeRect(endX + 32, yTop - 62, 34, 20);
      ctx.fillStyle = C.ink;
      ctx.font = `900 12px ${MONO}`;
      ctx.fillText("完", endX + 42, yTop - 48);
    }

    // 玩家
    const p = game.player;
    const px = p.x - camera;
    const py = p.y + origin;
    ctx.save();
    if (game.safeTime > 0 && Math.floor(game.safeTime * 8) % 2) ctx.globalAlpha = 0.45;
    drawShadowBox(px, py, p.w, p.h, C.red);
    ctx.fillStyle = C.paper;
    ctx.font = `900 22px ${SERIF}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(game.avatarChar, px + p.w / 2, py + p.h / 2 + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.restore();
    if (game.safeTime > 0) {
      ctx.fillStyle = C.green;
      ctx.font = `900 10px ${MONO}`;
      ctx.fillText(`保护 ${Math.ceil(game.safeTime)}s`, px - 4, py - 10);
    }
    game.dirty = false;
  }

  // ============ 状态机 ============
  function setStatus(text) {
    if (game._status === text) return;
    game._status = text;
    $("#readingStatus").textContent = text;
  }
  function setHint(text) {
    if (game._hint === text) return;
    game._hint = text;
    $("#readingHint").textContent = text;
  }
  function updateTrack() {
    const total = game.readTotal || 1;
    const read = game.state === "complete" ? total : Math.min(game.progress, total);
    const key = `${read}/${total}/${game.collected}`;
    if (game._track === key) return;
    game._track = key;
    $("#readingFill").style.width = `${(read / total) * 100}%`;
    $("#readingProgress").innerHTML =
      `已读 <b>${fmt(read)}</b> <span>/ ${fmt(total)} 字</span>` +
      (game.collected ? ` <span class="reading-marks">· 得印 ${game.collected}</span>` : "");
    $(".reading-track").setAttribute("aria-label", `已读 ${read} / ${total} 字`);
  }
  function setIdentity(chapter) {
    $("#readingChapterTitle").textContent = chapter.title;
    $("#readingDivision").textContent = (chapter.division || "").replace("书", "") || "史";
    $("#readingDivision").dataset.division = chapter.division || "";
    $("#readingVolumeLabel").textContent = `卷${chapter.volume} · ${chapter.division}`;
    $("#readingChars").textContent = `${fmt(chapter.chars)} 字`;
    $("#readingSeed").textContent = `排版 ${seedTag(game.seed)}`;
    game.avatarChar = Array.from(chapter.title)[0];
  }

  const OVERLAY_TEXT = {
    ready: () => ({
      symbol: "字",
      eye: "READY TO WALK",
      title: game.chapter ? game.chapter.title : "原典阅读",
      text: "每个字都是脚下的路面。句读墩子侧面拦路，跳过去就行；只有红墩的顶面碰不得。排版每次重掷，走法都不重样。",
      action: "开始阅读"
    }),
    paused: () => ({ symbol: "Ⅱ", eye: "TAKE YOUR TIME", title: "已暂停", text: "按 P 或点按钮继续。", action: "继续漫游" }),
    dead: () => ({
      symbol: game.deathMark,
      eye: "A LITTLE PAUSE",
      title: "已停止",
      text:
        game.deathKind === "fall"
          ? "掉出了路面。继续后在附近路面复活。"
          : game.deathKind === "lag"
            ? "被画框甩到了后面。自动漫步时画框一直前移，停久了就会出框；继续后记得跟上。"
            : "落在了红色句读的顶面上。继续后在附近路面复活，有 3 秒保护。",
      action: "继续阅读"
    }),
    complete: () => ({
      symbol: "完",
      eye: game.perfect ? "PERFECT · ALL SEALS" : "THE LAST LINE",
      title: "这一传读完了",
      text: `${game.chapter.title} · 共 ${fmt(game.readTotal)} 字，得印 ${game.collected} 枚${game.perfect ? "（全数收齐）" : ""}。`,
      action: "换个排版再走一遍"
    })
  };

  function showOverlay(kind) {
    const cfg = OVERLAY_TEXT[kind]();
    $("#readingOverlaySymbol").textContent = cfg.symbol;
    $("#readingOverlayEyebrow").textContent = cfg.eye;
    $("#readingOverlayTitle").textContent = cfg.title;
    $("#readingOverlayText").textContent = cfg.text;
    $("#readingOverlayAction").textContent = cfg.action;
    overlay.hidden = false;
    keys.clear();
    $("#readingPause").disabled = kind !== "paused";
  }
  function hideOverlay() {
    overlay.hidden = true;
    $("#readingPause").disabled = false;
  }

  function toReady(startPlaying) {
    game.state = startPlaying ? "playing" : "ready";
    game.safeTime = startPlaying ? 1.2 : 0;
    if (startPlaying) {
      hideOverlay();
      keys.clear();
      canvas.focus({ preventScroll: true });
    } else {
      showOverlay("ready");
    }
    setStatus(`01 / 共 ${game.surfaces.length} 段`);
    setHint("");
    updateTrack();
    game.dirty = true;
  }

  function pause() {
    if (game.state !== "playing") return;
    game.state = "paused";
    game.player.vx = 0;
    $("#readingPause").textContent = "继续";
    showOverlay("paused");
  }
  function resume() {
    if (game.state !== "paused") return;
    game.state = "playing";
    hideOverlay();
    $("#readingPause").textContent = "暂停";
    keys.clear();
    canvas.focus({ preventScroll: true });
  }
  function die(kind, mark) {
    if (game.state !== "playing") return;
    game.deathKind = kind;
    if (mark) game.deathMark = mark;
    game.state = "dead";
    game.player.vx = 0;
    showOverlay("dead");
  }
  function revive() {
    const surf = game.surfaces[game.checkpoint.surface] || game.surfaces[0];
    const p = game.player;
    // 复活点若贴着路段右缘，退回段首，免得一复活就再度跌进缺口
    let cx = game.checkpoint.x;
    if (cx > surf.x + surf.w - p.w - 46) cx = surf.x + 10;
    p.x = clamp(cx, surf.x + 2, surf.x + surf.w - p.w - 2);
    p.y = surf.y - p.h;
    p.vx = 0;
    p.vy = 0;
    p.jumps = 0;
    p.grounded = true;
    game.lastSurface = game.checkpoint.surface;
    game.state = "playing";
    game.safeTime = 3;
    game.coyote = COYOTE;
    game.jumpBuffer = 0;
    game.camera = Math.max(0, p.x - game.w * 0.28);
    game.autoEdge = -Infinity;   // 复活后画框重新以玩家位置起算，免得一复活就被判掉队
    hideOverlay();
    $("#readingPause").textContent = "暂停";
    keys.clear();
    canvas.focus({ preventScroll: true });
    game.dirty = true;
  }
  function complete() {
    game.state = "complete";
    game.progress = game.readTotal;
    const done = store.get(K_DONE, []);
    if (game.chapter && !done.includes(game.chapter.slug)) {
      done.push(game.chapter.slug);
      store.set(K_DONE, done);
      renderChapterList();
    }
    updateTrack();
    setStatus("终 / 最后一个字");
    setHint("");
    showOverlay("complete");
    // 彩蛋：这一篇的「印」一枚不落
    const total = game.marks.length;
    if (total > 0 && game.collected >= total) {
      game.perfect = true;
      setTimeout(() => showEgg(total), 480);
    }
  }

  function showEgg(total) {
    const egg = $("#readingEgg");
    if (!egg || egg.open) return;
    const count = $("#eggCount");
    if (count) count.textContent = String(total);
    if (typeof egg.showModal === "function") egg.showModal();
    else egg.setAttribute("open", "");
  }

  function jump() {
    if (game.state !== "playing") return;
    const p = game.player;
    if (p.grounded || game.coyote > 0 || p.jumps < 2) {
      p.vy = JUMP_V;
      p.jumps = p.grounded || game.coyote > 0 ? 1 : p.jumps + 1;
      p.grounded = false;
      game.coyote = 0;
      game.jumpBuffer = 0;
    } else {
      game.jumpBuffer = 0.12;
    }
  }

  function update(dt) {
    const p = game.player;
    let blockedNow = false;
    let blockedKind = null;
    game.safeTime = Math.max(0, game.safeTime - dt);
    game.coyote = Math.max(0, game.coyote - dt);
    game.jumpBuffer = Math.max(0, game.jumpBuffer - dt);

    const left = keys.has("ArrowLeft") || keys.has("a");
    const right = keys.has("ArrowRight") || keys.has("d");
    const dir = left ? -1 : right || game.auto ? 1 : 0;
    p.vx = dir * game.speed;

    const prevBottom = p.y + p.h;
    p.x = clamp(p.x + p.vx * dt, game.surfaces[0].x, game.totalWidth + 16);

    // 句读墩子一律拦路：撞上就停在墩子前，跳过去才能继续（黑白同理）
    for (let i = 0; i < game.blockers.length; i += 1) {
      const sl = game.blockers[i];
      if (sl.x > p.x + p.w + 80) break;
      if (sl.x + sl.w < p.x - 80) continue;
      if (prevBottom <= sl.top + 4 || p.y >= sl.base) continue;      // 从上方落下、或竖直方向没交叠
      if (p.x + p.w <= sl.x + 1 || p.x >= sl.x + sl.w - 1) continue; // 水平方向没接触
      if (p.vx > 0) {
        p.x = sl.x - p.w;
        blockedNow = true;
        blockedKind = sl.kind;
      } else if (p.vx < 0) {
        p.x = sl.x + sl.w;
        blockedNow = true;
        blockedKind = sl.kind;
      }
    }

    p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);
    p.y += p.vy * dt;

    const wasGrounded = p.grounded;
    p.grounded = false;
    const from = firstSurfaceAt(p.x - 6);
    for (let i = from; i < game.allSurfaces.length; i += 1) {
      const s = game.allSurfaces[i];
      if (s.x > p.x + p.w) break;
      if (p.x + p.w > s.x + 1 && p.x < s.x + s.w - 1 && p.vy >= 0 && prevBottom <= s.y + 2 && p.y + p.h >= s.y) {
        p.y = s.y - p.h;
        p.vy = 0;
        p.grounded = true;
        p.jumps = 0;
        game.coyote = COYOTE;
        if (s.road) {
          game.lastSurface = s.index;
          game.checkpoint = { x: p.x, surface: s.index };
        }
        if (game.jumpBuffer > 0) jump();
        break;
      }
    }
    // 黑墩顶面可踩：站上去能看得更远，也能从上面起跳
    if (!p.grounded) {
      for (let i = 0; i < game.solids.length; i += 1) {
        const sl = game.solids[i];
        if (sl.x > p.x + p.w + 80) break;
        if (sl.x + sl.w < p.x - 80) continue;
        if (p.x + p.w > sl.x + 2 && p.x < sl.x + sl.w - 2 && p.vy >= 0 && prevBottom <= sl.top + 2 && p.y + p.h >= sl.top) {
          p.y = sl.top - p.h;
          p.vy = 0;
          p.grounded = true;
          p.jumps = 0;
          game.coyote = COYOTE;
          break;
        }
      }
    }
    if (wasGrounded && !p.grounded && p.vy >= 0) {
      game.coyote = COYOTE;
      p.jumps = Math.max(1, p.jumps);
    }
    if (!p.grounded && p.y + game.origin > game.h + 80) {
      die("fall");
      return;
    }

    // 红块（。；：、！）：侧面只是拦路，只有落在顶面上才中断阅读
    const scale = hazardScale();
    if (game.safeTime <= 0) {
      for (let i = 0; i < game.spikes.length; i += 1) {
        const sp = game.spikes[i];
        if (sp.x > p.x + p.w + 40) break;
        if (sp.x + sp.w < p.x - 40) continue;
        const pad = (sp.w * (scale - 1)) / 2;
        const l = sp.x - pad + 1;
        const r = sp.x + sp.w + pad - 1;
        const ov = Math.min(p.x + p.w, r) - Math.max(p.x, l);
        // 下落中、脚底正好越过顶面、且身体确实压在墩子顶上
        if (ov >= 10 && p.vy >= 0 && prevBottom <= sp.top + 3 && p.y + p.h >= sp.top) {
          die("punctuation", sp.ch);
          return;
        }
      }
    }

    // 弹板 / 悬砖 / 文脉印
    for (const s of game.floats) {
      if (Math.abs(s.x - p.x) > 200) continue;
      if (p.x + p.w > s.x + 2 && p.x < s.x + s.w - 2 && p.vy >= 0 && prevBottom <= s.y + 2 && p.y + p.h >= s.y) {
        p.y = s.y - p.h;
        p.vy = 0;
        p.grounded = true;
        p.jumps = 0;
        game.flyer += 1;
        setHint(`踏上悬砖 · 第 ${game.flyer} 块`);
        break;
      }
    }
    for (const s of game.surfaces) {
      if (s.x > p.x + p.w + 40) break;
      for (const glyph of s.glyphs) {
        if (glyph.kind !== "bounce") continue;
        const gx = glyph.x + 1;
        const gw = Math.max(12, glyph.w - 2);
        if (
          p.x + p.w - 4 > gx &&
          p.x + 4 < gx + gw &&
          p.vy >= 0 &&
          p.y + p.h > s.y - 13 &&
          p.y + p.h < s.y + 20
        ) {
          p.vy = BOUNCE_V;
          p.grounded = false;
          p.jumps = 0;
          game.safeTime = Math.max(game.safeTime, 0.8);
          setHint("点号弹起");
        }
      }
    }
    for (const mark of game.marks) {
      if (mark.taken) continue;
      if (Math.abs(mark.x - p.x) > 200) continue;
      if (p.x + p.w > mark.x - 13 && p.x < mark.x + 13 && p.y + p.h > mark.y - 13 && p.y < mark.y + 13) {
        mark.taken = true;
        game.collected += 1;
        setHint(`收得文脉印 · ${game.collected} 枚`);
        updateTrack();
      }
    }

    for (let i = from; i < game.allSurfaces.length; i += 1) {
      const s = game.allSurfaces[i];
      if (s.x > p.x + p.w) break;
      if (!s.road) continue;
      for (const glyph of s.glyphs) if (p.x + p.w >= glyph.x) game.progress = Math.max(game.progress, glyph.index + 1);
    }

    if (p.x + p.w >= game.totalWidth - 6 && p.y < game.surfaces[game.surfaces.length - 1].y + 46) {
      complete();
      return;
    }

    // 自动漫步 = 画框持续前移：走得慢了就会被画面甩出去
    // 复活保护期内画框停下，给玩家一点重新起步的时间，免得一复活又被甩一次
    if (game.auto && game.safeTime <= 0) {
      const lag = Math.max(60, game.w * AUTO_LAG);
      if (!Number.isFinite(game.autoEdge)) game.autoEdge = p.x - lag;
      game.autoEdge = Math.max(game.autoEdge + game.speed * AUTO_SCROLL * dt, p.x - lag);
    }
    const target = Math.max(
      0,
      p.x - game.w * 0.28,
      game.auto ? game.autoEdge - game.w * 0.28 : 0
    );
    game.camera += (target - game.camera) * Math.min(1, dt * 9);

    // 被甩到画框之外：即中断阅读（复活保护期内不判）
    if (game.auto && game.safeTime <= 0 && p.x + p.w < game.camera) {
      die("lag", "框");
      return;
    }

    setStatus(`${String(game.lastSurface + 1).padStart(2, "0")} / 共 ${game.surfaces.length} 段`);
    if (blockedNow) {
      setHint(blockedKind === "low" ? "黑句读拦路 · 按空格跳过" : "红句读拦路 · 跳过时别落在顶面");
    } else if (game.auto && p.x - game.camera < game.w * LAG_WARN) {
      setHint("画框在推 · 别再停了");
    } else if (!game.safeTime) {
      setHint(game.auto ? "自动漫步中 · 记得跳跃" : "");
    }
    updateTrack();
    game.dirty = true;
  }

  function frame(now) {
    let dt = Math.min((now - (game.lastTime || now)) / 1000, 0.05);
    game.lastTime = now;
    if (game.state === "playing") {
      while (dt > 0 && game.state === "playing") {
        const step = Math.min(dt, 1 / 120);
        update(step);
        dt -= step;
      }
    }
    if (game.dirty && !panel.hidden) draw();
    requestAnimationFrame(frame);
  }

  // ============ 篇目 ============
  // 收录顺序与折叠：吴书按主要人物收齐，排在最先；魏书、蜀书只取若干名篇，默认收起
  const DIVISION_ORDER = ["吴书", "魏书", "蜀书"];
  const DIVISION_FOLD = { 魏书: true, 蜀书: true };

  function renderChapterList() {
    const host = $("#chapterList");
    if (!host) return;
    const done = store.get(K_DONE, []);
    const current = game.chapter ? game.chapter.slug : null;
    const scopeOf = window.READING_SCOPE || {};
    const groups = new Map();
    CHAPTERS.forEach((chapter) => {
      const key = chapter.division || "其他";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(chapter);
    });
    host.replaceChildren();
    const order = [...groups.keys()].sort((a, b) => {
      const ia = DIVISION_ORDER.indexOf(a);
      const ib = DIVISION_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    let n = 0;
    order.forEach((division) => {
      const list = groups.get(division);
      const wrap = document.createElement("div");
      wrap.className = "chapter-group";
      wrap.dataset.division = division;

      const fold = document.createElement("details");
      fold.className = "chapter-fold";
      // 吴书默认展开；魏书/蜀书默认收起，但当前在读的篇目会自动摊开
      fold.open = !DIVISION_FOLD[division] || list.some((c) => c.slug === current);

      const head = document.createElement("summary");
      const dot = document.createElement("i");
      head.append(dot, document.createTextNode(`${division} · ${list.length} 篇`));
      if (scopeOf[division]) {
        const tag = document.createElement("em");
        tag.className = "chapter-scope";
        tag.textContent = scopeOf[division];
        head.append(tag);
      }
      fold.append(head);

      list.forEach((chapter) => {
        n += 1;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chapter-button";
        if (chapter.slug === current) button.classList.add("active");
        if (done.includes(chapter.slug)) button.classList.add("done");
        button.dataset.slug = chapter.slug;
        const no = document.createElement("b");
        no.textContent = String(n).padStart(2, "0");
        const name = document.createElement("span");
        name.textContent = chapter.title;
        const meta = document.createElement("em");
        meta.textContent = `卷${chapter.volume} · ${fmt(chapter.chars)}字${done.includes(chapter.slug) ? " ✓" : ""}`;
        button.append(no, name, meta);
        button.addEventListener("click", () => loadChapter(chapter, true));
        fold.append(button);
      });
      wrap.append(fold);
      host.append(wrap);
    });
  }

  function loadChapter(chapter, freshSeed) {
    const seed = freshSeed ? (Math.random() * 4294967295) >>> 0 : store.get(K_SEED, hashSeed(chapter.slug));
    store.set(K_CHAPTER, chapter.slug);
    store.set(K_SEED, seed);
    buildLevel(chapter, seed);
    setIdentity(chapter);
    renderChapterList();
    resize();
    toReady(false);
  }

  function reroll() {
    if (!game.chapter) return;
    const seed = (Math.random() * 4294967295) >>> 0;
    store.set(K_SEED, seed);
    buildLevel(game.chapter, seed);
    setIdentity(game.chapter);
    resize();
    toReady(true);
    setHint(`已重掷排版 · ${seedTag(seed)}`);
  }

  function restart() {
    if (!game.chapter) return;
    buildLevel(game.chapter, game.seed);
    setIdentity(game.chapter);
    toReady(true);
  }

  // ============ 交互 ============
  function bind() {
    const focusCanvas = () => canvas.focus({ preventScroll: true });
    $("#readingPause").addEventListener("click", () => {
      if (game.state === "paused") resume();
      else pause();
      focusCanvas();
    });
    $("#readingOverlayAction").addEventListener("click", () => {
      if (game.state === "dead") revive();
      else if (game.state === "paused") resume();
      else if (game.state === "complete") reroll();
      else toReady(true);
    });
    $("#readingOverlaySecondary").addEventListener("click", () => {
      hideOverlay();
      game.state = "ready";
      $("#chapterList").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    $("#readingRestart").addEventListener("click", restart);
    $("#readingReroll").addEventListener("click", reroll);
    const closeEgg = () => {
      const egg = $("#readingEgg");
      if (egg && egg.open && typeof egg.close === "function") egg.close();
      else if (egg) egg.removeAttribute("open");
    };
    $("#eggClose").addEventListener("click", closeEgg);
    $("#eggStay").addEventListener("click", closeEgg);
    $("#eggAgain").addEventListener("click", () => {
      closeEgg();
      reroll();
    });
    $("#readingAuto").addEventListener("change", (event) => {
      game.auto = event.target.checked;
      game.autoEdge = -Infinity;
      if (game.auto && game.state === "ready") toReady(true);
      focusCanvas();
    });

    for (const button of panel.querySelectorAll("[data-reading]")) {
      const control = button.dataset.reading;
      const key = control === "left" ? "ArrowLeft" : "ArrowRight";
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        try {
          button.setPointerCapture(event.pointerId);
        } catch {
          /* 已释放 */
        }
        if (control === "jump") jump();
        else keys.add(key);
      });
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
        button.addEventListener(type, () => keys.delete(key));
      }
      button.addEventListener("contextmenu", (event) => event.preventDefault());
    }

    document.addEventListener("keydown", (event) => {
      if (panel.hidden) return;
      const target = event.target;
      if (target && (target.matches?.("input, textarea, select") || target.isContentEditable)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === "Escape") {
        if (game.state === "playing") pause();
        else if (game.state === "paused") resume();
        return;
      }
      if (key === "p" && !event.repeat) {
        if (game.state === "playing") pause();
        else if (game.state === "paused") resume();
        return;
      }
      if (key === "r" && !event.repeat) {
        reroll();
        return;
      }
      if (game.state !== "playing") return;
      if (key === " " || key === "ArrowUp" || key === "w") {
        if (target && target.closest && target.closest("button") && key === " ") return;
        event.preventDefault();
        if (!event.repeat) jump();
        return;
      }
      if (key === "ArrowLeft" || key === "ArrowRight" || key === "a" || key === "d") {
        event.preventDefault();
        keys.add(key);
      }
    });
    document.addEventListener("keyup", (event) => {
      if (panel.hidden) return;
      keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key);
    });
    window.addEventListener("blur", () => {
      keys.clear();
      if (game.state === "playing") pause();
    });

    if (typeof ResizeObserver === "function") new ResizeObserver(resize).observe(stage);
    window.addEventListener("resize", resize);

    // 面板显示后接管：切到本页时唤醒、离开时暂停
    const onPanelChange = () => {
      if (panel.hidden) {
        keys.clear();
        if (game.state === "playing") pause();
        return;
      }
      resize();
      if (!booted) boot();
    };
    new MutationObserver(onPanelChange).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
    document.querySelectorAll('.tab-button, [data-jump]').forEach((b) => b.addEventListener("click", () => window.requestAnimationFrame(onPanelChange)));
  }

  function boot() {
    booted = true;
    const saved = store.get(K_CHAPTER, null);
    // 冷启动默认落在吴书首篇：吴书按主要人物收齐、排在目录最前
    const fallback = CHAPTERS.find((c) => c.division === "吴书") || CHAPTERS[0];
    const chapter = CHAPTERS.find((c) => c.slug === saved) || fallback;
    const seed = store.get(K_SEED, hashSeed(chapter.slug)) || hashSeed(chapter.slug);
    store.set(K_SEED, seed);
    game.auto = false;
    buildLevel(chapter, seed);
    setIdentity(chapter);
    renderChapterList();
    if (!rafStarted) {
      rafStarted = true;
      requestAnimationFrame(frame);
    }
    resize();
    toReady(false);
  }

  bind();
  window.requestAnimationFrame(() => {
    if (!panel.hidden) boot();
  });
})();
