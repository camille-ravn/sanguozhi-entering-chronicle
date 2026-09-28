/*
 * 05 · 食货志 —— 经济自走棋 数据层
 * 单位数值派生自 data.js 的 window.SGZ_DATA.people（faction / life / tags）
 * 所有数字见 outputs/balance-05-shihuozhi.md（挂史料锚点）
 * 依赖：须先加载 data.js（提供 window.SGZ_DATA）
 */
(() => {
  "use strict";
  const SH = {};

  /* ───────────── 平衡常量（balance §3 / §6 / §8） ───────────── */
  SH.balance = {
    P_INIT: 100,            // 物价指数初始
    P_FLEE: 200,            // 通胀逃亡阈值
    P_COLLAPSE: 800,        // 恶性通胀崩溃
    INTEREST_RATE: 0.05,    // 每回合利息
    INTEREST_CAP: 50,       // 利息封顶（招募点，概念值）
    INTEREST_CAP_MONEY: 4000, // ⚑ 利息封顶（文）：按招募点换算会让后期复利爆炸，改绝对封顶
    STREAK_BONUS: 0.10,     // 连胜加成（封顶 +20 点）
    REFRESH_COST: 2,        // 刷新商店（招募点）
    STAR_MULT: { 2: 1.8, 3: 3.2 },   // 星级倍率
    AP_PER_TURN: 3,         // 行动点
    // 国力条公式系数（balance §8，⚑ 待模拟定标）
    POWER: { grain: 1, silk: 2, money_real: 0.8, soldier: 60, bianhu: 40 },
    POWER_WIN: { short: 4000, mid: 5000, long: 6000 },  // 短/中/长局胜利阈值
    YEARS: { short: [190, 220], mid: [190, 250], long: [190, 280] },
  };

  // 费用档 → 基础数值（balance §6.1）
  SH.COST_TIER = {
    1: { hp: 80,  atk: 14 },
    2: { hp: 140, atk: 24 },
    3: { hp: 220, atk: 38 },
    4: { hp: 320, atk: 52 },
    5: { hp: 440, atk: 70 },
  };

  // 布阵：6 列 × 3 排 = 18 格，人数上限 12（留 6 空格供调度）
  SH.BOARD = { cols: 6, rows: 3, cap: 9 };   // 敌我共用 18 格：左 9 格敌军、右 9 格我军（2026-09-27 续）

  // 三排定位：前排承伤、后排输出。定位 → 默认排（守→前排、攻→中排、谋/支→后排）
  SH.ROWS = [
    { key: "back",  name: "后排", note: "输出", hp: 0.80, atk: 1.20 },
    { key: "mid",   name: "中排", note: "策应", hp: 1.00, atk: 1.00 },
    { key: "front", name: "前排", note: "承伤", hp: 1.25, atk: 0.85 },
  ];
  SH.ROW_OF_ARCH = { 守: 2, 攻: 1, 谋: 0, 支: 0 };
  SH.NO_FRONT_PENALTY = 0.85;   // 前排无人（被冲阵）：全军战力折损

  /* ───────────── 三家势力配置（balance §1 / §8，差异「长」自史料） ───────────── */
  SH.factions = {
    魏: {
      name: "曹魏", start: { money: 20000, grain: 3000, silk: 800, bianhu: 35, soldiers: 8, P: 100, yinke: 6 },
      coinMult: 0.7, priceMult: 0.9,         // 铸币弱、实物强（彭信威：魏统一必然）
      trait: "军屯", // 邓艾两淮：兵自带产谷
      desc: "屯田起手强、编户基数大；铸币惩罚重，走实物税路线。",
    },
    蜀: {
      name: "蜀汉", start: { money: 12000, grain: 1500, silk: 400, bianhu: 12, soldiers: 4, P: 100, yinke: 4 },
      coinMult: 1.5, priceMult: 1.3,         // 直百最猛，通胀惩罚也最高
      trait: "蜀锦出口", // 锦→钱，不推物价
      desc: "铸币收益最高（直百），通胀惩罚也最高；靠虚值钱与锦。",
    },
    吴: {
      name: "孙吴", start: { money: 16000, grain: 2200, silk: 600, bianhu: 28, soldiers: 6, P: 100, yinke: 9 },
      coinMult: 1.0, priceMult: 1.0,
      trait: "复客·海贸", // 开局带1级复客（孙吴早行复客，ref §9.5.5 页30）
      desc: "山越人力、海上贸易位；大泉面额大但民间抵制（额外编户流失）。",
    },
  };

  /* ───────────── 铸币卡（机制2核心，表内数值为「魏基准」；蜀/吴乘 factions 系数） ───────────── */
  // effect.priceMult 作用于全局 P；gainMoney 受 faction.coinMult 修正；flee/编户流失受 priceMult 间接驱动
  SH.coinCards = [
    // ⚑ 平衡补丁：魏没有专属大钱，若只有「董卓小钱」则开局(190事件P×3.5→350)后一铸即崩(P≥800)。
    //   故补一张所有势力可用的低面额常钱，作为安全选项；董卓小钱退化为「绝境按钮」。
    { id:"mint_wuzhu", name:"行五铢（常钱）", faction:null, gainMoney:1500, priceMult:1.15,
      anchor:"曹魏太和元年复五铢、蜀行直百、吴铸大泉之前的两汉常制", note:"低面额常钱：得钱少，物价只 +15%，安全选项" },
    { id:"mint_dongzhuo", name:"董卓小钱", faction:null, gainMoney:12000, priceMult:3.5,
      bianhuPct:-0.10, grainPct:-0.15,
      anchor:"《后汉书·董卓传》「谷石数万」；ref 三论页40", note:"得钱最多，物价×3.5，民逃10%" },
    { id:"mint_zhibai", name:"直百五铢", faction:"蜀", gainMoney:3000, priceMult:1.4,
      requires:"event:214", anchor:"《刘巴传》注「府库充实」；plan §四 ⚠争议",
      note:"蜀专属；不写「刘备首铸」，见plan争议" },
    { id:"mint_daquan500", name:"大泉当五百", faction:"吴", gainMoney:5000, priceMult:1.8,
      requires:"event:236", anchor:"《吴主传》嘉禾五年", note:"吴专属" },
    { id:"mint_daquan1000", name:"大泉当千", faction:"吴", gainMoney:8000, priceMult:2.2,
      bianhuPct:-0.05, requires:"event:238", anchor:"《吴主传》赤乌元年", note:"吴专属" },
    { id:"mint_recall", name:"省息之·铸为器物", faction:"吴", gainMoney:0, priceMult:0.6,
      recallDaqian:0.5, requires:"event:246",
      anchor:"《吴主传》赤乌九年「省息之，铸为器物」", note:"强制回收大泉，手上大泉类×0.5折算，P×0.6" },
  ];

  /* ───────────── 制度卡（balance §4 / §5） ───────────── */
  SH.systemCards = [
    // 经济生产
    { id:"sys_tuntian", name:"屯田", ap:1, costMoney:2000, costGrain:300,
      effect:{ type:"build_tuntian", unit:1 }, anchor:"「得谷百万斛」；三论页34「屯田是国家的私田", note:"建1屯田单位，每回合+240斛，吸编户+0.3/回合" },
    { id:"sys_hutiao", name:"行户调", ap:1, requires:"event:204",
      effect:{ type:"unlock_hutiao" }, anchor:"《武帝纪》建安九年「亩四升，户绢二匹绵二斤」", note:"解锁户调产出线（绢/绵）" },
    { id:"sys_shuili", name:"芍陂·茹陂", ap:1, costMoney:1500,
      effect:{ type:"grain_mult", mult:1.5 }, anchor:"协同矩阵 plan §五", note:"水利：谷产出×1.5" },
    { id:"sys_juntun", name:"军屯（邓艾两淮）", ap:1, faction:"魏",
      effect:{ type:"soldier_grain" }, anchor:"魏独家机制 plan §八", note:"兵自带产谷+60斛/万兵" },
    // 货币/贸易
    { id:"sys_shujin", name:"蜀锦出口", ap:1, faction:"蜀",
      effect:{ type:"silk_to_money" }, anchor:"蜀独家机制 plan §八", note:"锦→钱，不推物价" },
    { id:"sys_haimao", name:"辽东·交趾互市", ap:1, faction:"吴",
      effect:{ type:"trade_bonus" }, anchor:"吴海贸位 plan §八", note:"贸易加成" },
    // 编户/荫客（机制3）
    { id:"sys_fuke", name:"坞堡", ap:1, costBianhu:0,
      effect:{ type:"gain_soldier", soldiers:1.5, bianhu:-3, yinkeOccupy:3 }, anchor:"部曲/坞堡", note:"立刻+1.5万兵，编户永久−3万，计入荫客占用" },
    { id:"sys_shizu", name:"世族庇荫", ap:1,
      effect:{ type:"gain_soldier", soldiers:1.0, bianhu:-2, yinkeOccupy:2 }, anchor:"九品中正/士族", note:"+1万兵，编户−2万" },
    { id:"sys_buqu", name:"部曲私兵", ap:1,
      effect:{ type:"gain_soldier", soldiers:2.5, bianhu:-5, yinkeOccupy:5 }, anchor:"部曲", note:"最猛：+2.5万兵，编户−5万（最亏税基）" },
    { id:"sys_fuke_reset", name:"复客（孙吴）", ap:1, faction:"吴",
      effect:{ type:"yinke_legal_lv", lv:1 }, anchor:"孙吴早行复客 ref §9.5.5 页30", note:"孙吴开局即带1级复客：非法期查处概率减半" },
    { id:"sys_zunu", name:"租牛客户（曹魏）", ap:1, faction:"魏", requires:"tech:caowei_late",
      effect:{ type:"yinke_legal_lv", lv:1 }, anchor:"三论页34 曹魏租牛客户=国家私客", note:"魏需先点「曹魏后期」科技才解锁同等待遇" },
    { id:"sys_taikang", name:"太康户调式", ap:2, requires:"tech:jin",
      effect:{ type:"yinke_legal" }, anchor:"三论页37 首次法定私属身份；ref §9.5.5 页24/30", note:"进入合法期：荫客≤配额免税稳定" },
    // ⚑ 后期 sink 对策：荫客自然侵蚀（机制3）后必须有「赎回落税基」的手段，否则编户只减不增
    { id:"sys_jiankuo", name:"检括荫客", ap:1, repeatable:true, costMoney:2500, costGrain:400,
      effect:{ type:"jiankuo", mult:0.35 }, anchor:"《武帝纪》建安九年裴注引《魏书》「无令强民有所隐藏」；曹操重豪强兼并之法", note:"荫客 −35% 退回编户；遏制士族侵蚀" },
    // 运输
    { id:"sys_muniu", name:"木牛流马", ap:1,
      effect:{ type:"transport_loss", mult:0.7 }, anchor:"诸葛亮", note:"运输损耗−30%" },
    // 孙吴路线核心
    { id:"sys_shanyue", name:"征山越", ap:1, faction:"吴",
      effect:{ type:"shanyue" }, anchor:"孙吴山越经营", note:"耗兵−1.5万，编户+4万" },
    { id:"sys_nanzhong", name:"平南中·迁青羌", ap:1, faction:"蜀",
      effect:{ type:"gain_soldier", soldiers:2, atkBonus:0.1 }, anchor:"诸葛亮南征", note:"得青羌兵+2万，ATK+" },
  ];

  /* ───────────── 事件卡（balance §7，年份已核 plan §七） ───────────── */
  SH.eventCards = [
    { id:"ev_dongzhuo", year:190, name:"董卓坏五铢铸小钱", weight:6,
      effects:[{k:"P", mult:3.5},{k:"bianhu", pct:-0.10},{k:"grain", pct:-0.15}], anchor:"《后汉书·董卓传》" },
    { id:"ev_hanhan", year:194, name:"蝗旱", weight:4,
      effects:[{k:"tuntian_yield", mult:0.5}], anchor:"灾害" },
    { id:"ev_xutuntian", year:196, name:"许下屯田（枣祗、韩浩）", weight:5,
      effects:[{k:"tuntian_cost", mult:0.5},{k:"flag","v":"xutuntian"}], anchor:"《晋书·食货志》" },
    { id:"ev_hutiao", year:204, name:"行户调（建安年间）", weight:5,
      effects:[{k:"flag","v":"hutiao"}], anchor:"《武帝纪》建安九年（两说，卡面写「建安年间」）" },
    { id:"ev_zhibai", year:214, name:"蜀地行直百钱", weight:4, faction:"蜀",
      effects:[{k:"unlock","v":"mint_zhibai"}], anchor:"《刘巴传》注；⚠不写「刘备首铸」" },
    { id:"ev_bawu", year:221, name:"罢五铢·以谷帛为市", weight:5,
      effects:[{k:"money_freeze", turns:4},{k:"silk_quality", pct:-0.20}], anchor:"曹丕黄初二年 + 《晋书》湿谷薄绢" },
    { id:"ev_fuwu", year:227, name:"复五铢", weight:4,
      effects:[{k:"money_unfreeze"}], anchor:"曹睿太和元年" },
    { id:"ev_daqian500", year:236, name:"大泉当五百", weight:3, faction:"吴",
      effects:[{k:"unlock","v":"mint_daquan500"}], anchor:"《吴主传》嘉禾五年" },
    { id:"ev_daqian1000", year:238, name:"大泉当千", weight:3, faction:"吴",
      effects:[{k:"unlock","v":"mint_daquan1000"}], anchor:"《吴主传》赤乌元年" },
    { id:"ev_recall", year:246, name:"省息之·铸为器物", weight:3, faction:"吴",
      effects:[{k:"unlock","v":"mint_recall"}], anchor:"《吴主传》赤乌九年" },
    // ⚑ 后期 sink：三张灾荒卡，越往后越密（三国纪传水旱蝗疫通例，见 ref §5 站内可引句）
    { id:"ev_huang2", year:208, name:"蝗旱·岁饥", weight:3,
      effects:[{k:"grain", pct:-0.25},{k:"bianhu", pct:-0.04}], anchor:"灾害通例（《三国志》纪传屡见蝗旱）" },
    { id:"ev_dayi", year:217, name:"大疫", weight:4,
      effects:[{k:"bianhu", pct:-0.08},{k:"soldiers", pct:-0.05}],
      anchor:"建安二十二年大疫；曹丕《与吴质书》「昔年疾疫，亲故多离其灾」" },
    { id:"ev_shui", year:229, name:"水灾·漂没", weight:3,
      effects:[{k:"grain", pct:-0.20},{k:"tuntian_yield", mult:0.6}], anchor:"灾害通例（《三国志》纪传屡见大水）" },
  ];

  /* ───────────── 羁绊（balance §6.2，读真实关系；主羁绊=faction） ───────────── */
  SH.bonds = {
    // 人数上限提到 12，故开到 Lv5（10 人）
    faction: { name:"同阵营", tiers:[{n:2,mult:1.08},{n:4,mult:1.16},{n:6,mult:1.26},{n:8,mult:1.36},{n:10,mult:1.46}],
      desc:"同阵营人数→等级，全场该阵营+ATK" },
    kin: { name:"亲属", tiers:[{n:2,mult:1.10}], desc:"互援（HP互+10%）" },
    mentor: { name:"举荐/师徒", tiers:[{n:2,mult:1.12}], desc:"被举者+ATK12%" },
    rival: { name:"敌对", tiers:[{n:3,mult:1.10}], desc:"场上有≥3敌对阵营单位，对敌+ATK10%" },
    tianzhi: { name:"田制系", tiers:[{n:2,mult:1.10},{n:3,mult:1.20}], desc:"屯田/军屯/复客同场，谷产出+" },
    bizhi: { name:"币制系", tiers:[{n:2,mult:1.15}], desc:"大钱/直百同场，铸币收益+" },
  };

  // 显式关系边（亲属/举荐/敌对），其余由 faction 自动判定
  SH.relations = {
    kin: [["liu_bei","guan_yu"],["liu_bei","zhang_fei"],["guan_yu","zhang_fei"],
          ["sun_jian","sun_ce"],["sun_ce","sun_quan"],["sun_jian","sun_quan"],
          ["cao_cao","cao_pi"],["xiahou_dun","cao_cao"],["cao_ren","cao_cao"],
          ["zhuge_jin","zhuge_liang"],["ma_teng","ma_chao"],["ma_liang","ma_su"]],
    mentor: [["sima_hui","zhuge_liang"],["sima_hui","pang_tong"],["xu_shu","zhuge_liang"],
             ["zhou_yu","sun_ce"],["zhang_zhao","sun_quan"],["lu_su","zhuge_liang"]],
    rival: [["蜀","魏"],["吴","魏"],["蜀","吴"]],
  };

  /* ───────────── 单位派生：费用档 / 子羁绊 / 特性 ───────────── */
  // 费用档：由角色与 tags 派生的精选表；未列出的由 buildUnits 按默认规则补
  // bond = 子羁绊（族/系），faction 自动作主羁绊
  SH.UNIT_TIERS = {
    // 魏
    cao_cao:{c:5,b:"宗亲",a:"攻"}, sima_yi:{c:4,b:"颍川谋",a:"谋"}, zhang_liao:{c:4,b:"五子",a:"攻"},
    deng_ai:{c:4,b:"伐蜀",a:"攻"}, cao_ren:{c:4,b:"宗亲",a:"守"}, guo_jia:{c:3,b:"颍川谋",a:"谋"},
    jia_xu:{c:3,b:"谋臣",a:"谋"}, xiahou_dun:{c:3,b:"宗亲",a:"守"}, zhang_he:{c:3,b:"五子",a:"攻"},
    xiahou_yuan:{c:3,b:"宗亲",a:"攻"}, xu_huang:{c:3,b:"五子",a:"攻"}, yu_jin:{c:3,b:"五子",a:"守"},
    xu_chu:{c:3,b:"宗亲",a:"守"}, cao_zhen:{c:3,b:"宗亲",a:"攻"}, xun_yu:{c:2,b:"颍川谋",a:"谋"},
    xun_you:{c:2,b:"颍川谋",a:"谋"}, cheng_yu:{c:2,b:"谋臣",a:"守"}, cao_hong:{c:2,b:"宗亲",a:"守"},
    yue_jin:{c:2,b:"五子",a:"攻"}, li_dian:{c:2,b:"五子",a:"守"}, liu_ye:{c:2,b:"谋臣",a:"谋"},
    guo_huai:{c:2,b:"边将",a:"守"}, chen_qun:{c:1,b:"士族",a:"支"}, zhong_yao:{c:1,b:"士族",a:"支"},
    wang_lang:{c:1,b:"文臣",a:"支"}, cao_zhi:{c:1,b:"宗室",a:"支"}, wang_can:{c:1,b:"文士",a:"支"},
    // 蜀
    liu_bei:{c:5,b:"旧交",a:"攻"}, zhuge_liang:{c:4,b:"北伐",a:"谋"}, jiang_wei:{c:4,b:"北伐",a:"攻"},
    guan_yu:{c:4,b:"旧交",a:"攻"}, zhang_fei:{c:4,b:"旧交",a:"攻"}, zhao_yun:{c:4,b:"北伐",a:"守"},
    ma_chao:{c:4,b:"凉州",a:"攻"}, huang_zhong:{c:3,b:"荆襄",a:"攻"}, fa_zheng:{c:3,b:"荆襄",a:"谋"},
    wei_yan:{c:3,b:"荆襄",a:"攻"}, wang_ping:{c:3,b:"后期",a:"守"}, jiang_wan:{c:3,b:"辅政",a:"支"},
    fei_yi:{c:3,b:"辅政",a:"支"}, pang_tong:{c:2,b:"荆襄",a:"谋"}, huang_quan:{c:2,b:"荆襄",a:"守"},
    li_yan:{c:2,b:"辅政",a:"支"}, ma_liang:{c:2,b:"荆襄",a:"支"}, jian_yong:{c:2,b:"旧交",a:"支"},
    mi_zhu:{c:2,b:"旧交",a:"支"}, sun_qian:{c:2,b:"旧交",a:"支"}, liu_ba:{c:2,b:"文臣",a:"支"},
    dong_yun:{c:2,b:"辅政",a:"支"}, ma_su:{c:1,b:"荆襄",a:"谋"}, yang_yi:{c:1,b:"辅政",a:"支"},
    qiao_zhou:{c:1,b:"文士",a:"支"}, qin_mi:{c:1,b:"文士",a:"支"}, liao_li:{c:1,b:"文士",a:"支"},
    xu_shu:{c:1,b:"谋臣",a:"谋"},
    // 吴
    sun_jian:{c:5,b:"元从",a:"攻"}, sun_ce:{c:5,b:"元从",a:"攻"}, sun_quan:{c:5,b:"宗室",a:"守"},
    zhou_yu:{c:4,b:"江表",a:"攻"}, lu_xun:{c:4,b:"江表",a:"攻"}, lv_meng:{c:4,b:"江表",a:"攻"},
    lu_su:{c:3,b:"江表",a:"谋"}, gan_ning:{c:3,b:"降将",a:"攻"}, tai_shi_ci:{c:3,b:"归吴",a:"攻"},
    zhu_ran:{c:3,b:"后期",a:"守"}, lu_kang:{c:3,b:"后期",a:"守"}, ding_feng:{c:3,b:"后期",a:"攻"},
    zhang_zhao:{c:3,b:"文臣",a:"支"}, cheng_pu:{c:2,b:"元从",a:"守"}, huang_gai:{c:2,b:"元从",a:"攻"},
    zhu_huan:{c:2,b:"守御",a:"守"}, ling_tong:{c:2,b:"亲卫",a:"攻"}, zhou_tai:{c:2,b:"亲卫",a:"守"},
    quan_cong:{c:2,b:"外戚",a:"攻"}, he_qi:{c:2,b:"山越",a:"攻"}, zhuge_jin:{c:2,b:"亲族",a:"支"},
    gu_yong:{c:2,b:"文臣",a:"支"}, bu_zhi:{c:2,b:"文臣",a:"支"}, lv_dai:{c:2,b:"南土",a:"守"},
    zhang_hong:{c:1,b:"文臣",a:"支"}, yu_fan:{c:1,b:"文士",a:"支"}, lu_ji:{c:1,b:"文士",a:"支"},
    // 群雄
    dong_zhuo:{c:5,b:"凉州",a:"攻"}, lv_bu:{c:5,b:"并州",a:"攻"}, yuan_shao:{c:5,b:"河北",a:"攻"},
    yuan_shu:{c:3,b:"讨董",a:"攻"}, gongsun_zan:{c:3,b:"幽州",a:"守"}, liu_biao:{c:3,b:"宗室",a:"守"},
    zhang_lu:{c:3,b:"汉中",a:"守"}, ma_teng:{c:3,b:"凉州",a:"攻"}, han_sui:{c:3,b:"凉州",a:"攻"},
    wang_yun:{c:2,b:"朝臣",a:"谋"}, chen_gong:{c:2,b:"谋士",a:"谋"}, zhang_xiu:{c:2,b:"降复叛",a:"攻"},
    ju_shou:{c:2,b:"河北",a:"谋"}, tian_feng:{c:2,b:"河北",a:"谋"}, shen_pei:{c:2,b:"河北",a:"守"},
    gao_shun:{c:2,b:"陷阵",a:"攻"}, yan_liang:{c:2,b:"河北",a:"攻"}, wen_chou:{c:2,b:"河北",a:"攻"},
    liu_yao:{c:2,b:"宗室",a:"守"}, liu_zhang:{c:2,b:"益州",a:"守"}, zhang_miao:{c:2,b:"名士",a:"支"},
    chen_deng:{c:2,b:"名士",a:"守"}, kong_rong:{c:2,b:"名士",a:"支"}, shi_xie:{c:1,b:"交州",a:"支"},
    sima_hui:{c:1,b:"名士",a:"支"}, mi_heng:{c:1,b:"名士",a:"支"}, tao_qian:{c:1,b:"徐州",a:"守"},
    zhang_jiao:{c:1,b:"黄巾",a:"攻"},
  };

  function parseYear(life) {
    const m = /(\d{2,4})/.exec(life || "");
    return m ? parseInt(m[1], 10) : 184;
  }
  function defaultTier(p) {
    const t = (p.tags || []).join(",");
    const role = p.role || "";
    if (/方技|医学|文士|文学|文治|玄学|竹林|名士|医者|学人/.test(t) && !/将|帅|兵/.test(role)) return { c:1, b:"文士", a:"支" };
    if (/谋|策/.test(t) || /谋|策|士/.test(role)) return { c:2, b:"谋臣", a:"谋" };
    return { c:2, b:"部曲", a:"攻" };
  }
  function archetypeName(a) {
    return { 攻:"攻击", 守:"坚守", 谋:"谋略", 支:"辅翼" }[a] || "攻击";
  }

  SH.buildUnits = function () {
    const src = (typeof window !== "undefined" && window.SGZ_DATA && window.SGZ_DATA.people) || null;
    const out = [];
    // 优先用 curated 表；若 SGZ_DATA 可用则并入全部人物（未精选者走默认档）
    const base = src ? src.slice() : Object.keys(SH.UNIT_TIERS).map((pid) => ({ id: pid, name: pid, faction: "群雄", life: "", role: "", tags: [] }));
    const seen = new Set();
    for (const p of base) {
      if (seen.has(p.id)) continue; seen.add(p.id);
      const t = SH.UNIT_TIERS[p.id] || defaultTier(p);
      const tier = SH.COST_TIER[t.c];
      out.push({
        pid: p.id,
        name: p.name || p.id,
        faction: p.faction || "群雄",
        cost: t.c,
        baseHp: tier.hp,
        baseAtk: tier.atk,
        bond: t.b,                 // 子羁绊
        archetype: t.a,
        archName: archetypeName(t.a),
        debutYear: parseYear(p.life),
        tags: p.tags || [],
        role: p.role || "",
      });
    }
    return out;
  };

  SH.units = SH.buildUnits();

  window.SGZ_SHIHUO = Object.freeze(SH);
})();
