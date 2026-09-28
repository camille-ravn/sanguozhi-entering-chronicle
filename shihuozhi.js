/*
 * 05 · 食货志 —— 经济自走棋 引擎
 * 消费 window.SGZ_SHIHUO（data-05-shihuozhi.js），依赖 window.SGZ_DATA（data.js）
 * 数值见 outputs/balance-05-shihuozhi.md（⚑ 待模拟定标处已在代码注释标明）
 * 无战斗动画：战报文字 + 数字滚动（plan §一 假设 3）
 */
(() => {
  "use strict";
  const D = window.SGZ_SHIHUO;
  if (!D) { console.warn("[食货志] 未找到 window.SGZ_SHIHUO，请先加载 data-05-shihuozhi.js"); return; }

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const fmt = (n) => Math.round(n).toLocaleString("zh-CN");
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const B = D.balance;
  const BOARD = D.BOARD || { cols: 6, rows: 3, cap: 12 };
  const COLS = BOARD.cols, ROWS = BOARD.rows, BOARD_MAX = BOARD.cap;
  const CELLS = COLS * ROWS;
  const MAX_STAR = B.MAX_STAR || 3;
  const ROWS_CFG = D.ROWS || [
    { key: "back", name: "后排", note: "输出", hp: 0.80, atk: 1.20 },
    { key: "mid", name: "中排", note: "策应", hp: 1.00, atk: 1.00 },
    { key: "front", name: "前排", note: "承伤", hp: 1.25, atk: 0.85 },
  ];
  const ROW_OF = D.ROW_OF_ARCH || { 守: 2, 攻: 1, 谋: 0, 支: 0 };
  const NO_FRONT_PENALTY = D.NO_FRONT_PENALTY || 0.85;
  const FRONT_ROW = ROWS_CFG.length - 1;
  // 敌我共用一块 18 格棋盘：左半（前 ENEMY_COLS 列）= 敌军，右半 = 我军（2026-09-27 续）
  const ENEMY_COLS = Math.floor(COLS / 2);
  const PLAYER_COL_START = ENEMY_COLS;
  const isEnemyCell = (slot) => (slot % COLS) < ENEMY_COLS;
  const isPlayerCell = (slot) => (slot % COLS) >= PLAYER_COL_START;
  const SAVE_KEY = "sgz.shihuo";
  const BASE_UPKEEP = 300;      // 每万兵基准军费（文/回合）⚑ 待定标（原 900 会让 P=350 时军费吞掉全部存钱）
  const BASE_GRAIN_PER_BIANHU = 120;   // 田租：每编户万/回合（balance §4）
  const BASE_SILK_PER_BIANHU = 30;     // 户调：每编户万/回合
  const TUNTIAN_YIELD = 240;           // 屯田每单位/回合
  // 物价年回落率：魏最稳、蜀最不稳（彭信威：魏钱重稳 → 魏统一必然）
  const GRAIN_BASE_PRICE = 10;         // ⚑ 谷价基准（文/斛）：原按 1000 计会让一次粜谷换出 60 万文，远超军费量级
  const SILK_BASE_PRICE = 20;          // ⚑ 帛价基准（文/匹）
  // 物价年回落率：魏最稳、蜀最不稳（彭信威：魏钱虽粗但重稳 → 魏地经济较稳）
  const P_DECAY = { 魏: 0.08, 吴: 0.05, 蜀: 0.035 };
  // ⚑ 后期 sink 1：军费随年份递增（兵久则器械、粮秣、赏赐之费益增）
  //   不然后期钱粮只进不出，国力条一路平推，挑战消失
  const UPKEEP_YEAR_GROWTH = 0.025;
  // ⚑ 后期 sink 1b：军粮（兵食于官）。谷此前只进不出，会让后期粮堆到几十万斛而毫无张力
  const GRAIN_UPKEEP_PER_SOLDIER = 250;
  const GRAIN_UPKEEP_YEAR_GROWTH = 0.03;
  // ⚑ 后期 sink 2：士族荫客自然侵蚀（机制3 的持续压力），随年份加速
  const EROSION_BASE = 0.002, EROSION_YEAR = 0.00008;
  // 承平则户口滋殖（与侵蚀对冲）：物价低则滋殖快，物价高则民不聊生
  const GROWTH_LOW_P = 0.006, GROWTH_MID_P = 0.002, GROWTH_P_LINE = 250;
  const TUNTIAN_ATTRACT = 0.04;   // 屯田吸纳流民：每单位每回合 +0.04 万户（封顶 5 单位，避免无限滚）
  const TUNTIAN_ATTRACT_CAP = 5;
  // ⚑ 后期 sink 1c：太仓陈腐 —— 谷堆到一定量后逐回合霉烂（《史记·平准书》「陈陈相因…腐败不可食」）
  const ROT_LIMIT = 150000, ROT_RATE = 0.10;
  // 屯田上限：土地与劳动力有限，不能无限铺（否则后期「屯田刷国力」压倒一切）
  // 国力绝对地板（按局长度）：短局 1500 / 中局 1800 / 长局 2000 ⚑ 待定标
  const WIN_FLOOR = { short: 1400, mid: 1950, long: 2400 };
  const WIN_MULT = { short: 1.45, mid: 1.5, long: 1.6 };
  const TUNTIAN_MAX = 12;
  // 钱货相权阈值：府库超过此数，钱多物少 → 物价上行
  const MONEY_HEAVY = 40000, MONEY_HEAVY_K = 1.5;

  let S = null;
  let uidSeq = 0;

  /* ───────────── 工具：随机数（可复现） ───────────── */
  function makeRng(seed) {
    let x = seed >>> 0 || 1;
    return function () {
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5; x >>>= 0;
      return (x >>> 0) / 4294967296;
    };
  }
  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

  /* ───────────── 布阵：6×3 格，前排承伤、后排输出 ───────────── */
  const rowOfSlot = (slot) => Math.floor(slot / COLS);
  function rowCfg(slot) { return ROWS_CFG[Math.min(rowOfSlot(slot), FRONT_ROW)] || ROWS_CFG[1]; }
  function unitAt(slot) { return S.board.find((u) => u.slot === slot) || null; }
  function frontCount() { return S.board.filter((u) => rowOfSlot(u.slot) === FRONT_ROW).length; }
  // 给敌军阵容用的「无 S 依赖」版本（按列区间找空位）
  function firstEmptySlotInCols(board, colStart, colEnd, preferRow) {
    if (preferRow != null && preferRow >= 0) {
      for (let c = colStart; c <= colEnd; c++) { const s = preferRow * COLS + c; if (!board.find((u) => u.slot === s)) return s; }
    }
    for (let r = 0; r < ROWS; r++) for (let c = colStart; c <= colEnd; c++) { const s = r * COLS + c; if (!board.find((u) => u.slot === s)) return s; }
    return -1;
  }
  function frontCountOf(board) { return board.filter((u) => rowOfSlot(u.slot) === FRONT_ROW).length; }
  function firstEmptySlot(preferRow) {
    if (preferRow != null && preferRow >= 0) {
      for (let c = 0; c < COLS; c++) { const s = preferRow * COLS + c; if (!unitAt(s)) return s; }
    }
    for (let i = 0; i < CELLS; i++) if (!unitAt(i)) return i;
    return -1;
  }
  // 自动落位（仅用于「一键整队」把仓库单位塞进右侧空格）：守→前排、攻→中排、谋/支→后排
  function placeUnit(u) {
    const want = ROW_OF[u.archetype];
    const s = firstEmptySlotInCols(S.board, PLAYER_COL_START, COLS - 1, want != null ? want : 1);
    u.slot = s >= 0 ? s : 0;
    return u.slot;
  }
  // 一键整队：先把仓库单位按定位塞进右侧空格，再按 守→前/攻→中/谋支→后 整队
  function autoPlaceBench() {
    while (S.bench.length) {
      const u = S.bench[0];
      const want = ROW_OF[u.archetype];
      const s = firstEmptySlotInCols(S.board, PLAYER_COL_START, COLS - 1, want != null ? want : 1);
      if (s < 0) break;                    // 棋盘满了，剩下的留仓库
      u.slot = s; S.bench.shift(); S.board.push(u);
    }
  }
  function autoForm() {
    autoPlaceBench();
    const order = [];
    for (let r = FRONT_ROW; r >= 0; r--) for (let c = PLAYER_COL_START; c < COLS; c++) order.push(r * COLS + c);
    const sorted = S.board.slice().sort((a, b) => (ROW_OF[b.archetype] != null ? ROW_OF[b.archetype] : 1)
      - (ROW_OF[a.archetype] != null ? ROW_OF[a.archetype] : 1));
    sorted.forEach((u, i) => { u.slot = order[i]; });
    S.sel = null; S.benchSel = null;
    pushLog("整队", "按定位列阵（前排承伤、后排输出）");
    save(); render();
  }
  // 换位：点一人再点一格（空则移，有人则对调）——只在我方半场
  function moveUnit(from, to) {
    if (!isPlayerCell(from) || !isPlayerCell(to)) { S.sel = null; save(); render(); return; }
    const a = unitAt(from), b = unitAt(to);
    S.sel = null;
    if (!a || from === to) { save(); render(); return; }
    if (b) b.slot = from;
    a.slot = to;
    save(); render();
  }
  // 点格：敌方半场不可操作；若已选仓库单位则落子，否则选中/换位
  function onCellClick(slot) {
    if (!S || S.over) return;
    if (!isPlayerCell(slot)) return;            // 左半 = 敌军，不可点
    if (S.benchSel != null) {                   // 从仓库落子
      const b = S.bench.find((x) => x.uid === S.benchSel);
      if (!b) { S.benchSel = null; render(); return; }
      if (unitAt(slot)) { toast("该格已有我方单位"); return; }
      b.slot = slot;
      S.bench.splice(S.bench.indexOf(b), 1);
      S.board.push(b);
      S.benchSel = null; save(); render(); return;
    }
    if (S.sel == null) {
      if (unitAt(slot)) { S.sel = slot; render(); }
      return;
    }
    moveUnit(S.sel, slot);
  }

  /* ───────────── 经济换算 ───────────── */
  // 1 招募点 = 1000 文 × (P/100)：通胀越高，同样的钱能招的人越少（balance §2）
  function rpRate() { return 1000 * (S.P / 100); }
  function moneyToRp(money) { return money / rpRate(); }
  function unitCost(unit) { return unit.cost * rpRate(); }
  function refreshCost() { return B.REFRESH_COST * rpRate(); }
  function realPower() { return (S.money / S.P) * 100; }        // 实际购买力（文）

  // 岁入：田租 + 屯田 + 户调，按「基准价」折成文（不随 P 放大，故通胀只通过购买力体现）
  // ⚑ 改版：国力原按 grain*0.2 计，导致「囤 36 万斛」就能碾压通关；改以岁入为主，
  //   呼应机制3——真正决定国力的是「税基（编户）」而非「仓里堆了多少」。
  function revenue() {
    let g = S.bianhu * BASE_GRAIN_PER_BIANHU + S.tuntian * TUNTIAN_YIELD * (S.tuntianYieldMult || 1);
    if (S.shuili) g *= 1.5;
    if (S.juntun) g += S.soldiers * 60;
    const silk = S.hutiao ? S.bianhu * BASE_SILK_PER_BIANHU * S.silkQuality : 0;
    return g * GRAIN_BASE_PRICE + silk * SILK_BASE_PRICE;
  }
  // 军费：兵数 × 基准 × 物价 × 年份递增（粮秣/器械/赏赐年复一年益重）
  function upkeep() { return S.soldiers * BASE_UPKEEP * (S.P / 100) * (1 + (S.year - 190) * UPKEEP_YEAR_GROWTH); }
  // 士族侵蚀率：每回合编户转入荫客的比例，随年份加速（机制3 的持续压力）
  function erosionRate() { return EROSION_BASE + (S.year - 190) * EROSION_YEAR; }

  function power() {
    // ⚑ 系数相对 balance §8 做了归一（钱单位为文，否则钱项会压倒其他项），待定标
    const rev = revenue() * 0.02;                                  // 岁入（文）→ 国力
    const stock = Math.min(S.grain, 40000) * 0.01 + Math.min(S.silk, 10000) * 0.02;  // 存量封顶
    const moneyTerm = Math.min(realPower(), 50000) / 1000 * 5;      // 府库封顶（囤钱不直接等于国力）
    return rev + stock + moneyTerm + S.soldiers * 30 + S.bianhu * 30;
  }

  /* ───────────── 开局 ───────────── */
  function newGame(factionKey, diffKey, seed) {
    const f = D.factions[factionKey];
    const rng = makeRng(seed || Date.now());
    S = {
      faction: factionKey, factionName: f.name,
      diff: diffKey,
      years: B.YEARS[diffKey] || B.YEARS.short,
      year: 190, turn: 1, ap: B.AP_PER_TURN,
      money: f.start.money, grain: f.start.grain, silk: f.start.silk,
      bianhu: f.start.bianhu, soldiers: f.start.soldiers,
      P: f.start.P, yinke: 0, yinkeQuota: f.start.yinke, yinkeLegal: false,
      tuntian: 0, hutiao: false, shuili: false, juntun: false,
      silkQuality: 1, moneyFrozen: 0,
      board: [], bench: [], shop: [], mercs: [], enemy: [], enemyBench: [], streak: 0, streakBonus: 0, mintedThisYear: false, sel: null, benchSel: null,
      drawnEvents: {}, unlockedCoins: {}, playedSystems: {},
      log: [], over: null, rng, seed: seed || 0,
      tuntianCostMult: 1, transportLoss: 1,
    };
    S.endYear = S.years[1];
    // ⚑ 双重判据：① 相对自身起手 ×1.35（保证三家可比）；② 绝对地板（防止小起手势力靠「屯田/存量的固定加成」白嫖通关）
    const floor = WIN_FLOOR[diffKey] || 2000;
    S.winPower = Math.round(Math.max(power() * (WIN_MULT[diffKey] || 1.5), floor));
    if (factionKey === "吴") S.yinkeLegalLv = 1; else S.yinkeLegalLv = 0;  // 孙吴开局带1级复客
    // 蜀锦/海贸/军屯等独家机制
    S.trait = f.trait;
    genEnemyBoard();        // 开局铺满敌军（持久军队，之后由 PvE 循环维持）
    for (let i = 0; i < 2; i++) enemyRecruit();   // 预置敌方仓库储备（隐藏，玩家不可见）
    rollShop(false);
    pushLog("开局", f.name + " · " + f.desc);
    save();
    render();
  }

  function pushLog(kind, text) {
    S.log.unshift({ kind, text, year: S.year });
    if (S.log.length > 80) S.log.length = 80;
  }

  /* ───────────── 商店 ───────────── */
  // 卡池：本势力精选（UNIT_TIERS 里有定位/子羁绊的）+ 每局固定 12 名群雄
  // ⚑ 原来全池 130+ 人，90 回合也抽不到两个同名 → 升星与子羁绊形同虚设
  const MERC_POOL = 12;
  function curatedPids() { return Object.keys(D.UNIT_TIERS || {}); }
  function pool() {
    if (!D.units || !D.units.length) return [];
    const curated = new Set(curatedPids());
    if (!S.mercs || !S.mercs.length) {
      const mercs = D.units.filter((u) => u.faction === "群雄" && curated.has(u.pid));
      for (let i = mercs.length - 1; i > 0; i--) {
        const j = Math.floor(S.rng() * (i + 1));
        const t = mercs[i]; mercs[i] = mercs[j]; mercs[j] = t;
      }
      S.mercs = mercs.slice(0, MERC_POOL).map((u) => u.pid);
    }
    return D.units.filter((u) => (u.faction === S.faction && curated.has(u.pid)) || S.mercs.indexOf(u.pid) >= 0);
  }
  // 阵中「还能再升」的同名者（给商店做加权用）
  function mergeableUnits() {
    const res = [], seen = new Set();
    S.board.forEach((u) => {
      if (u.star >= MAX_STAR || seen.has(u.pid)) return;
      seen.add(u.pid);
      const src = D.units.find((x) => x.pid === u.pid);
      if (src) res.push(src);
    });
    return res;
  }
  function rollShop(free) {
    const p = pool();
    if (!p.length) { S.shop = []; return; }
    const out = [];
    for (let i = 0; i < 5; i++) {
      // ⚑ 给阵中同名者稍作加权（便于升星），概率压到 0.20：同一人出场率过高会腻（用户 2026-09-27）
      const dup = mergeableUnits();
      out.push(dup.length && S.rng() < 0.20 ? pick(dup, S.rng) : pick(p, S.rng));
    }
    S.shop = out;
    if (free) runEnemyAI();   // 每回合跑敌军 PvE 循环（招募→升星→布阵，过程隐藏；手动刷新商店不动敌军）
  }

  const BENCH_MAX = 9;   // 仓库上限（与棋盘各 9，逼出资源/落子统筹）
  function recruit(idx) {
    const u = S.shop[idx];
    if (!u) return;
    const cost = unitCost(u);
    if (S.money < cost) { toast("钱不够，需要 " + fmt(cost) + " 文"); return; }
    // 仓库满时，仅放行能立刻合并的同名同星者
    const mergeable = S.board.concat(S.bench).some((b) => b.pid === u.pid && b.star === u.star && b.star < MAX_STAR);
    if (S.bench.length >= BENCH_MAX && !mergeable) { toast("仓库已满（" + BENCH_MAX + " 人）"); return; }
    S.money -= cost;
    const nu = { uid: ++uidSeq, pid: u.pid, name: u.name, faction: u.faction, cost: u.cost,
      star: 1, baseHp: u.baseHp, baseAtk: u.baseAtk, bond: u.bond, archetype: u.archetype, slot: -1 };
    S.bench.push(nu);                 // 入仓库，玩家自己摆位
    mergeStars();
    S.shop[idx] = null;
    pushLog("招贤", "募得 " + u.name + "（入仓库，" + fmt(cost) + " 文）");
    save(); render();
  }

  function mergeStars() {
    // 两名同名同星者自动合并，星级 +1（2 合 1，上限 MAX_STAR）；棋盘与仓库一并计算
    let merged = true;
    while (merged) {
      merged = false;
      const groups = {};
      const all = [];
      S.board.forEach((u) => all.push({ u, arr: S.board }));
      S.bench.forEach((u) => all.push({ u, arr: S.bench }));
      all.forEach(({ u }) => {
        if (u.star >= MAX_STAR) return;
        const k = u.pid + "#" + u.star;
        (groups[k] = groups[k] || []).push(u);
      });
      for (const k in groups) {
        if (groups[k].length >= 2) {
          const keep = groups[k][0], gone = groups[k][1];
          const arr = (S.board.indexOf(gone) >= 0) ? S.board : S.bench;
          arr.splice(arr.indexOf(gone), 1);
          keep.star += 1;
          const sm = B.STAR_MULT[keep.star] || 1;
          pushLog("升星", keep.name + " 升至 " + keep.star + " 星（" + keep.archetype +
            " " + Math.round(keep.baseAtk * sm) + "）");
          merged = true;
          break;
        }
      }
    }
  }

  /* ───────────── 羁绊计算 ───────────── */
  function bondMults() {
    const out = {};   // uid -> mult
    // 主羁绊：同阵营
    const fc = {};
    S.board.forEach((u) => { fc[u.faction] = (fc[u.faction] || 0) + 1; });
    const ftiers = D.bonds.faction.tiers;
    let fmult = 1;
    ftiers.forEach((t) => { if ((fc[S.faction] || 0) >= t.n) fmult = t.mult; });
    // 子羁绊：同 bond 名 ≥2
    const bc = {};
    S.board.forEach((u) => { bc[u.bond] = (bc[u.bond] || 0) + 1; });
    // 亲属 / 举荐
    const pids = new Set(S.board.map((u) => u.pid));
    const kinHit = new Set(), menHit = new Set();
    (D.relations.kin || []).forEach(([a, b]) => { if (pids.has(a) && pids.has(b)) { kinHit.add(a); kinHit.add(b); } });
    (D.relations.mentor || []).forEach(([m, s]) => { if (pids.has(m) && pids.has(s)) menHit.add(s); });

    S.board.forEach((u) => {
      let m = 1;
      if (u.faction === S.faction) m *= fmult;
      if ((bc[u.bond] || 0) >= 2) m *= 1.08;
      if (kinHit.has(u.pid)) m *= 1.10;
      if (menHit.has(u.pid)) m *= 1.12;
      out[u.uid] = m;
    });
    return out;
  }

  function boardPower() {
    const bm = bondMults();
    let p = 0;
    S.board.forEach((u) => {
      const sm = B.STAR_MULT[u.star] || 1;
      const rc = rowCfg(u.slot);
      p += (u.baseHp * 0.4 * rc.hp + u.baseAtk * 2.2 * rc.atk) * sm * (bm[u.uid] || 1);
    });
    // 前排无人则被冲阵：后排直接暴露，全军折损
    if (S.board.length > 0 && frontCount() === 0) p *= NO_FRONT_PENALTY;
    return p + S.soldiers * 30;
  }
  // 单位面板数值（攻/寿，已含星级与阵位）
  function unitStats(u, bm) {
    const sm = B.STAR_MULT[u.star] || 1;
    const rc = rowCfg(u.slot);
    return {
      atk: Math.round(u.baseAtk * sm * rc.atk),
      hp: Math.round(u.baseHp * sm * rc.hp),
      mult: (bm && bm[u.uid]) || 1,
    };
  }

  // 敌军战力曲线（生成敌军阵容的目标值）：随回合抬升（⚑ 待模拟定标）
  // ⚑ 定标（seed 4242）：起手只有兵 → 开局即败；铺满 12 人并升星 → 可胜，末段与敌军咬住
  const ENEMY_FINAL = { short: 2500, mid: 2900, long: 3300 };
  // 敌军 PvE 循环（2026-09-28 重写）：电脑自己也有「招募→仓库→升星→布阵」，过程对玩家不可见。
  //   每回合按 ENEMY_RECRUIT_PER_TURN 招人入隐藏仓库，做 2合1 升星，再从左3列空位部署；布阵战力受难度曲线约束。
  //   战败损失的单位不会满血复活，但仓库有储备、会持续补充——不再「一次只上一张」。
  const ENEMY_RECRUIT_PER_TURN = 3;
  function enemyCurveTarget() {
    const total = Math.max(2, S.endYear - 190);
    const finalE = ENEMY_FINAL[S.diff] || ENEMY_FINAL.long;
    const step = (finalE - 230) / (total - 1);
    return Math.round(230 + (S.turn - 1) * step);
  }
  // 敌军阵容：据难度曲线生成一支「有名有姓、有星级、分前后排」的敌方布阵（TFT 式，玩家可见可针对性换位）
  // ⚑ 修正（2026-09-28）：原写法把 T 均摊到固定 n 个单位，但单个单位 ★1 的最小贡献就常超过其份额，
  //    导致实际战力≈曲线 2.5 倍。改为「按剩余预算贪心填充、达标即停、超预算则跳过」，使敌军≈曲线。
  function genEnemyBoard() {
    const curated = new Set(curatedPids());
    const roster = D.units.filter((u) => u.faction !== S.faction && curated.has(u.pid));
    if (!roster.length) { S.enemy = []; return; }
    const T = enemyCurveTarget();                    // 本回合敌军总战力目标
    const board = []; let guard = 0;
    while (board.length < BOARD_MAX && guard++ < 40) {
      const u = pick(roster, S.rng);
      const want = ROW_OF[u.archetype];
      const slot = firstEmptySlotInCols(board, 0, ENEMY_COLS - 1, want != null ? want : 1);
      if (slot < 0) break;
      const remain = T - enemyBoardPower(board);
      if (remain <= 0) break;                        // 已达标
      const contrib = (star) => { const sm = B.STAR_MULT[star] || 1; const rc = rowCfg(slot); return (u.baseHp * 0.4 * rc.hp + u.baseAtk * 2.2 * rc.atk) * sm; };
      if (contrib(1) > remain * 1.5) break;          // 最小单位都会严重超预算，停
      let star = 1;
      for (let s = 1; s <= MAX_STAR; s++) { if (contrib(s) <= remain * 1.5) star = s; else break; }
      board.push({ name: u.name, pid: u.pid, faction: u.faction, archetype: u.archetype,
        baseAtk: u.baseAtk, baseHp: u.baseHp, bond: u.bond, star, slot });
    }
    S.enemy = board;
  }
  function enemyBoardPower(board) {
    if (!board || !board.length) return 0;
    let p = 0;
    board.forEach((u) => {
      const sm = B.STAR_MULT[u.star] || 1; const rc = rowCfg(u.slot);
      p += (u.baseHp * 0.4 * rc.hp + u.baseAtk * 2.2 * rc.atk) * sm;
    });
    if (frontCountOf(board) === 0) p *= NO_FRONT_PENALTY;
    return p;
  }
  // 会战对比用的敌军战力 = 敌军阵容实算（与玩家 boardPower 同口径）
  function enemyPower() { return Math.round(enemyBoardPower(S.enemy)); }

  // 敌军「招募」：每回合招 ENEMY_RECRUIT_PER_TURN 名入隐藏仓库（玩家不可见）。
  // 星级随当前难度曲线抬升——曲线越高，招来的将越强，这样 9 格棋盘内仍能凑出≈曲线的战力（不会沦为杂兵）。
  function enemyRecruit() {
    const curated = new Set(curatedPids());
    const roster = D.units.filter((u) => u.faction !== S.faction && curated.has(u.pid));
    if (!roster.length) return;
    const t = enemyCurveTarget();
    const p3 = t > 2000 ? 0.40 : t > 1200 ? 0.18 : 0.04;
    const p2 = t > 2000 ? 0.42 : t > 1200 ? 0.32 : 0.16;
    let added = 0;
    while (added < ENEMY_RECRUIT_PER_TURN && S.enemyBench.length < BENCH_MAX) {
      const u = pick(roster, S.rng);
      const r = S.rng();
      const star = r < p3 ? 3 : r < p3 + p2 ? 2 : 1;
      S.enemyBench.push({ uid: ++uidSeq, pid: u.pid, name: u.name, faction: u.faction,
        cost: u.cost, star, baseHp: u.baseHp, baseAtk: u.baseAtk, bond: u.bond, archetype: u.archetype, slot: -1 });
      added++;
    }
  }
  // 敌军「升星」：仿玩家 2合1，棋盘与仓库一并判定（隐藏，不写日志）
  function enemyMergeStars() {
    let merged = true;
    while (merged) {
      merged = false;
      const groups = {};
      const all = [];
      S.enemy.forEach((u) => all.push({ u, arr: S.enemy }));
      S.enemyBench.forEach((u) => all.push({ u, arr: S.enemyBench }));
      all.forEach(({ u }) => {
        if (u.star >= MAX_STAR) return;
        const k = u.pid + "#" + u.star;
        (groups[k] = groups[k] || []).push(u);
      });
      for (const k in groups) {
        if (groups[k].length >= 2) {
          const keep = groups[k][0], gone = groups[k][1];
          const arr = (S.enemy.indexOf(gone) >= 0) ? S.enemy : S.enemyBench;
          arr.splice(arr.indexOf(gone), 1);
          keep.star += 1;
          merged = true;
          break;
        }
      }
    }
  }
  // 单位「展示战力」贡献（不含羁绊）：有 slot 的按实际排位、仓库里的按兵种默认排位估算
  function unitContrib(u) {
    const sm = B.STAR_MULT[u.star] || 1;
    const row = (u.slot != null && u.slot >= 0)
      ? rowCfg(u.slot)
      : (ROWS_CFG[ROW_OF[u.archetype] != null ? ROW_OF[u.archetype] : 1] || ROWS_CFG[1]);
    return (u.baseHp * 0.4 * row.hp + u.baseAtk * 2.2 * row.atk) * sm;
  }
  // 敌军「布阵」：从隐藏仓库把单位弄上左 3 列，使场上战力逼近难度曲线（受 BOARD_MAX 与曲线双重约束）。
  //   ① 有空位：挑一个能塞进曲线预算、最接近剩余空间的单位部署；② 棋盘满但仓库有更强的将：换下最弱场将（升舱）。
  //   像玩家一样——弱将先压仓库、强将随时顶上；战败后靠仓库储备迅速重整，不再「一次只上一张」。
  function enemyDeploy() {
    const curve = enemyCurveTarget();
    let guard = 0;
    while (guard++ < 120) {
      const cur = enemyBoardPower(S.enemy);
      let acted = false;
      if (cur > curve * 1.15 && S.enemy.length > 1) {
        // ③ 安全网：极端超曲线（理论不触发）退回最强场将
        let strong = null, strongC = -1;
        S.enemy.forEach((u) => { const c = unitContrib(u); if (c > strongC) { strongC = c; strong = u; } });
        S.enemy.splice(S.enemy.indexOf(strong), 1); strong.slot = -1; S.enemyBench.push(strong);
        acted = true;
      } else if (S.enemy.length < BOARD_MAX) {
        // ① 补空位：挑一个能塞进曲线预算（≤曲线×1.05）的最弱仓库单位
        let pickIdx = -1, bestFit = Infinity;
        for (let i = 0; i < S.enemyBench.length; i++) {
          const c = unitContrib(S.enemyBench[i]);
          if (cur + c <= curve * 1.05 && c < bestFit) { bestFit = c; pickIdx = i; }
        }
        if (pickIdx >= 0) {
          const u = S.enemyBench[pickIdx];
          const slot = firstEmptySlotInCols(S.enemy, 0, ENEMY_COLS - 1, ROW_OF[u.archetype] != null ? ROW_OF[u.archetype] : 1);
          if (slot >= 0) { u.slot = slot; S.enemyBench.splice(pickIdx, 1); S.enemy.push(u); acted = true; }
        }
      }
      if (!acted && S.enemy.length >= BOARD_MAX) {
        // ② 升舱：在曲线×1.10 上限内，穷举找能让全场战力最大化的「场将↔仓库将」交换（强将逐步顶上）
        let bestB = -1, bestE = -1, bestNewCur = cur;
        for (let bi = 0; bi < S.enemyBench.length; bi++) {
          const cb = unitContrib(S.enemyBench[bi]);
          for (let ei = 0; ei < S.enemy.length; ei++) {
            const ce = unitContrib(S.enemy[ei]);
            if (cb <= ce) continue;                 // 只升不降
            const newCur = cur - ce + cb;
            if (newCur <= curve * 1.10 && newCur > bestNewCur) { bestNewCur = newCur; bestB = bi; bestE = ei; }
          }
        }
        if (bestB >= 0) {
          const u = S.enemyBench[bestB], e = S.enemy[bestE], ws = e.slot;
          S.enemy.splice(bestE, 1); e.slot = -1; S.enemyBench.push(e);
          u.slot = ws; S.enemyBench.splice(bestB, 1); S.enemy.push(u); acted = true;
        }
      }
      if (!acted) break;
    }
  }
  // 敌军 PvE 主循环：每回合 招人→升星→布阵（过程对玩家不可见）
  function runEnemyAI() {
    if (!S.enemyBench) S.enemyBench = [];
    enemyRecruit();
    enemyMergeStars();
    enemyDeploy();
  }

  // 羁绊一览（给玩家看的生效项）
  function bondSummary() {
    const out = [];
    const fc = {};
    S.board.forEach((u) => { fc[u.faction] = (fc[u.faction] || 0) + 1; });
    const n = fc[S.faction] || 0;
    const ft = D.bonds.faction.tiers;
    let lv = 0, mult = 1, nextN = ft.length ? ft[0].n : 2;
    ft.forEach((t, i) => { if (n >= t.n) { lv = i + 1; mult = t.mult; } });
    for (let i = 0; i < ft.length; i++) { if (n < ft[i].n) { nextN = ft[i].n; break; } if (i === ft.length - 1) nextN = null; }
    if (n > 0) out.push({ text: S.factionName + "同阵 " + n + " 人" + (lv ? " · Lv" + lv : ""), on: lv > 0,
      tip: lv ? "全军 ×" + mult.toFixed(2) : "尚未成阵" });
    const bc = {};
    S.board.forEach((u) => { bc[u.bond] = (bc[u.bond] || 0) + 1; });
    Object.keys(bc).forEach((k) => {
      if (bc[k] >= 2) out.push({ text: k + " " + bc[k] + " 人", on: true, tip: "同系 ×1.08" });
    });
    const pids = new Set(S.board.map((u) => u.pid));
    let kin = 0, men = 0;
    (D.relations.kin || []).forEach(([a, b]) => { if (pids.has(a) && pids.has(b)) kin += 1; });
    (D.relations.mentor || []).forEach(([m, s]) => { if (pids.has(m) && pids.has(s)) men += 1; });
    if (kin) out.push({ text: "亲属 " + kin + " 组", on: true, tip: "×1.10" });
    if (men) out.push({ text: "举荐 " + men + " 组", on: true, tip: "被举者 ×1.12" });
    return out;
  }

  /* ───────────── 行动（筹措） ───────────── */
  function spendAp(n) { S.ap -= n; }

    function doMint(id) {
    const c = D.coinCards.find((x) => x.id === id);
    if (!c || S.ap < 1) return;
    // 一国一年之币政：每回合只铸一次（否则一年连铸三次会把 P 直接推过崩坏线）
    if (S.mintedThisYear) { toast("本年已行铸币"); return; }
    if (c.faction && c.faction !== S.faction) { toast("非本势力币种"); return; }
    if (c.requires && !S.unlockedCoins[c.id]) { toast("尚未解锁：" + c.name); return; }
    const f = D.factions[S.faction];
    const gain = (c.gainMoney || 0) * (f.coinMult || 1);
    const pm = c.priceMult;
    // priceMult>1 表示推高物价；受势力 priceMult 系数修正（balance §3）
    const eff = pm > 1 ? 1 + (pm - 1) * (f.priceMult || 1) : pm;
    S.money += gain;
    S.P = Math.round(S.P * eff);
    if (c.bianhuPct) S.bianhu = Math.max(0, S.bianhu * (1 + c.bianhuPct));
    if (c.grainPct) S.grain = Math.max(0, S.grain * (1 + c.grainPct));
    if (c.recallDaqian) { /* 回收：大泉类折算，此处简化为直接扣一部分钱 */ S.money = Math.round(S.money * (1 - c.recallDaqian * 0.3)); }
    S.mintedThisYear = true;
    spendAp(1);
    pushLog("铸币", c.name + "：得钱 " + fmt(gain) + "，物价 ×" + eff.toFixed(2) + " → P=" + S.P);
    save(); render();
  }

  function doTuntian() {
    if (S.ap < 1) return;
    if (S.tuntian >= TUNTIAN_MAX) { toast("可屯之地已尽（上限 " + TUNTIAN_MAX + " 处）"); return; }
    const cm = Math.round(2000 * S.tuntianCostMult), cg = 300;
    if (S.money < cm || S.grain < cg) { toast("资源不足（需 " + fmt(cm) + " 文 / " + cg + " 斛）"); return; }
    S.money -= cm; S.grain -= cg; S.tuntian += 1;
    spendAp(1);
    pushLog("屯田", "新建屯田 1 处（累计 " + S.tuntian + "）");
    save(); render();
  }

  function doTrade(dir) {
    if (S.ap < 1) return;
    if (S.moneyFrozen > 0) { toast("钱已冻结（以谷帛为市）"); return; }
    // 兑换率 = 物价指数（balance §四 机制1）；谷帛带成色（湿谷薄绢）
    const rate = (S.P / 100) * S.silkQuality;
    // ⚑ 交易规模随国用放大：否则后期一次只能挪 300 斛，余钱无处可去 → 府库积钱推高 P
    const scale = 1 + S.turn * 0.06;
    if (dir === "buy") {          // 钱 → 谷（籴）：后期钱的主要去处
      const money = Math.round(Math.min(S.money, 3000 * scale));
      if (S.money < 500) { toast("钱不足"); return; }
      S.money -= money;
      S.grain += Math.round(money / (GRAIN_BASE_PRICE * rate));
      pushLog("通商", "以 " + fmt(money) + " 文籴谷（谷价 " + (GRAIN_BASE_PRICE * rate).toFixed(1) + " 文/斛）");
    } else {                      // 谷 → 钱（粜）
      const grain = Math.round(Math.min(S.grain, 300 * scale));
      if (S.grain < 100) { toast("谷不足"); return; }
      S.grain -= grain;
      S.money += Math.round(grain * GRAIN_BASE_PRICE * rate);
      pushLog("通商", "粜谷 " + fmt(grain) + " 斛（谷价 " + (GRAIN_BASE_PRICE * rate).toFixed(1) + " 文/斛）");
    }
    spendAp(1);
    save(); render();
  }

  function doConscript() {
    if (S.ap < 1) return;
    const cost = Math.round(BASE_UPKEEP * (S.P / 100));
    if (S.bianhu < 0.5) { toast("编户不足，无丁可征"); return; }
    if (S.money < cost) { toast("钱不足（需 " + fmt(cost) + " 文）"); return; }
    // ⚑ 0.5 → 0.3：原值下「会战损兵 → 征兵补员」会一路抽干税基（魏实测 35→11.5 万户）
    S.money -= cost; S.bianhu -= 0.3; S.soldiers += 0.5;
    spendAp(1);
    pushLog("征兵", "编户 -0.3 万 → 兵 +0.5 万");
    save(); render();
  }

  function playSystem(id) {
    const c = D.systemCards.find((x) => x.id === id);
    if (!c || S.ap < (c.ap || 1)) return;
    if (c.faction && c.faction !== S.faction) { toast("非本势力制度"); return; }
    if (c.requires && !S.playedSystems[c.id] && !checkReq(c.requires)) { toast("条件未满足：" + c.requires); return; }
    if (S.playedSystems[c.id] && !c.repeatable) { toast("已施行"); return; }
    const e = c.effect || {};
    if (e.type === "build_tuntian") {
      if (S.tuntian >= TUNTIAN_MAX) { toast("可屯之地已尽（上限 " + TUNTIAN_MAX + " 处）"); return; }
      if (S.money < (c.costMoney || 0) || S.grain < (c.costGrain || 0)) { toast("资源不足"); return; }
      S.money -= c.costMoney || 0; S.grain -= c.costGrain || 0; S.tuntian += 1;
    } else if (e.type === "unlock_hutiao") { S.hutiao = true; }
    else if (e.type === "grain_mult") { S.shuili = true; }
    else if (e.type === "soldier_grain") { S.juntun = true; }
    else if (e.type === "gain_soldier") {
      // ⚠ e.bianhu 可能缺省（如「平南中」只给兵）：缺省不得让编户变 NaN
      const bh = Number(e.bianhu) || 0;
      if (S.bianhu < Math.abs(bh)) { toast("编户不足，无法荫庇"); return; }
      S.soldiers += Number(e.soldiers) || 0;
      S.bianhu = Math.max(0, S.bianhu + bh);
      S.yinke += Number(e.yinkeOccupy) || 0;
    }
    else if (e.type === "yinke_legal_lv") { S.yinkeLegalLv = (S.yinkeLegalLv || 0) + (e.lv || 1); }
    else if (e.type === "yinke_legal") { S.yinkeLegal = true; }
    else if (e.type === "transport_loss") { S.transportLoss = e.mult || 0.7; }
    else if (e.type === "shanyue") {
      if (S.soldiers < 1.5) { toast("兵力不足"); return; }
      S.soldiers -= 1.5; S.bianhu += 4;
    }
    else if (e.type === "silk_to_money") { S.money += Math.round(S.silk * SILK_BASE_PRICE); S.silk = 0; }
    else if (e.type === "trade_bonus") { S.grain += 200; S.money += 1500; }
    else if (e.type === "jiankuo") {
      // 检括：把荫客退回编户（可重复施行，用来对抗逐年侵蚀）
      if (S.money < (c.costMoney || 0) || S.grain < (c.costGrain || 0)) { toast("资源不足"); return; }
      if (S.yinke < 0.1) { toast("荫客无几，无需检括"); return; }
      S.money -= c.costMoney || 0; S.grain -= c.costGrain || 0;
      const back = S.yinke * (e.mult || 0.35);
      S.yinke -= back; S.bianhu += back;
      pushLog("检括", "「" + c.name + "」：荫客 " + back.toFixed(2) + " 万户复归编户（余 " + S.yinke.toFixed(1) + "）");
      if (!c.repeatable) S.playedSystems[c.id] = true;
      spendAp(c.ap || 1);
      save(); render();
      return;
    }
    S.playedSystems[c.id] = true;
    spendAp(c.ap || 1);
    pushLog("制度", "施行「" + c.name + "」" + (c.note ? "：" + c.note : ""));
    save(); render();
  }

  function checkReq(req) {
    if (req.startsWith("event:")) return !!S.drawnEvents[req.slice(6)];
    if (req.startsWith("tech:")) {
      const t = req.slice(5);
      if (t === "caowei_late") return S.year >= 230;   // 曹魏后期：租牛客户（三论页34）
      if (t === "jin") return S.year >= 265;           // 西晋：太康户调式（三论页37）
      return true;
    }
    return true;
  }

  /* ───────────── 回合推进 ───────────── */
  function endTurn() {
    if (S.over) return;
    // 【史事】事件卡
    drawEvent();
    // 【结算】产出 / 军费 / 逃亡 / 荫客查处
    settle();
    // 【会战】
    battle();
    // 下一年
    S.year += 1; S.turn += 1; S.ap = B.AP_PER_TURN; S.mintedThisYear = false;
    if (S.moneyFrozen > 0) S.moneyFrozen -= 1;
    rollShop(true);
    checkEnd();
    save(); render();
  }

  function drawEvent() {
    const avail = D.eventCards.filter((c) =>
      S.year >= c.year && !S.drawnEvents[c.id] && (!c.faction || c.faction === S.faction));
    if (!avail.length) return;
    const total = avail.reduce((s, c) => s + (c.weight || 1), 0);
    let r = S.rng() * total, chosen = avail[0];
    for (const c of avail) { r -= (c.weight || 1); if (r <= 0) { chosen = c; break; } }
    S.drawnEvents[chosen.id] = true;
    applyEffects(chosen.effects || []);
    pushLog("史事", chosen.year + " " + chosen.name);
  }

  function applyEffects(effects) {
    effects.forEach((e) => {
      if (e.mult !== undefined) {
        if (e.k === "P") S.P = Math.round(S.P * e.mult);
        else if (e.k === "tuntian_yield") S.tuntianYieldMult = e.mult;
        else if (e.k === "tuntian_cost") S.tuntianCostMult = e.mult;
      } else if (e.pct !== undefined) {
        if (e.k === "bianhu") S.bianhu = Math.max(0, S.bianhu * (1 + e.pct));
        else if (e.k === "grain") S.grain = Math.max(0, S.grain * (1 + e.pct));
        else if (e.k === "soldiers") S.soldiers = Math.max(0, S.soldiers * (1 + e.pct));
        else if (e.k === "silk_quality") S.silkQuality = Math.max(0.5, S.silkQuality * (1 + e.pct));
      } else if (e.k === "money_freeze") S.moneyFrozen = e.turns || 4;
      else if (e.k === "money_unfreeze") S.moneyFrozen = 0;
      else if (e.k === "unlock") S.unlockedCoins[e.v] = true;
      else if (e.k === "flag") {
        if (e.v === "hutiao") S.hutiao = true;
        if (e.v === "xutuntian") S.tuntianCostMult = 0.5;
      }
    });
  }

  function settle() {
    // 产出
    let g = S.bianhu * BASE_GRAIN_PER_BIANHU;
    g += S.tuntian * TUNTIAN_YIELD * (S.tuntianYieldMult || 1);
    if (S.shuili) g *= 1.5;
    if (S.juntun) g += S.soldiers * 60;
    S.grain += Math.round(g);
    if (S.hutiao) S.silk += Math.round(S.bianhu * BASE_SILK_PER_BIANHU * S.silkQuality);
    // 军粮：兵食于官，且年久益费（sink）
    const gup = Math.round(S.soldiers * GRAIN_UPKEEP_PER_SOLDIER * (1 + (S.year - 190) * GRAIN_UPKEEP_YEAR_GROWTH));
    if (gup > 0) {
      if (S.grain >= gup) S.grain -= gup;
      else {
        S.grain = 0;
        S.soldiers = Math.max(0, S.soldiers - 0.5);
        pushLog("缺粮", "军粮不继（需 " + fmt(gup) + " 斛），兵溃 0.5 万");
      }
    }
    // 军费
    const up = Math.round(upkeep());
    if (S.money >= up) S.money -= up;
    else { S.money = 0; S.grain = Math.max(0, S.grain - 200); pushLog("军费", "钱不足，动用存粮抵充"); }
    // ⚑ 后期 sink 2：士族荫客自然侵蚀 —— 编户逐年转入荫客（税基被永久吞掉，只能靠「检括」赎）
    const er = erosionRate();
    if (S.bianhu > 0.2) {
      const moved = S.bianhu * er;
      S.bianhu = Math.max(0, S.bianhu - moved);
      S.yinke += moved;
      if (S.turn % 5 === 0) pushLog("侵蚀", "士族荫客：编户转入 " + moved.toFixed(2) + " 万户（荫客 " + S.yinke.toFixed(1) + "）");
    }
    // 户口滋殖 + 屯田吸纳流民（与侵蚀对冲：守住税基靠低物价与屯田）
    const gr = S.P < 150 ? GROWTH_LOW_P : S.P < GROWTH_P_LINE ? GROWTH_MID_P : 0;
    const attracted = Math.min(S.tuntian, TUNTIAN_ATTRACT_CAP) * TUNTIAN_ATTRACT;
    if (gr > 0 || attracted > 0) S.bianhu += S.bianhu * gr + attracted;
    // 太仓陈腐：谷过 15 万斛后霉烂（sink，也防「无脑囤粮」）
    if (S.grain > ROT_LIMIT) {
      const rot = (S.grain - ROT_LIMIT) * ROT_RATE;
      S.grain -= rot;
      if (S.turn % 5 === 0) pushLog("陈腐", "太仓积粟 " + fmt(S.grain) + " 斛，霉烂 " + fmt(rot) + " 斛");
    }
    // 通胀逃亡（balance §5.1）
    if (S.P > B.P_FLEE) {
      const f = Math.min(0.06, (S.P - B.P_FLEE) / 3000);
      const loss = S.bianhu * f;
      S.bianhu = Math.max(0, S.bianhu - loss);
      if (loss > 0.01) pushLog("逃亡", "物价过高，编户流失 " + loss.toFixed(2) + " 万户");
    }
    // 荫客查处（balance §5.2）：非法期按占用/配额触发
    if (!S.yinkeLegal && S.yinke > 0) {
      const ratio = S.yinke / Math.max(1, S.yinkeQuota);
      let p = Math.min(0.4, ratio * 0.25);
      if ((S.yinkeLegalLv || 0) >= 1) p *= 0.5;   // 孙吴复客：查处概率减半
      if (ratio > 1) p += 0.15;                    // 超配额（额外之客非法）加重
      if (S.rng() < p) {
        const lb = S.yinke * 0.10, ls = S.yinke * 0.05;
        S.bianhu = Math.max(0, S.bianhu - lb);
        S.soldiers = Math.max(0, S.soldiers - ls);
        pushLog("查处", "荫客逾制被查处：编户 -" + lb.toFixed(2) + "，兵 -" + ls.toFixed(2));
      }
    }
    // 物价自然回落（回笼 / 币制恢复）：向 100 收敛。
    // 魏最稳、蜀最不稳 —— 对应彭信威「曹魏钱虽粗但重稳，故魏地经济较稳」（balance §3）
    const decay = P_DECAY[S.faction] || 0.05;
    if (S.P > 100) {
      const before = S.P;
      S.P = Math.max(100, Math.round(S.P - (S.P - 100) * decay));
      if (before - S.P >= 5) pushLog("回笼", "物价回落 " + before + " → " + S.P);
    }
    // 钱货相权：府库积钱过多则钱轻物重（P 上行）—— ⚑ 后期 sink 3，防「无脑囤钱通关」
    if (S.money > MONEY_HEAVY) {
      const push = Math.round((S.money - MONEY_HEAVY) / MONEY_HEAVY * MONEY_HEAVY_K);
      if (push > 0) S.P += push;
      if (push >= 5 && S.turn % 3 === 0) pushLog("钱轻", "府库积钱 " + fmt(S.money) + " 文，钱轻物重 P +" + push);
    }
    // 利息（balance §6.1：钱 ×5%，上限 50 招募点）
    // ⚑ 修正：原上限换算成钱后高达数万，5% 复利会让后期钱爆炸（蜀曾堆到 60 万），改绝对封顶
    const interest = Math.min(S.money * B.INTEREST_RATE, B.INTEREST_CAP_MONEY);
    S.money += Math.round(interest);
  }

  // 真实会战：双方按前/中/后排对拼，前排承伤先掉血、血尽才退场；胜则清敌获赏、败则我方也损将
  function combatants(arr, isPlayer) {
    const bm = isPlayer ? bondMults() : null;
    return arr.map((u) => {
      const sm = B.STAR_MULT[u.star] || 1;
      const rc = rowCfg(u.slot);
      const mult = isPlayer ? (bm[u.uid] || 1) : 1;
      return { u, hp: u.baseHp * sm * rc.hp * mult, atk: u.baseAtk * sm * rc.atk * mult, alive: true, row: rowOfSlot(u.slot) };
    }).sort((a, b) => b.row - a.row);   // 前排（高 row）在前，先承伤
  }
  function resolveDamage(army, dmg) {
    let i = 0;
    while (dmg > 0 && i < army.length) {
      const c = army[i];
      if (!c.alive) { i++; continue; }
      if (dmg < c.hp) { c.hp -= dmg; dmg = 0; }
      else { dmg -= c.hp; c.alive = false; i++; }
    }
  }
  function battleReal() {
    const p = combatants(S.board, true);
    const e = combatants(S.enemy, false);
    const pNoFront = S.board.length > 0 && frontCount() === 0;
    const eNoFront = S.enemy.length > 0 && frontCountOf(S.enemy) === 0;
    let round = 0;
    while (round++ < 800) {
      const pa = p.filter((c) => c.alive), ea = e.filter((c) => c.alive);
      if (!pa.length || !ea.length) break;
      const pAtk = pa.reduce((s, c) => s + c.atk, 0) * (pNoFront ? NO_FRONT_PENALTY : 1);
      const eAtk = ea.reduce((s, c) => s + c.atk, 0) * (eNoFront ? NO_FRONT_PENALTY : 1);
      resolveDamage(e, pAtk);
      resolveDamage(p, eAtk);
    }
    return { p, e };
  }
  function battle() {
    if (!S.enemy.length && !S.board.length) return;
    if (!S.enemy.length) {                 // 无敌军来犯：直接胜
      S.streak += 1;
      S.money += 1200 + 300 * S.turn; S.grain += 200 + 40 * S.turn;
      pushLog("会战", "胜 · 无敌军来犯，得钱粮");
      return;
    }
    if (!S.board.length) {                 // 我方无阵：直接败
      S.streak = 0;
      S.soldiers = Math.max(0, S.soldiers - Math.max(0.5, S.soldiers * 0.12));
      S.grain = Math.max(0, S.grain - (200 + 40 * S.turn));
      pushLog("会战", "败 · 我方无阵，兵溃");
      return;
    }
    const { p, e } = battleReal();
    const pAlive = p.filter((c) => c.alive), eAlive = e.filter((c) => c.alive);
    const myDead = S.board.length - pAlive.length;
    const enDead = S.enemy.length - eAlive.length;
    S.board = pAlive.map((c) => c.u);
    S.enemy = eAlive.map((c) => c.u);
    const enemyCleared = eAlive.length === 0, playerWiped = pAlive.length === 0;
    if (enemyCleared) {
      S.streak += 1;
      const bonus = S.streak >= 2 ? Math.round(B.STREAK_BONUS * 1000 * (S.P / 100) * Math.min(S.streak, 5)) : 0;
      S.money += 1200 + 300 * S.turn + bonus;
      S.grain += 200 + 40 * S.turn;
      pushLog("会战", "胜 · 斩敌 " + enDead + " 员，我损 " + myDead + " 将" +
        (bonus ? "，连胜 +" + fmt(bonus) : "") + (playerWiped ? "（惨胜）" : ""));
    } else if (playerWiped) {
      S.streak = 0;
      const ls = Math.max(0.5, S.soldiers * 0.12), lg = 200 + 40 * S.turn;
      S.soldiers = Math.max(0, S.soldiers - ls);
      S.grain = Math.max(0, S.grain - lg);
      pushLog("会战", "败 · 我方阵亡 " + myDead + " 将，兵 -" + ls.toFixed(2) + " 万，谷 -" + lg);
    } else {                                // 双方皆存（理论上限防呆）：比剩余血量
      const myHp = pAlive.reduce((s, c) => s + c.hp, 0), enHp = eAlive.reduce((s, c) => s + c.hp, 0);
      if (myHp >= enHp) {
        S.streak += 1;
        S.money += 1200 + 300 * S.turn; S.grain += 200 + 40 * S.turn;
        pushLog("会战", "胜 · 斩敌 " + enDead + " 员，我损 " + myDead + " 将（敌尚余 " + eAlive.length + "）");
      } else {
        S.streak = 0;
        const ls = Math.max(0.5, S.soldiers * 0.1), lg = 200 + 40 * S.turn;
        S.soldiers = Math.max(0, S.soldiers - ls); S.grain = Math.max(0, S.grain - lg);
        pushLog("会战", "败 · 我方阵亡 " + myDead + " 将，兵 -" + ls.toFixed(2) + " 万");
      }
    }
  }

  function checkEnd() {
    if (S.P >= B.P_COLLAPSE) { S.over = "lose"; pushLog("结局", "物价崩坏（P≥" + B.P_COLLAPSE + "），钱成废纸。"); return; }
    if (S.grain < 0 && realPower() < upkeep()) { S.over = "lose"; pushLog("结局", "粮尽且购买力不足，兵溃。"); return; }
    // 「兵尽将亡」原判据太严：无兵且阵容空就立刻判负，早期一个买不起人的回合就猝死
    if (S.soldiers <= 0 && S.board.length === 0 && S.money < 2000 && S.grain < 2000) { S.over = "lose"; pushLog("结局", "兵尽将亡，府库亦空。"); return; }
    if (S.year >= S.endYear) {
      if (power() >= S.winPower) { S.over = "win"; pushLog("结局", "撑至 " + S.year + " 年，国力 " + Math.round(power()) + " ≥ " + S.winPower + "，成《食货志》。"); }
      else { S.over = "lose"; pushLog("结局", "撑至 " + S.year + " 年，但国力 " + Math.round(power()) + " 未达 " + S.winPower + "。"); }
    }
  }

  /* ───────────── 存档 ───────────── */
  function save() {
    try {
      const copy = Object.assign({}, S);
      copy.rng = null; copy.log = S.log.slice(0, 20);
      localStorage.setItem(SAVE_KEY, JSON.stringify(copy));
    } catch (e) { /* 忽略 */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      o.rng = makeRng(o.seed + o.turn);
      return o;
    } catch (e) { return null; }
  }

  /* ───────────── 渲染 ───────────── */
  function toast(msg) {
    const region = $("#toastRegion");
    if (!region) return;
    const tpl = $("#toastTemplate");
    // 防御：模板可能被主题/裁剪掉，缺了也不能让整个操作抛异常
    if (!tpl || !tpl.content || !tpl.content.firstElementChild) return;
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.textContent = msg;
    region.appendChild(node);
    setTimeout(() => node.remove(), 2600);
  }

  function priceColor(P) {
    if (P >= B.P_COLLAPSE) return "#7a2e2e";
    if (P >= 400) return "#b56a58";
    if (P >= B.P_FLEE) return "#ddc06a";
    return "#a3bcc9";
  }

  function render() {
    if (!S) return;
    const root = $("#shihuoGame");
    if (!root) return;
    $("#shihuoSetup").hidden = true;
    root.hidden = false;

    // 顶部
    $("#shYear").textContent = S.year + " 年";
    $("#shFaction").textContent = S.factionName;
    $("#shTurn").textContent = "第 " + S.turn + " / " + (S.endYear - 190 + 1) + " 回合";
    $("#shAp").textContent = "行动点 " + S.ap + " / " + B.AP_PER_TURN;

    // 物价条
    const pct = clamp(S.P / B.P_COLLAPSE * 100, 2, 100);
    const bar = $("#shPriceFill");
    bar.style.width = pct + "%";
    bar.style.background = priceColor(S.P);
    $("#shPriceVal").textContent = "P " + S.P;

    // 资源
    $("#shMoney").textContent = fmt(S.money);
    $("#shGrain").textContent = fmt(S.grain);
    $("#shSilk").textContent = fmt(S.silk);
    $("#shBianhu").textContent = S.bianhu.toFixed(1);
    $("#shSoldiers").textContent = S.soldiers.toFixed(1);
    $("#shYinke").textContent = S.yinke + " / " + S.yinkeQuota;
    const pw = Math.round(power());
    $("#shPower").textContent = fmt(pw) + " / " + fmt(S.winPower);

    // 铸币卡
    const mintBox = $("#shMintCards");
    mintBox.innerHTML = "";
    D.coinCards.forEach((c) => {
      if (c.faction && c.faction !== S.faction) return;
      const locked = c.requires && !S.unlockedCoins[c.id];
      const b = document.createElement("button");
      b.className = "brutal-button small" + (locked ? " disabled" : "");
      b.type = "button";
      b.disabled = locked || S.ap < 1;
      b.textContent = c.name + (locked ? "（未解锁）" : " +" + fmt(c.gainMoney * (D.factions[S.faction].coinMult || 1)));
      b.title = c.note + " ｜ " + c.anchor;
      b.addEventListener("click", () => doMint(c.id));
      mintBox.appendChild(b);
    });

    // 制度卡
    const sysBox = $("#shSystemCards");
    sysBox.innerHTML = "";
    D.systemCards.forEach((c) => {
      if (c.faction && c.faction !== S.faction) return;
      const done = !!S.playedSystems[c.id] && !c.repeatable;
      const b = document.createElement("button");
      b.className = "brutal-button small" + (done ? " disabled" : "");
      b.type = "button";
      b.disabled = done || S.ap < (c.ap || 1);
      b.textContent = c.name + (done ? "（已施行）" : "");
      b.title = (c.note || "") + " ｜ " + (c.anchor || "");
      b.addEventListener("click", () => playSystem(c.id));
      sysBox.appendChild(b);
    });

    // 商店
    const shopBox = $("#shShop");
    shopBox.innerHTML = "";
    S.shop.forEach((u, i) => {
      if (!u) { const d = document.createElement("div"); d.className = "sh-card empty"; d.textContent = "已招募"; shopBox.appendChild(d); return; }
      const d = document.createElement("button");
      d.type = "button";
      d.className = "sh-card";
      d.innerHTML = "<b>" + u.name + "</b>" +
        "<span class='sh-card-fac'>" + u.faction + " · " + u.cost + " 费</span>" +
        "<span class='sh-card-arch'>" + u.archetype + "　攻 " + u.baseAtk + " / 生 " + u.baseHp + "</span>" +
        "<span class='sh-card-bond'>羁绊：" + u.bond + "</span>" +
        "<em>" + fmt(unitCost(u)) + " 文</em>";
      d.addEventListener("click", () => recruit(i));
      shopBox.appendChild(d);
    });

    // 阵容：敌我共用一块 6×3 棋盘（左 3 列＝敌军，右 3 列＝我军）
    const bm = bondMults();
    const enemyLookup = {}; (S.enemy || []).forEach((u) => { enemyLookup[u.slot] = u; });
    const gridBox = $("#shGrid");
    if (gridBox) {
      gridBox.innerHTML = "";
      let maxHp = 1;
      S.board.concat(S.enemy || []).forEach((u) => { const h = u.baseHp * (B.STAR_MULT[u.star] || 1); if (h > maxHp) maxHp = h; });
      const hpRef = Math.max(600, maxHp);
      for (let r = 0; r < ROWS; r++) {
        const lab = document.createElement("div");
        lab.className = "sh-row-label";
        lab.innerHTML = "<b>" + (ROWS_CFG[r] ? ROWS_CFG[r].name : "") + "</b><span>" +
          (ROWS_CFG[r] ? ROWS_CFG[r].note : "") + "</span>";
        gridBox.appendChild(lab);
        for (let c = 0; c < COLS; c++) {
          const slot = r * COLS + c;
          const enemy = isEnemyCell(slot);
          const u = enemy ? enemyLookup[slot] : unitAt(slot);
          const cell = document.createElement(enemy ? "div" : "button");
          if (!enemy) cell.type = "button";
          const placeable = !enemy && S.benchSel != null && !u;
          cell.className = "sh-cell" + (u ? " filled" : " empty") + (enemy ? " enemy" : " me") +
            (S.sel === slot ? " sel" : "") + (placeable ? " placeable" : "");
          cell.dataset.slot = String(slot);
          if (u) {
            const sm = B.STAR_MULT[u.star] || 1; const rc = rowCfg(slot);
            const atk = Math.round(u.baseAtk * sm * rc.atk);
            const hp = Math.round(u.baseHp * sm * rc.hp);
            cell.innerHTML = "<b>" + u.name + "</b>" +
              "<span class='sh-star'>" + "★".repeat(u.star) + "</span>" +
              "<span class='sh-atk'>" + u.archetype + " " + atk + "</span>" +
              "<span class='sh-hp'><i style='width:" + clamp(hp / hpRef * 100, 6, 100).toFixed(0) + "%'></i></span>";
            cell.title = (enemy ? "敌 " : "") + u.name + " · " + u.faction + " · " + u.bond + "\n" +
              (ROWS_CFG[r] ? ROWS_CFG[r].name : "") + "：" + ROWS_CFG[r].note + "（生 ×" + ROWS_CFG[r].hp + "，攻 ×" + ROWS_CFG[r].atk + "）\n" +
              "攻 " + atk + "　生 " + hp + (enemy ? "" : (bm[u.uid] > 1.001 ? "　羁绊 ×" + bm[u.uid].toFixed(2) : ""));
          } else {
            cell.innerHTML = "<span class='sh-plus'>+</span>";
            cell.title = enemy ? "敌军空格" : (placeable ? "点此落子" : "我方空格（第 " + (c + 1) + " 列）");
          }
          if (!enemy) cell.addEventListener("click", () => onCellClick(slot));
          gridBox.appendChild(cell);
        }
      }
    }
    // 仓库（刚招募、尚未落子）
    const benchBox = $("#shBench");
    if (benchBox) {
      benchBox.innerHTML = "";
      if (!S.bench.length) {
        benchBox.innerHTML = "<span class='sh-bench-empty'>仓库空（招募后在此，点卡片再点右侧空格落子）</span>";
      } else {
        S.bench.forEach((u) => {
          const d = document.createElement("button");
          d.type = "button";
          d.className = "sh-card" + (S.benchSel === u.uid ? " sel" : "");
          d.innerHTML = "<b>" + u.name + "</b>" +
            "<span class='sh-card-fac'>" + u.faction + " · " + u.cost + " 费</span>" +
            "<span class='sh-card-arch'>" + u.archetype + "　攻 " + u.baseAtk + " / 生 " + u.baseHp + "</span>" +
            "<span class='sh-card-bond'>羁绊：" + u.bond + "</span>" +
            "<em>" + "★".repeat(u.star) + "</em>";
          d.addEventListener("click", () => { S.benchSel = (S.benchSel === u.uid ? null : u.uid); S.sel = null; save(); render(); });
          benchBox.appendChild(d);
        });
      }
    }
    $("#shBoardCount").textContent = "已布 " + S.board.length + " / " + BOARD_MAX + "　仓库 " + S.bench.length;
    const hint = $("#shBoardHint");
    if (hint) {
      let txt;
      if (S.benchSel != null) {
        const b = S.bench.find((x) => x.uid === S.benchSel);
        txt = b ? "已选仓库「" + b.name + "」，点右侧空格落子（再点卡片取消）" : "仓库已空";
      } else {
        const selU = S.sel != null ? unitAt(S.sel) : null;
        txt = selU ? "已选中「" + selU.name + "」，再点一格即换位（点原格取消）"
          : "招募进下方仓库，点仓库卡片再点右侧空格落子；左 3 列为敌军、不可操作。";
      }
      hint.textContent = txt;
      hint.className = "sh-hint" + (S.benchSel != null || S.sel != null ? " on" : "");
    }

    // 战力对比
    const mine = Math.round(boardPower()), en = enemyPower();
    const span = Math.max(mine, en, 1);
    const myBar = $("#shMyBar"), enBar = $("#shEnBar");
    if (myBar) myBar.style.width = clamp(mine / span * 100, 3, 100).toFixed(1) + "%";
    if (enBar) enBar.style.width = clamp(en / span * 100, 3, 100).toFixed(1) + "%";
    $("#shMyPow").textContent = fmt(mine);
    $("#shEnPow").textContent = fmt(en);
    const note = $("#shCmpNote");
    if (note) {
      const noFront = S.board.length > 0 && frontCount() === 0;
      note.textContent = mine > en
        ? "可胜（余 " + fmt(mine - en) + "）" + (noFront ? "　前排无人，全军 ×" + NO_FRONT_PENALTY : "")
        : "不敌（缺 " + fmt(en - mine) + "）" + (noFront ? "　前排无人，全军 ×" + NO_FRONT_PENALTY : "");
      note.className = "sh-cmp-note " + (mine > en ? "ok" : "bad");
    }
    const bondBox = $("#shBondList");
    if (bondBox) {
      bondBox.innerHTML = "";
      bondSummary().forEach((b) => {
        const chip = document.createElement("span");
        chip.className = "sh-bond-chip" + (b.on ? " on" : "");
        chip.textContent = b.text;
        if (b.tip) chip.title = b.tip;
        bondBox.appendChild(chip);
      });
      if (!bondBox.children.length) {
        const p = document.createElement("span");
        p.className = "sh-bond-chip";
        p.textContent = "尚未成阵";
        bondBox.appendChild(p);
      }
    }

    // 日志
    const logBox = $("#shLog");
    logBox.innerHTML = "";
    S.log.slice(0, 14).forEach((l) => {
      const p = document.createElement("p");
      p.className = "sh-log-line";
      p.innerHTML = "<b>" + l.year + " · " + l.kind + "</b> " + l.text;
      logBox.appendChild(p);
    });

    // 按钮可用性
    const canAct = S.ap > 0 && !S.over;
    ["shBtnTuntian", "shBtnTradeBuy", "shBtnTradeSell", "shBtnConscript", "shBtnRoll"].forEach((id) => {
      const el = $("#" + id); if (el) el.disabled = !canAct;
    });
    $("#shBtnEnd").disabled = !!S.over;

    if (S.over) showOver();
  }

  function showOver() {
    const dlg = $("#shOverDialog");
    if (!dlg) return;
    $("#shOverTitle").textContent = S.over === "win" ? "食货志成" : "国用不继";
    $("#shOverText").textContent = S.over === "win"
      ? "撑至 " + S.year + " 年，国力 " + Math.round(power()) + "。你把散落在纪传字缝里的经济制度，拼成了一部《食货志》。"
      : "终结于 " + S.year + " 年。物价 P=" + S.P + "，编户 " + S.bianhu.toFixed(1) + " 万户。" + (S.log[0] ? S.log[0].text : "");
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.hidden = false;
  }

  /* ───────────── 绑定 ───────────── */
  function bind() {
    const startBtn = $("#shStartBtn");
    if (startBtn) startBtn.addEventListener("click", () => {
      const fk = $("#shFactionSel").value;
      const dk = $("#shDiffSel").value;
      const seed = ($("#shSeedInput").value || "").trim();
      newGame(fk, dk, seed ? hashSeed(seed) : Date.now());
    });
    const on = (id, fn) => { const el = $("#" + id); if (el) el.addEventListener("click", fn); };
    on("shBtnTuntian", () => doTuntian());
    on("shBtnTradeBuy", () => doTrade("buy"));
    on("shBtnTradeSell", () => doTrade("sell"));
    on("shBtnConscript", () => doConscript());
    on("shBtnRoll", () => {
      if (S.ap < 1) return;
      const c = refreshCost();
      if (S.money < c) { toast("钱不足（刷新需 " + fmt(c) + " 文）"); return; }
      S.money -= c; rollShop(false); spendAp(1); save(); render();
    });
    on("shBtnEnd", () => endTurn());
    on("shBtnAutoForm", () => { if (S && !S.over) autoForm(); });
    on("shBtnNew", () => { localStorage.removeItem(SAVE_KEY); $("#shihuoSetup").hidden = false; $("#shihuoGame").hidden = true; S = null; });
    on("shOverClose", () => { const d = $("#shOverDialog"); if (d && d.close) d.close(); });
    on("shOverAgain", () => {
      const d = $("#shOverDialog"); if (d && d.close) d.close();
      localStorage.removeItem(SAVE_KEY); S = null;
      $("#shihuoSetup").hidden = false; $("#shihuoGame").hidden = true;
    });
    on("shOverStay", () => { const d = $("#shOverDialog"); if (d && d.close) d.close(); });
    on("shBtnResume", () => { const o = load(); if (o) { S = o; render(); } else toast("没有存档"); });
  }

  function hashSeed(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // 初始化：若有存档则显示「继续」
  bind();
  const saved = load();
  if (saved) { S = saved; render(); }

  // 暴露给调试 / 数值模拟（plan §六 遗留 1：k 与阈值必须靠模拟定标）
  window.__SGZ_SHIHUO__ = {
    get state() { return S; },
    newGame, endTurn, render,
    mint: doMint, recruit, tuntian: doTuntian, trade: doTrade,
    conscript: doConscript, playSystem, refresh: rollShop,
    power, revenue, upkeep, erosionRate, boardPower, enemyPower,   // 数值模拟/调试
    moveUnit, autoForm, placeUnit, unitStats, bondSummary,
    enemyBoard: () => S.enemy, genEnemyBoard, enemyCurveTarget, enemyBoardPower,
    constants: { BASE_UPKEEP, GRAIN_BASE_PRICE, SILK_BASE_PRICE, P_DECAY, BOARD_MAX,
      BASE_GRAIN_PER_BIANHU, BASE_SILK_PER_BIANHU, TUNTIAN_YIELD },
  };
})();
