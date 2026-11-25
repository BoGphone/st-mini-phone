// 小手机 —— 酒馆扩展
// 日程、地图、小红书、随机事件、购物车。只给自己看，不发给聊天模型。
// 生成、世界书、聊天变量借用酒馆助手（JS-Slash-Runner）的接口；设置存在酒馆的扩展设置里。
(function xsjExtension() {
  const EXT = 'xsj-phone';
  const OLD_SCRIPT_NAME = '📱小手机日程';
  const ctx = () => SillyTavern.getContext();
  const TH = () => {
    const t = window.TavernHelper;
    if (!t) throw new Error('需要先安装并启用「酒馆助手」扩展');
    return t;
  };

  // 扩展设置：data 是原来脚本变量里的东西（owner、api、maps），ui 是扩展自己的开关
  function extStore() {
    const s = ctx().extensionSettings;
    s[EXT] ||= { data: {}, ui: { showBubble: true } };
    s[EXT].ui ||= { showBubble: true };
    // 第一次装：把旧脚本里的设置和地图搬过来
    if (!s[EXT].migrated) {
      try {
        const old = TH().getScriptTrees({ type: 'global' }).find((x) => x.name === OLD_SCRIPT_NAME);
        if (old?.data && Object.keys(old.data).length) s[EXT].data = JSON.parse(JSON.stringify(old.data));
        s[EXT].migrated = true;
        ctx().saveSettingsDebounced();
      } catch (e) { /* 酒馆助手还没加载好，下次再搬 */ }
    }
    return s[EXT];
  }

  // ---- 转接：让原脚本里的写法在扩展里照样能用 ----
  const getVariables = (o) => (o.type === 'script' ? JSON.parse(JSON.stringify(extStore().data || {})) : TH().getVariables(o));
  const replaceVariables = (v, o) => {
    if (o.type === 'script') { extStore().data = JSON.parse(JSON.stringify(v)); ctx().saveSettingsDebounced(); return; }
    return TH().replaceVariables(v, o);
  };
  const insertOrAssignVariables = (v, o) => TH().insertOrAssignVariables(v, o);
  const generateRaw = (c) => TH().generateRaw(c);
  const getModelList = (c) => TH().getModelList(c);
  const stopGenerationById = (id) => TH().stopGenerationById(id);
  const getLastMessageId = () => TH().getLastMessageId();
  const getChatMessages = (r) => TH().getChatMessages(r);
  const getCurrentCharacterName = () => TH().getCurrentCharacterName();
  const substitudeMacros = (t) => TH().substitudeMacros(t);
  const getGlobalWorldbookNames = () => TH().getGlobalWorldbookNames();
  const getCharWorldbookNames = (c) => TH().getCharWorldbookNames(c);
  const getChatWorldbookName = (c) => TH().getChatWorldbookName(c);
  const getWorldbook = (n) => TH().getWorldbook(n);
  let openPhone = null;
  const getButtonEvent = () => '__xsj_button__';
  const replaceScriptButtons = () => {};
  const tavern_events = { CHAT_CHANGED: 'chat_id_changed' };
  const eventOn = (ev, fn) => {
    if (ev === '__xsj_button__') { openPhone = fn; return; }
    ctx().eventSource.on(ev === 'chat_id_changed' ? ctx().event_types.CHAT_CHANGED : ev, fn);
  };

// 小手机日程 —— 酒馆助手全局脚本
// 只给自己看：日程表、随机事件参考、本月流行与季节。数据按聊天分开存在聊天变量里，不发给聊天模型。
(function () {
  const W = window.parent;
  const D = W.document;
  const ROOT_ID = 'xsj-phone';
  const STYLE_ID = 'xsj-phone-style';
  const CHAT_KEY = '小手机日程';
  const BUTTON = '📱日程';

  const TYPES = ['工作', '会议', '出差', '私事', '约会'];
  const HOL = '节日';
  const NOTE_CATS = ['吃喝', '穿搭', '音乐', '影视', '八卦', '生活', '网络'];
  const CAT_EMOJI = { 吃喝: '🍜', 穿搭: '👗', 音乐: '🎧', 影视: '🎬', 八卦: '👀', 生活: '🌿', 网络: '📱', 美食: '🍜', 社会: '📰', 游戏: '🎮' };
  const CAT_GRAD = {
    吃喝: ['#ffd9b8', '#ffb38a'], 穿搭: ['#f9d3e4', '#e8a6c8'], 音乐: ['#d9d4ff', '#a99cf2'], 影视: ['#cfe3ff', '#93b8ee'],
    八卦: ['#ffe1e1', '#f4a3a3'], 生活: ['#d8f0dc', '#9fd3aa'], 网络: ['#d6f1f4', '#8fd0da'],
  };
  const TREND_CAT = { 美食: '吃喝', 社会: '八卦', 游戏: '网络' };
  const VAC = '假期';
  const FIXED = ['生日', '纪念日']; // 每年固定的日子，生成一次后固定
  const TYPE_COLOR = { 工作: '#7c9cff', 会议: '#9b8cff', 出差: '#4fb6c9', 私事: '#f2a65a', 约会: '#f07aa0', 节日: '#e0b84a', 假期: '#4fae7f', 生日: '#ff6fa8', 纪念日: '#b07cf0' };

  // ---------- 存储 ----------
  const defaultSettings = () => ({ owner: 'char', api: { useTavern: true, url: '', key: '', model: '' } });
  function loadSettings() {
    try {
      const v = getVariables({ type: 'script' }) || {};
      const d = defaultSettings();
      return normalizeApi({ ...d, ...v, api: { ...d.api, ...(v.api || {}) } });
    } catch (e) { return normalizeApi(defaultSettings()); }
  }
  // API 方案：apiProfiles 是几套「名字+地址+Key+模型」，apiActive = -1 表示跟随酒馆主 API，否则是第几套
  function normalizeApi(s) {
    const blank = (i) => ({ name: `方案${i + 1}`, url: '', key: '', model: '' });
    const profs = Array.isArray(s.apiProfiles) ? s.apiProfiles.filter((p) => p && typeof p === 'object') : [];
    if (!Number.isInteger(s.apiActive)) {
      // 旧版只有一套：当时没勾「用酒馆的」就把它收成一个方案
      s.apiActive = -1;
      if (!s.api.useTavern && s.api.url) {
        let i = profs.findIndex((p) => p.url === s.api.url && p.key === s.api.key && p.model === s.api.model);
        if (i < 0) { profs.unshift({ name: '方案1', url: s.api.url, key: s.api.key, model: s.api.model }); i = 0; }
        s.apiActive = i;
      }
    }
    while (profs.length < 3) profs.push(blank(profs.length));
    s.apiProfiles = profs.map((p, i) => ({ name: String(p.name || blank(i).name), url: p.url || '', key: p.key || '', model: p.model || '' }));
    if (s.apiActive >= s.apiProfiles.length) s.apiActive = -1;
    applyApi(s);
    return s;
  }
  function applyApi(s) {
    const p = s.apiActive >= 0 ? s.apiProfiles[s.apiActive] : null;
    s.api = p ? { useTavern: false, url: p.url, key: p.key, model: p.model } : { useTavern: true, url: '', key: '', model: '' };
  }
  function saveSettings(s) { try { replaceVariables(s, { type: 'script' }); } catch (e) { console.warn('[小手机] 保存设置失败', e); } }
  function loadChat() {
    try {
      const v = (getVariables({ type: 'chat' }) || {})[CHAT_KEY];
      const base = { dateOverride: '', months: {}, birthdays: [], birthdaysDone: false };
      return v && typeof v === 'object' ? { ...base, ...v } : base;
    } catch (e) { return { dateOverride: '', months: {}, birthdays: [], birthdaysDone: false }; }
  }
  function saveChat() { try { insertOrAssignVariables({ [CHAT_KEY]: chat }, { type: 'chat' }); } catch (e) { console.warn('[小手机] 保存失败', e); } }

  let settings = loadSettings();
  let chat = loadChat();
  // 同一个聊天里不要重新读：生成/出图还没回来时关掉再打开手机，结果会写进被换掉的旧对象，保存时就丢了
  let chatId = null;
  const chatIdNow = () => { try { const c = W.SillyTavern?.getContext?.(); return String(c?.getCurrentChatId?.() ?? c?.chatId ?? ''); } catch (e) { return ''; } };
  function syncChat() {
    const id = chatIdNow();
    if (id && id === chatId) return false;
    chat = loadChat(); chatId = id;
    return true;
  }
  const view = { dex: null, dexCat: '全部', wiki: null, wikiCat: '全部', drawing: null, batch: null, apiEdit: null, apiDraft: null, apiModels: null, apiDel: false, apiBusy: false, tab: 'home', month: '', day: '', editing: null, busy: null, note: null, noteCat: '推荐', place: null, mapEdit: false, mapZoom: 1 };

  // ---------- 工具 ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const ym = (y, m) => `${y}-${pad(m)}`;
  const toast = (msg, kind = 'info') => { try { W.toastr?.[kind]?.(msg, '小手机'); } catch (e) {} };
  // 旧数据里 type 为“节日”的日程挪到 holidays
  const monthData = (key) => {
    const md = (chat.months[key] ||= { schedule: [], events: [], season: null, trends: [] });
    if (!Array.isArray(md.schedule)) md.schedule = [];
    if (!Array.isArray(md.events)) md.events = [];
    if (!Array.isArray(md.cart)) md.cart = [];
    if (!Array.isArray(md.holidays)) {
      // “星际国庆节｜陪卿卿……”这种：竖线前是节日，后面的安排留在日程里
      md.holidays = [];
      const rest = [];
      for (const x of md.schedule) {
        if (x.type !== HOL) { rest.push(x); continue; }
        const [name, ...more] = String(x.title).split(/[｜|]/);
        md.holidays.push({ id: x.id, date: x.date, name: name.trim(), manual: !!x.manual });
        if (more.join('').trim()) rest.push({ ...x, id: x.id + 's', title: more.join('｜').trim(), type: '私事' });
      }
      md.schedule = rest;
    }
    // 旧的 trends 列表转成笔记卡片
    if (!md.notes && Array.isArray(md.trends) && md.trends.length) {
      md.notes = {
        platform: '本月热帖',
        items: md.trends.map((t, i) => {
          const cat = TREND_CAT[t['类']] || (NOTE_CATS.includes(t['类']) ? t['类'] : '生活');
          return { id: `t${i}`, cat, emoji: CAT_EMOJI[t['类']] || CAT_EMOJI[cat], title: String(t['内容'] || ''), author: '网友', likes: 300 + ((i * 7919) % 4700), text: String(t['说明'] || ''), tags: [], comments: null };
        }),
      };
    }
    // 旧数据天气卡里的“应季”挪成帖子
    if (md.season && Array.isArray(md.season['应季']) && md.season['应季'].length) {
      md.notes ||= { platform: '本月热帖', items: [] };
      md.season['应季'].forEach((x, i) => {
        const t = String(x).trim();
        if (!t || md.notes.items.some((n) => n.title === t)) return;
        const cat = /吃|栗|莓|锅|茶|糕|饼|酒|饮|果|面|粥|汤|糖/.test(t) ? '吃喝' : /展|秀|衣|装|鞋|高定/.test(t) ? '穿搭' : '生活';
        md.notes.items.push({ id: `s${i}`, cat, emoji: { 吃喝: '🍂', 穿搭: '🧥', 生活: '🍁' }[cat], title: t, author: '应季推荐', likes: 800 + ((i * 6151) % 5200), text: '', tags: ['应季'], comments: null });
      });
      delete md.season['应季'];
    }
    return md;
  };
  const notesFor = (md) => md.notes || { platform: '本月热帖', items: [] };
  const fmtLikes = (n) => (n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));
  const hashN = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function ownerName() {
    try {
      if (settings.owner === 'user') return substitudeMacros('{{user}}') || '我';
      return getCurrentCharacterName() || substitudeMacros('{{char}}') || '角色';
    } catch (e) { return settings.owner === 'user' ? '我' : '角色'; }
  }

  // 中文数字：二十五、廿三、十一、一九三六（逐位）、初八
  function cnNum(s) {
    s = String(s).replace(/^初/, '');
    if (/^\d+$/.test(s)) return +s;
    const D = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (!/[十廿卅]/.test(s)) { // 逐位：一九三六
      let n = 0; for (const ch of s) { if (!(ch in D)) return NaN; n = n * 10 + D[ch]; } return s ? n : NaN;
    }
    let n = 0, cur = 0;
    for (const ch of s) {
      if (ch in D) cur = D[ch];
      else if (ch === '十') { n += (cur || 1) * 10; cur = 0; }
      else if (ch === '廿') { n += 20; cur = 0; }
      else if (ch === '卅') { n += 30; cur = 0; }
      else return NaN;
    }
    return n + cur;
  }
  // 能换成公历年份的纪年；其他纪年（庆历四年、部落纪年）年份照原数字用，月份和季节照样对
  const ERA_BASE = { 民国: 1911, 中华民国: 1911, 公元: 0, 西元: 0, 光绪: 1874, 宣统: 1908, 同治: 1861, 咸丰: 1850, 道光: 1820, 乾隆: 1735, 康熙: 1661 };
  const CN = '〇零一二三四五六七八九十廿卅两';
  const DATE_CN = new RegExp(`(?:(民国|中华民国|公元|西元|光绪|宣统|同治|咸丰|道光|乾隆|康熙)?\\s*([${CN}\\d]{1,6}|元)年)?\\s*(正|冬|腊|[${CN}]{1,3}|\\d{1,2})月\\s*(初[${CN}]{1,2}|[${CN}]{1,3}|\\d{1,2})(?![${CN}\\d])`);
  // 从一段文字里找日期：1996/11/9、2026-11-14、2026年11月14日、民国二十五年八月初八
  function parseDateText(text) {
    const s = String(text || '');
    const a = s.match(/(\d{3,4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/);
    if (a) {
      const y = +a[1], mo = +a[2], d = +a[3];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { y, m: mo, d };
    }
    const re = new RegExp(DATE_CN.source, 'g');
    let c;
    while ((c = re.exec(s))) {
      const mo = c[3] === '正' ? 1 : c[3] === '冬' ? 11 : c[3] === '腊' ? 12 : cnNum(c[3]);
      const d = cnNum(c[4]);
      if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) continue;
      let y = c[2] ? (c[2] === '元' ? 1 : cnNum(c[2])) : NaN;
      if (Number.isFinite(y) && c[1]) y += ERA_BASE[c[1]];
      const zh = !/\d/.test(c[3] + c[4]);
      const cn = /[正冬腊]/.test(c[3]) || /[初廿卅]/.test(c[4]) || (zh && (!!c[1] || s[c.index + c[0].length] !== '日'));
      return { y: Number.isFinite(y) && y > 0 ? y : null, m: mo, d, cn };
    }
    return null;
  }
  // 从最近的聊天里找剧情日期（最新一条在前）；只有月日没有年时，往前找最近写过的年份，再没有就用今年
  function detectStoryDate() {
    try {
      const last = getLastMessageId();
      const from = Math.max(0, last - 15);
      const msgs = getChatMessages(`${from}-${last}`) || [];
      let hit = null;
      for (let i = msgs.length - 1; i >= 0; i--) {
        const p = parseDateText(msgs[i].message);
        if (!p) continue;
        if (!hit) hit = p;
        if (p.y != null) { if (hit.y == null) hit.y = p.y; break; }
      }
      if (hit) return { y: hit.y ?? new Date().getFullYear(), m: hit.m, d: hit.d, from: 'chat', cn: !!hit.cn, yKnown: hit.y != null };
    } catch (e) {}
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), from: 'real' };
  }
  function storyDate() {
    const o = String(chat.dateOverride || '').match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})$/);
    if (o) return { y: +o[1], m: +o[2], d: +o[3], from: 'manual' };
    return detectStoryDate();
  }
  const dateKey = (sd) => `${sd.y}-${pad(sd.m)}-${pad(sd.d)}`;
  // 日期写法：数字（11月25日）或中式（冬月廿五）。只换写法，不换算农历；中式每月三十天、不显示星期
  let cnCache = { at: 0, id: '', v: null };
  function calInfo() {
    const id = chatIdNow();
    if (Date.now() - cnCache.at > 800 || cnCache.id !== id) cnCache = { at: Date.now(), id, v: detectStoryDate() };
    return cnCache.v;
  }
  const isCn = () => chat.calStyle === 'cn' || (chat.calStyle !== 'num' && !!calInfo().cn);
  const CN_MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
  const cnDay = (d) => { const n = '〇一二三四五六七八九十'; return d <= 10 ? '初' + n[d] : d < 20 ? '十' + n[d - 10] : d === 20 ? '二十' : d < 30 ? '廿' + n[d - 20] : d === 30 ? '三十' : '卅一'; };
  const monthName = (m) => (isCn() ? CN_MONTHS[m - 1] : `${m}月`);
  const dayName = (d) => (isCn() ? cnDay(d) : String(d));
  const weekName = (dow) => (isCn() ? '' : '周' + '日一二三四五六'[dow]); // dow：0 = 周日
  const weekShort = (i) => (isCn() ? '' : '一二三四五六日'[i]); // i：0 = 周一
  // 中式里剧情没写过年份，就不显示（现实的今年没有意义）
  function yearName(y) {
    if (!isCn()) return `${y}年`;
    if (!chat.dateOverride && !calInfo().yKnown) return '';
    const n = '〇一二三四五六七八九';
    return (y === 1 ? '元' : y < 100 ? (y >= 20 ? n[Math.floor(y / 10)] : '') + (y >= 10 ? '十' : '') + (y % 10 ? n[y % 10] : '') : [...String(y)].map((x) => n[x]).join('')) + '年';
  }
  const dayLabel = (m, d) => `${monthName(m)}${dayName(d)}${isCn() ? '' : '日'}`;
  // 这个月画几天；中式按三十天，已经有安排在 31 号的照样显示
  const calDays = (y, m, md) => (isCn() ? (md?.schedule?.some((x) => x.date === `${ym(y, m)}-31`) ? 31 : 30) : new Date(y, m, 0).getDate());
  const calLead = (y, m) => (isCn() ? 0 : (new Date(y, m - 1, 1).getDay() + 6) % 7);

  // ---------- AI ----------
  let genId = null;
  let lastRaw = ''; // 上一次没解析成功的 AI 原文，显示在设置页最下面
  function parseJson(text) {
    let t = String(text || '').replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '').replace(/```(json)?/gi, '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('AI 没有返回 JSON');
    t = t.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(t);
  }

  const PART_SPEC = {
    season: `"season": {"时令": "节气或季节名", "天气": "这个月典型的天气，一句话", "氛围": "这个月街上的气氛，一句话"}`,
    notes: `"notes": {"platform": "符合世界观的平台或栏目名（现代可以是种草App，星际可以叫星网热帖，没有网络的年代就用杂志或报纸专栏名）", "items": [{"cat": "${NOTE_CATS.join('|')}", "emoji": "一个最贴切的emoji", "title": "网友口吻的标题，不超过16字", "author": "路人网友的昵称", "likes": 点赞数字, "text": "正文80-150字，口语化，有具体的店名、品牌、地点、物件、价格或做法", "tags": ["话题1", "话题2"], "img": "封面画面，用英文 danbooru tag 写给 NovelAI 出图（食物、街景、物件、穿搭等，尽量 no humans）", "comments": [{"name": "路人昵称", "text": "评论，不超过40字", "likes": 点赞数字}]}]}  // 8-10篇。这是一个让人了解“这个世界此刻有什么”的生活平台：只依据世界观设定、年代、地区、季节与社会环境来写，不参考最近剧情，不写主要角色、{{user}}和他们的熟人，也不写他们经历过的事。题材在吃喝、穿搭、店铺品牌、地方去处、节庆习俗、流行文化、新科技或新玩意、社会新闻、职业圈子之间分散，应季的东西写成帖子；每篇都要有能拿来丰富剧情的具体东西（一家店、一样物件、一个去处、一种说法）。评论每篇3-4条，全是路人，口吻各不相同`,
    schedule: `"schedule": [{"date": "YYYY-MM-DD", "time": "HH:MM-HH:MM 或 全天", "title": "事项", "place": "地点", "type": "${TYPES.join('|')}"}]  // 覆盖整个月，15-30条；按此人的职业和身份安排工作，周末和节假日轻一些；剧情里已经约定的事要排进去；节日本身不要放进日程`,
    holidays: `"holidays": [{"date": "YYYY-MM-DD", "end": "YYYY-MM-DD，只有假期填，其余填空字符串", "kind": "节日|假期", "name": "不超过6个字"}]  // 本月的节日与假期。规则：年月和历法优先用世界书设定，没有就按现实日历；节日只写正日：现实背景用当地真实的节日，架空背景用世界书里的节庆，世界书没有就按世界观设计1-3个；假期单独一条写清起止（法定长假、寒暑假、世界书里的放假安排），节日附带的假期从正日起算；普通周末不用写；生日和个人纪念日不放这里；没有就给空数组`,
    birthdays: `"birthdays": [{"who": "人名", "date": "MM-DD", "kind": "生日|纪念日", "note": "手机主人对这天的态度或打算，10字左右"}]  // 每年固定的日子：{{char}}、{{user}}和重要配角的生日，以及两人或家人之间的纪念日。只写角色卡、人设、世界书或正文里明确写了日期的，没写明日期的一律不要编；没有就给空数组`,
    cart: `"cart": [{"emoji": "一个emoji", "name": "商品名", "price": "价格，用这个世界的货币", "note": "手机主人随手写的一句备注，10字左右"}]  // 6-8件，手机主人购物车里的东西：符合身份、经济状况、年代与季节；可以有一两件是给别人准备的`,
    events: `"threads": ["最近剧情里悬着没解决的事，2-3条，每条一句：没说开的话、得罪过的人、答应过的事、瞒着的秘密、埋下的伏笔"],
  "events": [{"title": "事件", "level": "轻|中|重", "desc": "起因和经过，不超过50字", "hook": "它会逼出什么：让谁不得不面对或决定什么，不超过25字；轻事件可以空字符串", "date": "YYYY-MM-DD 或 空字符串", "who": "涉及的人", "villain": false}]`,
  };

  // 日历的 prompt：下面这些文字能在 日历设置 里改（settings.calPrompts）；JSON 格式固定，改坏了也能解析
  const CAL_PARTS = ['schedule', 'holidays', 'birthdays'];
  const cutSpec = (k) => { const t = PART_SPEC[k], i = t.indexOf('  // '); return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 5)]; };
  const CAL_PROMPTS = {
    open: ['开场', '你在为一个虚构故事里的人物整理手机里的内容。'],
    base: ['总要求', '根据上面的人物设定、世界观与最近剧情来写，符合年代、地区与身份。'],
    schedule: ['日程', cutSpec('schedule')[1]],
    holidays: ['节日和假期', cutSpec('holidays')[1]],
    birthdays: ['生日和纪念日', cutSpec('birthdays')[1]],
    week: ['注入本周日程的结尾', '只在剧情自然走到相关的时间、地点或人物时参考，不要主动念日程，也不要反复提醒。'],
  };
  // 随机剧情：种类一行一个「名字：说明」，改了这里页面上的种类就跟着变
  const EV_PROMPTS = {
    open: ['开场', CAL_PROMPTS.open[1]],
    base: ['总要求', CAL_PROMPTS.base[1]],
    kinds: ['剧情种类（一行一个）', '日常：生活里的小插曲、偶遇、天气、吃穿住行的琐事\n升温：让两个人靠近一步的契机，心动、护短、被看穿\n误会：话没说清、看错、传错，关系起波澜\n冲突：利益或立场撞上，当面争执、有人找麻烦\n秘密：瞒着的事差点露馅，或者露出一角\n旧事：过去的人、欠的债、没还的情找上门\n来客：意外的消息、电话、信，或者不请自来的人\n意外：东西坏了、计划被打乱、临时出状况\n时局：工作、家族、街坊、天灾、局势这些大环境压过来\n危险：有人受伤、被盯上、陷入险境'],
    size: ['大小怎么算', '轻：当天就能过去，只添一点滋味；中：会打乱计划或关系，要花几天收拾；重：逼人做选择，之后的日子会不一样。中和重要从 threads 里长出来，接上已有的线。'],
    rule: ['规则', '先想 threads 再写 events。每条都要具体到时间、地点、东西和谁做了什么，读完就能演。只写起因和局面，不写结局，不替{{user}}做决定或表态。几条之间不要雷同。'],
    npcOld: ['只用已有的人', '只用已有的人物（角色卡、世界书、人物图鉴里的），不要编新的有名有姓的人；路人可以出现，但不起名字。'],
    npcNew: ['可以有新面孔', '可以出现 1-2 个新的 NPC：这个世界里有名有姓、符合世界观的新面孔，在 who 里写清是谁（名字+身份，如“阿岩（采石的少年）”），其余用已有人物。'],
    wish: ['自己写的剧情向怎么用', '这是{{user}}想要的走向，几条都要往这个方向靠，但用意想不到的起因带出来，不要照抄原话，也不要一步到位。'],
    villain: ['反派的规则', '动机自洽、有自己的利益和理由，不是脸谱化的坏人；通常先在暗处动手，先留下痕迹、风声、损失或试探，再一步步露面；手段符合这个世界的年代和身份；这一次既不让反派一下子得逞，也不让他一下子败露。'],
  };
  const evPrompt = (k) => promptOf('ev', k).replace(/\s*\n\s*/g, ' ');
  const MON_PROMPTS = {
    open: ['开场', CAL_PROMPTS.open[1]],
    base: ["总要求","只根据上面的世界观设定来写，符合年代、地区与社会环境，不涉及主线剧情。"],
    notes: ["帖子怎么写","8-10篇。这是一个让人了解“这个世界此刻有什么”的生活平台：只依据世界观设定、年代、地区、季节与社会环境来写，不参考最近剧情，不写主要角色、{{user}}和他们的熟人，也不写他们经历过的事。题材在吃喝、穿搭、店铺品牌、地方去处、节庆习俗、流行文化、新科技或新玩意、社会新闻、职业圈子之间分散，应季的东西写成帖子；每篇都要有能拿来丰富剧情的具体东西（一家店、一样物件、一个去处、一种说法）。评论每篇3-4条，全是路人，口吻各不相同"],
    comments: ["评论区怎么写","要求：3-5条评论，全是路人网友，口吻各不相同；只依据世界观和帖子本身，不参考最近剧情，不出现主要角色、{{user}}和他们的熟人。"],
    cover: ["封面（帖子没写画面 tag 时用）","no humans, aesthetic photo, soft lighting, detailed, full frame"],
  };
  const monPrompt = (k) => promptOf('mon', k).replace(/\s*\n\s*/g, ' ');
  const WIKI_PROMPTS = {
    open: ['开场', CAL_PROMPTS.open[1]],
    base: ['总要求', CAL_PROMPTS.base[1]],
    task: ["任务","任务：写这个世界的生活百科，写给一个刚来到这里、什么都不懂的人：吃什么、怎么弄到、用什么工具、怎么做、有什么规矩和禁忌、怎么应付天气和危险、当地人的习俗和说法。优先写世界书和剧情里出现过的东西，每条都要具体、能照着做。"],
    body: ["正文","正文60-120字"],
    steps: ["步骤","做法步骤，每步不超过25字，不需要步骤就给空数组"],
    tip: ["窍门","一句当地人才知道的窍门，可为空"],
    img: ["画图 tag 怎么写","画这条讲的东西本身的英文 danbooru tag，不画人物"],
    tail: ["每张都加（tag 后面）","detailed background, atmospheric lighting, full frame"],
  };
  const wikiPrompt = (k) => promptOf('wiki', k).replace(/\s*\n\s*/g, ' ');
  const DREAM_PROMPTS = {
    open: ['开场', CAL_PROMPTS.open[1]],
    base: ['总要求', CAL_PROMPTS.base[1]],
    task: ["任务","任务：模拟「蓝星」的网络——蓝星是另一个和地球很像的世界（现代社会、手机、社交平台、网络用语都和地球差不多，但国家、城市、品牌、名人都是虚构的，不出现地球上真实存在的名字）。在蓝星网友眼里，{{user}}所在的故事是一个他们正在追的作品，叫「蓝星online」，像一款还在运营的剧情游戏：官方会更新剧情、出卡面和卡池、发 PV、办活动、出周边；{{user}}是里面的女主。写出他们讨论{{user}}的平台和上面的帖子。"],
    who: ["谁在发帖","重要：发帖和回复的全是蓝星网友，不是故事里的人；{{user}}身边的角色不会出现在这里发帖，网友提到他们时是当作「作品里的角色」来讨论。"],
    dirDream: ["梦向","这一批是【梦向】：发帖的是把{{user}}当老婆、妻子、宝宝、世界上最宝贵的人的梦男（叫她“老婆”“宝宝”“我媳妇”，自称老公、正宫）。他们时刻关注她的动态，对她有很多情绪：心疼、想念、吃醋、患得患失、节日里想她想得睡不着、为她和同担吵架；也会给她约稿画师、买和做蓝星周边（吧唧、立牌、抱枕、谷子）、抽她的卡、给她写小作文，用这些来增加陪伴感。可以有一点「meta 感」：网友觉得她好像知道自己在蓝星online里，在隔着屏幕回应他们。"],
    dirGeneral: ["一般向","这一批是【一般向】：普通玩家和观众的讨论，不把{{user}}当恋人。聊剧情走向和伏笔、考据设定、嗑{{user}}和作品里角色的 CP、吐槽官方（更新慢、卡池、活动、文案）、抽卡出货、晒同人和周边、新人入坑问题、路人锐评。"],
    open2: ["开头","每帖的开头句式都不一样，不要用“今天更新那段”“今天更新的”这类开头；同一批里不要几帖都在说同一个场面或同一样东西。"],
    form: ["形式","形式像截图里的楼中楼：一条主帖，底下的回复互相 @、接话、抬杠、跑题，有人只回一个“？”，有人一本正经科普；昵称、@账号有梗（乱码账号、带【 】的名字、抽象昵称都行），时间写成 21m、8h、09/17 这种。"],
    people: ["发帖人","发帖人：蓝星网友，有老粉、新入坑的、唯粉、CP 粉、黑粉路过，各有立场。"],
    stuff: ["素材","素材来自{{user}}在剧情里做过的事、去过的地方、穿过的衣服、说过的话、身边的人；网友只知道作品里演出来的部分，会脑补、误读、互相纠正、为一点小事吵翻天。"],
    tone: ["语气","语气：网感、口语、玩梗，可以用 emoji 和颜文字；有好笑的、有酸的、有一本正经的；不要真的侮辱{{user}}。"],
    tail: ["每张都加（tag 后面）","aesthetic photo, soft lighting, detailed, full frame"],
  };
  const dreamPrompt = (k) => promptOf('dream', k).replace(/\s*\n\s*/g, ' ');
  const PROMPT_SETS = { cal: { key: 'calPrompts', defs: () => CAL_PROMPTS }, npc: { key: 'npcPrompts', defs: () => NPC_PROMPTS, draw: ['frame', 'back', 'negative'], drawT: '画像 prompt <small>发给 NovelAI，中间是这个人的默认长相</small>', preview: () => npcInstr() }, mon: { key: 'monPrompts', defs: () => MON_PROMPTS, draw: ['cover'], drawT: '画图 prompt <small>发给 NovelAI</small>', preview: () => buildInstr(['season', 'notes'], view.month, notesFor(monthData(view.month)).items.length > 0), chat: false, has: '已有的帖子、月份' },
    wiki: { key: 'wikiPrompts', defs: () => WIKI_PROMPTS, draw: ['tail'], drawT: '画图 prompt <small>发给 NovelAI，前面是这条自己的 tag</small>', preview: () => wikiInstr(), has: '已有的条目、日期' },
    dream: { key: 'dreamPrompts', defs: () => DREAM_PROMPTS, draw: ['tail'], drawT: '画图 prompt <small>发给 NovelAI，前面是这一帖自己的 tag</small>', preview: () => dreamInstr('dream', pickDreamTypes('dream', codex().dream)), has: '这一批写哪几种、尺度、已有的帖子', light: true },
    closet: { key: 'closetPrompts', defs: () => CLOSET_PROMPTS, draw: ['pItem', 'pSet', 'pTail', 'pWear', 'pWearTail', 'pWearNeg'], drawT: '画图 prompt <small>发给 NovelAI</small>', preview: () => closetInstr(closetWho(), { kind: view.closetTab === 'set' ? 'set' : 'item', scene: '不限', season: 'auto', count: view.closetTab === 'set' ? 1 : 8, want: closetOf().want || '' }), has: '谁的、穿衣风格、场合季节、已有的衣服' },
    ev: { key: 'evPrompts', defs: () => EV_PROMPTS, preview: () => buildInstr(['events'], view.month, true, evOpts()) }, map: { key: 'mapPrompts', defs: () => MAP_PROMPTS, draw: ['pMap', 'pRegion', 'pPlace', 'pWorld'], drawT: '画图 prompt <small>发给 NovelAI，地名和说明由程序加在后面</small>', preview: () => (view.mapLevel === 'world' ? worldInstr(!!currentWorld()) : mapInstr(!!currentMap())) }, dex: { key: 'dexPrompts', defs: () => dexDefs(), rawKey: (k) => (ERA_KEYS[k] && dexEra() !== 'auto' ? `${dexEra()}.${k}` : k), draw: ['creature', 'plant', 'object', 'tail', 'negCreature', 'negOther'], drawT: '画图 prompt <small>发给 NovelAI，中间是这件东西自己的 tag</small>', preview: () => dexInstr() } };
  const ownPrompt = (set, k) => { const S = PROMPT_SETS[set]; return String(settings[S.key]?.[S.rawKey ? S.rawKey(k) : k] || '').trim(); };
  const promptOf = (set, k) => ownPrompt(set, k) || PROMPT_SETS[set].defs()[k][1];
  const calPrompt = (k) => promptOf('cal', k);
  function setPrompt(set, k, v) {
    const S = PROMPT_SETS[set], next = { ...(settings[S.key] || {}) }, t = String(v || '').trim(), rk = S.rawKey ? S.rawKey(k) : k;
    if (!t || t === S.defs()[k][1]) delete next[rk]; else next[rk] = t;
    settings[S.key] = next; saveSettings(settings);
    if (set === 'cal' && k === 'week') applyWeek();
  }
  const partSpec = (k) => (k === 'notes' ? `${cutSpec(k)[0]}  // ${monPrompt('notes')}` : CAL_PARTS.includes(k) ? `${cutSpec(k)[0]}  // ${calPrompt(k).replace(/\s*\n\s*/g, ' ')}` : PART_SPEC[k]);

  // 打开的所有世界书（全局、角色卡绑定、聊天绑定）里所有开着的条目，不管有没有被关键词触发
  const BOOKS_MAX_CHARS = 80000;
  async function openWorldbooksText() {
    const names = new Set();
    try { getGlobalWorldbookNames().forEach((n) => names.add(n)); } catch (e) {}
    try { const c = getCharWorldbookNames('current'); if (c.primary) names.add(c.primary); (c.additional || []).forEach((n) => names.add(n)); } catch (e) {}
    try { const n = getChatWorldbookName('current'); if (n) names.add(n); } catch (e) {}
    let out = '', used = 0, skipped = 0;
    for (const name of names) {
      let entries = [];
      try { entries = await getWorldbook(name); } catch (e) { continue; }
      const on = entries.filter((e) => e.enabled && String(e.content || '').trim());
      if (!on.length) continue;
      let block = `\n## 世界书《${name}》\n`;
      for (const e of on) {
        const piece = `### ${e.name || '条目' + e.uid}\n${String(e.content).trim()}\n`;
        if (used + block.length + piece.length > BOOKS_MAX_CHARS) { skipped++; continue; }
        block += piece;
      }
      used += block.length;
      out += block;
    }
    return { text: out, books: names.size, skipped };
  }

  // 发一次请求，返回解析好的 JSON；失败或取消返回 null
  // fullBooks：附上打开的世界书全部开启条目（识别生日、节日、写小红书时用）
  // noChat：不带聊天记录（小红书只看世界观，不跟剧情）
  // 只发给定的消息、拿回原文；取消或出错返回 null
  async function callText(prompts, busyLabel, maxTokens = 6000) {
    const cfg = { generation_id: (genId = 'xsj_' + uid()), should_stream: false, should_silence: true, max_chat_history: 0, ordered_prompts: prompts };
    const api = settings.api;
    if (!api.useTavern) {
      if (!api.url || !api.model) { genId = null; toast('请先在设置里填写独立 API 的地址和模型', 'warning'); view.tab = 'set'; render(); return null; }
      cfg.custom_api = { apiurl: api.url, key: api.key, model: api.model, source: 'openai', max_tokens: maxTokens, temperature: 0.9 };
    }
    view.busy = busyLabel; render();
    try {
      const raw = await generateRaw(cfg);
      return genId ? String(typeof raw === 'string' ? raw : raw?.content ?? '') : null;
    } catch (e) {
      if (genId) toast('生成失败：' + (e?.message || e), 'error');
      console.error('[小手机] 生成失败', e);
      return null;
    } finally { view.busy = null; genId = null; render(); }
  }
  const GEN_N = {
    cal: { u: '条', p: [15, 30], max: 60, t: (n) => `schedule 正好 ${n} 条` },
    mon: { u: '篇', p: [5, 10], max: 15, t: (n) => `notes.items 正好 ${n} 篇` },
    cart: { u: '件', p: [5, 10], max: 20, t: (n) => `cart 正好 ${n} 件` },
    x: { u: '条', p: [8, 16], max: 30, t: (n) => `items 正好 ${n} 条` },
    dex: { u: '个', p: [5, 10], max: 20, t: (n) => `found 和 locked 加起来正好 ${n} 个；剧情里真实出现过的没那么多，就用 locked 补，没出现过的不要写进 found` },
    npc: { u: '人', p: [3, 6], max: 10, t: (n) => `people 正好 ${n} 人；资料里没有这么多人就有几个写几个，不要编` },
    wiki: { u: '条', p: [5, 10], max: 15, t: (n) => `items 正好 ${n} 条` },
    dream: { u: '条', p: [4, 7], max: 12, t: () => '' },
    map: { u: '个地点', p: [10, 20], max: 40, t: (n) => `places 正好 ${n} 个` },
    world: { u: '个地点', p: [10, 20], max: 40, t: (n) => `spots 正好 ${n} 个` },
    fog: { u: '个地方', p: [3, 5], max: 10, t: (n) => `places 正好 ${n} 个` },
  };
  let genWant = null, genCap = 0;
  // 选完马上就会用掉；没用上的（比如中途取消）几秒后作废，不会串到别的生成里
  const wantFor = (k) => (genWant && genWant.k === k && Date.now() - genWant.at < 5000 ? genWant.n : 0);
  const capN = (d) => genCap || d;
  const genCount = (k) => { const n = Math.floor(Number(settings.genCount?.[k])); return n >= 1 ? Math.min(GEN_N[k].max, n) : 0; };
  function setWant(k, n) {
    settings.genCount = { ...(settings.genCount || {}), [k]: n }; saveSettings(settings);
    genWant = n ? { k, n, at: Date.now() } : null;
  }
  const countRow = (k, cur) => { const G = GEN_N[k], list = [0, ...G.p]; return `<small class="xsj-seg-h">生成几${G.u}</small><div class="xsj-cchips">${list.map((n) => `<button data-k="count" data-pri="1" data-v="${n}" class="${cur === n ? 'on xsj-primary' : ''}">${n || '自动'}</button>`).join('')}${numIn(k, cur, list)}</div>`; };
  async function callAI(instr, busyLabel, fullBooks = false, noChat = false, lead = '') {
    genCap = genWant ? wantFor(genWant.k) : 0;
    if (genCap) { const line = GEN_N[genWant.k].t(genCap); if (line) instr += `\n这次的数量：${line}。前面写的数量不算，以这一行为准。`; }
    genWant = null;
    const maxTokens = genCap ? 8000 : 6000;
    let books = null;
    if (fullBooks) {
      view.busy = '正在读世界书…'; render();
      books = await openWorldbooksText();
      if (books.skipped) toast(`世界书太长，有 ${books.skipped} 条没放进去`, 'warning');
    }
    const prompts = [
      ...(lead ? [{ role: 'system', content: lead }] : []),
      { role: 'system', content: '以下是故事的设定资料，仅供参考。' },
      ...(books?.text ? [] : ['world_info_before']),
      'persona_description', 'char_description', 'char_personality', 'scenario',
      ...(books?.text ? [{ role: 'system', content: `以下是打开的世界书里所有开启的条目（包括这一轮没有被触发的）：\n${books.text}` }] : ['world_info_after']),
      ...(noChat ? [] : ['chat_history']),
      { role: 'user', content: instr },
    ];
    const cfg = { generation_id: (genId = 'xsj_' + uid()), should_stream: false, should_silence: true, max_chat_history: 8, ordered_prompts: prompts };
    const api = settings.api;
    if (!api.useTavern) {
      if (!api.url || !api.model) { toast('请先在设置里填写独立 API 的地址和模型', 'warning'); view.tab = 'set'; render(); return null; }
      cfg.custom_api = { apiurl: api.url, key: api.key, model: api.model, source: 'openai', max_tokens: maxTokens, temperature: 0.9 };
    }
    view.busy = busyLabel;
    render();
    let text = '';
    try {
      const raw = await generateRaw(cfg);
      if (!genId) return null;
      text = typeof raw === 'string' ? raw : raw?.content;
      return parseJson(text);
    } catch (e) {
      if (text) { lastRaw = String(text).slice(0, 4000); console.warn('[小手机] 解析失败，AI 返回：', text); }
      if (genId) toast('生成失败：' + (e?.message || e), 'error');
      console.error('[小手机] 生成失败', e);
      return null;
    } finally {
      view.busy = null; genId = null; render();
    }
  }

  function baseInstr(y, m, worldOnly = false, set = '') {
    const sd = storyDate();
    return [
      `${set ? promptOf(set, 'open') : CAL_PROMPTS.open[1]}只输出一个 JSON 对象，不要任何解释、不要代码块。`,
      `手机主人：${ownerName()}${settings.owner === 'user' ? '（{{user}}本人）' : ''}`,
      `月份：${y}年${m}月。故事当前日期：${dateKey(sd)}。`,
      isCn() ? '这个世界用中式日期（如“八月初一”“腊月廿三”），写内容时用这种叫法，不写星期和周末。日期字段仍然按 YYYY-MM-DD 写：八月初一就是 08-01，每月只有 30 天。' : '',
      worldOnly ? (set ? promptOf(set, 'base') : MON_PROMPTS.base[1]) : set ? promptOf(set, 'base') : CAL_PROMPTS.base[1],
    ];
  }
  const WORLD_ONLY_PARTS = ['season', 'notes'];
  // 反派线：keep = 接着现在这个反派往下推，new / on = 找一个新的
  function villainInstr(mode, n) {
    const how = n ? `其中 ${Math.max(1, Math.ceil(n / 2))} 条` : '2-3 条';
    const v = mode === 'keep' ? chat.villain : null;
    const rules = `反派的规则：${evPrompt('villain')}这几条反派事件把 villain 设为 true，其余事件设为 false。`;
    const spec = `另外在 JSON 里加一个字段："villain": {"name": "反派的名字", "identity": "身份", "goal": "他想要什么", "plan": "他接下来打算怎么做，一句话"}`;
    if (v) return [`这个故事里正在进行一条反派线：${v.name}${v.identity ? `（${v.identity}）` : ''}，想要：${v.goal || '未明'}；他原本打算：${v.plan || '未明'}${v.done?.length ? `；之前已经做过：${v.done.join('；')}` : ''}。`,
      `让他往前推一步、比之前更进一步：${how}是他的事件，按日期由暗到明升级，回应主角们最近的动向。`, rules, spec].join('\n');
    return [`加入一条反派线：先从角色卡、世界书、人物图鉴或最近剧情里找一个已经存在、和主角们利益冲突的人做反派${evOpt().npc === 'new' ? '；实在没有合适的，可以新写一个有名有姓、符合世界观的人' : '；不要新编有名有姓的人'}。`,
      `${how}是他的事件，按日期由暗到明升级：布局或试探 → 制造麻烦 → 逼近主角。`, rules, spec].join('\n');
  }

  // add：只新增——日程和节日保留现有的，只补新的
  function withFirstParts(parts) {
    // 生日和纪念日只在第一次生成日历时识别一次，之后固定
    if (!chat.birthdaysDone && (parts.includes('holidays') || parts.includes('schedule')) && !parts.includes('birthdays')) parts = [...parts, 'birthdays'];
    return parts;
  }
  function buildInstr(parts, monthKey, add = false, opts = {}) {
    const [y, m] = monthKey.split('-').map(Number);
    const md = monthData(monthKey);
    const keepManual = md.schedule.filter((x) => x.manual).map((x) => `${x.date} ${x.time} ${x.title}`).join('；');
    const worldOnly = parts.every((p) => WORLD_ONLY_PARTS.includes(p));
    return [
      ...baseInstr(y, m, worldOnly, parts.every((p) => CAL_PARTS.includes(p)) ? 'cal' : parts.join() === 'events' ? 'ev' : worldOnly ? 'mon' : ''),
      keepManual && parts.includes('schedule') ? `下面这些是主人自己记的日程，不要重复也不要冲突：${keepManual}` : '',
      add && parts.includes('schedule') && md.schedule.some((x) => !x.manual) ? `这个月已经有这些日程，全部保留；这次只补充新的，不要重复、不要冲突：${md.schedule.filter((x) => !x.manual).map((x) => `${x.date} ${x.time} ${x.title}`).join('；')}` : '',
      ...(parts.includes('events') && opts.slots ? [
        `任务：为接下来的剧情写 ${opts.slots.length} 条可能发生的事，正好 ${opts.slots.length} 条，按下面的顺序，一条对一条：\n${opts.slots.map((x, i) => `${i + 1}. 种类「${x.kind}」${x.desc ? `（${x.desc}）` : ''}，大小「${x.level}」`).join('\n')}`,
        evPrompt('size'), evPrompt('rule'), evPrompt(opts.newNpc ? 'npcNew' : 'npcOld'),
        opts.who?.length ? `这次卷进来的人：${opts.who.join('、')}。每条至少有其中一个人。` : '',
        opts.wish ? `剧情向：${opts.wish}\n${evPrompt('wish')}` : '',
      ] : []),
      parts.includes('events') && opts.villain && opts.villain !== 'off' ? villainInstr(opts.villain, opts.slots?.length) : '',
      add && parts.includes('events') && md.events.length ? `这个月已经有这些随机事件，全部保留；这次写新的，不要重复：${md.events.map((e) => e.title).join('；')}` : '',
      add && parts.includes('notes') && notesFor(md).items.length ? `已经有这些热帖，全部保留；这次写新的，不要重复：${notesFor(md).items.map((n) => n.title).join('；')}` : '',
      add && parts.includes('cart') && md.cart.length ? `购物车里已经有：${md.cart.map((c) => c.name).join('、')}，全部保留；这次再加几件别的。` : '',
      add && parts.includes('holidays') && md.holidays.length ? `已经有这些节日和假期，不用再写：${md.holidays.map((h) => `${h.date} ${h.name}`).join('；')}` : '',
      !worldOnly && parts.includes('notes') ? `注意：notes 只依据世界观设定来写，不要用最近剧情和主要角色。` : '',
      `JSON 结构（只包含这些字段）：\n{\n  ${parts.map(partSpec).join(',\n  ')}\n}`,
    ].filter(Boolean).join('\n');
  }
  async function generate(parts, monthKey, add = false, opts = {}) {
    if (view.busy) return;
    parts = withFirstParts(parts);
    const [y, m] = monthKey.split('-').map(Number);
    const md = monthData(monthKey);
    const worldOnly = parts.every((p) => WORLD_ONLY_PARTS.includes(p));
    const instr = buildInstr(parts, monthKey, add, opts);
    const data = await callAI(instr, `正在生成${monthName(m)}…`, parts.some((p) => ['birthdays', 'holidays', 'notes'].includes(p)), worldOnly);
    if (!data) return;
    {
      if (parts.includes('season') && data.season && !(add && md.season)) md.season = data.season;
      if (parts.includes('notes') && data.notes && Array.isArray(data.notes.items)) {
        const oldNotes = add ? notesFor(md).items : [];
        md.notes = {
          platform: oldNotes.length && md.notes?.platform ? md.notes.platform : String(data.notes.platform || '本月热帖').trim(),
          items: data.notes.items.filter((x) => x && x.title).slice(0, capN(12)).map((x) => ({
            id: uid(), cat: NOTE_CATS.includes(x.cat) ? x.cat : '生活', emoji: String(x.emoji || '').trim() || CAT_EMOJI[x.cat] || '✨',
            title: String(x.title).trim(), author: String(x.author || '匿名').trim(), likes: Math.max(0, Math.round(Number(x.likes) || 0)),
            text: String(x.text || '').trim(), tags: Array.isArray(x.tags) ? x.tags.map(String).slice(0, 4) : [], img: String(x.img || '').trim(), pic: '',
            comments: Array.isArray(x.comments) && x.comments.length
              ? x.comments.filter((c) => c && c.text).slice(0, 6).map((c) => ({ name: String(c.name || '匿名'), text: String(c.text), likes: Math.max(0, Math.round(Number(c.likes) || 0)) }))
              : null,
          })),
        };
        // 只新增：旧帖子全留着，新帖子里同名的不要
        if (add) md.notes = { ...md.notes, items: [...oldNotes, ...md.notes.items.filter((n) => !oldNotes.some((o) => o.title === n.title))] };
        if (!add) md.trends = [];
      }
      if (parts.includes('schedule') && Array.isArray(data.schedule)) {
        const ai = data.schedule
          .filter((x) => x && x.title && /^\d{1,4}-\d{1,2}-\d{1,2}$/.test(String(x.date || '').trim()))
          .map((x) => {
            const [a, b, c] = String(x.date).trim().split('-').map(Number);
            return { id: uid(), date: `${a}-${pad(b)}-${pad(c)}`, time: String(x.time || '').trim(), title: String(x.title).trim(), place: String(x.place || '').trim(), type: TYPES.includes(x.type) ? x.type : '工作' };
          });
        md.schedule = add
          ? [...md.schedule, ...ai.filter((x) => !md.schedule.some((o) => o.date === x.date && o.title === x.title))]
          : [...md.schedule.filter((x) => x.manual), ...ai];
      }
      if (parts.includes('holidays') && Array.isArray(data.holidays)) {
        const hs = data.holidays
          .filter((x) => x && x.name && /^\d{1,4}-\d{1,2}-\d{1,2}$/.test(String(x.date || '').trim()))
          .map((x) => {
            const [a, b, c] = String(x.date).trim().split('-').map(Number);
            const kind = x.kind === VAC ? VAC : HOL;
            const e = String(x.end || '').trim().match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})$/);
            return { id: uid(), date: `${a}-${pad(b)}-${pad(c)}`, kind, end: kind === VAC && e ? `${e[1]}-${pad(e[2])}-${pad(e[3])}` : '', name: String(x.name).trim() };
          });
        md.holidays = add
          ? [...md.holidays, ...hs.filter((x) => !md.holidays.some((o) => o.date === x.date && o.name === x.name))]
          : [...md.holidays.filter((x) => x.manual), ...hs];
      }
      if (parts.includes('birthdays') && Array.isArray(data.birthdays)) {
        const bs = data.birthdays
          .map((x) => ({ x, m: String(x?.date || '').trim().match(/(\d{1,2})\D+(\d{1,2})\D*$/) }))
          .filter(({ x, m }) => x && x.who && m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31)
          .map(({ x, m }) => ({ id: uid(), who: String(x.who).trim(), md: `${pad(m[1])}-${pad(m[2])}`, kind: x.kind === '纪念日' ? '纪念日' : '生日', note: String(x.note || '').trim() }));
        const kept = chat.birthdays.filter((x) => x.manual || x.fromNpc);
        chat.birthdays = [...kept, ...bs.filter((b) => !kept.some((k) => k.who === b.who && k.kind === b.kind))];
        chat.birthdaysDone = true;
      }
      if (parts.includes('cart') && Array.isArray(data.cart)) {
        md.cart = [...(add ? md.cart : md.cart.filter((x) => x.bought)), ...data.cart.filter((x) => x && x.name).slice(0, capN(10)).map((x) => ({ id: uid(), emoji: String(x.emoji || '🛍'), name: String(x.name).trim(), price: String(x.price || '').trim(), note: String(x.note || '').trim(), bought: false }))];
      }
      if (parts.includes('events') && Array.isArray(data.events)) {
        const lv = (v) => (['轻', '中', '重'].includes(String(v)) ? String(v) : '');
        const wantV = opts.villain && opts.villain !== 'off';
        const evs = data.events.filter((x) => x && x.title).map((x) => ({ id: uid(), title: String(x.title), level: lv(x.level), desc: String(x.desc || ''), hook: String(x.hook || ''), date: String(x.date || ''), who: String(x.who || ''), villain: wantV && (x.villain === true || x.villain === 'true'), used: false, star: false }))
          .slice(0, opts.slots?.length || 12).map((x, i) => (opts.slots ? { ...x, level: opts.slots[i].level, kind: opts.slots[i].kind } : x));
        md.events = [...evs, ...(add ? md.events : md.events.filter((x) => x.star))];
        if (wantV && data.villain && typeof data.villain === 'object' && String(data.villain.name || '').trim()) {
          const v = data.villain, old = opts.villain === 'keep' ? chat.villain : null;
          chat.villain = {
            name: String(v.name).trim(), identity: String(v.identity || old?.identity || '').trim(), goal: String(v.goal || old?.goal || '').trim(), plan: String(v.plan || '').trim(),
            done: [...(old?.done || []), ...evs.filter((e) => e.villain).map((e) => `${e.date ? e.date + ' ' : ''}${e.title}`)].slice(-12),
          };
        }
      }
      md.generatedAt = Date.now();
      saveChat();
      toast(`${monthName(m)}的内容已更新`, 'success');
      render();
    }
  }

  // 点开笔记时才生成评论
  async function genComments(note, monthKey) {
    if (view.busy) return;
    const [y, m] = monthKey.split('-').map(Number);
    const platform = notesFor(monthData(monthKey)).platform;
    const instr = [
      ...baseInstr(y, m, true, 'mon'),
      `下面是「${platform}」上的一篇笔记，写出它底下的评论区。`,
      `标题：${note.title}\n作者：${note.author}\n正文：${note.text}`,
      monPrompt('comments'),
      `JSON 结构：{"comments": [{"name": "昵称", "text": "评论内容，不超过40字", "likes": 点赞数字}]}`,
    ].join('\n');
    const data = await callAI(instr, '正在加载评论…', false, true);
    if (!data || !Array.isArray(data.comments)) return;
    note.comments = data.comments.filter((c) => c && c.text).slice(0, 6).map((c) => ({ name: String(c.name || '匿名'), text: String(c.text), likes: Math.max(0, Math.round(Number(c.likes) || 0)) }));
    saveChat();
    render();
  }
  let batchStop = false; // 一键生图时按了取消：停掉后面的
  // 去掉会让 NovelAI 画出播放器边框、截图界面、帖子外框的词，只留画面本身
  const FRAME_WORDS = /^(?:video|video screenshot|screenshot|screencap|screen ?cap|ui|user interface|interface|border|bordered|frame|framed|picture frame|letterbox(?:ed)?|black bars?|play button|progress bar|timestamp|watermark|text|caption|subtitles?|social media(?: post)?|post|tweet|phone screen|app|website|web page|split screen|multiple views|collage)$/i;
  function cleanTags(s) { return String(s || '').split(',').map((t) => t.trim()).filter((t) => t && !FRAME_WORDS.test(t)).join(', '); }
  const stripMediaMark = (s) => String(s || '').replace(/^\s*\[(?:视频|图片|动图|直播)[^\]]*\]\s*/, '');
  async function drawXPic(it, label) {
    const video = /视频|video/i.test(it.media);
    const tags = cleanTags(it.img);
    const pic = await drawImage({
      prompt: tags || 'full frame, cinematic still, detailed',
      nl: tags ? '' : `${stripMediaMark(it.media)} ${it.text}`.trim(),
      size: video ? 'landscape' : 'portrait',
    }, label, it.id);
    if (pic) { it.pic = pic; saveChat(); render(); }
    return !!pic;
  }
  async function drawNotePic(n, label) {
    const tags = cleanTags(n.img);
    const pic = await drawImage({ prompt: tags || monPrompt('cover'), nl: tags ? '' : `${n.title}。${n.text}`, size: 'portrait' }, label, n.id);
    if (pic) { n.pic = pic; saveChat(); render(); }
    return !!pic;
  }
  // 地点实景图：默认无人风景，按类型给一点画面方向，描述交给柏宝绘的自然语言
  const PLACE_TAGS = { 家: 'apartment interior, cozy room, window light', 学校: 'school building, campus, hallway', 公司: 'office building, modern interior', 店铺: 'shop storefront, display window', 餐饮: 'cafe interior, restaurant, warm lighting', 景点: 'scenic view, landmark', 交通: 'train station, platform', 医院: 'hospital building, clean corridor', 机构: 'building exterior, entrance', 其他: 'street scene, city' };
  async function drawPlacePic(p, label) {
    const key = charKey();
    const pic = await drawImage({
      prompt: ['no humans, scenery', PLACE_TAGS[p.type] || PLACE_TAGS['其他'], mapPrompt('pPlace')].filter(Boolean).join(', '),
      nl: [p.name, p.desc, p.vibe].filter(Boolean).join('。'),
      size: 'landscape',
    }, label, p.id);
    if (!pic) return false;
    // 画的过程中可能换了卡：存回开始画时那张卡的地图
    const mp = (settings.maps || {})[key];
    const target = mp?.places.find((x) => x.id === p.id);
    if (!target) return false;
    target.pic = pic;
    settings.maps = { ...(settings.maps || {}), [key]: mp }; saveSettings(settings);
    render();
    return true;
  }
  let stoppedAt = 0;
  function cancelGen() {
    stoppedAt = Date.now();
    batchStop = true;
    try { if (genId) stopGenerationById(genId); } catch (e) {}
    try { imgAbort?.abort(); } catch (e) {}
    genId = null; view.busy = null; view.drawing = null; render();
  }

  // ---------- 出图：借柏宝绘（NovelAI）的公开接口，Key 和排队限流都由柏宝绘管 ----------
  let imgAbort = null;
  const IMG_PHASE = { queued: '排队中', generating: '正在画', 'queued-remote': '排队中', retrying: '被限流，重试中', saving: '正在保存' };
  // 成功返回图片地址（柏宝绘图库里的文件路径，存不了时退回 dataUrl）；失败或取消返回 ''
  // inlineId：给某条帖子/笔记出图时，只在它自己的框里转圈，不盖住整个手机
  async function drawImage({ prompt, nl = '', size = 'portrait', negative = '', chars = [] }, label, inlineId = null) {
    if (view.busy) return '';
    if (view.drawing) { toast('正在出另一张图，等它画完', 'warning'); return ''; }
    const api = W.STBaiBaiImage;
    if (!api || typeof api.generate !== 'function') { toast('需要先启用「柏宝绘」扩展', 'warning'); return ''; }
    const st = api.getBackendStatus?.();
    if (st && !st.configured) { toast(`柏宝绘还没配好：${st.reason}`, 'warning'); return ''; }
    imgAbort = new AbortController();
    if (inlineId) view.drawing = { id: inlineId, label }; else view.busy = label;
    render();
    const progress = (p) => {
      const text = `${label}（${p.text || IMG_PHASE[p.phase] || p.phase}${p.attempt ? ` ${p.attempt}/${p.max}` : ''}）`;
      if (inlineId) {
        if (!view.drawing) return;
        view.drawing.label = text;
        // 只改那一行字，不重画整页
        D.getElementById(ROOT_ID)?.querySelectorAll('[data-drawlabel]').forEach((el) => { el.textContent = text; });
      } else if (view.busy) { view.busy = text; render(); }
    };
    try {
      const r = await api.generate(
        { prompt: String(prompt || '').trim() || 'scenery', nl: String(nl || '').trim(), ...(negative ? { negative: String(negative).trim() } : {}), size, save: true, character: charKey() },
        { signal: imgAbort.signal, onProgress: progress },
      );
      return r.path || r.dataUrl || '';
    } catch (e) {
      if (e?.code !== 'aborted' && e?.name !== 'AbortError') toast(e?.code === 'rate_limited' ? '被 NovelAI 限流了，稍后再试' : `出图失败：${e?.message || e}`, 'error');
      return '';
    } finally {
      imgAbort = null; view.busy = null; view.drawing = null; render();
    }
  }
  // 出图中的占位框：转圈 + 进度 + 取消
  function drawingBox(id, cls = '', cancel = true) {
    const d = view.drawing;
    if (!d || d.id !== id) return '';
    return `<div class="xsj-drawing ${cls}"><div class="xsj-spin"></div><span data-drawlabel>${esc(d.label)}</span>${cancel ? '<button data-act="cancel-gen">取消</button>' : ''}</div>`;
  }

  // ---------- 📎 引用：把一条帖子/笔记/事件/地点附给下一次回复，不写进聊天记录 ----------
  // 点了引用 → 输入框上方出现标签；发出的那条消息生成时 AI 能看到；重新生成、滑动也还在；发下一条消息时自动清掉
  const QUOTE_KEY = 'xsj-phone-quote';
  let quote = null; // { label, text, bound }
  const stCtx = () => { try { return W.SillyTavern?.getContext?.() || null; } catch (e) { return null; } };
  function quoteFor(kind, id) {
    const who = ownerName();
    if (kind === 'x') {
      const it = chat.xlog?.items?.find((x) => x.id === id); if (!it) return null;
      return {
        label: `X · ${it.author} 的帖子`,
        text: [`${who} 私下刷 X 时看到的一条帖子（${who}${(KIND_LINE[it.kind] || '👁 ta 看过').replace(/^\S+\s*ta\s*/, '')}）`, `作者：${it.author} ${it.handle || ''}`.trim(), `正文：${it.text}`,
          it.media ? `配图/视频：${stripMediaMark(it.media) || it.media}` : '', it.note ? `${who} 当时的想法：${it.note}` : ''].filter(Boolean).join('\n'),
      };
    }
    if (kind === 'note') {
      const n = notesFor(monthData(view.month)).items.find((x) => x.id === id); if (!n) return null;
      return {
        label: `小红书 ·《${n.title}》`,
        text: [`一篇本地生活平台上的笔记《${n.title}》`, `作者：${n.author}${n.cat ? ` · 分类：${n.cat}` : ''}`, n.text ? `正文：${n.text}` : '', n.tags?.length ? `话题：${n.tags.join('、')}` : '',
          n.comments?.length ? `热门评论：${n.comments.slice(0, 3).map((c) => `${c.name}：${c.text}`).join('；')}` : ''].filter(Boolean).join('\n'),
      };
    }
    if (kind === 'event') {
      const e = monthData(view.month).events.find((x) => x.id === id); if (!e) return null;
      const v = e.villain && chat.villain;
      return {
        label: `${e.villain ? '反派' : '事件'} ·「${e.title}」`,
        text: [`本轮让这件事真的发生，并让它推动剧情：${e.title}`, e.desc, e.hook ? `它会逼出：${e.hook}` : '', [e.date, e.who].filter(Boolean).join(' · '),
          v ? `（这是反派 ${v.name}${v.identity ? `（${v.identity}）` : ''}的一步，他想要：${v.goal || '未明'}。按由暗到明的分寸写，主角们未必马上知道是谁做的。）` : '',
          `写出它带来的局面和角色的反应，不替{{user}}做决定或表态。`].filter(Boolean).join('\n'),
      };
    }
    if (kind === 'place') {
      const pl = currentMap()?.places.find((x) => x.id === id); if (!pl) return null;
      if (pl.fog) {
        return {
          label: '传闻 · 一个还没去过的地方',
          text: `最近听到的一个传闻：${pl.rumor}\n（这个地方叫「${pl.name}」${pl.region ? `，在${pl.region}附近` : ''}：${pl.desc}${pl.vibe ? `；${pl.vibe}` : ''}）\n可以让角色自然地提起、打听，或者顺路去找；不用马上去，也不要一下子把它的全貌说出来。`,
        };
      }
      return { label: `地点 ·「${pl.name}」`, text: [`地点：${pl.name}（${[pl.type, pl.region].filter(Boolean).join(' · ')}）`, pl.desc, pl.vibe ? `氛围：${pl.vibe}` : '', pl.people ? `常来的人：${pl.people}` : ''].filter(Boolean).join('\n') };
    }
    if (kind === 'dex') {
      const x = codex().dex.items.find((o) => o.id === id); if (!x) return null;
      return {
        label: `${appTitle('dex')} ·「${x.name}」`,
        text: [`这个世界里的一样东西：${x.name}（${x.cat}，${rar(x.rarity).n}）`, ...(x.attrs || []).map((a) => `${a.k}：${a.v}`), x.desc, x.flavor ? `当地的说法：${x.flavor}` : ''].filter(Boolean).join('\n'),
      };
    }
    if (kind === 'wiki') {
      const w = codex().wiki.items.find((o) => o.id === id); if (!w) return null;
      return {
        label: `${appTitle('wiki')} ·「${w.title}」`,
        text: [`这个世界的生活常识：${w.title}（${w.cat}）`, w.summary, w.body, w.steps?.length ? `做法：${w.steps.map((s, i) => `${i + 1}. ${s}`).join(' ')}` : '', w.tip ? `窍门：${w.tip}` : ''].filter(Boolean).join('\n'),
      };
    }
    if (kind === 'dream') {
      const D0 = codex().dream;
      const p = D0.items.find((o) => o.id === id); if (!p) return null;
      return {
        label: `${D0.platform || '论坛'} · ${p.author} 的帖子`,
        text: `另一个世界「蓝星」的网友在「${D0.platform || '论坛'}」上讨论{{user}}的一条帖子（发帖人：${p.author} ${p.handle}，是蓝星网友，不是故事里的人）：
${p.text}${p.replies?.length ? `
底下的回复：${p.replies.slice(0, 4).map((r) => `${r.author}：${r.text}`).join('；')}` : ''}
这是故事之外的声音，故事里的人看不到也不认识发帖人。可以只当作这一轮的氛围参考，或者让{{user}}隐约做个相关的梦、心里莫名一动；不要让故事里的角色读到或提起这条帖子。`,
      };
    }
    if (kind === 'closet') {
      const who = closetWho(), it = closet()[who].items.find((x) => x.id === id); if (!it) return null;
      const nm = who === 'user' ? '{{user}}' : closetName(who);
      return {
        label: `衣橱 ·「${it.name}」`,
        text: `${nm}衣橱里的一件衣服：${it.name}（${[it.cat, it.color, it.material].filter(Boolean).join('，')}）\n${it.desc}${it.note ? `\n来历：${it.note}` : ''}${it.when ? `\n平时什么时候穿：${it.when}` : ''}\n本轮${nm}穿着它${who === 'user' ? '（只写外表，不替{{user}}做别的决定）' : ''}；可以让人注意到、提起，或者只在描写里自然带过，不必刻意。`,
      };
    }
    if (kind === 'closetset') {
      const who = closetWho(), x = closet()[who].sets.find((o) => o.id === id); if (!x) return null;
      const nm = who === 'user' ? '{{user}}' : closetName(who), its = x.ids.map((i2) => closet()[who].items.find((o) => o.id === i2)).filter(Boolean);
      return { label: `衣橱 ·「${x.name}」`, text: `${nm}今天穿的一套：${x.name}。${x.desc}\n由这些组成：${its.map((o) => `${o.name}（${[o.color, o.material].filter(Boolean).join('、')}）`).join('；')}\n从这一轮起让${nm}穿着这套，直到剧情里明确换衣服。` };
    }
    if (kind === 'wland' || kind === 'wspot') {
      const w = currentWorld();
      const x = w && (kind === 'wland' ? w.lands : w.spots).find((o) => o.id === id); if (!x) return null;
      if (!x.known) {
        return {
          label: '传闻 · 一个还没去过的地方',
          text: `最近听到的一个传闻：${x.hint || '远方有个没人说得清的地方'}\n（这个地方叫「${x.name}」${x.land ? `，在${x.land}` : ''}：${x.desc || ''}）\n可以让角色自然地提起、打听，或者计划去那里；不用马上去，也不要一下子把它的全貌说出来。`,
        };
      }
      return { label: `世界 ·「${x.name}」`, text: `这个世界里的${kind === 'wland' ? `一片地方：${x.name}（${x.terrain || ''}）` : `一个地点：${x.name}${x.land ? `，在${x.land}` : ''}`}\n${x.desc || ''}` };
    }
    if (kind === 'npc') {
      const p = (codex().npc.items || []).find((o) => o.id === id); if (!p || !p.met) return null;
      const ls = (codex().npc.links || []).filter((l) => l.a === p.name || l.b === p.name);
      const other = (l) => npcLabel(l.a === p.name ? l.b : l.a);
      const knownF = (p.facts || []).filter((f) => f.known), hidF = (p.facts || []).filter((f) => !f.known);
      const knownL = ls.filter((l) => l.known), hidL = ls.filter((l) => !l.known);
      return {
        label: `${appTitle('npc')} ·「${p.name}」`,
        text: [`人物：${p.name}${p.role ? `（${p.role}）` : ''}${p.look ? `；${p.look}` : ''}${p.basic?.length ? `；${p.basic.map((x) => `${x.k} ${x.v}`).join('、')}` : ''}`,
          knownF.length || knownL.length ? `{{user}}已经知道的：${[...knownF.map((f) => `${f.k}：${f.v}`), ...knownL.map((l) => `和${other(l)}：${l.label}`)].join('；')}` : '',
          hidF.length || hidL.length ? `【只给你看的底，{{user}}还不知道】${[...hidF.map((f) => `${f.k}：${f.v}`), ...hidL.map((l) => `和${other(l)}：${l.label}`)].join('；')}` : '',
          `写这个人时照着上面来，尤其「不会」的事不能让 ta 突然会、「擅长」以外的判断要谨慎。{{user}}还不知道的部分可以慢慢露出线索，不要一下子说破，也不要提到“底”。`].filter(Boolean).join('\n'),
      };
    }
    return null;
  }
  function applyQuote() {
    const c = stCtx();
    try {
      const value = quote ? `[附带资料] 用户这一轮提到的那条内容如下。把它当作故事里真实存在的东西来理解和回应，不要逐字复述，也不要提到“附带资料”。\n${quote.text}` : '';
      c?.setExtensionPrompt?.(QUOTE_KEY, value, 1, 1, false, 0); // 1 = 插在聊天里，深度 1（紧挨在最后一条消息前），0 = system
    } catch (e) { console.warn('[小手机] 附带失败', e); }
    quoteChip();
  }
  function setQuote(q) { quote = q ? { ...q, bound: false } : null; applyQuote(); }
  function quoteChip() {
    let chip = D.getElementById('xsj-quote');
    if (!quote) { chip?.remove(); return; }
    if (!chip) {
      const host = D.getElementById('send_form');
      if (!host) return;
      chip = D.createElement('div');
      chip.id = 'xsj-quote';
      chip.addEventListener('click', (ev) => { if (ev.target.closest('[data-qx]')) { setQuote(null); toast('已撤掉附带', 'info'); } });
      host.parentNode.insertBefore(chip, host);
    }
    chip.innerHTML = `<span>📎 ${quote.bound ? '本楼已附带' : '下一条消息会附带'}：<b>${esc(quote.label)}</b>${quote.bound ? '<small>重新生成也有效，发下一条消息时清除</small>' : ''}</span><button data-qx title="撤掉">×</button>`;
  }
  // 发消息：第一次把附带「绑」在这条上；再发下一条时清掉（事件在拼提示词之前触发）
  (function hookQuoteEvents() {
    const c = stCtx();
    if (!c?.eventSource || !c.event_types) return;
    c.eventSource.on(c.event_types.MESSAGE_SENT, () => {
      if (!quote) return;
      if (quote.bound) setQuote(null);
      else { quote.bound = true; quoteChip(); }
    });
    c.eventSource.on(c.event_types.CHAT_CHANGED, () => { if (quote) setQuote(null); });
  })();

  // ---------- ✦ 图鉴自动发现：AI 回复里出现了还锁着的名字，就直接点亮（只对名字，不调 API） ----------
  function autoDiscover(text) {
    const d = codex().dex;
    const plain = String(text || '').replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '').replace(/<[^>]+>/g, ' ');
    const hits = d.items.filter((x) => !x.found && txt(x.name).length >= 2 && plain.includes(x.name));
    if (!hits.length) return [];
    const today = dateKey(storyDate());
    for (const x of hits) Object.assign(x, { found: true, isNew: true, foundAt: today, foundNote: x.foundNote || '剧情里遇到' });
    saveChat();
    return hits;
  }
  (function hookAutoDiscover() {
    const c = stCtx();
    if (!c?.eventSource || !c.event_types?.MESSAGE_RECEIVED) return;
    c.eventSource.on(c.event_types.MESSAGE_RECEIVED, (id) => {
      try {
        const m = stCtx()?.chat?.[id];
        if (!m || m.is_user || m.is_system) return;
        const hits = autoDiscover(m.mes);
        const spots = autoRevealFog(m.mes);
        const wlds = autoRevealWorld(m.mes);
        if (wlds.length) try { W.toastr?.success?.(wlds.map((x) => `${esc(x.emoji || '🗺')} ${esc(x.name)}`).join('<br>'), '🌍 世界地图上点亮了', { escapeHtml: false, timeOut: 6000 }); } catch (e) {}
        if (wlds.length && D.getElementById(ROOT_ID)) render();
        const ppl = autoNpc(m.mes);
        if (ppl.met.length || ppl.facts.length) try { W.toastr?.success?.([...ppl.met.map((p) => `认识了 ${esc(p.emoji)} ${esc(p.name)}`), ...ppl.facts.map((s) => `知道了${esc(s)}`)].join('<br>'), `📇 ${esc(appTitle('npc'))}`, { escapeHtml: false, timeOut: 7000 }); } catch (e) {}
        if (spots.length) try { W.toastr?.success?.(spots.map((p) => `${esc(p.emoji)} ${esc(p.name)}`).join('<br>'), '🗺 发现新地点', { escapeHtml: false, timeOut: 6000 }); } catch (e) {}
        if (!hits.length) { if ((spots.length || ppl.met.length || ppl.facts.length) && D.getElementById(ROOT_ID)) render(); return; }
        const r = (x) => rar(x.rarity);
        try {
          if (hits.length) W.toastr?.success?.(hits.map((x) => `${esc(x.emoji)} ${esc(x.name)}　${'★'.repeat(rarN(x.rarity))} ${r(x).n}`).join('<br>'), `✦ ${esc(appTitle('dex'))}新发现`, { escapeHtml: false, timeOut: 6000 });
        } catch (e) {}
        if (D.getElementById(ROOT_ID)) render();
      } catch (e) { console.warn('[小手机] 图鉴自动发现失败', e); }
    });
  })();

  // ---------- 📅 注入本周日程：从剧情里的今天起 7 天，回复时悄悄给 AI，只读不改数据 ----------
  const WEEK_KEY = 'xsj-phone-week';
  const WEEKDAY = '日一二三四五六';
  function weekText() {
    const sd = storyDate();
    const start = new Date(sd.y, sd.m - 1, sd.d);
    const lines = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      let y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
      if (isCn()) { const n = sd.d - 1 + i, mm = sd.m - 1 + Math.floor(n / 30); y = sd.y + Math.floor(mm / 12); m = (mm % 12) + 1; dd = (n % 30) + 1; }
      const key = `${y}-${pad(m)}-${pad(dd)}`;
      const mon = chat.months?.[ym(y, m)] || {};
      const parts = [];
      for (const b of chat.birthdays || []) if (b.md === `${pad(m)}-${pad(dd)}`) parts.push(`${b.kind === '纪念日' ? '💝' : '🎂'} ${b.who}${b.kind === '纪念日' ? '' : '生日'}`);
      for (const h of mon.holidays || []) {
        if (h.kind === VAC) { if (key >= h.date && key <= (h.end || h.date) && (i === 0 || key === h.date)) parts.push(`${h.name}（放假到 ${+String(h.end || h.date).slice(5, 7)}/${+String(h.end || h.date).slice(8, 10)}）`); }
        else if (h.date === key) parts.push(`🎉 ${h.name}`);
      }
      for (const it of (mon.schedule || []).filter((x) => x.date === key).sort((a, b) => String(a.time).localeCompare(String(b.time)))) {
        parts.push(`${it.time ? it.time + ' ' : ''}${it.title}${it.place ? ' @' + it.place : ''}`);
      }
      if (!parts.length) continue;
      const label = i === 0 ? '今天' : i === 1 ? '明天' : `${dayLabel(m, dd)} ${weekName(d.getDay())}`.trim();
      lines.push(`${label}：${parts.join('；')}`);
    }
    if (!lines.length) return '';
    return [`[${ownerName()} 接下来一周的安排（今天是 ${`${dayLabel(sd.m, sd.d)} ${weekName(start.getDay())}`.trim()}）]`, ...lines,
      calPrompt('week')].join('\n');
  }
  function applyWeek() {
    try { stCtx()?.setExtensionPrompt?.(WEEK_KEY, settings.weekInject ? weekText() : '', 1, 4, false, 0); } // 插在聊天里，深度 4，system
    catch (e) { console.warn('[小手机] 注入本周日程失败', e); }
  }
  // 每次开始生成前重算一遍（剧情日期、日程都可能变了），事件在拼提示词之前触发
  (function hookWeekEvents() {
    const c = stCtx();
    if (!c?.eventSource || !c.event_types?.GENERATION_STARTED) return;
    c.eventSource.on(c.event_types.GENERATION_STARTED, applyWeek);
    applyWeek();
  })();

  // ---------- 页内确认框（不用 window.confirm） ----------
  function ask(msg, okText = '确定') {
    return new Promise((resolve) => {
      const box = D.createElement('div');
      box.className = 'xsj-ask';
      box.innerHTML = `<div class="xsj-ask-card"><div>${esc(msg)}</div><div class="xsj-ask-row"><button data-v="0">取消</button><button data-v="1" class="xsj-primary">${esc(okText)}</button></div></div>`;
      box.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; box.remove(); resolve(b.dataset.v === '1'); });
      D.getElementById(ROOT_ID)?.querySelector('.xsj-screen')?.appendChild(box);
    });
  }
  // 点生成时：已经有内容就问一句——保留现在的只新增，还是全部重新生成（返回 'add' / 'reset' / null）
  function askRegen(name, n, unit, resetNote = '现在的内容和画好的图都会删掉', k = '', btns = null) {
    return new Promise((resolve) => {
      let num = k ? genCount(k) : 0;
      const box = D.createElement('div');
      box.className = 'xsj-ask';
      const draw = () => {
        box.innerHTML = `<div class="xsj-ask-card xsj-regen-card"><div>${n ? `「${esc(name)}」里已经有 ${n} ${esc(unit)}，这次要怎么生成？` : esc(name)}</div>
        ${k ? countRow(k, num) : ''}${btns || (n ? `<button data-v="add" data-go class="xsj-primary">保留现在的，只新增</button>
        <button data-v="reset" data-go class="xsj-regen-reset">全部重新生成<small>${esc(resetNote)}</small></button>` : '<button data-v="new" data-go class="xsj-primary">生成</button>')}
        <button data-v="" data-go class="xsj-regen-cancel">取消</button></div>`;
      };
      draw();
      box.addEventListener('input', (ev) => { const v = ev.target.dataset.numin && numOk(k, ev.target.value); if (v) num = v; });
      box.addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        if (b.dataset.k === 'count') { num = Number(b.dataset.v); draw(); return; }
        box.remove();
        if (b.dataset.v && k) setWant(k, num);
        resolve(b.dataset.v || null);
      });
      D.getElementById(ROOT_ID)?.querySelector('.xsj-screen')?.appendChild(box);
    });
  }
  // 刷新蓝星online 前问：保留还是重来（有帖子时），以及这一批是梦向还是一般向
  function askDream(n) {
    return new Promise((resolve) => {
      let mode = 'add', dir = settings.dreamDir === 'general' ? 'general' : 'dream', num = genCount('dream');
      const box = D.createElement('div');
      box.className = 'xsj-ask';
      const seg = (name, opts, cur) => `<div class="xsj-seg" data-seg="${name}">${opts.map(([v, label]) => `<button data-sv="${v}" class="${cur === v ? 'on' : ''}">${label}</button>`).join('')}</div>`;
      const draw = () => {
        box.innerHTML = `<div class="xsj-ask-card xsj-regen-card"><div>刷新蓝星online</div>
          ${n ? `<small class="xsj-seg-h">现在有 ${n} 条</small>${seg('mode', [['add', '保留，只新增'], ['reset', '全部重新生成']], mode)}` : ''}
          <small class="xsj-seg-h">这一批看什么</small>${seg('dir', [['dream', '💘 梦向'], ['general', '🎮 一般向']], dir)}
          <small class="xsj-seg-tip">${dir === 'dream' ? '把你当老婆、最宝贵的人：想你、吃醋、约稿、做周边、为你抽卡' : '普通玩家视角：聊剧情、考据、嗑 CP、吐槽官方、抽卡'}</small>
          ${countRow('dream', num)}<button data-go class="xsj-primary">刷新</button><button data-cancel class="xsj-regen-cancel">取消</button></div>`;
      };
      draw();
      box.addEventListener('input', (ev) => { const v = ev.target.dataset.numin && numOk('dream', ev.target.value); if (v) num = v; });
      box.addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        if (b.dataset.k === 'count') { num = Number(b.dataset.v); draw(); return; }
        const sg = b.closest('[data-seg]');
        if (sg) { if (sg.dataset.seg === 'mode') mode = b.dataset.sv; else dir = b.dataset.sv; draw(); return; }
        box.remove();
        if (b.hasAttribute('data-go')) { settings.dreamDir = dir; setWant('dream', num); resolve({ add: mode === 'add', dir }); } else resolve(null);
      });
      D.getElementById(ROOT_ID)?.querySelector('.xsj-screen')?.appendChild(box);
    });
  }
  // 几个选项里挑一个（页内对话框）；返回选中的 v，取消返回 null
  function askChoice(msg, options) {
    return new Promise((resolve) => {
      const box = D.createElement('div');
      box.className = 'xsj-ask';
      box.innerHTML = `<div class="xsj-ask-card xsj-regen-card"><div>${esc(msg)}</div>${options.map((o) => `<button data-v="${esc(o.v)}" class="${o.primary ? 'xsj-primary' : o.danger ? 'xsj-regen-reset' : ''}">${esc(o.label)}</button>`).join('')}<button data-v="" class="xsj-regen-cancel">取消</button></div>`;
      box.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; box.remove(); resolve(b.dataset.v || null); });
      D.getElementById(ROOT_ID)?.querySelector('.xsj-screen')?.appendChild(box);
    });
  }
  // 哪些生成按钮要问：数一数现有内容、全部重来时清掉什么；snap/restore 用来在重新生成失败时还原
  const REGEN = {
    'gen-dex': { k: 'dex', unit: '个', n: () => codex().dex.items.length, get: () => codex().dex.items, set: (v) => { codex().dex.items = v; view.dex = null; } },
    'gen-wiki': { k: 'wiki', unit: '条', n: () => codex().wiki.items.length, get: () => codex().wiki.items, set: (v) => { codex().wiki.items = v; view.wiki = null; } },
    'gen-npc': {
      k: 'npc', unit: '个人', n: () => npcData().items.length,
      get: () => ({ items: npcData().items, links: npcData().links, bd: (chat.birthdays || []).filter((b) => b.fromNpc) }),
      set: (v) => {
        const N = npcData();
        N.items = v ? v.items : []; N.links = v ? v.links : [];
        chat.birthdays = [...(chat.birthdays || []).filter((b) => !b.fromNpc), ...(v ? v.bd : [])];
        view.npc = null;
      },
    },
  };
  // 返回 true = 可以继续生成（只新增，或已经清空准备重来）；false = 取消
  async function regenChoice(act) {
    const R = REGEN[act];
    if (!R) return { go: true };
    const name = appTitle(R.k);
    const v = await askRegen(R.n() ? name : `生成${name}`, R.n(), R.unit, undefined, R.k);
    if (!v) return { go: false };
    if (v !== 'reset') return { go: true };
    const snap = R.get();
    R.set(act === 'gen-dex' || act === 'gen-wiki' || act === 'gen-dream' ? [] : null);
    return { go: true, undo: () => { R.set(snap); saveChat(); } };
  }

  // ---------- 渲染 ----------
  function statusBar() {
    const sd = storyDate();
    // 右边是手画的信号、Wi-Fi、电池图标（以前用文字符号拼的，在不同字体下会变形）
    const icons = `<span class="xsj-sicons">
      <svg width="17" height="11" viewBox="0 0 17 11"><rect x="0" y="7.5" width="3" height="3.5" rx=".9"/><rect x="4.6" y="5" width="3" height="6" rx=".9"/><rect x="9.2" y="2.5" width="3" height="8.5" rx=".9"/><rect x="13.8" y="0" width="3" height="11" rx=".9"/></svg>
      <svg width="15" height="11" viewBox="0 0 15 11"><path d="M7.5 10.6 9.8 8a3.3 3.3 0 0 0-4.6 0z"/><path d="M3 5.7a6.6 6.6 0 0 1 9 0l-1.4 1.6a4.5 4.5 0 0 0-6.2 0z"/><path d="M.3 2.7a10.5 10.5 0 0 1 14.4 0l-1.4 1.6a8.4 8.4 0 0 0-11.6 0z"/></svg>
      <svg width="25" height="12" viewBox="0 0 25 12"><rect x=".6" y=".6" width="21" height="10.8" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".45"/><rect x="2.3" y="2.3" width="15" height="7.4" rx="1.8"/><rect x="22.6" y="4" width="1.8" height="4" rx=".9" opacity=".45"/></svg>
    </span>`;
    return `<div class="xsj-status"><span class="xsj-sdate">${dayLabel(sd.m, sd.d)}</span>${icons}</div>`;
  }

  // 各 app 还没内容时的默认界面：图标 + 一句话 + 说明 + 一颗按钮
  const blank = (k, title, hint = '', btn = '') => `<div class="xsj-blank is-${k}">${ICON_URI[k] ? `<img src="${ICON_URI[k]}" alt="" draggable="false">` : ''}<b>${title}</b>${hint ? `<p>${hint}</p>` : ''}${btn}</div>`;
  const blankBtn = (act, label, extra = '') => `<button data-act="${act}"${extra} class="xsj-primary">${label}</button>`;
  function calView() {
    if (view.calSet) return calSettings();
    const [y, m] = view.month.split('-').map(Number);
    const md = monthData(view.month);
    const days = calDays(y, m, md), cnMode = isCn();
    const today = dateKey(storyDate());
    const byDay = {};
    for (const it of md.schedule) (byDay[it.date] ||= []).push(it);
    // 节日只在正日；假期从起始日铺到结束日，名字只写在第一天
    const holByDay = {};
    for (const h of md.holidays) {
      const end = h.kind === VAC && h.end > h.date ? h.end : h.date;
      for (let d = 1; d <= days; d++) {
        const k = `${y}-${pad(m)}-${pad(d)}`;
        if (k >= h.date && k <= end) (holByDay[k] ||= []).push({ ...h, first: k === h.date });
      }
    }
    const bdByDay = {};
    for (const b of chat.birthdays) if (b.md && b.md.startsWith(pad(m) + '-')) (bdByDay[`${y}-${b.md}`] ||= []).push(b);
    let cells = '';
    const lead = calLead(y, m); // 周一开头；中式从头排
    for (let i = 0; i < lead; i++) cells += '<div></div>';
    for (let d = 1; d <= days; d++) {
      const weekend = !cnMode && (lead + d - 1) % 7 >= 5;
      const k = `${y}-${pad(m)}-${pad(d)}`;
      const dots = (byDay[k] || []).slice(0, 3).map((x) => `<i style="background:${TYPE_COLOR[x.type] || '#999'}"></i>`).join('');
      const hs = holByDay[k] || [], bs = bdByDay[k] || [];
      const labels = [
        ...bs.map((b) => `<small class="xsj-hol xsj-bd">${b.kind === '纪念日' ? '💝' : '🎂'}${esc(b.who)}</small>`),
        ...hs.filter((h) => h.first).map((h) => `<small class="xsj-hol${h.kind === VAC ? ' xsj-vac' : ''}">${esc(h.name)}</small>`),
      ].slice(0, 2).join('');
      const cls = [k === today && 'is-today', k === view.day && 'is-sel', weekend && 'is-wkd', hs.some((h) => h.kind !== VAC) && 'has-hol', hs.some((h) => h.kind === VAC) && 'is-off', bs.length && 'has-bd'].filter(Boolean).join(' ');
      cells += `<button class="xsj-day ${cls}" data-day="${k}"><span>${dayName(d)}</span>${labels}<b>${dots}</b></button>`;
    }
    const dayHols = holByDay[view.day] || [];
    const dayBds = bdByDay[view.day] || [];
    const list = (byDay[view.day] || []).slice().sort((a, b) => a.time.localeCompare(b.time));
    const ed = view.editing;
    const fields = !ed ? '' : FIXED.includes(ed.type)
      ? `<input data-f="title" placeholder="${ed.type === '生日' ? '谁的生日' : '什么纪念日'}" value="${esc(ed.title)}"><input data-f="note" placeholder="备注（每年这天都会显示）" value="${esc(ed.note)}">`
      : ed.type === HOL ? `<input data-f="title" placeholder="节日名" value="${esc(ed.title)}">`
      : ed.type === VAC ? `<input data-f="title" placeholder="假期名，如 国庆假期" value="${esc(ed.title)}"><input data-f="end" placeholder="放到哪天，如 ${y}-${pad(m)}-07" value="${esc(ed.end)}">`
      : `<input data-f="title" placeholder="事项" value="${esc(ed.title)}"><div class="xsj-row2"><input data-f="time" placeholder="09:00-12:00" value="${esc(ed.time)}"><input data-f="place" placeholder="地点" value="${esc(ed.place)}"></div>`;
    const form = ed ? `<div class="xsj-ask xsj-formask"><div class="xsj-ask-card"><div class="t">${ed.id ? '修改' : '新增'} · ${esc(dayLabel(+ed.date.split('-')[1], +ed.date.split('-')[2]))}</div>
      <div class="xsj-form">
        ${fields}
        <div class="xsj-chips">${[...TYPES, HOL, VAC, ...FIXED].map((t) => `<button data-type="${t}" class="${ed.type === t ? 'on' : ''}" style="--c:${TYPE_COLOR[t]}">${t}</button>`).join('')}</div>
        <div class="xsj-row2">${ed.id ? '<button data-act="del-item" class="xsj-danger">删除</button>' : '<span></span>'}<span><button data-act="cancel-edit">取消</button><button data-act="save-item" class="xsj-primary">保存</button></span></div>
      </div></div></div>` : '';
    const selDate = view.day ? new Date(+view.day.split('-')[0], +view.day.split('-')[1] - 1, +view.day.split('-')[2]) : null;
    const wk = selDate ? weekName(selDate.getDay()) : '';
    const items = list.map((it) => `<button class="xsj-item" data-item="${it.id}"><i style="background:${TYPE_COLOR[it.type] || '#999'}"></i><span class="xsj-time">${esc(it.time || '—')}</span><span class="xsj-title">${esc(it.title)}${it.place ? `<small>${esc(it.place)}</small>` : ''}</span><em>${esc(it.type)}${it.manual ? ' · 自记' : ''}</em></button>`).join('');
    const chev = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
    return `
      <div class="xsj-caltop"><button data-act="back" class="bk" title="返回桌面">${chev('M15 4.500 7.500 12l7.500 7.500')}</button><h2>${esc(monthName(m))}<small>${esc(yearName(y))}</small></h2><span class="cap"><button data-act="prev" title="上月">${chev('M14.500 6 8.500 12l6 6')}</button><button data-tab="cal" data-today="${today}" class="td">今天</button><button data-act="next" title="下月">${chev('M9.500 6l6 6-6 6')}</button></span><button data-act="add-item" class="gen set" title="新增日程">${chev('M12 5v14M5 12h14')}</button><button data-act="gen" data-parts="schedule,holidays" class="gen" title="生成本月日程和节日">${ico('gen')}</button><button data-act="cal-set" class="gen set" title="日历设置">${chev('M4 7h8M18 7h2M4 17h2M12 17h8M15 4.500a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5zM9 14.500a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5z')}</button></div>
      <div class="xsj-cal">
        
        ${cnMode ? '' : `<div class="xsj-week">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<span${i >= 5 ? ' class="is-wkd"' : ''}>${esc(weekShort(i))}</span>`).join('')}</div>`}
        <div class="xsj-grid${cnMode ? ' is-cn' : ''}">${cells}</div>
      </div>
      ${items || dayHols.length || dayBds.length ? `<div class="xsj-daycard">
      <div class="xsj-dayhead"><span>${view.day ? `<b class="xsj-dbig">${dayName(+view.day.split('-')[2])}</b><span class="xsj-dsub">${esc([monthName(+view.day.split('-')[1]), wk].filter(Boolean).join(' · '))}</span>` : ''}${dayHols.map((h) => `<button class="xsj-holpill${h.kind === VAC ? ' xsj-vacpill' : ''}" data-hol="${h.id}">${esc(h.name)}</button>`).join('')}${dayBds.map((b) => `<button class="xsj-holpill xsj-bdpill" data-bd="${b.id}">${b.kind === '纪念日' ? '💝' : '🎂'}${esc(b.who)}</button>`).join('')}</span></div>
      ${dayBds.filter((b) => b.note).map((b) => `<div class="xsj-bdnote">${b.kind === '纪念日' ? '💝' : '🎂'} ${esc(b.who)}${b.kind === '纪念日' ? '' : '生日'}：${esc(b.note)}</div>`).join('')}
      ${items}
      </div>` : ''}
      ${form}
      ${md.schedule.some((x) => !x.manual) ? '' : `<button data-act="gen" data-parts="schedule,holidays" class="xsj-primary xsj-genmonth">✦ 生成${esc(monthName(m))}日程和节日</button>`}`;
  }

  // 🎲 随机剧情：先选种类、大小、人物、反派，也可以自己写剧情向，再掷骰子
  // 选数量的地方都留一格自己填。边打边存、不重画，这样打完直接点按钮也算数
  const NUM_MAX = { ev: 20, item: 20, set: 6, ...Object.fromEntries(Object.entries(GEN_N).map(([k, G]) => [k, G.max])) };
  const numOk = (kind, v) => { const n = Math.floor(Number(v)); return n >= 1 ? Math.min(NUM_MAX[kind], n) : 0; };
  const numIn = (kind, cur, presets) => { const own = !presets.includes(Number(cur)); return `<input data-numin="${kind}" type="number" inputmode="numeric" min="1" max="${NUM_MAX[kind]}" class="xsj-numin${own ? ' on' : ''}" value="${own ? esc(cur) : ''}" placeholder="自己填" title="1-${NUM_MAX[kind]}">`; };
  function numInput(el) {
    const kind = el.dataset?.numin;
    if (!kind) return false;
    const n = numOk(kind, el.value);
    if (!n) return true;
    if (kind === 'ev') { settings.evOpt = { ...evOpt(), count: n }; saveSettings(settings); }
    el.classList.add('on');
    for (const b of el.parentElement.querySelectorAll('[data-ev="count"],[data-k="count"]')) for (const c of b.dataset.pri ? ['on', 'xsj-primary'] : ['on']) b.classList.toggle(c, Number(b.dataset.v) === n);
    return true;
  }
  // 填完离开：超了就改成上限；空着就沿用上一次的数，写回格子里
  function numChange(el) {
    const kind = el.dataset?.numin;
    if (!kind) return false;
    const n = numOk(kind, el.value);
    if (n && Number(el.value) > NUM_MAX[kind]) toast(`最多 ${NUM_MAX[kind]}`);
    if (n) el.value = n;
    else if (kind === 'ev') {
      const on = [...el.parentElement.querySelectorAll('[data-ev="count"]')].some((b) => b.classList.contains('on') && Number(b.dataset.v) === evOpt().count);
      el.value = on ? '' : evOpt().count;
      el.classList.toggle('on', !on);
    }
    return true;
  }
  const evOpt = () => ({ kinds: [], size: 'any', npc: 'old', villain: 'off', count: 3, ...(settings.evOpt || {}) });
  const evKinds = () => promptOf('ev', 'kinds').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 16).map((x) => { const [k, ...d] = x.split(/[：:]/); return { k: k.trim().slice(0, 6), d: d.join('：').trim() }; }).filter((x) => x.k);
  const evPeople = () => npcData().items.filter((p) => p.met).map((p) => p.name).slice(0, 24);
  const d6 = () => 1 + Math.floor(Math.random() * 6);
  // 骰子：没选种类就从全部里掷，选了就在选中的里掷；大小随机时 1-3 轻、4-5 中、6 重
  function evRoll() {
    const o = evOpt(), all = evKinds(), mine = all.filter((x) => o.kinds.includes(x.k)), pool = mine.length ? mine : all.length ? all : [{ k: '随缘', d: '' }];
    let bag = [];
    const draw = () => { if (!bag.length) bag = pool.slice().sort(() => Math.random() - 0.5); return bag.pop(); };
    return Array.from({ length: o.count }, () => { const n = d6(), x = draw(); return { n, kind: x.k, desc: x.d, level: o.size !== 'any' ? o.size : n <= 3 ? '轻' : n <= 5 ? '中' : '重' }; });
  }
  function evOpts(slots = evRoll()) {
    const o = evOpt(), people = evPeople();
    return { slots, newNpc: o.npc === 'new', villain: o.villain === 'keep' && !chat.villain ? 'new' : o.villain, who: (chat.evWho || []).filter((n) => people.includes(n)), wish: String(chat.evWish || '').trim() };
  }
  const PIPS = { 1: [[50, 50]], 2: [[30, 30], [70, 70]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[30, 30], [70, 30], [30, 70], [70, 70]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[30, 26], [70, 26], [30, 50], [70, 50], [30, 74], [70, 74]] };
  const dice = (n) => `<svg viewBox="0 0 100 100" aria-hidden="true">${PIPS[n].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9"/>`).join('')}</svg>`;
  function eventsView() {
    // 永远是剧情当前这个月的
    { const sd = storyDate(); view.month = ym(sd.y, sd.m); }
    if (view.evSet) return topBar('is-ev', '剧情设置', '') + promptCard('ev');
    const md = monthData(view.month), o = evOpt(), cv = chat.villain, people = evPeople(), who = chat.evWho || [], rolling = !!view.evRolling, last = chat.evLast;
    const chip = (attr, v, label, on) => `<button data-ev="${attr}" data-v="${esc(v)}" class="${on ? 'on' : ''}">${esc(label)}</button>`;
    const row = (h, tip, body) => `<div class="xsj-evrow"><h4>${h}${tip ? `<small>${tip}</small>` : ''}</h4><div class="chips">${body}</div></div>`;
    const form = `<div class="xsj-evform">
      ${row('剧情种类', o.kinds.length ? '在选中的里掷' : '不选就全部随机', evKinds().map((x) => chip('kind', x.k, x.k, o.kinds.includes(x.k))).join(''))}
      ${row('大小', o.size === 'any' ? '1-3 轻 · 4-5 中 · 6 重' : '', [['any', '随机'], ['轻', '小'], ['中', '中'], ['重', '大']].map(([v, t]) => chip('size', v, t, o.size === v)).join(''))}
      ${row('NPC', '', chip('npc', 'old', '只用已有的人', o.npc !== 'new') + chip('npc', 'new', '可以有新面孔', o.npc === 'new'))}
      ${people.length ? row('谁卷进来', '不选就随机', people.map((n) => chip('who', n, n, who.includes(n))).join('')) : ''}
      ${row('反派', cv && o.villain === 'keep' ? esc(cv.name) : '', chip('villain', 'off', '不要', o.villain === 'off') + (cv ? chip('villain', 'keep', `接着 ${cv.name}`, o.villain === 'keep') : '') + chip('villain', 'new', cv ? '换一个' : '加入反派', o.villain === 'new' || (o.villain === 'keep' && !cv)))}
      ${row('掷几条', '', [1, 3, 6].map((n) => chip('count', n, String(n), o.count === n)).join('') + numIn('ev', o.count, [1, 3, 6]))}
      <div class="xsj-evrow"><h4>剧情向<small>自己写，可以空着</small></h4><textarea data-evwish rows="2" placeholder="比如：想让他吃醋，但不是因为别的男人">${esc(chat.evWish || '')}</textarea></div>
    </div>`;
    const vHead = cv && md.events.some((e) => e.villain) ? `<div class="xsj-card xsj-villain-head" data-hold="villain:1"><b>🗡 ${esc(cv.name)}</b>${cv.identity ? ` · ${esc(cv.identity)}` : ''}${cv.goal ? `<div>想要：${esc(cv.goal)}</div>` : ''}${cv.plan ? `<small>打算：${esc(cv.plan)}</small>` : ''}</div>` : '';
    const list = md.events.map((e) => `
      <div class="xsj-card${e.used ? ' is-used' : ''}${e.villain ? ' is-villain' : ''}" data-hold="ev:${e.id}">
        <div class="xsj-card-top"><b>${e.villain ? '<i class="xsj-lv xsj-lv-v">反派</i>' : ''}${e.level ? `<i class="xsj-lv xsj-lv-${{ 轻: 1, 中: 2, 重: 3 }[e.level]}">${{ 轻: '小', 中: '中', 重: '大' }[e.level]}</i>` : ''}${e.kind ? `<i class="xsj-lv xsj-lv-k">${esc(e.kind)}</i>` : ''}${esc(e.title)}</b><span><button data-act="star" data-id="${e.id}" title="收藏，清空时保留">${e.star ? '★' : '☆'}</button><button data-act="used" data-id="${e.id}" title="用过了">${e.used ? '↺' : '✓'}</button><button data-act="quote" data-kind="event" data-id="${e.id}" title="附带给下一次回复">📎</button></span></div>
        <div>${esc(e.desc)}</div>
        ${e.hook ? `<div class="xsj-hook">→ ${esc(e.hook)}</div>` : ''}
        ${e.date || e.who ? `<small>${esc([e.date, e.who].filter(Boolean).join(' · '))}</small>` : ''}
      </div>`).join('');
    return `${topBar('is-ev', '随机剧情', ownerName(), topBtn('ev-set', 'set', '随机剧情设置', true))}
      <div class="xsj-dice"><button data-act="ev-roll" class="die${rolling ? ' is-rolling' : ''}" title="掷骰子"${rolling ? ' disabled' : ''}>${dice(last?.n || 5)}</button><b>${rolling ? '正在掷…' : '点骰子，掷一次剧情'}</b>${rolling ? '<button data-act="cancel-gen" class="stop">取消</button>' : ''}${last?.text ? `<small>${rolling ? '掷出' : '上次掷出'}：${esc(last.text)}</small>` : ''}</div>
      ${form}
      ${md.events.length ? `<div class="xsj-evhead"><b>掷出的剧情</b><button data-act="ev-clear">清空（★ 留着）</button></div>` : ''}${vHead}${list}`;
  }

  function monthView() {
    // 小红书不分月份显示：永远是剧情当前这个月的
    { const sd = storyDate(); view.month = ym(sd.y, sd.m); }
    const md = monthData(view.month);
    const [, m] = view.month.split('-').map(Number);
    const nb = notesFor(md);
    if (!md.season && !nb.items.length) return blank('mon', '小红书还是空的', '看看这个世界此刻有什么：吃喝、穿搭、店铺、去处、节庆和新鲜事。都是路人网友发的，不参考剧情。', blankBtn('gen', '生成小红书', ' data-parts="season,notes"'));
    if (view.note) {
      const n = nb.items.find((x) => x.id === view.note);
      if (n) return noteDetail(n);
      view.note = null;
    }
    const s = md.season || {};
    const season = md.season ? `
      <div class="xsj-weather">
        <div><b>☁ ${esc(s['时令'] || '')}</b><span>${esc(s['天气'] || '')}</span></div>
        ${s['氛围'] ? `<small>${esc(s['氛围'])}</small>` : ''}
      </div>` : '';
    const cats = ['推荐', ...NOTE_CATS.filter((c) => nb.items.some((x) => x.cat === c))];
    const cur = cats.includes(view.noteCat) ? view.noteCat : '推荐';
    const items = nb.items.filter((x) => cur === '推荐' || x.cat === cur);
    const cards = items.map((n) => {
      const [g1, g2] = CAT_GRAD[n.cat] || CAT_GRAD['生活'];
      const h = [96, 124, 150][hashN(n.id + n.title) % 3];
      return `<button class="xsj-note" data-note="${n.id}">
        ${view.drawing?.id === n.id ? drawingBox(n.id, 'xsj-drawing-cover', false) : n.pic
          ? `<img class="xsj-cover xsj-cover-img" src="${esc(n.pic)}" style="height:${h + 30}px" alt="" loading="lazy">`
          : `<div class="xsj-cover" style="height:${h}px;background:linear-gradient(160deg,${g1},${g2})"><span>${esc(n.emoji)}</span></div>`}
        <div class="xsj-note-t">${esc(n.title)}</div>
        <div class="xsj-note-f"><i style="background:${g2}">${esc([...n.author][0] || '?')}</i><span>${esc(n.author)}</span><em>♡ ${fmtLikes(n.likes)}</em></div>
      </button>`;
    }).join('');
    return `
      <div class="xsj-xbar"><div class="xsj-plat" style="margin:0">🔥 ${esc(nb.platform)}</div></div>
      ${season}
      ${nb.items.length ? `<div class="xsj-cats">${cats.map((c) => `<button data-cat="${c}" class="${c === cur ? 'on' : ''}">${c}</button>`).join('')}</div>
      <div class="xsj-flow">${cards}</div>` : blank('mon', '还没有帖子', '', blankBtn('gen', '生成小红书', ' data-parts="season,notes"'))}`;
  }

  function cartView() {
    const md = monthData(view.month);
    const [, m] = view.month.split('-').map(Number);
    if (!md.cart.length) return `<div class="xsj-empty">${monthName(m)}的购物车还是空的<br><button data-act="gen" data-parts="cart" class="xsj-primary">🛒 看看购物车</button></div>`;
    const items = md.cart.slice().sort((a, b) => a.bought - b.bought);
    const left = md.cart.filter((x) => !x.bought).length;
    return `
      <div class="xsj-sub">${esc(ownerName())}的购物车 · ${left}件待结算</div>
      ${items.map((c) => `
        <div class="xsj-cart${c.bought ? ' is-bought' : ''}">
          <button data-act="buy" data-id="${c.id}" class="xsj-tick" title="${c.bought ? '放回购物车' : '已买'}">${c.bought ? '✓' : ''}</button>
          <span class="xsj-cart-e">${esc(c.emoji)}</span>
          <div class="xsj-cart-m"><b>${esc(c.name)}</b>${c.note ? `<small>${esc(c.note)}</small>` : ''}</div>
          <em>${esc(c.price)}</em>
          <button data-act="cart-del" data-id="${c.id}" class="xsj-x" title="移出">×</button>
        </div>`).join('')}
      <button data-act="gen" data-parts="cart" class="xsj-regen">↻ 换一批（保留已买的）</button>`;
  }

  // ---------- X：char 私下刷 X 的浏览记录（偏成人向），按聊天存，跟着剧情刷新 ----------
  const X_KINDS = { 浏览: '👁', 点赞: '♥', 收藏: '🔖', 看视频: '▶', 搜索: '🔍' };
  function xView() {
    const xl = chat.xlog;
    const who = esc(charKey());
    if (!xl || !xl.items?.length) return blank('x', `还没偷看过 ${who} 的 X`, `按最近剧情生成 ${who} 私下刷 X 的记录，偏成人向。内容默认打码，点一下才显示。`, blankBtn('gen-x', '看看浏览记录'));
    const reveal = !!view.xReveal;
    const tab = view.xTab === 'search' ? 'search' : 'feed';
    const me = [...charKey()][0] || '?';
    const menu = view.xMenu ? `
      <div class="xsj-xmenu">
        ${view.batch ? `<button data-act="cancel-gen">⏹ 停止一键生图（${view.batch}）</button>` : xl.items.some((x) => (x.media || x.img) && !x.pic) ? '<button data-act="x-pic-all">🖼 一键生图</button>' : ''}
        <button data-act="x-reveal">${reveal ? '🙈 全部打码' : '👁 全部显示'}</button>
        <button data-act="gen-x">↻ 刷新浏览记录</button>
      </div>` : '';
    const head = `
      <div class="xsj-xhead">
        <button data-act="back" class="xsj-exit xsj-xexit" title="返回上一层">‹</button>
        <i class="xsj-xme" style="background:${avatarColor(charKey())}">${esc(me)}</i>
        <b class="xsj-xlogo">𝕏</b>
        <button data-act="x-menu" class="xsj-xdots" title="更多">⋯</button>
      </div>
      <div class="xsj-xtabs">
        <button data-xtab="feed" class="${tab === 'feed' ? 'on' : ''}"><span>浏览</span></button>
        <button data-xtab="search" class="${tab === 'search' ? 'on' : ''}"><span>搜索 · 收藏</span></button>
      </div>
      ${menu}`;
    if (tab === 'search') {
      const saved = xl.items.filter((x) => x.saved || x.kind === '收藏');
      return `<div class="xsj-xapp">${head}
        <div class="xsj-xsearchbar">${XI.search}<span>搜索</span></div>
        <div class="xsj-xsec">最近搜索</div>
        ${(xl.searches || []).map((s, i) => `<div class="xsj-xsrow" data-hold="xs:${i}">${XI.clock}<span${reveal ? '' : ' class="is-blur"'}>${esc(s)}</span><em>×</em></div>`).join('') || '<div class="xsj-none">没有搜索记录</div>'}
        <div class="xsj-xsec">收藏 <small>${saved.length}</small></div>
        ${saved.map((it) => xPost(it, reveal)).join('') || '<div class="xsj-none">还没收藏什么</div>'}
      </div>`;
    }
    return `<div class="xsj-xapp">${head}
      <div class="xsj-xasof">浏览记录 · 截至${esc(xl.asOf || '')} · 无痕模式：关</div>
      ${xl.items.map((it) => xPost(it, reveal)).join('')}
    </div>`;
  }

  // X 的小图标（自己画的简笔线条）
  const XI = {
    reply: '<svg viewBox="0 0 24 24"><path d="M4 11.5C4 7.4 7.4 4.5 11.6 4.5h1c4.2 0 7.4 3 7.4 6.9 0 3-1.8 5.4-4.6 6.5L10 20.5v-2.6C6.6 17.6 4 15 4 11.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    repost: '<svg viewBox="0 0 24 24"><path d="M7 17V8.5A2.5 2.5 0 0 1 9.5 6H17M14 3l3 3-3 3M17 7v8.5a2.5 2.5 0 0 1-2.5 2.5H7m3 3-3-3 3-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    like: '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-8.8-9.4C2.4 7.4 4.4 4.8 7.4 4.8c2 0 3.6 1.2 4.6 2.8 1-1.6 2.6-2.8 4.6-2.8 3 0 5 2.6 4.2 5.8C19.5 15.4 12 20 12 20z" fill="var(--fill,none)" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    views: '<svg viewBox="0 0 24 24"><path d="M5 20V12M10 20V6M15 20v-9M20 20V9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    mark: '<svg viewBox="0 0 24 24"><path d="M6.5 4h11v16.5L12 16.8l-5.5 3.7z" fill="var(--fill,none)" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 14v5h14v-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 20 20 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1d9bf0"/><path d="m7.5 12.3 3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 8v4.5l3 1.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  };
  const AV_COLORS = ['#f4a3b8', '#9db7f5', '#f6c177', '#8fd3b6', '#c4a3f0', '#f59e8b', '#7cc7d9', '#e7a5d6'];
  const avatarColor = (s) => AV_COLORS[hashN(s) % AV_COLORS.length];
  const KIND_LINE = { 点赞: '♥ ta 赞过', 收藏: '🔖 ta 收藏了', 看视频: '▶ ta 看过这个视频', 浏览: '👁 ta 看过' };

  // 一条帖子：头像、名字+认证+@账号·时间、正文、图片或成人内容警告卡、互动栏
  function xPost(it, reveal) {
    const shown = reveal || view.xOpen?.[it.id];
    const hide = it.nsfw && !shown;
    const h = hashN(it.id + it.handle + it.text);
    const big = (n) => fmtLikes(n).replace('k', 'K').replace('w', '万');
    const replies = 3 + (h % 180), reposts = 20 + (h % 1900), likes = 120 + (h % 29000), views = likes * (18 + (h % 30));
    const verified = h % 3 === 0;
    const liked = it.kind === '点赞';
    const marked = it.saved || it.kind === '收藏';
    let media = '';
    if (view.drawing?.id === it.id) {
      media = drawingBox(it.id);
    } else if (hide && (it.pic || it.media)) {
      media = `<div class="xsj-xwarn">${XI.eyeOff}<b>内容警告：成人内容</b><span>该帖子被标记为包含成人内容。</span><button data-xopen="${it.id}">显示</button></div>`;
    } else if (it.pic) {
      media = `<img class="xsj-xpic" src="${esc(it.pic)}" alt="" loading="lazy">`;
    } else if (it.media) {
      media = `<div class="xsj-xmedia">${esc(it.media)}</div>`;
    }
    const draw = (it.media || it.img) && view.drawing?.id !== it.id ? `<button class="xsj-xdraw" data-act="x-pic" data-id="${it.id}">${it.pic ? '↻ 重画' : '🖼 出图'}</button>` : '';
    return `
      <div class="xsj-xpost2" data-hold="x:${it.id}">
        <div class="xsj-xctx">${esc(KIND_LINE[it.kind] || '👁 ta 看过')}<span>${esc(it.time)}</span></div>
        <div class="xsj-xrow">
          <i class="xsj-xav" style="background:${avatarColor(it.author)}">${esc([...(it.author || '?')][0])}</i>
          <div class="xsj-xmain">
            <div class="xsj-xname"><b>${esc(it.author)}</b>${verified ? `<span class="xsj-xv">${XI.check}</span>` : ''}<span class="xsj-xh">${esc(it.handle)}</span></div>
            <div class="xsj-xtext${hide ? ' is-blur' : ''}"${hide ? ` data-xopen="${it.id}"` : ''}>${esc(it.text)}</div>
            ${media}
            ${draw}
            <div class="xsj-xacts">
              <span>${XI.reply}${big(replies)}</span>
              <span>${XI.repost}${big(reposts)}</span>
              <span class="${liked ? 'is-on-like' : ''}" style="${liked ? '--fill:currentColor' : ''}">${XI.like}${big(likes + (liked ? 1 : 0))}</span>
              <span>${XI.views}${big(views)}</span>
              <span class="xsj-xsm${marked ? ' is-on-mark' : ''}" style="${marked ? '--fill:currentColor' : ''}">${XI.mark}</span>
              <button class="xsj-xquote" data-act="quote" data-kind="x" data-id="${it.id}" title="附带给下一次回复">📎</button>
            </div>
            ${it.note ? `<div class="xsj-xnote2">💭 ${esc(it.note)}</div>` : ''}
          </div>
        </div>
      </div>`;
  }

  async function generateX(add = false) {
    if (view.busy) return;
    const sd = storyDate();
    const instr = [
      ...baseInstr(sd.y, sd.m),
      add && chat.xlog?.items?.length ? `已经有这些浏览记录，全部保留；这次写更新的几条，不要重复：${chat.xlog.items.slice(0, 12).map((x) => String(x.text || x.media).slice(0, 18)).join('｜')}` : '',
      `任务：写出{{char}}最近私下刷 X（推特）时留下的浏览记录。这是只有读者能偷看的私密内容，偏成人向。`,
      `规则：`,
      `- 内容以成人向为主：性感照片、擦边视频、情色文字、成人话题讨论、和性有关的搜索；夹杂两三条普通浏览，让记录显得真实。`,
      `- 符合{{char}}的性格、性向、癖好与说话方式；也反映ta此刻对{{user}}的感情与欲望（比如搜索和{{user}}有关的事、想对{{user}}做的事），参考最近剧情。`,
      `- 发帖账号是虚构的路人账号或博主，不写现实中的真人；所有涉及的人都是成年人。`,
      `- 时间写成相对时间，集中在深夜和独处的时候，如“昨晚 01:42”“今天 07:15”，从新到旧排列。`,
      `- note 是{{char}}看到时的反应或心里话，10字左右，符合性格（可以是嘴硬、羞耻、认真收藏、立刻划走）。`,
      `JSON 结构：{"xlog": {"searches": ["最近的搜索词，4-6个"], "items": [{"time": "相对时间", "kind": "浏览|点赞|收藏|看视频", "author": "发帖账号昵称", "handle": "@账号", "text": "帖子内容，不超过60字", "media": "附带图片或视频的简短描述，如 [视频 0:43] …，没有就空字符串", "img": "有图片或视频时，用英文 danbooru tag 写出画面本身给 NovelAI 出图：只写画面里的人物、动作、场景、光线、构图；视频就写其中一帧的画面。不要写 video、screenshot、ui、border、frame、play button、text 这类会画出播放器或截图边框的词。人物都是成年人，写 adult 相关 tag。没有图就空字符串", "note": "{{char}}的反应", "nsfw": true或false}]}}  // items 10-14条`,
    ].join('\n');
    const data = await callAI(instr, '正在偷看浏览记录…', false, false);
    if (!data) return;
    const g = data.xlog || data;
    const items = Array.isArray(g.items) ? g.items : Array.isArray(g.history) ? g.history : null;
    if (!items) { lastRaw = JSON.stringify(data).slice(0, 4000); toast('AI 返回的格式不对，再试一次（原文在设置页最下面）', 'error'); return; }
    const old = chat.xlog?.items || [];
    chat.xlog = {
      asOf: dayLabel(sd.m, sd.d),
      searches: [...new Set([...(Array.isArray(g.searches) ? g.searches : []).map(String), ...(add ? chat.xlog?.searches || [] : [])])].slice(0, 8),
      items: [
        ...items.filter((x) => x && (x.text || x.media)).slice(0, capN(16)).map((x) => ({
          id: uid(), time: String(x.time || ''), kind: X_KINDS[x.kind] ? x.kind : '浏览', author: String(x.author || '匿名'), handle: String(x.handle || ''),
          text: String(x.text || ''), media: String(x.media || ''), img: String(x.img || ''), pic: '', note: String(x.note || ''), nsfw: x.nsfw !== false, saved: x.kind === '收藏',
        })),
        // 只新增：以前的全留着；换一批：只留收藏过的。都沉在最下面
        ...(add ? old.slice(0, 60) : old.filter((x) => x.saved).slice(0, 10)).map((x) => ({ ...x, time: x.time.startsWith('更早') ? x.time : `更早 · ${x.time}` })),
      ],
    };
    view.xOpen = {};
    saveChat();
    render();
  }

  function noteDetail(n) {
    const [g1, g2] = CAT_GRAD[n.cat] || CAT_GRAD['生活'];
    const comments = n.comments
      ? n.comments.map((c, i) => `<div class="xsj-cmt" data-hold="cmt:${i}"><i>${esc([...c.name][0] || '?')}</i><div><small>${esc(c.name)}</small><div>${esc(c.text)}</div></div><em>♡ ${fmtLikes(c.likes)}</em></div>`).join('') +
        `<button data-act="comments" class="xsj-regen">↻ 换一批评论</button>`
      : `<button data-act="comments" class="xsj-primary xsj-block">💬 看看评论区</button>`;
    return `
      ${view.drawing?.id === n.id ? drawingBox(n.id, 'xsj-drawing-cover xsj-drawing-big') : n.pic
        ? `<img class="xsj-cover xsj-cover-big xsj-cover-img" src="${esc(n.pic)}" alt="">`
        : `<div class="xsj-cover xsj-cover-big" style="background:linear-gradient(160deg,${g1},${g2})"><span>${esc(n.emoji)}</span></div>`}
      <div class="xsj-row2 xsj-note-acts"><button class="xsj-xdraw" data-act="quote" data-kind="note" data-id="${n.id}">📎 引用到回复</button></div>
      <div class="xsj-note-f xsj-note-author"><i style="background:${g2}">${esc([...n.author][0] || '?')}</i><span>${esc(n.author)}</span><em>${esc(n.cat)}</em></div>
      <h4 class="xsj-note-h">${esc(n.title)}</h4>
      <div class="xsj-note-text">${esc(n.text)}</div>
      ${n.tags.length ? `<div class="xsj-note-tags">${n.tags.map((t) => `#${esc(String(t).replace(/^#/, ''))}`).join(' ')}</div>` : ''}
      <div class="xsj-note-stat">♡ ${fmtLikes(n.likes)}　☆ ${fmtLikes(Math.round(n.likes / 3))}</div>
      <div class="xsj-sub">评论</div>
      ${comments}`;
  }

  // 日历自己的设置：日程页右上角进来
  function calSettings() {
    const sd = detectStoryDate();
    return `
      <div class="xsj-caltop"><button data-act="back" class="bk" title="返回日程"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4.5 7.5 12l7.5 7.5"/></svg></button><h2>日历设置</h2></div>
      <div class="xsj-card xsj-set">
        <div class="xsj-set-h">📆 剧情日期</div>
        <div class="xsj-set-row"><span>现在用的</span><small>${sd.from === 'chat' ? `${sd.y}-${pad(sd.m)}-${pad(sd.d)}（聊天里认出的）` : '没认出，用现实日期'}</small></div>
        <input data-set="dateOverride" placeholder="手动指定，如 1996-11-09，留空自动" value="${esc(chat.dateOverride)}">
      </div>

      <div class="xsj-card xsj-set">
        <div class="xsj-set-h">📅 日期写法 <small>只管这个聊天</small></div>
        <div class="xsj-seg">${[['auto', '自动'], ['num', '11月25日'], ['cn', '冬月廿五']].map(([v, t]) => `<button data-calstyle="${v}" class="${(chat.calStyle || 'auto') === v ? 'on' : ''}">${t}</button>`).join('')}</div>
        <small class="xsj-set-tip">自动：剧情写「八月初一」就用中式，写「8月1日」就用数字，现在是${isCn() ? '中式' : '数字'}。只换写法，不换算农历。</small>
      </div>

      <div class="xsj-card xsj-set">
        <div class="xsj-set-h">🎂 生日和纪念日 <small>每年固定显示</small></div>
        ${chat.birthdays.length
          ? chat.birthdays.slice().sort((a, b) => a.md.localeCompare(b.md)).map((b) => `<div class="xsj-fixed"><span>${b.kind === '纪念日' ? '💝' : '🎂'} ${esc(b.who)}</span><em>${esc(dayLabel(+b.md.split('-')[0], +b.md.split('-')[1]))}${b.manual ? ' · 自记' : b.fromNpc ? ' · 人物图鉴' : ''}</em></div>`).join('')
          : `<small class="xsj-set-tip">${chat.birthdaysDone ? '设定里没找到写明日期的，可以在日历点「＋」选「生日」自己加' : '第一次生成日历时会找一次，之后固定'}</small>`}
        <button data-act="regen-bd" class="xsj-regen">↻ 重新从设定里找（保留自记）</button>
      </div>

      <div class="xsj-card xsj-set">
        <div class="xsj-set-h">📅 注入本周日程</div>
        <label class="xsj-check"><input type="checkbox" data-set="weekInject" ${settings.weekInject ? 'checked' : ''}> 回复时把接下来 7 天的安排悄悄给 AI</label>
        ${(() => {
          const wt = weekText();
          if (!wt) return '<small class="xsj-set-tip">接下来 7 天还没有安排，先生成这个月的日程。</small>';
          return `<small class="xsj-set-tip">${settings.weekInject ? '现在每次回复都会附上：' : '打开后每次回复会附上：'}（约 ${wt.length} 字，不写进聊天记录）</small><pre class="xsj-weekpre">${esc(wt)}</pre><small class="xsj-set-tip">日期不对的话，在上面「剧情日期」手动填。</small>`;
        })()}
      </div>

      ${promptCard('cal')}`;
  }
  const calPreview = () => buildInstr(withFirstParts(['schedule', 'holidays']), view.month);
  const promptPreview = (set) => (PROMPT_SETS[set].preview || calPreview)();
  function promptCard(set) {
    const S = PROMPT_SETS[set], draw = S.draw || [];
    const row = ([k, [n]]) => `<details class="xsj-cp" data-cpk="${k}"${view.cpOpen === k ? ' open' : ''}><summary>${n}<em>${ownPrompt(set, k) ? '改过' : ''}</em></summary><textarea data-cp="${k}" data-cps="${set}" rows="6">${esc(promptOf(set, k))}</textarea><button data-act="cp-reset" data-k="${k}" data-cps="${set}" class="xsj-regen">恢复默认</button></details>`;
    const all = Object.entries(S.defs());
    const books = S.chat === false ? '打开的世界书全部条目、你的人设、角色卡（不带聊天）' : set !== 'cal' && !S.light ? '打开的世界书全部条目、你的人设、角色卡、最近 8 条聊天' : '打开的世界书、你的人设、角色卡、最近 8 条聊天';
    return `<div class="xsj-card xsj-set">
        <div class="xsj-set-h">📝 ${'发给 AI '}的 prompt <small>${set === 'dex' ? `现在这套：${DEX_ERAS[dexEra()][0]}；` : ''}改完点别处就存，所有聊天共用</small></div>
        ${all.filter(([k]) => !draw.includes(k)).map(row).join('')}
        <details class="xsj-cp"><summary>看${set === 'ev' ? '掷骰子' : '点 ✦ '}时完整发出去的内容</summary><small class="xsj-set-tip">${S.alone ? S.alone + '。' : `前面还会带：${books}。下面这段跟在最后；`}${S.has || set === 'npc' ? S.has || '已有的人、日期' : set === 'dex' ? '已收录的东西、日期' : set === 'map' ? '已有的地点、坐标' : set === 'ev' ? '骰子掷出的、你选的、已有的剧情' : '月份、日期'}和 JSON 格式由程序填，不能改。</small><pre class="xsj-weekpre" data-cppre>${esc(promptPreview(set))}</pre></details>
      </div>${draw.length ? `
      <div class="xsj-card xsj-set">
        <div class="xsj-set-h">🖼 ${S.drawT}</div>
        ${all.filter(([k]) => draw.includes(k)).map(row).join('')}
      </div>` : ''}`;
  }
  const ICO = { back: 'M15 4.5 7.5 12l7.5 7.5', img: 'M5 4.500h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zM3.500 17l5-5.500 4 4.500 3-3 5 4.500M15.500 8a1.300 1.300 0 1 0 0 2.600 1.300 1.300 0 0 0 0-2.600z', stop: 'M7 7h10v10H7z', gen: 'M11 4c.9 4.800 2.700 6.600 7.500 7.500-4.800.9-6.600 2.700-7.500 7.500-.9-4.800-2.700-6.600-7.500-7.500C8.300 10.600 10.100 8.800 11 4zM18.500 3c.3 1.600.9 2.200 2.500 2.500-1.600.3-2.200.9-2.500 2.500-.3-1.600-.9-2.200-2.500-2.500 1.600-.3 2.200-.9 2.500-2.500z', set: 'M4 7h8M18 7h2M4 17h2M12 17h8M15 4.500a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5zM9 14.500a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5z' };
  const ico = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICO[k]}"/></svg>`;
  const topBtn = (act, k, title, line, extra = '') => `<button data-act="${act}"${extra} class="gen${line ? ' set' : ''}" title="${title}">${ico(k)}</button>`;
  const topBar = (cls, h, small, btns = '') => `<div class="xsj-caltop ${cls}"><button data-act="back" class="bk" title="返回">${ico('back')}</button><h2>${esc(h)}${small ? `<small>${esc(small)}</small>` : ''}</h2>${btns}</div>`;
  // 小红书、百科、蓝星：三颗键 + 设置
  function appTop() {
    const t = view.tab, head = (...a) => topBar(`is-${t}`, ...a);
    const name = { mon: '小红书', wiki: appTitle('wiki'), dream: appTitle('dream') }[t];
    if (view.appSet) return head(`${name}设置`, '');
    const stop = view.batch ? topBtn('cancel-gen', 'stop', '停止生图') : '', set = topBtn('app-set', 'set', `${name}设置`, true);
    const one = (x, act, has = true) => (has && view.drawing?.id !== x.id ? topBtn(act, 'img', x.pic ? '重画这张图' : '画这张图', true) : '');
    if (t === 'mon') {
      const md = monthData(view.month), n = notesFor(md).items.find((x) => x.id === view.note);
      if (n) return head('笔记', n.author, (stop || one(n, 'note-pic')) + topBtn('comments', 'gen', n.comments ? '换一批评论' : '看看评论区') + set);
      const any = notesFor(md).items.length;
      return head(name, ownerName(), (stop || (any ? topBtn('note-pic-all', 'img', '给还没封面的帖子一键生图', true) : '')) + topBtn('gen', 'gen', any ? '刷新小红书' : '生成小红书', false, ' data-parts="season,notes"') + set);
    }
    if (t === 'wiki') {
      const w = codex().wiki, x = w.items.find((o) => o.id === view.wiki);
      if (x) return head(name, x.cat, (stop || one(x, 'wiki-pic')) + set);
      return head(name, w.items.length ? `${w.items.length} 条` : ownerName(), (stop || (w.items.length ? topBtn('wiki-pic-all', 'img', '给还没配图的条目一键生图', true) : '')) + topBtn('gen-wiki', 'gen', w.items.length ? '再补充几条' : '编写百科') + set);
    }
    const D0 = codex().dream, p = D0.items.find((o) => o.id === view.dream);
    if (p) return head('帖子', p.author, (stop || one(p, 'dream-pic', !!(p.img || p.imgDesc))) + set);
    return head(name, D0.platform || ownerName(), (stop || (D0.items.length ? topBtn('dream-pic-all', 'img', '给带图的帖子一键生图', true) : '')) + topBtn('gen-dream', 'gen', D0.items.length ? '刷新' : '上线看看') + set);
  }
  // 物品图鉴顶上一行
  function dexTop() {
    const d = codex().dex, x = d.items.find((o) => o.id === view.dex), head = (...a) => topBar('is-dex', ...a);
    if (view.dexSet) return head('图鉴设置', '');
    const stop = view.batch ? topBtn('cancel-gen', 'stop', '停止生图') : '', set = topBtn('dex-set', 'set', '物品图鉴设置', true);
    if (x) return head(`No.${pad3(x.no)}`, x.found ? x.name : '还没遇到', (x.found ? stop || (view.drawing?.id === x.id ? '' : topBtn('dex-pic', 'img', x.pic ? '重画这一张' : '画出来', true)) : '') + (x.found && !x.desc ? topBtn('dex-fill', 'gen', '补全说明') : '') + set);
    return head(appTitle('dex'), ownerName(), (stop || topBtn('dex-pic-all', 'img', '给已发现、还没图的一键生图', true)) + topBtn('gen-dex', 'gen', '从世界书和剧情收集') + set);
  }
  // 人物图鉴顶上一行：返回、标题、生图 / 生成 / 设置
  function npcTop() {
    const N = npcData(), p = N.items.find((x) => x.id === view.npc);
    const b = (act, k, title, line) => `<button data-act="${act}" class="gen${line ? ' set' : ''}" title="${title}">${ico(k)}</button>`;
    const head = (h, small, btns = '') => `<div class="xsj-caltop is-npc"><button data-act="back" class="bk" title="返回">${ico('back')}</button><h2>${esc(h)}${small ? `<small>${esc(small)}</small>` : ''}</h2>${btns}</div>`;
    if (view.npcSet) return head('图鉴设置', '');
    const stop = view.batch ? b('cancel-gen', 'stop', '停止生图') : '', set = b('npc-set', 'set', '人物图鉴设置', true);
    if (p) return head('人物档案', p.met ? '' : '还没见过', (p.met ? stop || (view.drawing?.id === p.id ? '' : b('npc-pic', 'img', p.pic ? '重画这张画像' : '画这个人的画像', true)) : '') + (p.met && !(p.facts || []).length ? b('npc-fill', 'gen', '补全这张卡') : '') + set);
    const met = N.items.filter((x) => x.met).length, rest = N.items.length - met;
    return head(appTitle('npc'), N.items.length ? `认识 ${met} 人${rest ? ` · ${rest} 人没见过` : ''}` : ownerName(), (stop || b('npc-pic-all', 'img', '给见过、还没画像的人一键生图', true)) + b('gen-npc', 'gen', '从世界书和剧情整理人物') + set);
  }
  function settingsView() {
    const profs = settings.apiProfiles, act = settings.apiActive;
    const ed = view.apiEdit != null && profs[view.apiEdit] ? { ...profs[view.apiEdit], ...(view.apiDraft || {}) } : null;
    const chips = (attr, cur, list) => `<div class="xsj-seg">${list.map(([v, t]) => `<button data-${attr}="${v}" class="${cur === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    return `${updCard()}
      <div class="xsj-card xsj-set">
        <div class="xsj-set-h">🖼 外观</div>
        <div class="xsj-set-row"><span>玻璃颜色</span>${chips('glass', settings.glass || 'auto', [['auto', '自动'], ['light', '浅色'], ['dark', '深色']])}</div>
        ${(settings.glass || 'auto') === 'auto' && settings.wallpaper ? `<small class="xsj-set-tip">按壁纸明暗自动选择，现在是${settings.wpTone === 'dark' ? '深色' : '浅色'}</small>` : ''}
        <div class="xsj-wpset-in">
          <div class="xsj-wpthumb"${settings.wallpaper ? ` style="background-image:url('${esc(settings.wallpaper)}')"` : ''}>${settings.wallpaper ? '' : '默认'}</div>
          <div class="xsj-wpbtns">
            <label class="xsj-primary xsj-upload">上传壁纸<input type="file" accept="image/*" id="xsj-wp-file" hidden></label>
            ${settings.wallpaper ? '<button data-act="wp-clear" class="xsj-regen">恢复默认</button>' : ''}
          </div>
        </div>
        <input id="xsj-wp-desc" placeholder="用 NovelAI 画：想要的画面（可选）">
        <div class="xsj-set-row">
          <label class="xsj-check"><input type="checkbox" id="xsj-wp-char"> 画进 ${esc(charKey())}</label>
          <button data-act="wp-draw" class="xsj-primary xsj-nowrap">🎨 画一张</button>
        </div>
      </div>

      <div class="xsj-card xsj-set">
        <div class="xsj-set-h">📱 这部手机</div>
        <div class="xsj-set-row"><span>谁的手机</span>${chips('owner', settings.owner, [['char', '角色'], ['user', '我']])}</div>
      </div>

      <div class="xsj-card xsj-set">
        <div class="xsj-set-h">🔌 生成用的 API</div>
        <div class="xsj-profs">
          <button data-act="use-api" data-i="-1" class="xsj-prof${act < 0 ? ' on' : ''}">${act < 0 ? '✓ ' : ''}跟随主 API</button>
          ${profs.map((pr, i) => `<button data-act="use-api" data-i="${i}" class="xsj-prof${act === i ? ' on' : ''}${view.apiEdit === i ? ' open' : ''}">${act === i ? '✓ ' : ''}${esc(pr.name)}${pr.url ? '' : ' <i>空</i>'}</button>`).join('')}
          <button data-act="add-api" class="xsj-prof xsj-prof-add" title="新建方案">＋</button>
        </div>
        <small class="xsj-set-tip">${act < 0 ? '现在用酒馆当前连接的 API。' : `现在用「${esc(profs[act].name)}」${profs[act].model ? ' · ' + esc(profs[act].model) : ''}。`}点方案切换并打开编辑，再点一下收起。</small>
        ${ed ? `<div class="xsj-apied">
          <input data-ap="name" placeholder="方案名字" value="${esc(ed.name)}">
          <div class="xsj-row2"><input data-ap="url" placeholder="地址，如 https://xxx/v1" value="${esc(ed.url)}" autocomplete="off" autocapitalize="off" spellcheck="false"><button data-act="paste" data-for="url" class="xsj-nowrap" title="粘贴">📋</button></div>
          <div class="xsj-row2"><input data-ap="key" type="text" class="xsj-secret" placeholder="Key" value="${esc(ed.key)}" autocomplete="off" autocapitalize="off" spellcheck="false"><button data-act="peek" class="xsj-nowrap" title="显示/隐藏">👁</button><button data-act="paste" data-for="key" class="xsj-nowrap" title="粘贴">📋</button></div>
          <div class="xsj-row2"><input data-ap="model" placeholder="模型名（手填，或获取后点选）" value="${esc(ed.model)}" autocomplete="off" autocapitalize="off" spellcheck="false"><button data-act="models" class="xsj-nowrap">${view.apiBusy ? '获取中…' : '获取模型'}</button></div>
          ${view.apiModels ? `<div class="xsj-models">
            <input data-ap="filter" placeholder="搜索 ${view.apiModels.length} 个模型" autocomplete="off" autocapitalize="off" spellcheck="false">
            <div class="xsj-mlist">${view.apiModels.map((m) => `<button data-act="pick-model" data-m="${esc(m)}" class="${m === ed.model ? 'on' : ''}">${esc(m)}</button>`).join('') || '<small class="xsj-set-tip">没有拿到模型名，请手填。</small>'}</div>
          </div>` : ''}
          <div class="xsj-row2"><button data-act="del-api" class="xsj-danger">${view.apiDel ? '再点一次删除' : '删除方案'}</button><span><button data-act="close-api">收起</button><button data-act="save-api" class="xsj-primary">保存并使用</button></span></div>
          <small class="xsj-set-tip">Key 只存在这台设备的酒馆设置里，不会写进聊天。</small>
        </div>` : ''}
      </div>
      ${lastRaw ? `<details class="xsj-raw"><summary>上次没解析成功的 AI 返回（排查用）</summary><pre>${esc(lastRaw)}</pre></details>` : ''}`;
  }

  // 右上角按钮（小红书、百科、手记、委托、蓝星online）：有能一键生图的就放 🖼，再放 ↻ 生成/刷新；生图中变成 ⏹
  function headButtons() {
    const btn = (act, icon, title, extra = '') => `<button data-act="${act}"${extra} class="xsj-exit${icon === '↻' ? '' : ' xsj-headbtn'}" title="${title}">${icon}</button>`;
    const tabs = ['mon', 'wiki', 'dream'];
    if (!tabs.includes(view.tab)) return '';
    if (view.batch) return btn('cancel-gen', '⏹', '停止生图');
    if (view.tab === 'mon') {
      if (view.note) return '';
      const nb = notesFor(monthData(view.month));
      if (!nb.items.length && !monthData(view.month).season) return '';
      return (nb.items.some((n) => !n.pic) ? btn('note-pic-all', '🖼', '给还没封面的帖子一键生图') : '') + btn('gen', '↻', '刷新小红书', ' data-parts="season,notes"');
    }
    if (view.tab === 'wiki') {
      const w = codex().wiki;
      if (view.wiki || !w.items.length) return '';
      return (w.items.some((x) => !x.pic) ? btn('wiki-pic-all', '🖼', '给还没配图的条目一键生图') : '') + btn('gen-wiki', '↻', '再补充几条');
    }
    if (view.tab === 'dream') {
      const D0 = codex().dream;
      if (view.dream || !D0.items.length) return '';
      return (D0.items.some((p) => (p.img || p.imgDesc) && !p.pic) ? btn('dream-pic-all', '🖼', '给带图的帖子一键生图') : '') + btn('gen-dream', '↻', '刷新');
    }
    return '';
  }
  // 一键生图的通用流程：先问，再一张张画，可以中途停
  async function batchDraw(todo, fn, what) {
    if (!todo.length) { toast('都有图了', 'info'); return; }
    if (!(await ask(`给还没图的 ${todo.length} ${what}一张张画出来？中途可以停，画好的会留着。`, `画 ${todo.length} 张`))) return;
    batchStop = false;
    let done = 0;
    for (const [i, x] of todo.entries()) {
      if (batchStop) break;
      view.batch = `${i + 1}/${todo.length}`;
      if (await fn(x, `一键生图 ${i + 1}/${todo.length}`)) done++;
      else if (batchStop) break;
    }
    toast(batchStop ? `已停止，画好了 ${done} 张` : `画好了 ${done}/${todo.length} 张`, done ? 'success' : 'warning');
    batchStop = false; view.batch = null; render();
  }

  function render() {
    const root = D.getElementById(ROOT_ID);
    if (!root) return;
    const [y, m] = view.month.split('-').map(Number);
    if (!APPS.some((a) => a.k === view.tab)) view.tab = 'home';
    const home = view.tab === 'home';
    const titles = { cal: '日程', map: '地图', ev: '随机剧情', mon: '小红书', x: 'X', set: '设置', dex: appTitle('dex'), wiki: appTitle('wiki'), dream: appTitle('dream'), npc: appTitle('npc'), closet: '衣橱', pic: '生图' };
    const body = { home: homeView, cal: calView, map: mapView, ev: eventsView, mon: () => appTop() + (view.appSet ? promptCard('mon') : monthView()), x: xView, set: settingsView, dex: dexView, wiki: () => appTop() + (view.appSet ? promptCard('wiki') : wikiView()), dream: () => appTop() + (view.appSet ? promptCard('dream') : dreamView()), npc: npcView, closet: closetView }[view.tab]();
    const busy = view.busy && !(view.evRolling && view.tab === 'ev') ? `<div class="xsj-busy"><div class="xsj-spin"></div><div>${esc(view.busy)}</div><button data-act="cancel-gen">取消</button></div>` : '';
    const scr = root.querySelector('.xsj-screen');
    scr.classList.toggle('has-wp', !!settings.wallpaper);
    scr.classList.toggle('tone-dark', glassTone() === 'dark');
    // 小红书和 X 像真的 App 一样整屏实心底色，不透壁纸
    scr.classList.toggle('app-white', view.tab === 'x' || view.tab === 'mon' || view.tab === 'dream' || view.tab === 'npc');
    // 图鉴是深色游戏界面，手记是皮革底上的卷轴
    for (const k of ['mon', 'wiki', 'dream', 'closet', 'pic']) scr.classList.toggle(`app-${k}`, view.tab === k);
    scr.classList.toggle('app-ev', view.tab === 'ev');
    scr.classList.toggle('app-map', view.tab === 'map');
    scr.classList.toggle('app-npc', view.tab === 'npc');
    const dexBlank = view.tab === 'dex' && !view.dexSet && !codex().dex.items.length;
    scr.classList.toggle('app-dex', view.tab === 'dex' && !dexBlank);
    scr.classList.toggle('app-dexb', dexBlank);
    if (dexBlank) scr.classList.add('app-white');
    if (settings.wallpaper && !settings.wpTone) measureTone();
    if (settings.wallpaper) scr.style.setProperty('--xsj-wp', `url("${settings.wallpaper.replace(/"/g, '%22')}")`);
    else scr.style.removeProperty('--xsj-wp');
    const isMap = view.tab === 'map';
    const codexTab = ['dex', 'wiki', 'dream', 'npc', 'closet', 'pic'].includes(view.tab);
    // 人物图鉴列表：右上角一键生图、从剧情更新
    const isWorld = isMap && view.mapLevel === 'world';
    const dexHead = view.tab === 'dex' && !view.dex && codex().dex.items.length
      ? (view.batch ? '<button data-act="cancel-gen" class="xsj-exit xsj-headbtn" title="停止生图">⏹</button>'
        : (codex().dex.items.some((x) => x.found && !x.pic) ? '<button data-act="dex-pic-all" class="xsj-exit xsj-headbtn" title="给已发现、还没图的一键生图">🖼</button>' : '') + '<button data-act="gen-dex" class="xsj-exit" title="从剧情更新">↻</button>')
      : '';
    const mapHead2 = isWorld ? !!currentWorld() : isMap && currentMap() && !view.mapEdit;
    const worldHead = isWorld && currentWorld() ? (view.drawing?.id === 'world-bg' ? '' : '<button data-act="world-pics" class="xsj-exit xsj-headbtn" title="画世界地图的大背景">🖼</button>') + '<button data-act="gen-world" class="xsj-exit" title="更新世界地图">↻</button>' : '';
    const npcHead = view.tab === 'npc' && !view.npc && !view.lookEdit && view.npcTab !== 'looks' && npcData().items.length
      ? (view.batch ? `<button data-act="cancel-gen" class="xsj-exit xsj-headbtn" title="停止生图">⏹</button>`
        : `<button data-act="npc-pic-all" class="xsj-exit xsj-headbtn" title="给见过、还没画像的人一键生图">🖼</button><button data-act="gen-npc" class="xsj-exit" title="从剧情更新人物图鉴">↻</button>`)
      : '';
    // 日程：上月/下月挪到日历上面，右上角是一键生成
    const isCal = view.tab === 'cal';
    const isEv = view.tab === 'ev';
    const noNav = isMap || view.tab === 'x' || codexTab || isCal || isEv || view.tab === 'mon' || view.tab === 'set';
    const appHead = headButtons();
    const evHead = '';
    const calHead = '';
    const sub = isMap ? `${esc(isWorld ? currentWorld()?.name || '还没有世界地图' : currentMap()?.name || '还没有地图')} · ${esc(charKey())}`
      : view.tab === 'x' ? `${esc(charKey())} 的浏览记录`
      : codexTab || isEv || view.tab === 'mon' || view.tab === 'set' ? esc(ownerName())
      : `${esc(yearName(y))} ${esc(monthName(m))} · ${esc(ownerName())}`;
    // 同一页重画时保持滚动位置（保存、切方案、出图进度都会重画，不要跳回最上面）
    const pageKey = [view.tab, view.calSet ? 'calset' : '', view.npcSet ? 'npcset' : '', view.dexSet ? 'dexset' : '', view.mapSet ? 'mapset' : '', view.evSet ? 'evset' : '', view.appSet ? 'appset' : '', view.tab === 'closet' ? [view.closetOpen, view.closetWho, view.closetItem, view.closetSet, view.closetTab].join('/') : '', view.month, view.note || '', view.place || '', view.xTab || '', view.dex || '', view.wiki || '', view.dream || '', view.npc || '', view.npcTab || '', view.picTab || '', view.picSet ? 'picset' : '', view.lookEdit ? `look${view.lookEdit.id}` : '', view.shotEdit?.sid || '', view.styleEdit ? 'style' : ''].join('|');
    const oldBody = root.querySelector('.xsj-body');
    const bodyTop = oldBody && root.dataset.page === pageKey ? oldBody.scrollTop : 0;
    const prevScroll = root.querySelector('.xsj-mapwrap');
    const keep = prevScroll ? [prevScroll.scrollLeft, prevScroll.scrollTop] : null;
    root.querySelector('.xsj-screen').innerHTML = `
      ${statusBar()}
      ${home || isCal || view.tab === 'npc' || view.tab === 'dex' || isMap || view.tab === 'ev' || ['mon', 'wiki', 'dream', 'closet', 'pic'].includes(view.tab) || (view.tab === 'x' && chat.xlog?.items?.length) ? '' : `<div class="xsj-head${npcHead || mapHead2 || dexHead || appHead.includes('xsj-headbtn') ? ' xsj-head2' : ''}">
        <span class="xsj-headside"><button data-act="back" class="xsj-exit" title="返回上一层">‹</button>${noNav ? '' : '<button data-act="prev" class="xsj-mnav">上月</button>'}</span>
        <div><b>${titles[view.tab]}</b><small>${sub}</small></div>
        <span class="xsj-headside xsj-headr">${npcHead || dexHead || calHead || evHead || worldHead || appHead || (noNav ? (isMap && !isWorld && currentMap() && !view.mapEdit ? (view.batch || view.drawing?.id === 'map-bg' ? '' : '<button data-act="map-pics" class="xsj-exit xsj-headbtn" title="生图：整张地图背景、区域背景、地点图">🖼</button>') + '<button data-act="gen-map" class="xsj-exit" title="重新生成地图（保留自己加的和挪过的地点）">↻</button>' : '') : '<button data-act="next" class="xsj-mnav">下月</button>')}</span>
      </div>`}
      <div class="xsj-body${isMap ? ' xsj-body-map' : ''}${view.tab === 'x' ? ' xsj-body-x' : ''}${home ? ' xsj-body-home' : ''}">${body}</div>
      ${home ? '' : '<button class="xsj-homebar" data-act="home" title="回到桌面"><i></i></button>'}
      ${busy}`;
    const wrap = root.querySelector('.xsj-mapwrap');
    if (wrap && keep && isMap) { wrap.scrollLeft = keep[0]; wrap.scrollTop = keep[1]; }
    root.dataset.page = pageKey;
    if (bodyTop) { const nb = root.querySelector('.xsj-body'); if (nb) nb.scrollTop = bodyTop; }
    if (isMap) fitPhone();
  }

  // ---------- 地图（按角色卡存，同一张卡的所有聊天共用） ----------
  const PLACE_TYPES = ['家', '学校', '公司', '店铺', '餐饮', '景点', '交通', '医院', '机构', '其他'];
  const REGION_COLORS = ['#ffe3ec', '#e3efff', '#e6f6e9', '#fff1d9', '#efe6ff', '#dff4f4', '#fde7dd', '#f0f0e0'];
  function charKey() { try { return getCurrentCharacterName() || '未选角色'; } catch (e) { return '未选角色'; } }
  function currentMap() { return (settings.maps || {})[charKey()] || null; }
  function saveMap(mp) { settings.maps = { ...(settings.maps || {}), [charKey()]: mp }; saveSettings(settings); }

  // 从最新一条 AI 回复里找当前地点：[地点|…]、地点：…、<location>…</location>
  function detectLocation() {
    try {
      const last = getLastMessageId();
      const msgs = getChatMessages(`${Math.max(0, last - 6)}-${last}`) || [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') continue;
        const t = String(msgs[i].message || '');
        const m = t.match(/\[(?:地点|位置|Location|Place)\s*[|｜:：]\s*([^\]]+)\]/i) || t.match(/<location>([\s\S]*?)<\/location>/i) || t.match(/(?:^|\n)\s*(?:📍\s*)?(?:地点|位置)\s*[:：]\s*([^\n|｜]+)/);
        if (m) return m[1].replace(/<[^>]+>/g, '').trim();
      }
    } catch (e) {}
    return '';
  }
  // 地点名和定位文字互相包含、或按 · / 及 切开后有一段能对上
  function matchPlace(mp, loc) {
    if (!mp || !loc) return null;
    const parts = loc.split(/[·・\/、，,及与和\s]+/).map((s) => s.trim()).filter((s) => s.length >= 2);
    let best = null;
    for (const p of mp.places) {
      const n = p.name;
      const hit = loc.includes(n) || n.includes(loc) || parts.some((s) => n.includes(s) || s.includes(n));
      if (hit && (!best || n.length > best.name.length)) best = p;
    }
    return best;
  }

  const MAP_PROMPTS = {
    open: ['开场', CAL_PROMPTS.open[1]],
    base: ['总要求', CAL_PROMPTS.base[1]],
    task: ["地图：任务","任务：画出故事主要发生的那片地方的简易地图（通常是一座城市或一个片区；如果世界很大，只画主线所在的城市）。"],
    rules: ["地图：规则","规则：地点优先来自世界书、角色卡和剧情里出现过的；可以补充少量符合世界观的日常地点（车站、便利店、医院等）。主要角色的住处、工作或学习的地方要有。区域之间尽量不重叠，地点坐标落在所属区域的方框里，彼此至少隔6个单位。"],
    fog: ["打听消息：任务","给出 3-5 个这个世界里确实存在、但主角们还没去过的地方，作为“听说过、没去过”的传闻。"],
    fogRules: ["打听消息：规则","规则：符合世界书设定和年代；不要和已有地点重名，也不要换个说法重复；要有让人想去的理由（资源、危险、秘密、人情）。"],
    wTask: ["世界：任务","任务：画出这个故事所在世界的世界大地图：各片大陆、国度、荒野、海岛和重要地点。"],
    wRules: ["世界：规则","硬性规则：只用世界书和设定里这个虚构世界自己的地理和地名；禁止出现、影射或照抄任何现实世界的地图——不要用现实里的国家、城市、大洲、海洋、山脉的名字，也不要照着现实的海岸线和版图来摆。设定里没写到的地方，按世界观编虚构的名字。如果故事本身发生在现实城市里，也只画这个故事里虚构出来的世界层面（比如异世界、势力范围），实在没有就编一个贴合世界观的虚构世界。"],
    wKnown: ["世界：去过没去过","known：主角们已经去过、住过，或者这个世界里人人都知道的地方是 true；远方的、传说里的、还没人去过的是 false，并给一句不剧透的传闻 hint（如“商队说那边的沙子夜里会唱歌”）。剧情现在所在的地方一定是 known。"],
    pMap: ["整张地图的大背景","no humans, scenery, aerial view, from above, bird's-eye view, wide landscape, whole area, detailed background, atmospheric lighting, full frame"],
    pRegion: ["区域背景","no humans, scenery, aerial view, from above, wide shot, detailed background, atmospheric lighting, full frame"],
    pPlace: ["地点图（地点类型的词后面）","detailed background, atmospheric lighting, full frame"],
    pWorld: ["世界大背景","no humans, scenery, fantasy world, aerial view, from above, satellite view, vast landscape, continents, ocean, clouds, detailed, no text"],
  };
  const mapPrompt = (k) => promptOf('map', k).replace(/\s*\n\s*/g, ' ');
  // 地图顶上一行
  function mapTop() {
    const head = (...a) => topBar('is-map', ...a), world = view.mapLevel === 'world';
    if (view.mapSet) return head('地图设置', '');
    const has = world ? currentWorld() : currentMap(), bg = view.drawing?.id === (world ? 'world-bg' : 'map-bg');
    if (!world && view.mapEdit) return head('编辑地图', has?.name || '');
    const set = topBtn('map-set', 'set', '地图设置', true);
    const img = view.batch ? topBtn('cancel-gen', 'stop', '停止生图') : has && !bg ? topBtn(world ? 'world-pics' : 'map-pics', 'img', world ? '画世界地图的大背景' : '生图：整张地图背景、区域背景、地点图', true) : '';
    return head(has?.name || (world ? '世界地图' : '地图'), charKey(), img + topBtn(world ? 'gen-world' : 'gen-map', 'gen', has ? '更新地图' : '生成地图') + set);
  }
  function mapView() {
    return mapTop() + (view.mapSet ? promptCard('map') : mapBody());
  }
  function mapBody() {
    if (view.mapLevel === 'world') return worldView();
    const mp = currentMap();
    if (!mp) return mapSwitch() + blank('map', '还没有地图', '读打开的世界书和最近剧情，画出故事主要发生的那片地方。生成一次就固定，同一张卡的所有聊天共用。', blankBtn('gen-map', '生成地图'));
    const loc = detectLocation();
    const here = matchPlace(mp, loc);
    // 剧情里的位置正好是一个还在迷雾里的地方：直接点亮
    if (here?.fog) { revealFog(here); saveMap(mp); toast(`🗺 发现新地点：${here.name}`, 'success'); }
    const zoom = view.mapZoom || 1;
    // 区域：底色 + 生成过的背景图（裁成区域的圆角方块）；点区域看说明、画背景
    if (mp.regions.some((r) => !r.id)) { mp.regions.forEach((r) => { if (!r.id) r.id = uid(); }); saveMap(mp); }
    const regions = mp.regions.map((r, i) => {
      const box = `x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"`;
      const drawing = view.drawing?.id === r.id;
      return `
      <g class="xsj-region${r.id === view.region ? ' is-sel' : ''}" data-region="${r.id}">
        <rect ${box} rx="5" fill="${esc(r.color || REGION_COLORS[i % REGION_COLORS.length])}" />
        ${r.pic && !drawing ? `<clipPath id="xsj-rc-${esc(r.id)}"><rect ${box} rx="5"/></clipPath><image href="${esc(r.pic)}" ${box} preserveAspectRatio="xMidYMid slice" clip-path="url(#xsj-rc-${esc(r.id)})" class="xsj-rimg" />` : ''}
        ${drawing ? `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2}" class="xsj-pin-e">⏳</text>` : ''}
        <rect ${box} rx="5" class="xsj-rframe" />
        <text x="${r.x + 2}" y="${r.y + 4.2}" class="xsj-rlabel${r.pic || mp.pic ? ' on-pic' : ''}">${esc(r.name)}</text>
      </g>`;
    }).join('');
    const pins = mp.places.map((p) => p.fog ? `
      <g class="xsj-pin is-fog${p.id === view.place ? ' is-sel' : ''}" data-place="${p.id}" transform="translate(${p.x} ${p.y}) scale(${(1 / zoom).toFixed(3)})">
        <circle r="5.6" class="xsj-fog-cloud" />
        <circle r="4.3" class="xsj-pin-bg" />
        <text class="xsj-pin-e xsj-fog-q" y="1.5">?</text>
        <text class="xsj-pin-n" y="7.8">？？？</text>
      </g>` : `
      <g class="xsj-pin${p.id === view.place ? ' is-sel' : ''}${here && p.id === here.id ? ' is-here' : ''}" data-place="${p.id}" transform="translate(${p.x} ${p.y}) scale(${(1 / zoom).toFixed(3)})">
        ${here && p.id === here.id ? '<circle r="6.4" class="xsj-pulse" />' : ''}
        <circle r="4.3" class="xsj-pin-bg" />
        ${p.pic && view.drawing?.id !== p.id
          ? `<image href="${esc(p.pic)}" x="-3.9" y="-3.9" width="7.8" height="7.8" preserveAspectRatio="xMidYMid slice" clip-path="url(#xsj-pinclip)" /><circle r="4.3" class="xsj-pin-ring" />`
          : `<text class="xsj-pin-e" y="1.5">${esc(view.drawing?.id === p.id ? '⏳' : p.emoji || '📍')}</text>`}
        <text class="xsj-pin-n" y="7.8">${esc(p.name)}</text>
      </g>`).join('');
    const sel = mp.places.find((p) => p.id === view.place);
    const selRegion = mp.regions.find((r) => r.id === view.region);
    const locLine = loc
      ? (here ? `<div class="xsj-loc">📍 你在这：<b>${esc(here.name)}</b><small>${esc(loc)}</small></div>`
        : `<div class="xsj-loc">📍 剧情里的位置：<b>${esc(loc)}</b><small>地图上没有对上的地点</small>${view.mapEdit ? '' : '<button data-act="add-here" class="xsj-mini">加到地图</button>'}</div>`)
      : '<div class="xsj-loc xsj-loc-none">最近的回复里没找到地点</div>';
    return `
      ${mapSwitch()}
      ${locLine}
      ${view.batch ? `<div class="xsj-hint" style="text-align:center">正在生图 ${view.batch}</div>` : ''}
      ${view.mapEdit ? '<div class="xsj-hint">拖动图钉换位置；点空白处添加地点；点图钉修改。</div>' : ''}
      <div class="xsj-mapframe${mp.pic ? ' has-bg' : ''}"><div class="xsj-mapwrap"><svg class="xsj-map${view.mapEdit ? ' is-edit' : ''}" viewBox="-3 -3 106 120" style="width:${zoom * 100}%;--z:${zoom}">
        <defs><clipPath id="xsj-pinclip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath><pattern id="xsj-grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#efe6dc" stroke-width=".25"/></pattern></defs>
        <rect x="-3" y="-3" width="106" height="120" fill="#fbf7f1"/>${mp.pic && view.drawing?.id !== 'map-bg' ? `<image href="${esc(mp.pic)}" x="-3" y="-3" width="106" height="120" preserveAspectRatio="xMidYMid slice" />` : '<rect x="-3" y="-3" width="106" height="120" fill="url(#xsj-grid)"/>'}
        ${view.drawing?.id === 'map-bg' ? '<text x="50" y="50" class="xsj-pin-e">⏳</text>' : ''}
        ${regions}${pins}
      </svg></div>
      <div class="xsj-mapctl"><button data-act="zoom-out" aria-label="缩小">－</button><button data-act="zoom-in" aria-label="放大">＋</button>${view.mapEdit ? '' : '<button data-act="gen-fog">🧭 打听消息</button>'}<button data-act="map-edit" class="${view.mapEdit ? 'on' : ''}">${view.mapEdit ? '✓ 完成' : '✏️ 编辑'}</button></div></div>
      ${sel ? placeCard(sel, mp) : selRegion && !view.mapEdit ? regionCard(selRegion, mp) : `<div class="xsj-hint">点图钉看地点，点区域看这片地方、画背景图。共 ${mp.regions.length} 个区域、${mp.places.filter((p) => !p.fog).length} 个地点${mp.places.some((p) => p.fog) ? `，还有 ${mp.places.filter((p) => p.fog).length} 个只听说过的地方（？）` : ''}。</div>`}`;
  }

  function regionCard(r, mp) {
    const drawing = view.drawing?.id === r.id;
    const inside = mp.places.filter((p) => p.region === r.name);
    return `
      <div class="xsj-place">
        ${drawing ? drawingBox(r.id, 'xsj-drawing-place') : r.pic ? `<img class="xsj-place-pic" src="${esc(r.pic)}" alt="">` : ''}
        <div class="xsj-place-top"><span class="xsj-place-e">🗺</span><div><b>${esc(r.name)}</b><small>区域 · ${inside.length} 个地点</small></div><button data-act="region-close" class="xsj-x">×</button></div>
        ${r.desc ? `<div>${esc(r.desc)}</div>` : ''}
        ${inside.length ? `<div class="xsj-place-v">📍 ${esc(inside.map((p) => p.name).join('、'))}</div>` : ''}
        ${(() => { const dx = dexForRegion(r, mp); return dx.length ? `<div class="xsj-sub">这片能遇到 · ${esc(appTitle('dex'))}</div>${dexLinks(dx)}` : ''; })()}
        ${drawing ? '' : `<button class="xsj-xdraw" data-act="region-pic">${r.pic ? '↻ 重画背景' : '🏞 画这片区域的背景'}</button>`}
      </div>`;
  }
  // ---------- 🌍 世界大地图：整个世界观的虚构大陆，没去过的地方盖着迷雾，剧情里说到就点亮 ----------
  // 存在扩展数据 settings.worlds[卡名] = { name, lands: [...], spots: [...], pic }
  // land = { id, name, terrain, x, y, w, h, desc, known, hint }（x/y 是中心点，w/h 是大小，坐标 0-100）
  // spot = { id, name, emoji, land, x, y, desc, known, hint }
  // 规则：只画世界书里的虚构世界，不出现、不照抄任何现实地理。
  const TERRAINS = { 森林: '#9cc59a', 草原: '#c9dd9a', 平原: '#e4dcb4', 沙漠: '#ecd39a', 雪原: '#e8f1f6', 山地: '#b9ab97', 沼泽: '#9fae86', 海岛: '#bfe0c8', 火山: '#c98e7e', 废土: '#c7b9a6', 城邦: '#e9d6c4', 浮空: '#d9d2f0' };
  function currentWorld() { return (settings.worlds || {})[charKey()] || null; }
  function saveWorld(w) { settings.worlds = { ...(settings.worlds || {}), [charKey()]: w }; saveSettings(settings); }
  // 用名字做种子，给每块陆地一条不规则、但每次都一样的海岸线
  function landPath(l) {
    let seed = hashN(l.id || l.name) || 1;
    const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
    const n = 22, pts = [];
    const bumps = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 0.98 + 0.12 * Math.sin(a * 3 + bumps[0]) + 0.08 * Math.sin(a * 5 + bumps[1]) + 0.06 * Math.sin(a * 2 + bumps[2]) + rnd() * 0.06;
      pts.push([l.x + Math.cos(a) * (l.w / 2) * k, l.y + Math.sin(a) * (l.h / 2) * k]);
    }
    // 平滑成曲线
    let d = '';
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      d += i === 0 ? `M${mx.toFixed(2)} ${my.toFixed(2)}` : '';
      const r = pts[(i + 1) % n], s2 = pts[(i + 2) % n];
      d += `Q${r[0].toFixed(2)} ${r[1].toFixed(2)} ${((r[0] + s2[0]) / 2).toFixed(2)} ${((r[1] + s2[1]) / 2).toFixed(2)}`;
    }
    return d + 'Z';
  }
  // 剧情里现在在哪：先对地点名，再对陆地名；本地小地图的名字也算
  function worldHere(w) {
    const loc = detectLocation() || '';
    const local = currentMap()?.name || '';
    const hit = (name) => !!name && ((loc && (loc.includes(name) || (loc.length >= 2 && name.includes(loc)))) || (!!local && (local === name || local.includes(name))));
    return w.spots.find((s) => s.known && hit(s.name)) || null;
  }
  function worldView() {
    const w = currentWorld();
    const sw = mapSwitch();
    if (!w) {
      return sw + blank('map', '还没有世界地图', '按世界书画出整个世界：各片大陆、王国、荒野和海。去过、听说过的地方是亮的，其余盖着迷雾，剧情里说到就会点亮。', blankBtn('gen-world', '生成世界地图'));
    }
    const zoom = view.mapZoom || 1;
    const here = worldHere(w);
    const lands = w.lands.map((l) => {
      const fill = l.known ? (TERRAINS[l.terrain] || '#e4dcb4') : '#cfd6dc';
      return `<g class="xsj-wland${l.known ? '' : ' is-fog'}${view.wland === l.id ? ' is-sel' : ''}" data-wland="${l.id}">
        <path d="${landPath(l)}" fill="${fill}"/>
        <text x="${l.x}" y="${l.y - l.h / 2 + 5}" class="xsj-wlabel">${l.known ? esc(l.name) : '？？？'}</text>
      </g>`;
    }).join('');
    const spots = w.spots.filter((s) => { const l = w.lands.find((x) => x.name === s.land); return !l || l.known; }).map((s) => `
      <g class="xsj-pin${s.known ? '' : ' is-fog'}${view.wspot === s.id ? ' is-sel' : ''}${here && here.id === s.id ? ' is-here' : ''}" data-wspot="${s.id}" transform="translate(${s.x} ${s.y}) scale(${(1 / zoom).toFixed(3)})">
        ${here && here.id === s.id ? '<circle r="6.4" class="xsj-pulse" />' : ''}
        ${s.known ? '' : '<circle r="5.2" class="xsj-fog-cloud" />'}
        <circle r="3.8" class="xsj-pin-bg" />
        <text class="xsj-pin-e${s.known ? '' : ' xsj-fog-q'}" y="1.4">${s.known ? esc(s.emoji || '📍') : '?'}</text>
        <text class="xsj-pin-n" y="7.2">${s.known ? esc(s.name) : '？？？'}</text>
      </g>`).join('');
    const known = w.lands.filter((l) => l.known).length + w.spots.filter((s) => s.known).length;
    const all = w.lands.length + w.spots.length;
    const selL = w.lands.find((l) => l.id === view.wland);
    const selS = w.spots.find((s) => s.id === view.wspot);
    return `${sw}
      <div class="xsj-loc">🌍 <b>${esc(w.name)}</b><small>已探索 ${known}/${all}${here ? ` · 你在 ${esc(here.name)}` : ''}</small></div>
      <div class="xsj-mapframe${w.pic ? ' has-bg' : ''}"><div class="xsj-mapwrap xsj-worldwrap"><svg class="xsj-map xsj-world" viewBox="-3 -3 106 120" style="width:${zoom * 100}%;--z:${zoom}">
        <defs><radialGradient id="xsj-sea" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#cfe6ee"/><stop offset="1" stop-color="#9cc3d3"/></radialGradient></defs>
        <rect x="-3" y="-3" width="106" height="120" fill="url(#xsj-sea)"/>
        ${w.pic && view.drawing?.id !== 'world-bg' ? `<image href="${esc(w.pic)}" x="-3" y="-3" width="106" height="120" preserveAspectRatio="xMidYMid slice" />` : ''}
        ${view.drawing?.id === 'world-bg' ? '<text x="50" y="50" class="xsj-pin-e">⏳</text>' : ''}
        ${lands}${spots}
      </svg></div>
      <div class="xsj-mapctl"><button data-act="zoom-out" aria-label="缩小">－</button><button data-act="zoom-in" aria-label="放大">＋</button></div></div>
      ${selS ? worldSpotCard(selS, w) : selL ? worldLandCard(selL, w) : `<div class="xsj-hint">点陆地或地点看说明。灰色的「？？？」还没去过，剧情里一提到就会点亮，也可以把传闻带进剧情，让角色去打听。</div>`}`;
  }
  function worldLandCard(l, w) {
    const inside = w.spots.filter((s) => s.land === l.name);
    if (!l.known) {
      return `<div class="xsj-place">
        <div class="xsj-place-top"><span class="xsj-place-e">🌫</span><div><b>？？？</b><small>还没去过的地方</small></div><button data-act="wclose" class="xsj-x">×</button></div>
        <div>传闻：${esc(l.hint || '那边是什么样，没人说得清。')}</div>
        <div class="xsj-row2" style="margin-top:8px"><button data-act="quote" data-kind="wland" data-id="${l.id}" class="xsj-mini">📎 带进剧情</button><button data-act="wreveal" data-id="${l.id}" class="xsj-mini">直接揭开</button></div>
      </div>`;
    }
    return `<div class="xsj-place">
      <div class="xsj-place-top"><span class="xsj-place-e">🗺</span><div><b>${esc(l.name)}</b><small>${esc(l.terrain || '')} · ${inside.filter((s) => s.known).length}/${inside.length} 个地方</small></div><button data-act="wclose" class="xsj-x">×</button></div>
      ${l.desc ? `<div>${esc(l.desc)}</div>` : ''}
      ${inside.length ? `<div class="xsj-place-v">📍 ${inside.map((s) => esc(s.known ? s.name : '？？？')).join('、')}</div>` : ''}
      <button data-act="quote" data-kind="wland" data-id="${l.id}" class="xsj-xdraw">📎 带进剧情</button>
    </div>`;
  }
  function worldSpotCard(s, w) {
    if (!s.known) {
      return `<div class="xsj-place">
        <div class="xsj-place-top"><span class="xsj-place-e">❔</span><div><b>？？？</b><small>${esc(s.land || '')} · 还没去过</small></div><button data-act="wclose" class="xsj-x">×</button></div>
        <div>传闻：${esc(s.hint || '听说那里有个地方。')}</div>
        <div class="xsj-row2" style="margin-top:8px"><button data-act="quote" data-kind="wspot" data-id="${s.id}" class="xsj-mini">📎 带进剧情</button><button data-act="wreveal" data-id="${s.id}" class="xsj-mini">直接揭开</button></div>
      </div>`;
    }
    return `<div class="xsj-place">
      <div class="xsj-place-top"><span class="xsj-place-e">${esc(s.emoji || '📍')}</span><div><b>${esc(s.name)}</b><small>${esc(s.land || '')}</small></div><button data-act="wclose" class="xsj-x">×</button></div>
      ${s.desc ? `<div>${esc(s.desc)}</div>` : ''}
      <button data-act="quote" data-kind="wspot" data-id="${s.id}" class="xsj-xdraw">📎 带进剧情</button>
    </div>`;
  }
  function mapSwitch() {
    const lv = view.mapLevel === 'world' ? 'world' : 'local';
    return `<div class="xsj-np-tabs xsj-mapswitch"><button data-maplevel="local" class="${lv === 'local' ? 'on' : ''}">📍 这里</button><button data-maplevel="world" class="${lv === 'world' ? 'on' : ''}">🌍 世界</button></div>`;
  }
  function worldInstr(add) {
    const sd = storyDate();
    const old = currentWorld();
    const knownNames = old ? [...old.lands, ...old.spots].filter((x) => x.known).map((x) => x.name) : [];
    return [
      ...baseInstr(sd.y, sd.m, false, 'map'),
      mapPrompt('wTask'),
      mapPrompt('wRules'),
      mapPrompt('wKnown'),
      `坐标：整张图左上角(0,0)，右下角(100,100)，四周留出海。陆地用中心点 x、y 和大小 w、h 表示，彼此尽量不要重叠，大小有差别；地点要落在所属陆地的范围里。`,
      add && old ? `已经有这些陆地：${old.lands.map((l) => l.name).join('、')}；地点：${old.spots.map((s) => s.name).join('、')}。全部保留，不要重复，这次只补充新的陆地和地点，放在空着的海上或已有陆地上。` : '',
      knownNames.length && !add ? `这些地方{{user}}已经去过或知道，名字保持一致、known 为 true：${knownNames.join('、')}` : '',
      `JSON 结构：{"name": "世界名", "lands": [{"name": "陆地或国度名", "terrain": "${Object.keys(TERRAINS).join('|')}", "x": 数字, "y": 数字, "w": 数字, "h": 数字, "desc": "一句话", "known": true, "hint": "没去过时的传闻，去过的留空"}], "spots": [{"name": "地点名", "emoji": "一个emoji", "land": "所属陆地名", "x": 数字, "y": 数字, "desc": "一句话", "known": false, "hint": "传闻"}]}  // ${add ? '新增 2-4 块陆地、4-10 个地点' : '5-9 块陆地，12-24 个地点'}`,
    ].filter(Boolean).join('\n');
  }
  async function generateWorld(add) {
    if (view.busy) return;
    const sd = storyDate();
    const old = currentWorld();
    const knownNames = old ? [...old.lands, ...old.spots].filter((x) => x.known).map((x) => x.name) : [];
    const instr = worldInstr(add);
    const data = await callAI(instr, add ? '正在打听更远的地方…' : '正在画世界地图…', true, false);
    if (!data) return;
    const num = (v, d) => { const n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : d; };
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const bool = (v) => v === true || v === 'true';
    const lands = (Array.isArray(data.lands) ? data.lands : []).filter((l) => l && txt(l.name)).slice(0, 14).map((l) => {
      const w0 = clamp(num(l.w, 24), 8, 60), h0 = clamp(num(l.h, 20), 8, 60);
      return { id: uid(), name: txt(l.name).slice(0, 20), terrain: TERRAINS[txt(l.terrain)] ? txt(l.terrain) : '平原', x: clamp(num(l.x, 50), w0 / 2 + 2, 98 - w0 / 2), y: clamp(num(l.y, 50), h0 / 2 + 2, 98 - h0 / 2), w: w0, h: h0, desc: txt(l.desc), known: bool(l.known), hint: txt(l.hint) };
    });
    const spots = (Array.isArray(data.spots) ? data.spots : []).filter((s) => s && txt(s.name)).slice(0, capN(40)).map((s) => ({
      id: uid(), name: txt(s.name).slice(0, 20), emoji: txt(s.emoji) || '📍', land: txt(s.land), x: clamp(num(s.x, 50), 3, 97), y: clamp(num(s.y, 50), 3, 95), desc: txt(s.desc), known: bool(s.known), hint: txt(s.hint),
    }));
    if (!lands.length) { lastRaw = JSON.stringify(data).slice(0, 4000); toast('没画出世界地图，再试一次（返回内容记在设置页最下面）', 'error'); return; }
    // 已经知道的地方，重新生成后还是亮的
    for (const x of [...lands, ...spots]) if (knownNames.includes(x.name)) x.known = true;
    if (add && old) {
      const nl = lands.filter((l) => !old.lands.some((o) => o.name === l.name));
      const ns = spots.filter((s) => !old.spots.some((o) => o.name === s.name));
      saveWorld({ ...old, lands: [...old.lands, ...nl], spots: [...old.spots, ...ns] });
      toast(nl.length + ns.length ? `新添 ${nl.length} 块陆地、${ns.length} 个地点` : '这次没打听到新地方', nl.length + ns.length ? 'success' : 'info');
    } else {
      saveWorld({ name: txt(data.name).slice(0, 20) || '世界', lands, spots, pic: old?.pic || '', generatedAt: Date.now() });
      toast(`画好了：${lands.length} 块陆地、${spots.length} 个地点`, 'success');
    }
    view.wland = null; view.wspot = null;
    render();
  }
  // AI 回复里说出了还在迷雾里的陆地或地点：点亮（地点亮了，它所在的陆地也一起亮）
  function autoRevealWorld(text) {
    const w = currentWorld();
    if (!w) return [];
    const plain = String(text || '').replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '').replace(/<[^>]+>/g, ' ');
    const hits = [...w.lands, ...w.spots].filter((x) => !x.known && txt(x.name).length >= 2 && plain.includes(x.name));
    if (!hits.length) return [];
    for (const x of hits) {
      x.known = true;
      if (x.land) { const l = w.lands.find((o) => o.name === x.land); if (l && !l.known) { l.known = true; hits.push(l); } }
    }
    saveWorld(w);
    return hits;
  }
  async function drawWorldPic(label) {
    const key = charKey();
    const w0 = currentWorld();
    if (!w0) return false;
    const pic = await drawImage({
      prompt: mapPrompt('pWorld'),
      nl: [w0.name, `大地上有：${w0.lands.filter((l) => l.known).map((l) => `${l.name}（${l.terrain}）`).join('、')}`].join('。').slice(0, 500),
      size: 'landscape',
    }, label, 'world-bg');
    if (!pic) return false;
    const w = (settings.worlds || {})[key];
    if (!w) return false;
    w.pic = pic;
    settings.worlds = { ...(settings.worlds || {}), [key]: w }; saveSettings(settings);
    render();
    return true;
  }

  // ---------- 🧭 迷雾地点：打听来的、还没去过的地方；剧情里一提到或走到就点亮 ----------
  function revealFog(p) {
    p.fog = false;
    p.revealed = true;
    p.revealedAt = dateKey(storyDate());
  }
  async function generateFog() {
    if (view.busy) return;
    const key = charKey();
    const mp = currentMap();
    if (!mp) return;
    const sd = storyDate();
    // 线索：图鉴和读懂的兽皮卷里提到、地图上却对不上的地方
    const onMap = (s) => mp.places.some((p) => nameHit(p.name, s)) || mp.regions.some((r) => nameHit(r.name, s));
    const clues = [];
    for (const x of codex().dex.items) {
      if (x.found) dexWhereTexts(x).filter((s) => !onMap(s)).forEach((s) => clues.push(`图鉴·${x.name}：${s}`));
      else if (x.hint) clues.push(`图鉴里还没遇到的「？」：${x.hint}`);
    }
    const instr = [
      ...baseInstr(sd.y, sd.m, false, 'map'),
      `任务：地图「${mp.name}」上已经有这些地方：${mp.places.map((p) => `${p.name}${p.region ? `（${p.region}）` : ''}`).join('、')}。${mapPrompt('fog')}`,
      clues.length ? `优先补上这些线索里提到、地图上却没有的地方：\n${clues.slice(0, 12).join('\n')}` : '',
      mapPrompt('fogRules'),
      `坐标：左上(0,0)，右下(100,100)。已有区域：${mp.regions.map((r) => `${r.name}(x${Math.round(r.x)},y${Math.round(r.y)},宽${Math.round(r.w)},高${Math.round(r.h)})`).join('，')}。新地点放在相关区域的边缘或地图空白处，离已有地点至少 6。`,
      `JSON 结构：{"places": [{"name": "地名", "emoji": "一个emoji", "type": "${PLACE_TYPES.join('|')}", "region": "靠近哪个已有区域，没有就空字符串", "x": 数字, "y": 数字, "desc": "这里实际是什么，20-40字（先藏起来，去过才显示）", "vibe": "氛围，一句话", "rumor": "主角现在能听到的传闻：谁说的、说了什么，25-50字，不点破全貌", "source": "如果来自上面的线索，写是哪一条（如“兽皮卷·雾苔止血膏”）；否则空字符串"}]}`,
    ].filter(Boolean).join('\n');
    const data = await callAI(instr, '正在打听消息…', true, false);
    if (!data) return;
    const target = (settings.maps || {})[key];
    if (!target) return;
    const list = (Array.isArray(data.places) ? data.places : []).filter((x) => x && txt(x.name) && !target.places.some((p) => p.name === txt(x.name) || nameHit(p.name, txt(x.name))));
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : (lo + hi) / 2));
    let added = 0;
    for (const x of list.slice(0, capN(6))) {
      let px = clamp(x.x, 4, 96), py = clamp(x.y, 4, 93);
      // 和已有图钉挤在一起就往外挪一点
      for (let k = 0; k < 12 && target.places.some((p) => Math.hypot(p.x - px, p.y - py) < 6); k++) {
        const a = k * 2.4;
        px = clamp(px + Math.cos(a) * 6, 4, 96); py = clamp(py + Math.sin(a) * 6, 4, 93);
      }
      target.places.push({
        id: uid(), name: txt(x.name), emoji: txt(x.emoji) || '📍', type: PLACE_TYPES.includes(x.type) ? x.type : '其他', region: txt(x.region),
        x: +px.toFixed(1), y: +py.toFixed(1), desc: txt(x.desc), vibe: txt(x.vibe), people: '', pic: '',
        fog: true, rumor: txt(x.rumor), source: txt(x.source), heardAt: dateKey(sd),
      });
      added++;
    }
    settings.maps = { ...(settings.maps || {}), [key]: target }; saveSettings(settings);
    toast(added ? `打听到 ${added} 个地方，地图上的「？」` : '这次没打听到新地方', added ? 'success' : 'info');
    render();
  }
  // AI 回复里说出了迷雾地点的名字：点亮
  function autoRevealFog(text) {
    const mp = currentMap();
    if (!mp) return [];
    const plain = String(text || '').replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '').replace(/<[^>]+>/g, ' ');
    const hits = mp.places.filter((p) => p.fog && txt(p.name).length >= 2 && plain.includes(p.name));
    if (!hits.length) return [];
    hits.forEach(revealFog);
    saveMap(mp);
    return hits;
  }

  // 区域背景：俯瞰的无人风景，铺在地图的区域方块里
  async function drawRegionPic(r, label) {
    const key = charKey();
    const mp0 = currentMap();
    const inside = (mp0?.places || []).filter((p) => p.region === r.name).map((p) => p.name);
    const pic = await drawImage({
      prompt: mapPrompt('pRegion'),
      nl: [mp0?.name, r.name, r.desc, inside.length ? `这里有${inside.slice(0, 6).join('、')}` : ''].filter(Boolean).join('。'),
      size: r.w >= r.h ? 'landscape' : 'portrait',
    }, label, r.id);
    if (!pic) return false;
    // 画的过程中可能换了卡：存回开始画时那张卡的地图
    const mp = (settings.maps || {})[key];
    const target = mp?.regions.find((x) => x.id === r.id);
    if (!target) return false;
    target.pic = pic;
    settings.maps = { ...(settings.maps || {}), [key]: mp }; saveSettings(settings);
    render();
    return true;
  }
  // 整张地图的大背景：整片地方的俯瞰图，铺在所有区域下面（区域方块会变半透明，透出底图）
  async function drawMapPic(label) {
    const key = charKey();
    const mp0 = currentMap();
    if (!mp0) return false;
    const pic = await drawImage({
      prompt: mapPrompt('pMap'),
      nl: [mp0.name, mp0.regions.length ? `由这些区域组成：${mp0.regions.map((r) => r.name + (r.desc ? `（${r.desc}）` : '')).join('；')}` : ''].filter(Boolean).join('。').slice(0, 600),
      size: 'landscape',
    }, label, 'map-bg');
    if (!pic) return false;
    const mp = (settings.maps || {})[key];
    if (!mp) return false;
    mp.pic = pic;
    settings.maps = { ...(settings.maps || {}), [key]: mp }; saveSettings(settings);
    render();
    return true;
  }

  function placeCard(p, mp) {
    if (view.mapEdit) {
      return `<div class="xsj-form">
        <div class="xsj-row2"><input data-pf="emoji" value="${esc(p.emoji)}" style="width:56px;flex:none"><input data-pf="name" placeholder="地点名" value="${esc(p.name)}"></div>
        <input data-pf="desc" placeholder="这里是什么" value="${esc(p.desc)}">
        <input data-pf="vibe" placeholder="氛围" value="${esc(p.vibe)}">
        <input data-pf="people" placeholder="常来的人" value="${esc(p.people)}">
        <div class="xsj-row2"><button data-act="del-place" class="xsj-danger">删除</button><span><button data-act="place-close">取消</button><button data-act="save-place" class="xsj-primary">保存</button></span></div>
      </div>`;
    }
    if (p.fog) {
      return `
      <div class="xsj-place xsj-fogcard">
        <div class="xsj-place-top"><span class="xsj-place-e">🌫</span><div><b>还没去过的地方</b><small>${esc([p.region && `${p.region}附近`, p.heardAt && `${p.heardAt} 听说`].filter(Boolean).join(' · ') || '传闻')}</small></div><button data-act="place-close" class="xsj-x">×</button></div>
        <div class="xsj-fogrumor">“${esc(p.rumor || '有人提起过这附近还有个地方。')}”</div>
        ${p.source ? `<div class="xsj-place-v">🔎 线索来自：${esc(p.source)}</div>` : ''}
        <div class="xsj-hint">剧情里有人说出这个地名、或者你们走到了那里，它就会自动点亮。</div>
        <div class="xsj-row2"><button data-act="fog-del" class="xsj-danger">不要这个传闻</button><span><button data-act="quote" data-kind="place" data-id="${p.id}">📎 带进剧情</button><button data-act="fog-reveal" class="xsj-primary">已经去过了</button></span></div>
      </div>`;
    }
    const key = (s) => String(s || '');
    const md = monthData(view.month);
    const near = (txt) => key(txt).includes(p.name) || (p.name.length >= 2 && key(txt) && p.name.includes(key(txt)) && key(txt).length >= 2);
    const sch = md.schedule.filter((x) => near(x.place) || key(x.title).includes(p.name));
    const notes = notesFor(md).items.filter((n) => key(n.title).includes(p.name) || key(n.text).includes(p.name));
    const region = mp.regions.find((r) => r.name === p.region);
    const photo = view.drawing?.id === p.id ? drawingBox(p.id, 'xsj-drawing-place')
      : p.pic ? `<img class="xsj-place-pic" src="${esc(p.pic)}" alt="">` : '';
    return `
      <div class="xsj-place">
        ${photo}
        <div class="xsj-place-top"><span class="xsj-place-e">${esc(p.emoji)}</span><div><b>${esc(p.name)}</b><small>${esc([p.type, region?.name || p.region].filter(Boolean).join(' · '))}</small></div><button data-act="quote" data-kind="place" data-id="${p.id}" class="xsj-x" title="附带给下一次回复">📎</button><button data-act="place-close" class="xsj-x">×</button></div>
        ${p.desc ? `<div>${esc(p.desc)}</div>` : ''}
        ${p.vibe ? `<div class="xsj-place-v">✨ ${esc(p.vibe)}</div>` : ''}
        ${p.people ? `<div class="xsj-place-v">👥 ${esc(p.people)}</div>` : ''}
        ${region?.desc ? `<div class="xsj-place-v">🗺 ${esc(region.name)}：${esc(region.desc)}</div>` : ''}
        ${view.drawing?.id === p.id ? '' : `<button class="xsj-xdraw" data-act="place-pic">${p.pic ? '↻ 重画这张' : '🖼 画出这个地方'}</button>`}
        ${sch.length ? `<div class="xsj-sub">${+view.month.split('-')[1]}月在这里的安排</div>${sch.map((x) => `<div class="xsj-place-li">${esc(x.date.slice(5))} ${esc(x.time)} ${esc(x.title)}</div>`).join('')}` : ''}
        ${notes.length ? `<div class="xsj-sub">小红书提到</div>${notes.map((n) => `<button class="xsj-place-li xsj-linknote" data-gonote="${n.id}">${esc(n.emoji)} ${esc(n.title)}</button>`).join('')}` : ''}
        ${(() => { const dx = dexForPlace(p); return dx.length ? `<div class="xsj-sub">这里能遇到 · ${esc(appTitle('dex'))}</div>${dexLinks(dx)}` : ''; })()}
      </div>`;
  }

  function mapInstr(add = false) {
    const sd = storyDate();
    const old = currentMap();
    // 只新增：所有地点和区域都留着，只补新的；重新画：只留自己加的、挪过的、迷雾地点
    const keep = old ? (add ? old.places : old.places.filter((p) => p.manual || p.moved || p.fog || p.revealed)) : [];
    return [
      ...baseInstr(sd.y, sd.m, false, 'map'),
      mapPrompt('task'),
      mapPrompt('rules'),
      keep.length ? `下面这些地点已经由用户放好，保留它们，不要重复：${keep.map((p) => p.name).join('、')}` : '',
      add && old ? `这次只补充：地图上已有这些区域，保持不变：${old.regions.map((r) => `${r.name}(${r.x},${r.y},${r.w},${r.h})`).join('、')}；在这些区域里或空白处补 4-10 个新地点，可以加 0-2 个新区域（不要和已有区域重叠）。` : '',
      `坐标系：左上角(0,0)，右下角(100,100)。`,
      `JSON 结构：{"map": {"name": "地图名（城市或片区名）", "regions": [{"name": "区域名", "x": 数字, "y": 数字, "w": 宽, "h": 高, "desc": "一句话说明"}], "places": [{"name": "地点名", "emoji": "一个emoji", "type": "${PLACE_TYPES.join('|')}", "region": "所属区域名", "x": 数字, "y": 数字, "desc": "这里是什么，20-40字", "vibe": "氛围，一句话", "people": "常来这里的人，可以是故事里的人"}]}}  // 4-8个区域，12-25个地点`,
    ].filter(Boolean).join('\n');
  }
  async function generateMap(add = false) {
    if (view.busy) return;
    const sd = storyDate();
    const old = currentMap();
    // 只新增：所有地点和区域都留着，只补新的；重新画：只留自己加的、挪过的、迷雾地点
    const keep = old ? (add ? old.places : old.places.filter((p) => p.manual || p.moved || p.fog || p.revealed)) : [];
    const instr = mapInstr(add);
    const data = await callAI(instr, '正在画地图…', true, false);
    if (!data) return;
    // 容错：不管 AI 把地点放在 map / 地图 / 顶层，还是用了中文字段名，都找出来
    const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };
    const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : NaN; };
    const isPlace = (o) => o && typeof o === 'object' && !Array.isArray(o) && typeof pick(o, 'name', '名称', '地点', '名字') === 'string';
    const isRegion = (o) => isPlace(o) && Number.isFinite(num(pick(o, 'w', 'width', '宽', '宽度')));
    const arrays = [];
    (function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 5) return;
      if (Array.isArray(o)) { arrays.push(o); o.forEach((x) => walk(x, depth + 1)); } else Object.values(o).forEach((x) => walk(x, depth + 1));
    })(data, 0);
    const regionArr = arrays.find((a) => a.length && a.every(isRegion)) || [];
    const placeArr = arrays.find((a) => a !== regionArr && a.length && a.filter(isPlace).length >= Math.max(1, a.length / 2) && !a.every(isRegion));
    if (!placeArr) {
      lastRaw = JSON.stringify(data).slice(0, 4000);
      console.warn('[小手机] 地图格式不对，AI 返回：', data);
      toast('AI 返回的地图格式不对，再试一次（返回内容已记在设置页最下面）', 'error');
      return;
    }
    const g = pick(data, 'map', '地图') || data;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(num(v)) ? num(v) : lo));
    const regions = regionArr.slice(0, 10).map((r, i) => {
      const x = clamp(pick(r, 'x', 'X', '横坐标'), 0, 95), y = clamp(pick(r, 'y', 'Y', '纵坐标'), 0, 95);
      return { id: uid(), name: String(pick(r, 'name', '名称', '名字')).trim(), x, y, w: clamp(pick(r, 'w', 'width', '宽', '宽度'), 8, 100 - x), h: clamp(pick(r, 'h', 'height', '高', '高度'), 8, 100 - y), desc: String(pick(r, 'desc', '说明', '描述') || '').trim(), color: REGION_COLORS[i % REGION_COLORS.length],
        // 重新生成时，同名区域留着之前画的背景
        pic: old?.regions?.find((o) => o.name === String(pick(r, 'name', '名称', '名字')).trim())?.pic || '' };
    });
    const names = new Set(keep.map((p) => p.name));
    const places = placeArr.filter(isPlace).filter((p) => !names.has(String(pick(p, 'name', '名称', '地点', '名字')).trim())).slice(0, capN(30)).map((p) => {
      const type = pick(p, 'type', '类型');
      return {
        id: uid(), name: String(pick(p, 'name', '名称', '地点', '名字')).trim(), emoji: String(pick(p, 'emoji', '图标') || '📍').trim(), type: PLACE_TYPES.includes(type) ? type : '其他', region: String(pick(p, 'region', '区域', '所属区域') || '').trim(),
        _np: !Number.isFinite(num(pick(p, 'x', 'X', '横坐标'))) || !Number.isFinite(num(pick(p, 'y', 'Y', '纵坐标'))),
        pic: old?.places.find((o) => o.name === String(pick(p, 'name', '名称', '地点', '名字')).trim())?.pic || '',
        x: clamp(pick(p, 'x', 'X', '横坐标'), 4, 96), y: clamp(pick(p, 'y', 'Y', '纵坐标'), 4, 93), desc: String(pick(p, 'desc', '说明', '描述') || '').trim(), vibe: String(pick(p, 'vibe', '氛围') || '').trim(), people: String(pick(p, 'people', '常来的人', '人物') || '').trim(),
      };
    });
    // 没给坐标的地点：放进所属区域的方框里排开，找不到区域就在整张图上排
    {
      const slots = {};
      places.forEach((p) => {
        const np = p._np; delete p._np;
        if (!np) return;
        const r = regions.find((rr) => rr.name === p.region);
        const box = r || { x: 5, y: 5, w: 90, h: 88 };
        const k = r ? r.name : '_';
        const n = (slots[k] = (slots[k] || 0) + 1) - 1;
        const cols = Math.max(1, Math.floor(box.w / 16));
        p.x = Math.min(96, box.x + 8 + (n % cols) * 16);
        p.y = Math.min(93, box.y + 10 + Math.floor(n / cols) * 15);
      });
    }
    lastRaw = '';
    if (add && old) {
      const newRegions = regions.filter((r) => !old.regions.some((o) => o.name === r.name));
      saveMap({ ...old, regions: [...old.regions, ...newRegions], places: [...keep, ...places], generatedAt: Date.now() });
      toast(places.length ? `新添 ${places.length} 个地点${newRegions.length ? `、${newRegions.length} 个区域` : ''}` : '这次没有新地点', places.length ? 'success' : 'info');
      render();
      return;
    }
    saveMap({ name: String(pick(g, 'name', '名称', '地图名') || '地图').trim(), regions, places: [...keep, ...places], pic: old?.pic || '', generatedAt: Date.now() });
    view.place = null;
    toast('地图画好了', 'success');
    render();
  }

  // 编辑模式下拖动图钉；点空白处加地点
  let drag = null;
  function svgPoint(svg, ev) {
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.min(97, Math.max(3, p.x)), y: Math.min(94, Math.max(3, p.y)) };
  }
  function onPointerDown(ev) {
    if (view.tab !== 'map' || !view.mapEdit) return;
    const pin = ev.target.closest?.('[data-place]');
    const svg = ev.target.closest?.('svg.xsj-map');
    if (!svg) return;
    ev.preventDefault();
    drag = { id: pin?.dataset.place || null, svg, start: { x: ev.clientX, y: ev.clientY }, moved: false, pin };
    try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
  }
  function onPointerMove(ev) {
    if (!drag || !drag.id) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.start.x, ev.clientY - drag.start.y) < 5) return;
    drag.moved = true;
    const p = svgPoint(drag.svg, ev);
    drag.pin.setAttribute('transform', `translate(${p.x} ${p.y})`);
    drag.last = p;
  }
  function onPointerUp(ev) {
    if (!drag) return;
    const d = drag; drag = null;
    const mp = currentMap();
    if (!mp) return;
    if (d.id && d.moved && d.last) {
      const p = mp.places.find((x) => x.id === d.id);
      if (p) { p.x = +d.last.x.toFixed(1); p.y = +d.last.y.toFixed(1); p.moved = true; saveMap(mp); }
      return render();
    }
    if (d.id) { view.place = d.id; return render(); }
    // 点空白处：新地点
    const p = svgPoint(d.svg, ev);
    const np = { id: uid(), name: '新地点', emoji: '📍', type: '其他', region: '', x: +p.x.toFixed(1), y: +p.y.toFixed(1), desc: '', vibe: '', people: '', manual: true };
    mp.places.push(np); saveMap(mp); view.place = np.id; render();
  }

  // ---------- 桌面：app 图标网格，点开进入；底部横条回到桌面 ----------
  const APPS = [
    { k: 'cal', i: '🗓', t: '日程', c: ['#ffb3c7', '#ff7aa2'] },
    { k: 'map', i: '🗺', t: '地图', c: ['#9fd8c6', '#45a98f'] },
    { k: 'ev', i: '🎲', t: '随机剧情', c: ['#ffd59e', '#f0a04b'] },
    { k: 'mon', i: '📕', t: '小红书', c: ['#ff8a8a', '#ff2e4d'] },
    { k: 'x', i: '𝕏', t: 'X', c: ['#4a4a4a', '#000000'] },
    { k: 'dex', i: '📖', t: '物品图鉴', c: ['#6a58a8', '#2c2350'] },
    { k: 'wiki', i: '🌿', t: '百科', c: ['#a8e0a0', '#4fa565'] },
    { k: 'dream', i: '🌏', t: '蓝星online', c: ['#8fd3ff', '#2f6fd6'] },
    { k: 'npc', i: '📇', t: '人物图鉴', c: ['#c9b6e8', '#6b4f9e'] },
    { k: 'closet', i: '👗', t: '衣橱', c: ['#f7c9d9', '#c4598a'] },
    { k: 'set', i: '⚙', t: '设置', c: ['#dcdce4', '#9a9aa8'] },
  ];
  // 桌面上的顺序：长按图标进入整理模式后拖动，存在设置里（同一台设备所有聊天共用）
  function appOrder() {
    const keys = APPS.map((a) => a.k);
    const saved = Array.isArray(settings.appOrder) ? settings.appOrder.filter((k) => keys.includes(k)) : [];
    return [...new Set([...saved, ...keys])].map((k) => APPS.find((a) => a.k === k));
  }
  // 图鉴 / 百科 / 手记：名字跟着世界观变（兽人世界里手记就叫兽皮卷），存在这串聊天里
  const APP_DEFAULT = { dex: '物品图鉴', wiki: '生活百科', dream: '蓝星online', npc: '人物图鉴' };
  function codex() {
    if (!chat.codex || typeof chat.codex !== 'object') chat.codex = {};
    for (const k of ['dex', 'wiki', 'dream', 'npc']) {
      const v = chat.codex[k];
      if (!v || typeof v !== 'object' || !Array.isArray(v.items)) chat.codex[k] = { title: '', items: [] };
    }
    return chat.codex;
  }
  function appTitle(k) {
    if (k === 'dex' || k === 'npc') return APP_DEFAULT[k]; // 这两个名字固定，不跟世界观变
    if (APP_DEFAULT[k]) return codex()[k].title || APP_DEFAULT[k];
    return (APPS.find((a) => a.k === k) || {}).t || k;
  }
  function appIcon(a) {
    const fresh = a.k === 'set' ? (updNew() ? '新' : 0) : a.k === 'dex' || a.k === 'npc' ? codex()[a.k].items.filter((x) => x.isNew).length : 0;
    return `<button class="xsj-app" data-tab="${a.k}"><i><img src="${ICON_URI[a.k]}" alt="" draggable="false" decoding="sync"></i>${fresh ? `<b class="xsj-badge">${fresh}</b>` : ''}<span>${esc(appTitle(a.k))}</span></button>`;
  }
  // 桌面日历小组件：左边今天，右边整月；点一下进日程的今天
  function calWidget(sd, wd) {
    const key = dateKey(sd), mk = key.slice(0, key.lastIndexOf('-')), md = chat.months[mk] ? monthData(mk) : { schedule: [], holidays: [] }, mmdd = `${pad(sd.m)}-${pad(sd.d)}`;
    const list = [
      ...chat.birthdays.filter((b) => b.md === mmdd).map((b) => ({ t: `${b.who}的${b.kind === '纪念日' ? '纪念日' : '生日'}`, c: TYPE_COLOR[b.kind === '纪念日' ? '纪念日' : '生日'] })),
      ...md.holidays.filter((h) => key >= h.date && key <= (h.kind === VAC && h.end > h.date ? h.end : h.date)).map((h) => ({ t: h.name, c: TYPE_COLOR[h.kind === VAC ? VAC : HOL] })),
      ...md.schedule.filter((x) => x.date === key).sort((a, b) => a.time.localeCompare(b.time)).map((x) => ({ t: x.title, s: x.time, c: TYPE_COLOR[x.type] || '#8e8e93' })),
    ];
    const lead = calLead(sd.y, sd.m), days = calDays(sd.y, sd.m, md), cnMode = isCn();
    const busy = new Set(md.schedule.map((x) => x.date));
    let cells = (cnMode ? [] : [0, 1, 2, 3, 4, 5, 6]).map((i) => `<i class="h${i > 4 ? ' w' : ''}">${esc([...weekShort(i)][0] || '')}</i>`).join('') + '<i></i>'.repeat(lead);
    for (let d = 1; d <= days; d++) cells += `<i class="${d === sd.d ? 'now' : !cnMode && (lead + d - 1) % 7 > 4 ? 'w' : ''}${busy.has(`${mk}-${pad(d)}`) ? ' dot' : ''}"><u>${dayName(d)}</u></i>`;
    return `<button class="xsj-calw" data-tab="cal" data-today="${key}"><span class="l"><em>${esc(wd || '今日')}</em><b>${dayName(sd.d)}</b>${list.slice(0, 2).map((x) => `<span class="ev" style="--c:${x.c}"><strong>${esc(x.t)}</strong>${x.s ? `<small>${esc(x.s)}</small>` : ''}</span>`).join('') || '<small class="none">今天没有日程</small>'}${list.length > 2 ? `<small class="none">还有 ${list.length - 2} 项</small>` : ''}</span><span class="r"><em>${esc(monthName(sd.m))}<small>${esc(ownerName())}</small></em><span class="mg${cnMode ? ' is-cn' : ''}">${cells}</span></span></button>`;
  }
  function homeView() {
    const sd = storyDate();
    const wd = weekName(new Date(sd.y, sd.m - 1, sd.d).getDay());
    const dex = codex().dex.items;
    const found = dex.filter((x) => x.found).length;
    return `${view.arrange ? '<button data-act="arrange-done" class="xsj-arrange-done">完成</button>' : ''}
      ${calWidget(sd, wd)}
      <div class="xsj-appgrid${view.arrange ? ' is-arrange' : ''}">${appOrder().filter((a) => a.k !== 'cal').map((a) => appIcon(a)).join('')}</div>
      ${view.arrange ? '<div class="xsj-hint xsj-arrange-hint">拖动图标换位置，点「完成」或空白处结束</div>' : ''}`;
  }

  // 长按图标 0.45 秒进入整理模式（图标抖动），手指不松开就能直接拖；整理模式下按住即拖
  let appDrag = null; // { el, ghost, grid, timer, sx, sy, ox, oy, scale, live }
  let swallowClick = false;
  const HOLD_SEL = '[data-hold],[data-item],[data-hol],[data-bd],[data-note],[data-dex],[data-wiki],[data-npc],[data-npclink],[data-npcfact],[data-dreamopen],[data-place],[data-region],[data-wland],[data-wspot],[data-act="closet-open"],[data-act="closet-set-open"],[data-act="closet-folder"]';
  // 长按的是哪一条：{ msg, del }；不能删的返回 null
  function holdInfo(el) {
    const d = el.dataset, md = monthData(view.month), by = (arr, id) => (arr || []).find((x) => x.id === id);
    const cut = (o, k, x) => () => { o[k] = o[k].filter((y) => y !== x); saveChat(); };
    const hit = (x, msg, del) => (x ? { msg, del } : null);
    const short = (v, n = 16) => { const s = txt(v); return s.length > n ? s.slice(0, n) + '…' : s; };
    if (d.hold) {
      const [k, id] = d.hold.split(':');
      if (k === 'ev') { const x = by(md.events, id); return hit(x, `删掉剧情「${x?.title}」？`, cut(md, 'events', x)); }
      if (k === 'villain') return hit(chat.villain, `删掉反派「${chat.villain?.name}」？已经掷出的剧情还在。`, () => { chat.villain = null; saveChat(); });
      if (k === 'x') { const x = by(chat.xlog?.items, id); return hit(x, '删掉这条浏览记录？', cut(chat.xlog, 'items', x)); }
      if (k === 'xs') { const x = chat.xlog?.searches?.[Number(id)]; return hit(x, `删掉搜索「${short(x)}」？`, () => { chat.xlog.searches = chat.xlog.searches.filter((y) => y !== x); saveChat(); }); }
      if (k === 'cmt') { const n = by(notesFor(md).items, view.note), x = n?.comments?.[Number(id)]; return hit(x, `删掉${x?.name}的评论？`, () => cut(n, 'comments', x)()); }
      if (k === 'reply') { const n = by(codex().dream.items, view.dream), x = n?.replies?.[Number(id)]; return hit(x, `删掉${x?.author}的回复？`, () => cut(n, 'replies', x)()); }
      if (k === 'fact') { const n = by(npcData().items, view.npc), x = n?.facts?.[Number(id)]; return hit(x, x?.known ? `删掉「${npcT(x.k)}」这条记录？` : '删掉这条涂黑的记录？', () => cut(n, 'facts', x)()); }
      if (k === 'link') { const N = npcData(), x = by(N.links, id); return hit(x, '删掉这条关系？', cut(N, 'links', x)); }
      if (k === 'basic') { const n = by(npcData().items, view.npc); return hit(n, `删掉「${id}」？`, () => { if (Array.isArray(n.basic)) n.basic = n.basic.filter((y) => y.k !== id); n.facts = (n.facts || []).filter((y) => y.k !== id); saveChat(); }); }
      return null;
    }
    if (d.item) { const x = by(md.schedule, d.item); return hit(x, `删掉日程「${short(x?.title)}」？`, cut(md, 'schedule', x)); }
    if (d.hol) { const x = by(md.holidays, d.hol); return hit(x, `删掉「${x?.name}」？`, cut(md, 'holidays', x)); }
    if (d.bd) { const x = by(chat.birthdays, d.bd); return hit(x, `删掉${x?.who}的${x?.kind || '生日'}？以后每年都不再显示。`, cut(chat, 'birthdays', x)); }
    if (d.note) { const n = notesFor(md), x = by(n.items, d.note); return hit(x, `删掉「${short(x?.title)}」？`, () => { if (md.notes) md.notes.items = md.notes.items.filter((y) => y.id !== x.id); saveChat(); }); }
    if (d.dex) { const o = codex().dex, x = by(o.items, d.dex); return hit(x, `从${appTitle('dex')}里删掉「${x?.found ? x.name : '？？？'}」？`, cut(o, 'items', x)); }
    if (d.wiki) { const o = codex().wiki, x = by(o.items, d.wiki); return hit(x, `删掉「${x?.title}」？`, cut(o, 'items', x)); }
    if (d.npcfact) return holdInfo({ dataset: { hold: 'fact:' + d.npcfact } });
    if (d.npclink) return holdInfo({ dataset: { hold: 'link:' + d.npclink } });
    if (d.npc) { const N = npcData(), x = by(N.items, d.npc); return hit(x, `从${appTitle('npc')}里删掉「${x?.name}」？他的关系也会一起删掉。`, () => { N.items = N.items.filter((y) => y !== x); N.links = N.links.filter((l) => l.a !== x.name && l.b !== x.name); saveChat(); }); }
    if (d.dreamopen) { const o = codex().dream, x = by(o.items, d.dreamopen); return hit(x, `删掉${x?.author}的这条帖子？`, cut(o, 'items', x)); }
    const mp = d.place || d.region ? currentMap() : null, wd = d.wland || d.wspot ? currentWorld() : null;
    if (d.place) { const x = by(mp?.places, d.place); return hit(x, x?.fog ? '不要这个传闻了？地图上的「？」会去掉。' : `从地图上删掉「${x?.name}」？`, () => { mp.places = mp.places.filter((y) => y !== x); if (view.place === x.id) view.place = null; saveMap(mp); }); }
    if (d.region) { const x = by(mp?.regions, d.region); return hit(x, `删掉区域「${x?.name}」？里面的地点还在。`, () => { mp.regions = mp.regions.filter((y) => y !== x); if (view.region === x.id) view.region = null; saveMap(mp); }); }
    if (d.wland) {
      const x = by(wd?.lands, d.wland), n = x ? wd.spots.filter((s) => s.land === x.name).length : 0;
      return hit(x, `从世界地图上删掉「${x?.known ? x.name : '？？？'}」？${n ? `里面的 ${n} 个地点会一起删掉。` : ''}`, () => { if (view.wland === x.id) view.wland = null; saveWorld({ ...wd, lands: wd.lands.filter((y) => y !== x), spots: wd.spots.filter((s) => s.land !== x.name) }); });
    }
    if (d.wspot) { const x = by(wd?.spots, d.wspot); return hit(x, `从世界地图上删掉「${x?.known ? x.name : '？？？'}」？`, () => { if (view.wspot === x.id) view.wspot = null; saveWorld({ ...wd, spots: wd.spots.filter((y) => y !== x) }); }); }
    if (d.act === 'closet-open') {
      const o = closetOf(), x = by(o.items, d.id), used = x ? o.sets.filter((s) => s.ids.includes(x.id)).length : 0;
      return hit(x, `从衣橱里拿掉「${x?.name}」？${used ? `有 ${used} 套用到它，会一起从套装里去掉。` : ''}`, () => { o.items = o.items.filter((y) => y !== x); o.sets.forEach((s) => { s.ids = s.ids.filter((id) => id !== x.id); }); o.sets = o.sets.filter((s) => s.ids.length); saveChat(); });
    }
    if (d.act === 'closet-set-open') { const o = closetOf(), x = by(o.sets, d.id); return hit(x, `拆掉「${x?.name}」这套？里面的单品还在。`, cut(o, 'sets', x)); }
    if (d.act === 'closet-folder') {
      const k = d.k, o = closet()[k], own = k.startsWith('n:');
      if (!o || (!own && !o.items.length && !o.sets.length)) return null;
      return { msg: `${own ? '删掉' : '清空'}「${closetName(k)}」的衣橱？里面的衣服和套装都会没有。`, del: () => { if (own) delete chat.closet[k]; else { o.items = []; o.sets = []; } if (chat.wear?.[k]) { const w = { ...chat.wear }; delete w[k]; chat.wear = w; } if (view.closetWho === k && own) view.closetWho = 'char'; saveChat(); } };
    }
    return null;
  }
  let hold = null, holdFired = false, holdTouch = false;
  function holdEnd() { if (!hold) return; clearTimeout(hold.t1); clearTimeout(hold.t2); hold.el.classList.remove('xsj-held'); hold = null; }
  function holdDown(ev) {
    holdEnd(); holdFired = false; holdTouch = ev.pointerType === 'touch';
    if (ev.button > 0 || ev.isPrimary === false || view.busy || view.mapEdit || view.tab === 'home') return;
    if (ev.target.closest?.('.xsj-ask, input, textarea, select, summary')) return;
    const el = ev.target.closest?.(HOLD_SEL);
    if (!el || !holdInfo(el)) return;
    hold = { el, x: ev.clientX, y: ev.clientY, chat: chatIdNow() };
    hold.t1 = setTimeout(() => el.classList.add('xsj-held'), 180);
    hold.t2 = setTimeout(async () => {
      const cid = hold?.chat, info = holdInfo(el);
      holdEnd();
      if (!info || view.busy || chatIdNow() !== cid) return;
      holdFired = true;
      try { navigator.vibrate?.(15); } catch (e) {}
      if (!(await ask(info.msg, '删除')) || chatIdNow() !== cid) return;
      await info.del();
      render();
    }, 550);
  }
  function holdMove(ev) { if (hold && Math.hypot(ev.clientX - hold.x, ev.clientY - hold.y) > 8) holdEnd(); }
  function holdUp() { holdEnd(); if (holdFired) setTimeout(() => { holdFired = false; }, 60); }
  // 长按松手那一下不算点击
  function holdClick(ev) { if (holdFired) { holdFired = false; ev.stopPropagation(); ev.preventDefault(); } }
  function appPointerDown(ev) {
    if (view.tab !== 'home' || ev.button > 0) return;
    const el = ev.target.closest?.('.xsj-app');
    if (!el) return;
    appDrag = { el, sx: ev.clientX, sy: ev.clientY, live: false, pid: ev.pointerId };
    if (view.arrange) startAppDrag(ev);
    else appDrag.timer = setTimeout(() => { if (appDrag) { view.arrange = true; el.closest('.xsj-appgrid')?.classList.add('is-arrange'); startAppDrag({ clientX: appDrag.lx ?? appDrag.sx, clientY: appDrag.ly ?? appDrag.sy, pointerId: appDrag.pid }); } }, 450);
  }
  function startAppDrag(ev) {
    const d = appDrag;
    const scr = d.el.closest('.xsj-screen');
    if (!scr) return;
    const sr = scr.getBoundingClientRect();
    const er = d.el.getBoundingClientRect();
    d.scale = sr.width / scr.offsetWidth || 1;
    d.ox = (ev.clientX - er.left) / d.scale; d.oy = (ev.clientY - er.top) / d.scale;
    d.grid = d.el.closest('.xsj-appgrid');
    d.ghost = d.el.cloneNode(true);
    d.ghost.classList.add('xsj-app-ghost');
    d.ghost.style.width = er.width / d.scale + 'px';
    scr.appendChild(d.ghost);
    d.el.classList.add('is-holding');
    d.live = true;
    swallowClick = true;
    try { navigator.vibrate?.(15); } catch (e) {}
    try { d.el.setPointerCapture(ev.pointerId); } catch (e) {}
    moveGhost(ev);
  }
  function moveGhost(ev) {
    const d = appDrag;
    const sr = d.ghost.parentElement.getBoundingClientRect();
    d.ghost.style.left = (ev.clientX - sr.left) / d.scale - d.ox + 'px';
    d.ghost.style.top = (ev.clientY - sr.top) / d.scale - d.oy + 'px';
    // 手指下面是哪个图标：拖到它前面或后面
    const over = D.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.xsj-app');
    if (!over || over === d.el || over.parentElement !== d.grid) return;
    const kids = [...d.grid.children];
    if (kids.indexOf(over) < kids.indexOf(d.el)) d.grid.insertBefore(d.el, over);
    else d.grid.insertBefore(d.el, over.nextSibling);
  }
  // 返回：详情页先回列表，其余回桌面（左上角的 ‹ 直接回桌面）
  function goBack() {
    if (view.tab === 'home') return;
    if (view.appSet) { view.appSet = false; return render(); }
    if (view.tab === 'ev' && view.evSet) { view.evSet = false; return render(); }
    if (view.tab === 'map' && view.mapSet) { view.mapSet = false; return render(); }
    if (view.tab === 'dex' && view.dexSet) { view.dexSet = false; return render(); }
    if (view.tab === 'npc' && view.npcSet) { view.npcSet = false; return render(); }
    // 一层层往回：先关掉打开的详情/编辑，都关了才回桌面
    if (view.tab === 'closet' && view.closetItem) view.closetItem = null;
    else if (view.tab === 'closet' && view.closetSet) view.closetSet = null;
    else if (view.tab === 'closet' && view.closetOpen) view.closetOpen = false;
    else if (view.tab === 'dream' && view.dream) view.dream = null;
    else if (view.tab === 'dex' && view.dex) view.dex = null;
    else if (view.tab === 'wiki' && view.wiki) view.wiki = null;
    else if (view.tab === 'npc' && view.npc) view.npc = null;
    else if (view.tab === 'mon' && view.note) view.note = null;
    else if (view.tab === 'cal' && view.calSet) view.calSet = false;
    else if (view.tab === 'cal' && view.editing) view.editing = null;
    else if (view.tab === 'map' && view.mapEdit) { view.mapEdit = false; view.place = null; }
    else if (view.tab === 'map' && (view.place || view.region)) { view.place = null; view.region = null; }
    else { view.tab = 'home'; view.region = null; view.editing = null; view.note = null; view.place = null; view.mapEdit = false; view.dex = null; view.wiki = null; view.dream = null; view.npc = null; view.closetItem = null; }
    render();
  }
  // 从左往右划：返回。上下滑、在能横向滚动的地方（地图、分类条）划、正在打字时都不算
  let swipe = null;
  const NO_SWIPE = '.xsj-mapwrap, .xsj-cats, .xsj-dexcats, .xsj-xtabs, input, textarea, select, .xsj-busy, .xsj-ask';
  function swipeStart(ev) {
    swipe = null;
    if (view.tab === 'home' || view.busy || view.mapEdit || appDrag || typing() || ev.touches.length !== 1) return;
    if (ev.target.closest?.(NO_SWIPE)) return;
    const t = ev.touches[0];
    const body = D.querySelector(`#${ROOT_ID} .xsj-body`);
    swipe = { x: t.clientX, y: t.clientY, body, dx: 0, dy: 0 };
  }
  function swipeMove(ev) {
    if (!swipe) return;
    const t = ev.touches[0];
    swipe.dx = t.clientX - swipe.x; swipe.dy = t.clientY - swipe.y;
    if (Math.abs(swipe.dy) > 30 && Math.abs(swipe.dy) > swipe.dx) { swipeReset(); swipe = null; return; }
    if (swipe.dx > 12 && swipe.body) {
      const d = Math.min(swipe.dx, 180);
      swipe.body.style.transition = 'none';
      swipe.body.style.transform = `translateX(${d * 0.5}px)`;
      swipe.body.style.opacity = String(1 - d / 450);
    }
  }
  function swipeReset() {
    const b = swipe?.body;
    if (!b) return;
    b.style.transition = 'transform .18s, opacity .18s';
    b.style.transform = ''; b.style.opacity = '';
  }
  function swipeEnd() {
    if (!swipe) return;
    const s = swipe; swipe = null;
    if (s.dx > 80 && Math.abs(s.dy) < s.dx * 0.6) { swallowClick = false; goBack(); return; }
    swipe = s; swipeReset(); swipe = null;
  }
  function appPointerMove(ev) {
    const d = appDrag;
    if (!d) return;
    d.lx = ev.clientX; d.ly = ev.clientY;
    if (!d.live) {
      // 还没到长按时间就挪动了：是在滑动页面，不算长按
      if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) > 8) { clearTimeout(d.timer); appDrag = null; }
      return;
    }
    ev.preventDefault();
    moveGhost(ev);
  }
  function appPointerUp() {
    const d = appDrag;
    if (!d) return;
    clearTimeout(d.timer);
    appDrag = null;
    if (!d.live) return;
    d.ghost.remove();
    d.el.classList.remove('is-holding');
    const order = [...d.grid.querySelectorAll('.xsj-app')].map((b) => b.dataset.tab);
    if (order.join() !== appOrder().filter((a) => a.k !== 'cal').map((a) => a.k).join()) { settings.appOrder = order; saveSettings(settings); }
    // 松手后再重画，补上「完成」按钮和提示（等这次松手带出的 click 过去）
    setTimeout(() => { if (view.tab === 'home') render(); }, 0);
  }

  // ---------- 📖 图鉴：像 RPG 游戏里那样，编号格子，遇到过的点亮，没遇到的是问号 ----------
  const RARITY = [null, { n: '普通', c: '#a3aab5' }, { n: '少见', c: '#5cc27e' }, { n: '稀有', c: '#4aa0f5' }, { n: '珍稀', c: '#b276f5' }, { n: '传说', c: '#f3c34a' }];
  const rarN = (r) => Math.min(5, Math.max(1, Math.round(Number(r) || 1)));
  const rar = (r) => RARITY[rarN(r)];
  const pad3 = (n) => String(n || 0).padStart(3, '0');
  const txt = (s) => String(s ?? '').trim();
  // 按时代的几套提示词：task 到 img 每套各写各的，其余共用；每个聊天记自己选的（chat.dexEra）
  const DEX_ERAS = {
    "auto": [
      "自动",
      {
        "task": "任务：给这个故事做一本物品图鉴。先看世界书和剧情，判断这是什么时代、什么世界、什么生活圈子，只收这个世界里真的会有的东西；不要套用游戏图鉴的野兽、矿石、草药，除非这个世界本来就是那样。优先收跟剧情和人物有关的具体东西：谁用的、谁送的、在哪见过。不收录主要角色、{{user}}和有名有姓的人。",
        "cat": "按这个世界来定，2-3字",
        "keys": "来历、材质、用途、讲究",
        "attrs": "attrs 3-4条，键名按这件东西和这个时代换成合适的，值要具体",
        "desc": "说明，40-80字，像这个时代的人写的物品介绍，写清样子、用法和它在这个世界里的分量",
        "flavor": "这个世界里的人说起它时的一句话，口吻符合时代，不超过25字",
        "img": "画它的英文 danbooru tag：主体的外形、材质、颜色和摆放的环境，符合这个时代，不画人物"
      }
    ],
    "tribe": [
      "部落",
      {
        "task": "任务：给这个原始、部落世界做一本图鉴，收录野兽、猎物、草药、石器骨器、兽皮衣饰、吃食、图腾祭物，按世界书里的地域和族群来定，不出现金属工业品和文字书籍，除非设定里有。不收录主要角色、{{user}}和有名有姓的人。",
        "cat": "野兽|草药|器具|衣饰|吃食|图腾",
        "keys": "栖息地、习性、用途、危险度",
        "attrs": "attrs 3-4条，键名按东西换：活物写 栖息地、习性、危险度；草药写 生长处、药性、采法；器具写 材料、做法、用处；图腾写 来历、忌讳",
        "desc": "说明，40-80字，像族里老人讲给后辈听的，写清怎么认、怎么用、要小心什么",
        "flavor": "族里人的一句老话或禁忌，不超过25字",
        "img": "画它的英文 danbooru tag：主体外观、姿态与所处环境，primitive、bone、fur、stone、leather 这类材质，不画人物"
      }
    ],
    "ancient": [
      "古代",
      {
        "task": "任务：给这个古代故事做一本博物图鉴，收录器物、服饰首饰、文房、药材香料、吃食茶酒、兵器、花木鸟兽、节令物，按世界书的朝代、地域和人物身份来定（宫廷、世家、市井、江湖用的东西不一样）。不出现后世才有的东西。不收录主要角色、{{user}}和有名有姓的人。",
        "cat": "器物|服饰|文房|药材|吃食|兵器|花木|节令",
        "keys": "材质、出处、规制、讲究",
        "attrs": "attrs 3-4条，键名按东西换：器物写 材质、窑口或产地、规制；服饰写 料子、纹样、什么身份能穿；药材写 药性、炮制、忌口；吃食写 做法、时令、哪家的好；值多用当时的叫法，价钱用银两铜钱",
        "desc": "说明，40-80字，半文半白，像博物志或掌柜的介绍，写清形制、用处和来历",
        "flavor": "一句当时人的话：俗语、诗句口吻、行话或掌故，自己写不引用现成诗词，不超过25字",
        "img": "画它的英文 danbooru tag：主体的形制、材质、纹样和陈设，ancient chinese style、porcelain、silk、jade、lacquerware、wooden table、candlelight 这类合适的词，不画人物"
      }
    ],
    "minguo": [
      "民国",
      {
        "task": "任务：给这个民国（近代）故事做一本旧物图鉴，收录舶来品、衣饰、报刊唱片、香烟火柴、点心西餐、家具电器、车船票证、书信信物，按世界书的城市、年份和人物身份来定（公馆、里弄、码头、学堂、梨园）。不出现年份对不上的东西。不收录主要角色、{{user}}和有名有姓的人。",
        "cat": "舶来品|衣饰|报刊|点心|家什|票证|信物",
        "keys": "产地、牌子、时价、去处",
        "attrs": "attrs 3-4条，键名按东西换：产地、牌子（可以虚构，不用真实商标）、时价（大洋、角、铜板）、哪里买、什么人用、流行的年份",
        "desc": "说明，40-80字，像旧报纸的商品介绍或老先生的回忆，写清样子、时髦在哪、谁家会有",
        "flavor": "一句广告词、弄堂闲话或报上的短评，不超过25字",
        "img": "画它的英文 danbooru tag：主体外形、材质和环境，1930s、republic of china era、vintage、art deco、sepia tones、wooden counter 这类合适的词，不画人物，不写文字"
      }
    ],
    "modern": [
      "现代",
      {
        "task": "任务：给这个现代故事做一本生活物品图鉴，收录餐食饮料、衣服配饰、数码电器、美妆香水、家居文具、车、店铺周边、票根礼物、街头的猫狗和绿植，按人物的职业、收入、城市和生活圈子来定。优先收剧情里用过、送过、吃过、弄坏过的具体那一件，而不是泛泛一类东西。不要野兽、矿石、草药这种游戏图鉴的内容。不收录主要角色、{{user}}和有名有姓的人。",
        "cat": "餐食|穿搭|数码|美妆|家居|礼物|店铺|宠物",
        "keys": "牌子、价格、哪里买、谁的",
        "attrs": "attrs 3-4条，键名按东西换：牌子（可以虚构，不用真实商标）、价格（具体数字）、哪里买、谁的、材质、口味、型号、购入时间；剧情里没说归谁就不写「谁的」",
        "desc": "说明，40-80字，像好物分享或买手写的短评，写清样子、好在哪、跟谁有什么事",
        "flavor": "一句网友评价、店员推荐或当事人的吐槽，口语，不超过25字",
        "img": "画它的英文 danbooru tag：主体的款式、颜色、材质和环境，modern、cafe table、bedroom、shop display、soft daylight 这类合适的词，不画人物，不写品牌和文字"
      }
    ],
    "future": [
      "未来",
      {
        "task": "任务：给这个未来、星际或赛博故事做一本装备与物资图鉴，收录随身装备、义体芯片、武器载具、合成食物、医疗用品、通讯终端、异星生物与植物、旧地球遗物，按世界书的科技水平、星区势力和阶层来定，不要用当代日用品凑数。不收录主要角色、{{user}}和有名有姓的人。",
        "cat": "装备|义体|载具|合成食|医疗|终端|异星生物|旧物",
        "keys": "型号、制造商、权限、能耗",
        "attrs": "attrs 3-4条，键名按东西换：型号、制造商、权限等级、能耗、黑市价、适配、星区、危险等级；名字和型号要像这个世界的命名",
        "desc": "说明，40-80字，像终端里的物资条目，写清功能、限制和谁在用",
        "flavor": "一句广告标语、维修工的抱怨或士兵间的黑话，不超过25字",
        "img": "画它的英文 danbooru tag：主体的结构、材质、发光和环境，science fiction、futuristic、metal、holographic、neon lights、spaceship interior 这类合适的词，不画人物，不写文字"
      }
    ],
    "fantasy": [
      "奇幻",
      {
        "task": "任务：给这个奇幻或仙侠世界做一本图鉴，收录魔物灵兽、灵草异果、法器兵刃、丹药卷轴、矿石材料、奇珍与禁物，按世界书的体系来定（西幻、仙侠、魔法学院的叫法和等级不一样），等级、属性只用这个世界自己的说法。不收录主要角色、{{user}}和有名有姓的人。",
        "cat": "灵兽|灵草|法器|丹药|矿石|奇珍|禁物",
        "keys": "品阶、属性、来历、禁忌",
        "attrs": "attrs 3-4条，键名按东西换：活物写 出没、习性、危险度；草木丹药写 品阶、药性、代价；器物写 品阶、来历、认主条件、禁忌",
        "desc": "说明，40-80字，像宗门典籍或冒险者手册，写清样子、能做什么、代价是什么",
        "flavor": "一句流传的说法、谶语或冒险者的忠告，不超过25字",
        "img": "画它的英文 danbooru tag：主体外观、姿态与所处环境，fantasy、magic、glowing、ornate、ancient 这类合适的词，不画人物"
      }
    ]
  };
  const ERA_KEYS = {"task":"任务","cat":"分类","keys":"属性举例（顿号隔开）","attrs":"属性怎么写","desc":"说明","flavor":"一句话","img":"画图 tag 怎么写"};
  const dexEra = () => (DEX_ERAS[chat.dexEra] ? chat.dexEra : 'auto');
  const DEX_SHARED = {
    open: ['开场', CAL_PROMPTS.open[1]],
    base: ['总要求', CAL_PROMPTS.base[1]],
    found: ["遇到的和没遇到的","found：最近剧情里真实出现、被看到或用到过的（3-10个）；locked：世界书或世界观里有、但剧情里还没遇到的（4-10个），只给一句不剧透的线索。"],
    creature: ["生物的画法","no humans, animal focus"],
    plant: ["植物的画法","no humans, still life, plant focus, botanical"],
    object: ["其他东西的画法","no humans, still life, object focus"],
    tail: ["每张都加（tag 后面）","detailed, atmospheric lighting, full frame"],
    negCreature: ["生物的负面","1girl, 1boy, human"],
    negOther: ["其他的负面","cat, animal, 1girl, 1boy, human, character"],
  };
  const dexDefs = () => {
    const { open, base, found, ...draw } = DEX_SHARED, era = DEX_ERAS[dexEra()][1];
    return { open, base, ...Object.fromEntries(Object.entries(ERA_KEYS).map(([k, n]) => [k, [n, era[k]]])), found, ...draw };
  };
  const dexPrompt = (k) => promptOf('dex', k).replace(/\s*\n\s*/g, ' ');
  const dexEntry = () => `{"name": "名称", "emoji": "一个emoji", "cat": "分类，2-3字，${dexEra() === 'auto' ? '' : '如 '}${dexPrompt('cat')}", "rarity": 1到5的稀有度, "attrs": [${dexPrompt('keys').split(/[、，,]/).map(txt).filter(Boolean).slice(0, 5).map((k) => `{"k": "${k}", "v": "不超过10字"}`).join(', ')}], "desc": "${dexPrompt('desc')}", "flavor": "${dexPrompt('flavor')}", "where": "在剧情里哪里遇到的，10字以内", "img": "${dexPrompt('img')}"}`;
  function dexInfo(x) {
    return {
      emoji: txt(x.emoji) || '❔', cat: txt(x.cat) || '其他', rarity: rarN(x.rarity),
      attrs: Array.isArray(x.attrs) ? x.attrs.filter((a) => a && txt(a.k) && txt(a.v)).slice(0, 5).map((a) => ({ k: txt(a.k), v: txt(a.v) })) : [],
      desc: txt(x.desc), flavor: txt(x.flavor).replace(/^[“"「]|[”"」]$/g, ''), img: txt(x.img),
    };
  }
  // 图鉴 ↔ 地图：按「在哪遇到」和栖息地/产地这类属性，对上地图里的地点名（纯本地，不调 API）
  const WHERE_KEYS = /出处|去处|哪里买|窑口|生长处|星区|栖息|产地|生长|分布|出没|地点|来源|产自|发现/;
  function dexWhereTexts(x) {
    return [x.foundNote, ...(x.attrs || []).filter((a) => WHERE_KEYS.test(a.k)).map((a) => a.v)].map(txt).filter((s) => s && s !== '剧情里遇到');
  }
  const nameHit = (name, s) => s.includes(name) || (s.length >= 3 && name.includes(s));
  function dexForPlace(p) {
    return codex().dex.items.filter((x) => x.found && (dexWhereTexts(x).some((s) => nameHit(p.name, s)) || txt(x.desc).includes(p.name)));
  }
  function dexForRegion(r, mp) {
    const inside = mp.places.filter((p) => p.region === r.name);
    return codex().dex.items.filter((x) => x.found && (dexWhereTexts(x).some((s) => nameHit(r.name, s) || inside.some((p) => nameHit(p.name, s))) || txt(x.desc).includes(r.name)));
  }
  function placesForDex(x) {
    const mp = currentMap();
    if (!mp) return [];
    const ws = dexWhereTexts(x);
    return mp.places.filter((p) => ws.some((s) => nameHit(p.name, s)) || txt(x.desc).includes(p.name)).slice(0, 6);
  }
  const dexLinks = (list) => list.length ? `<div class="xsj-dexlinks">${list.map((x) => `<button data-godex="${x.id}" style="--r:${rar(x.rarity).c}">${esc(x.emoji)} ${esc(x.name)}</button>`).join('')}</div>` : '';
  function dexList() {
    const d = codex().dex;
    const cat = view.dexCat || '全部';
    const list = d.items.filter((x) => cat === '全部' || x.cat === cat);
    return list.length ? list : d.items;
  }
  function dexView() {
    return dexTop() + (view.dexSet ? eraCard() + promptCard('dex') : dexBody());
  }
  function eraCard() {
    return `<div class="xsj-card xsj-set">
        <div class="xsj-set-h">📜 时代背景 <small>只管这个聊天</small></div>
        <div class="xsj-eras">${Object.entries(DEX_ERAS).map(([k, [n]]) => `<button data-dexera="${k}" class="${chat.dexEra === k ? 'on' : ''}">${n}</button>`).join('')}</div>
        <small class="xsj-set-tip">${chat.dexEra ? '换了以后只影响新收的，已有的不动。' : '还没选，第一次点 ✦ 时会问。'}每个时代一套提示词，下面改的是选中的那套。</small>
      </div>`;
  }
  function dexBody() {
    const d = codex().dex;
    if (!d.items.length) {
      return blank('dex', `${esc(appTitle('dex'))}还是空的`, '读世界书和最近剧情：剧情里遇到过的生物、植物、物件会点亮；世界里有、但还没遇到的先锁着，只给一句线索。', blankBtn('gen-dex', '从剧情里收集'));
    }
    const sel = d.items.find((x) => x.id === view.dex);
    if (sel) return dexDetail(sel);
    const cats = ['全部', ...new Set(d.items.map((x) => x.cat).filter(Boolean))];
    if (!cats.includes(view.dexCat)) view.dexCat = '全部';
    const list = dexList();
    const found = d.items.filter((x) => x.found).length;
    const slot = (x) => {
      if (!x.found) return `<button class="xsj-slot is-locked" data-dex="${x.id}"><em>No.${pad3(x.no)}</em><span class="xsj-slot-q">?</span><small>？？？</small></button>`;
      const r = rar(x.rarity);
      const art = view.drawing?.id === x.id ? '<span class="xsj-slot-e">⏳</span>' : x.pic ? `<img src="${esc(x.pic)}" alt="">` : `<span class="xsj-slot-e">${esc(x.emoji)}</span>`;
      return `<button class="xsj-slot${x.isNew ? ' is-new' : ''}" data-dex="${x.id}" style="--r:${r.c}"><em>No.${pad3(x.no)}</em>${art}<i>${'★'.repeat(rarN(x.rarity))}</i><small>${esc(x.name)}</small></button>`;
    };
    return `<div class="xsj-dexbar"><div><b>收集进度</b><span>${found} / ${d.items.length}</span></div><i><em style="width:${Math.round((found / d.items.length) * 100)}%"></em></i></div>
      ${cats.length > 2 ? `<div class="xsj-dexcats">${cats.map((c) => `<button data-dexcat="${esc(c)}" class="${c === view.dexCat ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>` : ''}
      <div class="xsj-dexgrid">${list.map(slot).join('')}</div>
`;
  }
  function dexDetail(x) {
    const arrow = (n) => `<button data-act="dex-step" data-n="${n}" class="xsj-dexarrow ${n < 0 ? 'is-l' : 'is-r'}" title="${n < 0 ? '上一个' : '下一个'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${n < 0 ? 'M14.500 5.500 8 12l6.500 6.500' : 'M9.500 5.500 16 12l-6.500 6.500'}"/></svg></button>`;
    const nav = dexList().length > 1 ? arrow(-1) + arrow(1) : '';
    if (!x.found) {
      return `<div class="xsj-dexcard is-locked"><div class="xsj-dexart">${nav}<span class="xsj-slot-q">?</span></div>
        <div class="xsj-dexname"><em>No.${pad3(x.no)}</em><b>？？？</b><small>${esc(x.cat)}</small></div>
        <div class="xsj-dexflavor">🔒 线索：${esc(x.hint || '尚未遇见')}</div>
        <div class="xsj-dexacts"><button data-act="dex-unlock" class="xsj-dexbtn">已经遇到了，解锁</button></div></div>`;
    }
    const r = rar(x.rarity);
    const drawing = view.drawing?.id === x.id;
    const art = drawing ? drawingBox(x.id, 'xsj-drawing-big') : x.pic ? `<img src="${esc(x.pic)}" alt="">` : `<span class="xsj-dexart-e">${esc(x.emoji)}</span>`;
    const n = rarN(x.rarity);
    return `<div class="xsj-dexcard" style="--r:${r.c}">
      <div class="xsj-dexart${drawing ? ' is-drawing' : ''}">${nav}${art}</div>
      <div class="xsj-dexname"><em>No.${pad3(x.no)}</em><b>${esc(x.name)}</b><small>${esc(x.emoji)} ${esc(x.cat)} · <i style="color:${r.c}">${'★'.repeat(n)}${'☆'.repeat(5 - n)} ${r.n}</i></small></div>
      ${x.attrs?.length ? `<div class="xsj-dexattrs">${x.attrs.map((a) => `<div><span>${esc(a.k)}</span>${esc(a.v)}</div>`).join('')}</div>` : ''}
      ${x.desc ? `<div class="xsj-dexdesc">${esc(x.desc)}</div>` : ''}
      ${x.flavor ? `<div class="xsj-dexflavor">“${esc(x.flavor)}”</div>` : ''}
      ${x.foundAt || x.foundNote ? `<div class="xsj-dexfound">首次发现 · ${esc([x.foundAt, x.foundNote].filter(Boolean).join(' · '))}</div>` : ''}
      ${(() => { const ps = placesForDex(x); return ps.length ? `<div class="xsj-dexplaces"><span>在地图上</span>${ps.map((p) => `<button data-goplace="${p.id}">📍 ${esc(p.name)}</button>`).join('')}</div>` : ''; })()}
      <div class="xsj-dexacts">
        <button data-act="quote" data-kind="dex" data-id="${x.id}" class="xsj-dexbtn">📎 附带</button>
        <button data-act="dex-del" class="xsj-dexbtn xsj-dexdel">删除</button>
      </div></div>`;
  }
  function dexInstr() {
    const d = codex().dex;
    const sd = storyDate();
    const known = d.items.map((x) => `${x.name}（${x.found ? '已发现' : '未发现'}）`).join('、');
    return [
      ...baseInstr(sd.y, sd.m, false, 'dex'),
      dexPrompt('task'),
      dexPrompt('found'),
      known ? `图鉴里已经有：${known}。已有的不要重复收录；如果某个“未发现”的这次在剧情里出现了，把它放进 found，名字保持一致。` : '',
      `JSON 结构：{"found": [${dexEntry()}], "locked": [{"name": "名称", "emoji": "一个emoji", "cat": "分类", "rarity": 1到5, "hint": "不剧透的线索，20字以内"}]}  // ${dexPrompt('attrs')}`,
    ].filter(Boolean).join('\n');
  }
  async function generateDex() {
    if (view.busy) return;
    const d = codex().dex;
    const sd = storyDate();
    const instr = dexInstr();
    const data = await callAI(instr, `正在整理${appTitle('dex')}…`, true, false);
    if (!data) return;
    const nextNo = () => d.items.reduce((m, x) => Math.max(m, x.no || 0), 0) + 1;
    const today = dateKey(sd);
    let added = 0, unlocked = 0, locked = 0;
    for (const x of Array.isArray(data.found) ? data.found : []) {
      const name = txt(x?.name);
      if (!name) continue;
      const info = dexInfo(x);
      const old = d.items.find((o) => o.name === name);
      if (old) {
        if (!old.found) { Object.assign(old, info, { found: true, isNew: true, foundAt: today, foundNote: txt(x.where) }); unlocked++; }
        continue;
      }
      d.items.push({ id: uid(), no: nextNo(), name, ...info, found: true, isNew: true, foundAt: today, foundNote: txt(x.where), pic: '' });
      added++;
    }
    for (const x of Array.isArray(data.locked) ? data.locked : []) {
      const name = txt(x?.name);
      if (!name || d.items.some((o) => o.name === name)) continue;
      d.items.push({ id: uid(), no: nextNo(), name, emoji: txt(x.emoji) || '❔', cat: txt(x.cat) || '其他', rarity: rarN(x.rarity), hint: txt(x.hint), found: false, pic: '' });
      locked++;
    }
    saveChat();
    toast(added + unlocked + locked ? `新收录 ${added}，解锁 ${unlocked}，待发现 ${locked}` : '这次没有新东西', added + unlocked ? 'success' : 'info');
    render();
  }
  // 手动解锁、或者老条目没有说明时：单独补全一条
  async function fillDex(x) {
    if (view.busy) return;
    const sd = storyDate();
    const instr = [
      ...baseInstr(sd.y, sd.m, false, 'dex'),
      `为${appTitle('dex')}补全一条：「${x.name}」（${x.cat}）。依据世界书、人物设定与最近剧情来写；名字保持不变。`,
      dexPrompt('attrs'),
      `JSON 结构：${dexEntry()}`,
    ].join('\n');
    const data = await callAI(instr, `正在补全「${x.name}」…`, true, false);
    if (!data) return;
    const info = dexInfo(data.entry || data);
    Object.assign(x, info, { emoji: info.emoji === '❔' ? x.emoji : info.emoji });
    if (!x.foundNote) x.foundNote = txt((data.entry || data).where);
    saveChat();
    render();
  }
  // 图鉴图：一定写 no humans；生物写 animal focus，其余（植物、食材、器物、矿石……）写成静物，并在负面里排除猫、动物和人
  // （以前用的 solo focus 会让 NovelAI 自己塞一个角色进来，最常见的就是猫）
  const DEX_CREATURE = /兽|禽|鸟|鱼|虫|蛇|龙|妖|魔|怪|生物|动物|宠|精灵/;
  async function drawDexPic(x, label) {
    const tags = cleanTags(x.img);
    const creature = DEX_CREATURE.test(x.cat || '');
    const plant = /植物|花|草|树|菌|药/.test(x.cat || '');
    const focus = dexPrompt(creature ? 'creature' : plant ? 'plant' : 'object');
    const pic = await drawImage({
      prompt: [focus, tags, dexPrompt('tail')].filter(Boolean).join(', '),
      nl: tags ? '' : [x.name, x.desc].filter(Boolean).join('。'),
      negative: dexPrompt(creature ? 'negCreature' : 'negOther'),
      size: 'portrait',
    }, label, x.id);
    if (pic) { x.pic = pic; saveChat(); render(); }
    return !!pic;
  }

  // ---------- 🌿 生活百科：在这个世界怎么过日子 ----------
  function wikiView() {
    const w = codex().wiki;
    if (!w.items.length) {
      return blank('wiki', `${esc(appTitle('wiki'))}还是空的`, '读世界书和最近剧情，写给刚来到这个世界的人：吃什么、用什么、怎么做、有什么规矩。', blankBtn('gen-wiki', '编写百科'));
    }
    const sel = w.items.find((x) => x.id === view.wiki);
    if (sel) {
      const drawing = view.drawing?.id === sel.id;
      return `<div class="xsj-card xsj-wikid">
          ${drawing ? drawingBox(sel.id, 'xsj-drawing-place') : sel.pic ? `<img class="xsj-place-pic" src="${esc(sel.pic)}" alt="">` : ''}
          <div class="xsj-place-top"><span class="xsj-place-e">${esc(sel.emoji)}</span><div><b>${esc(sel.title)}</b><small>${esc(sel.cat)}</small></div><button data-act="quote" data-kind="wiki" data-id="${sel.id}" class="xsj-x" title="附带给下一次回复">📎</button></div>
          ${sel.summary ? `<div class="xsj-wikisum">${esc(sel.summary)}</div>` : ''}
          ${sel.body ? `<div class="xsj-note-text">${esc(sel.body)}</div>` : ''}
          ${sel.steps?.length ? `<ol class="xsj-wikisteps">${sel.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
          ${sel.tip ? `<div class="xsj-wikitip">💡 ${esc(sel.tip)}</div>` : ''}
          <div class="xsj-row2" style="margin-top:8px"><button data-act="wiki-del" class="xsj-danger">删除</button></div>
        </div>`;
    }
    const cats = ['全部', ...new Set(w.items.map((x) => x.cat).filter(Boolean))];
    if (!cats.includes(view.wikiCat)) view.wikiCat = '全部';
    const list = w.items.filter((x) => view.wikiCat === '全部' || x.cat === view.wikiCat);
    return `${cats.length > 2 ? `<div class="xsj-cats">${cats.map((c) => `<button data-wikicat="${esc(c)}" class="${c === view.wikiCat ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>` : ''}
      ${list.map((x) => `<button class="xsj-wikirow" data-wiki="${x.id}">${x.pic ? `<img src="${esc(x.pic)}" alt="">` : `<i>${esc(x.emoji)}</i>`}<span><b>${esc(x.title)}</b><small>${esc(x.summary)}</small></span><em>${esc(x.cat)}</em></button>`).join('')}`;
  }
  function wikiInstr() {
    const w = codex().wiki;
    const sd = storyDate();
    return [
      ...baseInstr(sd.y, sd.m, false, 'wiki'),
      wikiPrompt('task'),
      w.items.length ? `已经写过：${w.items.map((x) => x.title).join('、')}。不要重复，写新的。` : '',
      w.title ? `百科名已经定为「${w.title}」，沿用。` : `title：符合世界观的百科名字，2-8字（如“部落生存指南”“修真日用杂记”“城市生活手册”）。`,
      `JSON 结构：{"title": "百科名", "items": [{"cat": "分类，2字，如 饮食|工具|技能|习俗|禁忌|医药|天气|出行，按世界观换", "emoji": "一个emoji", "title": "条目名，不超过12字", "summary": "一句话说明，20字以内", "body": "${wikiPrompt('body')}", "steps": ["${wikiPrompt('steps')}"], "tip": "${wikiPrompt('tip')}", "img": "${wikiPrompt('img')}"}]}  // 6-10条，分类分散`,
    ].filter(Boolean).join('\n');
  }
  async function generateWiki() {
    if (view.busy) return;
    const w = codex().wiki;
    const instr = wikiInstr();
    const data = await callAI(instr, `正在编写${appTitle('wiki')}…`, true, false);
    if (!data) return;
    const items = (Array.isArray(data.items) ? data.items : []).filter((x) => x && txt(x.title) && !w.items.some((o) => o.title === txt(x.title)));
    w.items.push(...items.slice(0, capN(12)).map((x) => ({
      id: uid(), cat: txt(x.cat) || '其他', emoji: txt(x.emoji) || '📄', title: txt(x.title), summary: txt(x.summary), body: txt(x.body),
      steps: Array.isArray(x.steps) ? x.steps.map(txt).filter(Boolean).slice(0, 8) : [], tip: txt(x.tip), img: txt(x.img), pic: '',
    })));
    if (!w.title && txt(data.title)) w.title = txt(data.title).slice(0, 10);
    saveChat();
    toast(items.length ? `加了 ${Math.min(items.length, capN(12))} 条` : '这次没有新条目', items.length ? 'success' : 'info');
    render();
  }
  async function drawWikiPic(x, label) {
    const tags = cleanTags(x.img);
    const pic = await drawImage({ prompt: ['no humans', tags || 'still life', wikiPrompt('tail')].filter(Boolean).join(', '), nl: tags ? '' : `${x.title}。${x.body}`, size: 'landscape' }, label, x.id);
    if (pic) { x.pic = pic; saveChat(); render(); }
    return !!pic;
  }

  // ---------- 👗 衣橱：一人一个文件夹，里面有单品和套装 ----------
  // chat.closet[key] = { style, points, want, items: [单品], sets: [套装] }；key：char、user、n:名字
  const CLOSET_CATS = ['上衣', '下装', '连衣裙', '外套', '鞋', '配饰', '贴身', '其他'];
  const CLOSET_SCENES = ['不限', '日常', '约会', '工作', '正式', '睡衣', '运动', '节庆'];
  const CLOSET_SEASONS = [['auto', '跟剧情日期'], ['春', '春'], ['夏', '夏'], ['秋', '秋'], ['冬', '冬']];
  function closet() {
    if (!chat.closet || typeof chat.closet !== 'object') chat.closet = {};
    const keys = ['char', 'user', ...Object.keys(chat.closet).filter((k) => k.startsWith('n:'))];
    for (const w of keys) {
      const v = chat.closet[w];
      if (!v || typeof v !== 'object' || !Array.isArray(v.items)) chat.closet[w] = { style: '', items: [] };
      if (!Array.isArray(chat.closet[w].sets)) chat.closet[w].sets = [];
    }
    return chat.closet;
  }
  const closetKeys = () => ['char', 'user', ...Object.keys(closet()).filter((k) => k.startsWith('n:'))];
  const closetWho = () => (closetKeys().includes(view.closetWho) ? view.closetWho : 'char');
  function whoName(w) {
    try { return w === 'user' ? (substitudeMacros('{{user}}') || '我') : (getCurrentCharacterName() || substitudeMacros('{{char}}') || '角色'); } catch (e) { return w === 'user' ? '我' : '角色'; }
  }
  const closetName = (w) => (String(w).startsWith('n:') ? w.slice(2) : whoName(w).replace(/\s+v?\d+(?:\.\d+)*$/i, '') || whoName(w));
  const closetOf = () => closet()[closetWho()];
  const CLOSET_PROMPTS = {
    open: ['开场', CAL_PROMPTS.open[1]],
    base: ['总要求', CAL_PROMPTS.base[1]],
    style: ['读穿衣风格', '只读设定，不看聊天正文。style：一句话概括这个人的穿衣风格，30字以内，写清常穿的款式、颜色、料子、配饰；设定里写得少就写得短，不发挥。points：设定里明确写到的穿衣喜好、常穿的衣服、颜色、料子、首饰，一条一个，v 是简短的说法（10字以内），src 从设定里一字不差抄下那一小段原文（4-40字），程序会拿去核对，对不上的会被扔掉；没写就给空数组。'],
    item: ['单品', '每件都具体到款式、颜色、料子和一个记得住的细节，像真的挂在这个人衣橱里，不要泛泛的“白衬衫”。设定里写过的衣服优先，名字和细节照设定写，并从设定里一字不差抄一小段原文放进 src；设定没写、你补的，src 留空。'],
    set: ['套装', '每套从头到脚搭完整：衣服、鞋、至少一样配饰。优先用衣橱里已有的单品搭，缺的才新做，新做的放进 new。几套之间风格、颜色要拉开，但都要像这个人会穿的。'],
    fit: ['怎么算合适', '符合这个人的身份、性格、经济状况、年代地区和季节；不出现这个年代、这个世界没有的东西。'],
    want: ['自己写的要求怎么用', '这是{{user}}的要求，优先满足；和设定或世界观冲突时，在这个世界里找最接近的样子。'],
    img: ['单品画图 tag 怎么写', '画这件衣服本身的英文 danbooru tag，平铺或挂在衣架上，写清款式、颜色、料子、细节，不画人'],
    wear: ['穿着的 tag 怎么写', '这套穿在人身上的英文 danbooru tag，按外套、上衣、下装、鞋、配饰的顺序，写清颜色和款式，不写人、发型、表情、姿势'],
    pItem: ['单品图：前面', 'no humans, still life, clothes focus'],
    pSet: ['套装平铺图：前面', 'no humans, still life, clothes focus, outfit flat lay, neatly arranged, from above'],
    pTail: ['平铺图：后面', 'simple background, soft lighting, detailed fabric texture'],
    pWear: ['上身图：构图', 'solo, full body, standing, front view, looking at viewer'],
    pWearTail: ['上身图：后面', 'simple background, white background, even lighting'],
    pWearNeg: ['上身图：负面', '2::multiple views::, character sheet, reference sheet, multiple people, nude, close-up'],
  };
  const closetPrompt = (k) => promptOf('closet', k).replace(/\s*\n\s*/g, ' ');
  // 原文核对用的设定：世界书、角色卡；给你自己读风格时加上人设
  async function closetBlocks(w) {
    const out = await settingBlocks();
    if (w === 'user') try { const p = substitudeMacros(String(stCtx()?.powerUserSettings?.persona_description || '')); if (p.trim()) out.push(bareText(whoName('user') + '\n' + p)); } catch (e) {}
    return out;
  }
  const srcOk = (src, name, blocks) => { const x = bareText(src), n = bareText(name); return x.length >= 3 && blocks.some((b) => b.includes(x) && (!n || b.includes(n))); };
  const closetWhoLine = (w) => (w === 'user' ? '{{user}}本人，看人设（persona）' : w === 'char' ? '看角色卡' : '看世界书和角色卡里写到这个人的地方');
  async function readClosetStyle(w) {
    if (view.busy) return false;
    const name = closetName(w), sd = storyDate();
    const instr = [...baseInstr(sd.y, sd.m, false, 'closet'), `任务：读「${name}」的穿衣风格（${closetWhoLine(w)}）。`, closetPrompt('style'), 'JSON 结构：{"style": "一句话", "points": [{"v": "简短说法", "src": "设定原文"}]}'].filter(Boolean).join('\n');
    const data = await callAI(instr, `正在读${name}的穿衣风格…`, true, true);
    if (!data) return false;
    const W0 = closet()[w], blocks = await closetBlocks(w);
    W0.points = (Array.isArray(data.points) ? data.points : []).filter((x) => x && txt(x.v) && srcOk(x.src, name, blocks)).slice(0, 12).map((x) => txt(x.v).slice(0, 14));
    if (txt(data.style)) W0.style = txt(data.style).slice(0, 80);
    saveChat(); render();
    return !!W0.style;
  }
  function closetInstr(w, o) {
    const W0 = closet()[w], name = closetName(w), sd = storyDate(), set = o.kind === 'set';
    const season = o.season === 'auto' ? `${sd.m}月的季节` : `${o.season}季`;
    const ITEM = `{"cat": "${CLOSET_CATS.join('|')}", "emoji": "一个emoji", "name": "具体的衣服名，不超过14字", "color": "颜色", "material": "料子", "desc": "样子和细节，30-60字", "when": "平时什么时候穿，10字以内", "note": "来历，或${name}对它的一句话，20字以内，可以空", "src": "设定里写过就抄原文，否则空", "img": "${closetPrompt('img')}"}`;
    return [
      ...baseInstr(sd.y, sd.m, false, 'closet'),
      `任务：给「${name}」的衣橱${set ? `搭 ${o.count} 套衣服` : `添 ${o.count} 件单品`}（${closetWhoLine(w)}）。正好 ${o.count} ${set ? '套' : '件'}。`,
      W0.style ? `穿衣风格：${W0.style}${W0.points?.length ? `（设定里写过：${W0.points.join('、')}）` : ''}。都要照这个来。` : '',
      `场合：${o.scene === '不限' ? '不限，分散一些' : o.scene}。季节：${season}。`,
      closetPrompt(set ? 'set' : 'item'), set ? closetPrompt('item') : '', closetPrompt('fit'),
      o.want ? `要求：${o.want}\n${closetPrompt('want')}` : '',
      W0.items.length ? `衣橱里已经有：${W0.items.map((x) => `${x.name}（${[x.cat, x.color].filter(Boolean).join('，')}）`).join('、')}。${set ? '搭配时直接写名字，一字不差。' : '不要重复。'}` : '',
      set && W0.sets.length ? `已经有这些套装，不要重复：${W0.sets.map((x) => x.name).join('、')}` : '',
      set ? `JSON 结构：{"new": [${ITEM}], "sets": [{"name": "这套的名字，不超过10字", "scene": "场合，4字以内", "desc": "整体样子和搭配的心思，40-70字", "note": "${name}会怎么说这套，20字以内，可以空", "items": ["用到的单品名，已有的或 new 里的，3-7 件"], "wear": "${closetPrompt('wear')}"}]}`
        : `JSON 结构：{"items": [${ITEM}]}`,
    ].filter(Boolean).join('\n');
  }
  async function generateCloset(w, o) {
    if (view.busy) return;
    const name = closetName(w);
    // 第一次先读风格，读不到就算了，照样生成
    if (!closet()[w].style) { const ok = await readClosetStyle(w); if (!ok && stoppedAt > Date.now() - 1500) return; }
    const data = await callAI(closetInstr(w, o), `正在给${name}${o.kind === 'set' ? '搭衣服' : '添衣服'}…`, true, false);
    if (!data) return;
    const W0 = closet()[w], blocks = await closetBlocks(w);
    const add = (arr, max) => (Array.isArray(arr) ? arr : []).filter((x) => x && txt(x.name) && !W0.items.some((k) => k.name === txt(x.name).slice(0, 20))).slice(0, max).map((x) => {
      const it = { id: uid(), cat: CLOSET_CATS.includes(txt(x.cat)) ? txt(x.cat) : '其他', emoji: txt(x.emoji) || '👕', name: txt(x.name).slice(0, 20), color: txt(x.color), material: txt(x.material), desc: txt(x.desc), when: txt(x.when), note: txt(x.note), fromPersona: !!txt(x.src) && srcOk(x.src, name, blocks), img: txt(x.img), pic: '', fav: false };
      W0.items.unshift(it); return it;
    });
    let n = 0;
    if (o.kind === 'set') {
      const fresh = add(data.new, 20);
      for (const x of (Array.isArray(data.sets) ? data.sets : []).slice(0, o.count)) {
        const ids = [...new Set((Array.isArray(x?.items) ? x.items : []).map((v) => { const t = txt(v?.name || v).slice(0, 20); return (W0.items.find((k) => k.name === t) || W0.items.find((k) => t.length >= 3 && (k.name.includes(t) || t.includes(k.name))))?.id; }).filter(Boolean))];
        if (!txt(x?.name) || ids.length < 2) continue;
        W0.sets.unshift({ id: uid(), name: txt(x.name).slice(0, 14), scene: txt(x.scene).slice(0, 6), desc: txt(x.desc), note: txt(x.note), ids, wear: txt(x.wear), pic: '', wearPic: '', fav: false });
        n++;
      }
      if (n || fresh.length) toast(`搭了 ${n} 套${fresh.length ? `，新添 ${fresh.length} 件单品` : ''}`, 'success');
    } else { n = add(data.items, o.count).length; if (n) toast(`${name}的衣橱里添了 ${n} 件`, 'success'); }
    if (!n) toast('这次没搭出来，再试一次', 'warning');
    view.closetTab = o.kind === 'set' ? 'set' : 'item'; view.closetCat = '';
    saveChat(); render();
  }
  // 生成前选：单品还是一套、场合、季节、几件、自己的要求
  function askCloset(w) {
    return new Promise((resolve) => {
      const W0 = closet()[w], o = { kind: view.closetTab === 'set' ? 'set' : 'item', scene: '不限', season: 'auto', count: 0, ...(settings.closetOpt || {}) };
      o.kind = view.closetTab === 'set' ? 'set' : 'item';
      const memo = { ...(settings.closetOpt?.counts || {}) };
      let want = W0.want || '';
      const counts = () => (o.kind === 'set' ? [1, 3] : [4, 8]);
      const box = D.createElement('div');
      box.className = 'xsj-ask';
      const row = (h, k, opts) => `<small class="xsj-seg-h">${h}</small><div class="xsj-cchips">${opts.map(([v, t]) => `<button data-k="${k}" data-v="${v}" class="${String(o[k]) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
      const draw = () => {
        o.count = numOk(o.kind, memo[o.kind]) || counts()[o.kind === 'set' ? 0 : 1];
        box.innerHTML = `<div class="xsj-ask-card xsj-regen-card xsj-closet-ask"><div>给${esc(closetName(w))}${o.kind === 'set' ? '搭一套' : '添衣服'}</div>${W0.style ? `<small class="xsj-seg-tip">照「${esc(W0.style)}」来</small>` : '<small class="xsj-seg-tip">第一次会先读一遍穿衣风格，多一次请求</small>'}
          ${row('要什么', 'kind', [['item', '单品'], ['set', '一整套']])}${row('场合', 'scene', CLOSET_SCENES.map((x) => [x, x]))}${row('季节', 'season', CLOSET_SEASONS)}${row(o.kind === 'set' ? '几套' : '几件', 'count', counts().map((x) => [x, x])).replace(/<.div>$/, numIn(o.kind, o.count, counts()) + '</div>')}
          <small class="xsj-seg-h">你的要求（可以不填）</small><textarea data-want class="xsj-closet-want" rows="2" placeholder="比如：见家长穿的，别太素">${esc(want)}</textarea>
          <button data-go class="xsj-primary">${o.kind === 'set' ? '搭' : '添'}</button><button data-cancel class="xsj-regen-cancel">取消</button></div>`;
      };
      draw();
      box.addEventListener('input', (ev) => { const k = ev.target.dataset.numin, n = k && numOk(k, ev.target.value); if (n) memo[k] = o.count = n; });
      box.addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        want = box.querySelector('[data-want]').value.trim();
        if (b.dataset.k === 'count') { memo[o.kind] = Number(b.dataset.v); draw(); return; }
        if (b.dataset.k) { o[b.dataset.k] = b.dataset.v; draw(); return; }
        box.remove();
        if (!b.hasAttribute('data-go')) return resolve(null);
        W0.want = want.slice(0, 200); saveChat();
        settings.closetOpt = { scene: o.scene, season: o.season, counts: memo }; saveSettings(settings);
        resolve({ ...o, want: W0.want });
      });
      D.getElementById(ROOT_ID)?.querySelector('.xsj-screen')?.appendChild(box);
    });
  }
  // 加一个人的文件夹：从人物图鉴挑，或者写名字
  function askClosetName() {
    return new Promise((resolve) => {
      const has = new Set(closetKeys().map(closetName)), people = npcData().items.map((p) => p.name).filter((n) => !has.has(n)).slice(0, 30);
      const box = D.createElement('div');
      box.className = 'xsj-ask';
      box.innerHTML = `<div class="xsj-ask-card xsj-regen-card xsj-closet-ask"><div>给谁加一个衣橱？</div>${people.length ? `<small class="xsj-seg-h">人物图鉴里的人</small><div class="xsj-cchips">${people.map((n) => `<button data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}<small class="xsj-seg-h">或者写名字</small><input data-name class="xsj-closet-want" maxlength="20" placeholder="名字"><button data-go class="xsj-primary">加上</button><button data-cancel class="xsj-regen-cancel">取消</button></div>`;
      box.addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        const n = b.dataset.n || (b.hasAttribute('data-go') ? box.querySelector('[data-name]').value.trim() : '');
        if (b.hasAttribute('data-go') && !n) return;
        box.remove(); resolve(n || null);
      });
      D.getElementById(ROOT_ID)?.querySelector('.xsj-screen')?.appendChild(box);
    });
  }
  // 正在穿：「今天穿这套 / 这件」记在这里，直到换衣服
  const WEAR_DROP = /^(?:no humans|still life|clothes focus|flat lay|simple background|white background|hanging|clothes hanger|hanger|on hanger|folded|laid out|product photo.*|outfit.*|display)$/;
  function wearTags(key) {
    const W0 = closet()[key], w = (chat.wear || {})[key];
    if (!W0 || !w) return null;
    const st = W0.sets.find((x) => x.id === w.set), its = (w.items || []).map((id) => W0.items.find((x) => x.id === id)).filter(Boolean);
    const tags = tagList(st?.wear, ...its.map((x) => x.img)).filter((t) => !WEAR_DROP.test(bareTag(t)) && !isPerson(t)).slice(0, 14).join(', ');
    const label = [st?.name, ...its.map((x) => x.name)].filter(Boolean).join(' + ');
    return tags ? { key, name: closetName(key), tags, label } : null;
  }
  const wearNow = () => Object.keys(chat.wear || {}).map(wearTags).filter(Boolean);
  function putOn(key, kind, id) {
    const all = { ...(chat.wear || {}) }, W0 = closet()[key];
    if (kind === 'set') all[key] = { set: id, items: [], at: dateKey(storyDate()) };
    else {
      const cat = W0.items.find((x) => x.id === id)?.cat, old = all[key] || { set: '', items: [] };
      // 同一类的换掉，不同类的加上
      all[key] = { ...old, items: [...(old.items || []).filter((i) => W0.items.find((x) => x.id === i)?.cat !== cat), id], at: dateKey(storyDate()) };
    }
    chat.wear = all; saveChat();
  }
  function takeOff(key, why) {
    if (!chat.wear?.[key]) return;
    const was = wearTags(key), all = { ...chat.wear };
    delete all[key]; chat.wear = all; saveChat();
    if (was && why) toast(`${was.name}换下了「${was.label}」`);
  }
  function closetTop() {
    const head = (...a) => topBar('is-closet', ...a), set = topBtn('app-set', 'set', '衣橱设置', true);
    if (view.appSet) return head('衣橱设置', '');
    if (!view.closetOpen) return head('衣橱', `${closetKeys().length} 个人`, set);
    const W0 = closetOf(), it = W0.items.find((x) => x.id === view.closetItem), st = W0.sets.find((x) => x.id === view.closetSet);
    const stop = view.batch ? topBtn('cancel-gen', 'stop', '停止生图') : '';
    const one = (x, act) => stop || (view.drawing?.id === x.id ? '' : topBtn(act, 'img', x.pic ? '重画这张' : '画这张', true, ` data-id="${x.id}"`));
    if (st) return head('套装', closetName(closetWho()), one(st, 'closet-set-pic') + set);
    if (it) return head('单品', closetName(closetWho()), one(it, 'closet-pic') + set);
    const list = view.closetTab === 'set' ? W0.sets : W0.items;
    return head(closetName(closetWho()), `${W0.items.length} 件 · ${W0.sets.length} 套`, (stop || (list.length ? topBtn('closet-pic-all', 'img', '给还没图的一键生图', true) : '')) + topBtn('gen-closet', 'gen', '添衣服、搭套装') + set);
  }
  const wearChips = (only) => { const l = wearNow().filter((x) => !only || x.key === only); return l.length ? `<div class="xsj-wearing">${l.map((x) => `<button data-act="wear-off" data-k="${esc(x.key)}" title="点一下不再沿用">👗 ${only ? '正在穿' : esc(x.name)} · ${esc(x.label)} <i>×</i></button>`).join('')}</div>` : ''; };
  const closetThumb = (x) => (x.pic ? `<img src="${esc(x.pic)}" alt="">` : `<span class="xsj-closet-e">${esc(x.emoji || '👗')}</span>`);
  function closetFolders() {
    return `<div class="xsj-folders">${closetKeys().map((k) => { const W0 = closet()[k], peek = [...W0.items].sort((a, b) => (b.pic ? 1 : 0) - (a.pic ? 1 : 0)).slice(0, 3); return `<button class="xsj-folder" data-act="closet-folder" data-k="${esc(k)}"><span class="peek">${peek.map((x) => `<i>${closetThumb(x)}</i>`).join('')}</span><span class="face"><b>${esc(closetName(k))}</b><small>${W0.items.length || W0.sets.length ? `${W0.items.length} 件 · ${W0.sets.length} 套` : '还空着'}</small></span></button>`; }).join('')}<button class="xsj-folder is-add" data-act="closet-add"><span class="face"><b>＋</b><small>加一个人</small></span></button></div>`;
  }
  function closetDetail(it) {
    const drawing = view.drawing?.id === it.id, sets = closetOf().sets.filter((x) => x.ids.includes(it.id));
    return `<div class="xsj-card xsj-closet-detail">
      ${drawing ? drawingBox(it.id, 'xsj-drawing-place') : it.pic ? `<img src="${esc(it.pic)}" alt="">` : `<div class="xsj-closet-big">${esc(it.emoji || '👕')}</div>`}
      <b>${esc(it.name)}</b>
      <small>${esc([it.cat, it.color, it.material].filter(Boolean).join(' · '))} <i class="xsj-closet-tag${it.fromPersona ? '' : ' is-add'}">${it.fromPersona ? '人设里写过' : '补充'}</i></small>
      ${it.desc ? `<p>${esc(it.desc)}</p>` : ''}${it.when ? `<p class="xsj-closet-when">平时：${esc(it.when)}</p>` : ''}${it.note ? `<p class="xsj-closet-note">“${esc(it.note)}”</p>` : ''}
      ${sets.length ? `<div class="xsj-cchips">${sets.map((x) => `<button data-act="closet-set-open" data-id="${x.id}">🧺 ${esc(x.name)}</button>`).join('')}</div>` : ''}
      <div class="xsj-closet-a"><button data-act="closet-on" data-kind="item" data-id="${it.id}">${(chat.wear?.[closetWho()]?.items || []).includes(it.id) ? '✓ 正在穿' : '📎 今天穿这件'}</button><button data-act="closet-fav" data-id="${it.id}">${it.fav ? '♥ 常穿' : '♡ 常穿'}</button><button data-act="closet-del" data-id="${it.id}" class="xsj-danger">删除</button></div>
    </div>`;
  }
  function closetSetDetail(x) {
    const items = x.ids.map((id) => closetOf().items.find((o) => o.id === id)).filter(Boolean), wid = x.id + '-w';
    const pic = view.drawing?.id === x.id ? drawingBox(x.id, 'xsj-drawing-place') : x.pic ? `<img src="${esc(x.pic)}" alt="">` : `<div class="xsj-closet-mosaic">${items.slice(0, 6).map((o) => `<i>${closetThumb(o)}</i>`).join('')}</div>`;
    const wear = view.drawing?.id === wid ? drawingBox(wid, 'xsj-drawing-place') : x.wearPic ? `<img src="${esc(x.wearPic)}" alt="">` : '';
    return `<div class="xsj-card xsj-closet-detail">${pic}
      <b>${esc(x.name)}</b><small>${esc(x.scene || '')}</small>
      ${x.desc ? `<p>${esc(x.desc)}</p>` : ''}${x.note ? `<p class="xsj-closet-note">“${esc(x.note)}”</p>` : ''}
      <div class="xsj-closet-list">${items.map((o) => `<button data-act="closet-open" data-id="${o.id}"><i>${closetThumb(o)}</i><span><b>${esc(o.name)}</b><small>${esc([o.cat, o.color].filter(Boolean).join(' · '))}</small></span></button>`).join('')}</div>
      <div class="xsj-closet-a"><button data-act="closet-on" data-kind="set" data-id="${x.id}">${chat.wear?.[closetWho()]?.set === x.id ? '✓ 正在穿' : '📎 今天穿这套'}</button><button data-act="closet-wear" data-id="${x.id}">🪞 ${x.wearPic ? '重画上身' : '上身看看'}</button><button data-act="closet-set-fav" data-id="${x.id}">${x.fav ? '♥ 常穿' : '♡ 常穿'}</button><button data-act="closet-set-del" data-id="${x.id}" class="xsj-danger">删除</button></div>
      ${wear}
    </div>`;
  }
  function closetView() {
    const top = closetTop();
    if (view.appSet) return top + (view.closetOpen && closetWho().startsWith('n:') ? `<div class="xsj-card xsj-set"><div class="xsj-set-h">📁 ${esc(closetName(closetWho()))}的文件夹</div><button data-act="closet-drop" class="xsj-regen xsj-danger">删掉这个文件夹</button></div>` : '') + promptCard('closet');
    if (!view.closetOpen) return top + closetFolders();
    const w = closetWho(), W0 = closetOf();
    const it = W0.items.find((x) => x.id === view.closetItem), st = W0.sets.find((x) => x.id === view.closetSet);
    if (it) return top + closetDetail(it);
    if (st) return top + closetSetDetail(st);
    const tab = view.closetTab === 'set' ? 'set' : 'item';
    const style = `<div class="xsj-closet-st"><div><b>穿衣风格</b><button data-act="closet-style">${W0.style ? '重读' : '读一遍设定'}</button></div><textarea data-closetstyle rows="2" placeholder="点右边读一遍设定，或者自己写">${esc(W0.style || '')}</textarea>${W0.points?.length ? `<p>${W0.points.map((x) => `<i>${esc(x)}</i>`).join('')}</p>` : ''}</div>`;
    const tabs = `<div class="xsj-np-tabs"><button data-act="closet-tab" data-v="item" class="${tab === 'item' ? 'on' : ''}">单品 ${W0.items.length}</button><button data-act="closet-tab" data-v="set" class="${tab === 'set' ? 'on' : ''}">套装 ${W0.sets.length}</button></div>`;
    const fav = (a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0);
    if (tab === 'set') return top + style + wearChips(w) + tabs + (W0.sets.length ? `<div class="xsj-closet-sets">${W0.sets.slice().sort(fav).map((x) => `<button data-act="closet-set-open" data-id="${x.id}">${view.drawing?.id === x.id ? drawingBox(x.id, 'xsj-drawing-cover', false) : x.pic ? `<img src="${esc(x.pic)}" alt="">` : `<div class="xsj-closet-mosaic">${x.ids.map((id) => W0.items.find((o) => o.id === id)).filter(Boolean).slice(0, 4).map((o) => `<i>${closetThumb(o)}</i>`).join('')}</div>`}<b>${esc(x.name)}${x.fav ? ' ♥' : ''}</b><small>${esc(x.scene || '')}${x.scene ? ' · ' : ''}${x.ids.length} 件</small></button>`).join('')}</div>` : blank('closet', '还没有套装', '用衣橱里的单品搭，缺的会顺手做新的。', blankBtn('gen-closet', '搭一套')));
    if (!W0.items.length) return top + style + tabs + blank('closet', '衣橱还空着', '第一次会先读一遍设定里的穿衣风格，再照着添。', blankBtn('gen-closet', '添几件'));
    const cats = CLOSET_CATS.filter((c) => W0.items.some((x) => (x.cat || '其他') === c)), cur = cats.includes(view.closetCat) ? view.closetCat : '';
    const list = (cur ? W0.items.filter((x) => (x.cat || '其他') === cur) : W0.items).slice().sort(fav);
    const chip = (c, label) => `<button data-act="closet-cat" data-cat="${c}" class="${cur === c ? 'on' : ''}">${label}</button>`;
    return top + style + wearChips(w) + tabs + `<div class="xsj-cchips xsj-closet-c">${chip('', '全部')}${cats.map((c) => chip(c, c)).join('')}</div>
      <div class="xsj-closet-grid">${list.map((x) => `<button class="xsj-closet-item" data-act="closet-open" data-id="${x.id}">${view.drawing?.id === x.id ? '<span class="xsj-closet-e">⏳</span>' : closetThumb(x)}<b>${esc(x.name)}</b><small>${esc(x.color || x.cat || '')}</small>${x.fav ? '<i class="xsj-closet-fav">♥</i>' : ''}</button>`).join('')}</div>`;
  }
  async function drawClosetPic(it, label, inline = false) {
    const tags = cleanTags(it.img);
    const pic = await drawImage({ prompt: [closetPrompt('pItem'), tags || 'clothes', closetPrompt('pTail')].filter(Boolean).join(', '), nl: tags ? '' : `${it.name}，${it.color}${it.material}。${it.desc}`, size: 'portrait' }, label, inline ? it.id : null);
    if (pic) { it.pic = pic; saveChat(); render(); }
    return !!pic;
  }
  async function drawClosetSet(x, label, inline = false) {
    const tags = cleanTags(x.wear);
    const pic = await drawImage({ prompt: [closetPrompt('pSet'), tags, closetPrompt('pTail')].filter(Boolean).join(', '), nl: tags ? '' : `${x.name}。${x.desc}`, negative: '1girl, 1boy, human, mannequin', size: 'portrait' }, label, inline ? x.id : null);
    if (pic) { x.pic = pic; saveChat(); render(); }
    return !!pic;
  }
  // 上身看看：角色库里的外貌 + 这套衣服，全身照，一律穿好
  async function drawClosetWear(x) {
    const name = closetName(closetWho()), bb = baibaiChar(name), tags = cleanTags(x.wear);
    if (!bb?.tag) { toast(`柏宝绘角色库里没有${name}，先去那里加上外貌`, 'warning'); return; }
    if (!tags) { toast('这套没有穿着的 tag，重新搭一套再试', 'warning'); return; }
    const look = tagList(bb.tag).filter((t) => !UNDER.test(bareTag(t))).join(', ');
    const intimate = /贴身|内衣|睡/.test([x.scene, x.name, ...x.ids.map((id) => closetOf().items.find((o) => o.id === id)).filter(Boolean).map((o) => o.cat)].join(' '));
    if (intimate && MINOR.test([look, tags].join(', '))) { toast('这套不画上身', 'warning'); return; }
    const pic = await drawImage({ prompt: ['sfw', closetPrompt('pWear'), look, tags, closetPrompt('pWearTail')].filter(Boolean).join(', '), negative: closetPrompt('pWearNeg'), size: 'portrait' }, '正在试穿', x.id + '-w');
    if (pic) { x.wearPic = pic; saveChat(); render(); }
  }

  // ---------- 💘 你的梦男：这个世界里把 {{user}} 当梦角的男人们，在平台上晒糖、理讨、吵架 ----------
  const DREAM_CATS = ['吃糖', '理讨', '产粮', '抽卡', '剧情', '考据', '嗑CP', '吵架', '论坛体', '吐槽', '求助', '整活', '日常', '官方', '安利', '深夜'];
  // 帖子类型池：每次刷新随机抽 6-7 种、尽量避开上一批用过的，每帖一种，免得每批都是同一套
  const DREAM_TYPES = {
    dream: [
      ['吃糖', '自作多情：截图逐帧分析，把她一个眼神、一句台词认定是冲着自己来的'],
      ['吃糖', '把她说过的一句话当成对自己的告白，越想越上头'],
      ['日常', '网友自己生活里的一刻想到她：下班的地铁、吃到她吃过的东西、下雨天'],
      ['日常', '和她的同居脑补：早上叫她起床、给她吹头发、一起逛超市'],
      ['日常', '老粉回忆自己是哪一段入的坑、那时候的她是什么样'],
      ['产粮', '约稿返图，和画师来回沟通她的细节'],
      ['产粮', '手作周边：缝玩偶、做痛包、给她的立牌做小衣服'],
      ['产粮', '给她写的小作文或情书，写到一半自己先破防'],
      ['抽卡', '为她氪金：歪了、吃满保底、十连出金后的发疯'],
      ['吵架', '正宫之争：比谁付出得多、谁更懂她'],
      ['吵架', '梦男和嗑她与作品里某个角色 CP 的人对线'],
      ['吵架', '同担拒否：看到别人也叫她老婆就难受'],
      ['求助', '情感求助：她和作品里的某个人走得太近，自己好难受怎么办'],
      ['求助', '节日或纪念日怎么一个人熬过去'],
      ['理讨', '深度解读她的一个小习惯、小动作或口头禅'],
      ['理讨', '理讨她的 meta 感：她是不是知道屏幕外有人在看'],
      ['论坛体', '「如果她是我老婆……」接龙'],
      ['整活', '投票贴：她哪套衣服更好看、哪个瞬间最心动'],
      ['整活', '做她的表情包、P 图、谐音梗'],
      ['吐槽', '心疼她：吐槽官方又让她受委屈、发刀子'],
      ['官方', '新 PV、活动预告、生日会、周边开售：抢不到的哀嚎'],
      ['官方', '线下：去她去过的地方在蓝星的对应地点巡礼、办生日应援'],
      ['安利', '向朋友或家人安利她，成功或翻车的经历'],
    ],
    general: [
      ['剧情', '讨论最新一段剧情、猜下一章怎么走'],
      ['剧情', '整理埋下的伏笔，列出还没填的坑'],
      ['考据', '设定考据：世界观、地名、物件背后的来历'],
      ['考据', '时间线梳理，或者翻出很早以前的一个细节'],
      ['嗑CP', '嗑她和作品里某个角色，逐帧找糖'],
      ['吵架', 'CP 粉互掐，或者为某个配角的做法吵起来'],
      ['吐槽', '吐槽官方：更新慢、文案、BUG、卡池'],
      ['抽卡', '出货或非酋的晒图'],
      ['产粮', '同人图、同人文、cos 返图'],
      ['求助', '新人入坑问从哪里开始看'],
      ['论坛体', '路人锐评或者理性讨论楼'],
      ['整活', '梗图、名场面弹幕、投票'],
      ['官方', 'PV、活动、联动、周边开售'],
      ['安利', '安利给朋友的经历'],
      ['日常', '玩家生活里的蓝星online：地铁广告、同事也在玩'],
    ],
  };
  // 每帖用的素材：最多两帖讨论最新一段，其余散开
  const DREAM_ANGLES = ['最新一段剧情', '更早发生过的剧情（老粉翻出来）', '她穿过的一件衣服、用过的一样东西', '她身边的一个配角', '官方运营，和剧情无关', '网友自己的生活'];
  function pickDreamTypes(dir, D0) {
    const pool = DREAM_TYPES[dir];
    const last = new Set(D0.lastTypes?.[dir] || []);
    const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
    const fresh = shuffle(pool.filter(([, t]) => !last.has(t)));
    const used = shuffle(pool.filter(([, t]) => last.has(t)));
    const n = wantFor('dream') || 6 + (Math.random() < 0.5 ? 1 : 0);
    const out = [];
    for (const x of [...fresh, ...used]) {
      if (out.length >= n) break;
      if (out.filter(([c]) => c === x[0]).length >= 2) continue; // 同一分类最多两帖
      out.push(x);
    }
    for (const x of [...fresh, ...used]) if (out.length < n && !out.includes(x)) out.push(x); // 要得多时分类可以重复
    if (dir === 'dream' && out.length > 2 && Math.random() < 0.6) out[out.length - 1] = ['深夜', '成年梦男的深夜帖：性幻想、涩涩的脑补、荤话，可以写得直白'];
    return out.map(([cat, t], i) => ({ cat, t, angle: cat === '深夜' ? '最新一段剧情里她的某个细节' : i < 2 ? DREAM_ANGLES[0] : DREAM_ANGLES[1 + Math.floor(Math.random() * (DREAM_ANGLES.length - 1))] }));
  }
  const fmtN = (n) => fmtLikes(Math.max(0, Math.round(Number(n) || 0)));
  function dreamAvatar(name, handle, emoji) {
    return `<i class="xsj-dm-av" style="background:${avatarColor(handle || name)}">${esc(emoji || [...String(name || '?')][0])}</i>`;
  }
  function dreamPost(p, full) {
    const drawing = view.drawing?.id === p.id;
    const media = p.img || p.imgDesc
      ? (drawing ? drawingBox(p.id, 'xsj-drawing-place')
        : p.pic ? `<img class="xsj-dm-img" src="${esc(p.pic)}" alt="">`
        : `<div class="xsj-dm-ph">🖼 ${esc(p.imgDesc || '配图')}${full ? '<button data-act="dream-pic">画出来</button>' : ''}</div>`)
      : '';
    return `<div class="xsj-dm-post${full ? ' is-full' : ''}"${full ? '' : ` data-dreamopen="${p.id}"`}>
      <div class="xsj-dm-top">${dreamAvatar(p.author, p.handle, p.avatar)}<div><b>${esc(p.author)}</b><small>${esc(p.handle || '')}${p.time ? ` · ${esc(p.time)}` : ''}</small></div>${p.cat ? `<em>${esc(p.cat)}</em>` : ''}</div>
      <div class="xsj-dm-text">${esc(p.text)}</div>
      ${p.tags?.length ? `<div class="xsj-dm-tags">${p.tags.map((t) => `#${esc(String(t).replace(/^#/, ''))}`).join(' ')}</div>` : ''}
      ${media}
      <div class="xsj-dm-stats"><span>💬 ${fmtN(p.replies?.length ? Math.max(p.replies.length, p.cmts || 0) : p.cmts)}</span><span>🔁 ${fmtN(p.rts)}</span><span>♡ ${fmtN(p.likes)}</span>${p.views ? `<span>📊 ${fmtN(p.views)}</span>` : ''}</div>
    </div>`;
  }
  function dreamView() {
    const D0 = codex().dream;
    if (!D0.items.length) {
      return blank('dream', '蓝星还没有动静', '蓝星是另一个和地球很像的世界。那里的网友追着你的故事，把你当梦角来爱：晒糖、理讨、吵架、拉踩。', blankBtn('gen-dream', '上线看看'));
    }
    const sel = D0.items.find((p) => p.id === view.dream);
    if (sel) {
      return `${dreamPost(sel, true)}
        <div class="xsj-dm-acts"><button data-act="quote" data-kind="dream" data-id="${sel.id}">📎 带进剧情</button><button data-act="dream-del" class="xsj-danger">删帖</button></div>
        <div class="xsj-dm-replyhead">最相关的回复</div>
        ${(sel.replies || []).map((r, i) => `<div class="xsj-dm-reply" data-hold="reply:${i}">${dreamAvatar(r.author, r.handle, '')}<div><div class="xsj-dm-rt"><b>${esc(r.author)}</b><small>${esc(r.handle || '')}</small></div>${r.to ? `<small class="xsj-dm-to">回复 <span>${esc(r.to)}</span></small>` : ''}<div class="xsj-dm-text">${esc(r.text)}</div><small class="xsj-dm-rl">♡ ${fmtN(r.likes)}</small></div></div>`).join('') || '<div class="xsj-none">还没有回复</div>'}`;
    }
    const cats = ['全部', ...DREAM_CATS.filter((c) => D0.items.some((p) => p.cat === c))];
    if (!cats.includes(view.dreamCat)) view.dreamCat = '全部';
    const list = D0.items.filter((p) => view.dreamCat === '全部' || p.cat === view.dreamCat);
    return `<div class="xsj-dm-search"><span>🔍</span><b>${esc(D0.query || appTitle('dream'))}</b><small>${esc(D0.platform || '')}</small></div>
      <div class="xsj-cats">${cats.map((c) => `<button data-dreamcat="${esc(c)}" class="${c === view.dreamCat ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>
      ${list.map((p) => dreamPost(p, false)).join('')}`;
  }
  function dreamInstr(dir, types) {
    const D0 = codex().dream, sd = storyDate();
    return [
      ...baseInstr(sd.y, sd.m, false, 'dream'),
      dreamPrompt('task'),
      dreamPrompt('who'),
      D0.platform && D0.kind === 'bluestar' ? `平台已经定为「${D0.platform}」，沿用。` : `平台是蓝星上的现代社交平台（类似地球的微博超话、论坛、X、小红书那种），起一个虚构的名字，不用地球上真实的平台名。`,
      dir === 'dream'
        ? dreamPrompt('dirDream')
        : dreamPrompt('dirGeneral'),
      `这一批正好写 ${types.length} 帖，按顺序一帖对应一行（分类｜写什么｜素材从哪来；素材那一栏不合适时可以换，但整批要散开）：\n${types.map((x, i) => `${i + 1}. ${x.cat}｜${x.t}｜${x.angle}`).join('\n')}`,
      dreamPrompt('open2'),
      dreamPrompt('form'),
      dreamPrompt('people'),
      dreamPrompt('stuff'),
      dreamPrompt('tone'),
      types.some((x) => x.cat === '深夜') ? `尺度：只有「深夜」那一帖可以露骨，其余保持日常。不写未成年，不写强迫。` : `这一批不写露骨内容。`,
      D0.items.length ? `最近已经有这些帖子（分类：开头），这次换话题、换场面、换开头：${D0.items.slice(0, 16).map((p) => `${p.cat}：${p.text.slice(0, 18)}`).join('｜')}` : '',
      `JSON 结构：{"platform": "平台名", "query": "搜索框里的关键词，如“你的梦男”或带{{user}}名字的超话名", "posts": [{"author": "昵称", "handle": "@开头的英文账号", "avatar": "一个emoji", "time": "如 2h、昨天 17:39", "cat": "照上面那一行的分类", "text": "正文30-140字", "tags": ["话题"], "img": "有配图时写画面的英文 danbooru tag（物件、场景、截图里的东西，不画{{user}}本人），没有就空字符串", "imgDesc": "配图是什么，中文一句，没有就空字符串", "likes": 数字, "rts": 数字, "views": 数字, "cmts": 评论总数, "replies": [{"author": "昵称", "handle": "@账号", "to": "回复的是谁的 @账号", "text": "不超过60字", "likes": 数字}]}]}  // 正好 ${types.length} 帖，每帖 2-5 条回复，回复里也可以互相吵`,
    ].filter(Boolean).join('\n');
  }
  async function generateDream(opts = {}) {
    if (view.busy) return;
    const dir = opts.dir === 'general' ? 'general' : 'dream';
    const D0 = codex().dream;
    const types = pickDreamTypes(dir, D0);
    const sd = storyDate();
    const instr = dreamInstr(dir, types);
    const data = await callAI(instr, '正在刷帖…', false, false);
    if (!data) return;
    const posts = (Array.isArray(data.posts) ? data.posts : []).filter((p) => p && txt(p.text));
    if (!posts.length) { lastRaw = JSON.stringify(data).slice(0, 4000); toast('没刷出帖子，再试一次', 'error'); return; }
    // 改成蓝星online 以前生成的平台名（按故事世界起的）换掉一次
    if (D0.kind !== 'bluestar') { D0.platform = ''; D0.query = ''; D0.kind = 'bluestar'; }
    if (!D0.platform && txt(data.platform)) D0.platform = txt(data.platform).slice(0, 16);
    if (!D0.query && txt(data.query)) D0.query = txt(data.query).slice(0, 20);
    const num = (v) => Math.max(0, Math.round(Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0));
    D0.lastTypes = { ...(D0.lastTypes || {}), [dir]: types.map((x) => x.t) };
    D0.items.unshift(...posts.slice(0, capN(10)).map((p, i) => ({
      id: uid(), author: txt(p.author) || '匿名账号', handle: txt(p.handle), avatar: txt(p.avatar), time: txt(p.time),
      cat: DREAM_CATS.includes(txt(p.cat)) ? txt(p.cat) : types[i]?.cat || '吐槽', dir, text: txt(p.text), tags: Array.isArray(p.tags) ? p.tags.map(txt).filter(Boolean).slice(0, 4) : [],
      img: txt(p.img), imgDesc: txt(p.imgDesc), pic: '', likes: num(p.likes), rts: num(p.rts), views: num(p.views), cmts: num(p.cmts),
      replies: Array.isArray(p.replies) ? p.replies.filter((r) => r && txt(r.text)).slice(0, 8).map((r) => ({ author: txt(r.author) || '匿名账号', handle: txt(r.handle), to: txt(r.to), text: txt(r.text), likes: num(r.likes) })) : [],
    })));
    D0.items = D0.items.slice(0, 40);
    view.dreamCat = '全部';
    saveChat();
    toast(`刷到 ${Math.min(posts.length, capN(10))} 条新帖`, 'success');
    render();
    D.querySelector(`#${ROOT_ID} .xsj-body`).scrollTop = 0;
  }
  async function drawDreamPic(p, label) {
    const tags = cleanTags(p.img);
    const pic = await drawImage({ prompt: ['no humans', tags || 'still life', dreamPrompt('tail')].filter(Boolean).join(', '), nl: tags ? '' : p.imgDesc, size: 'portrait' }, label, p.id);
    if (pic) { p.pic = pic; saveChat(); render(); }
    return !!pic;
  }

  // ---------- 📇 人物图鉴：每个人一张卡，没在剧情里了解到的栏位是「？」；关系网用同一份数据画出来 ----------
  // codex.npc = { title, items: [人物], links: [{ id, a, b, label, keys, known }] }，a/b 是人名，USER 代表 {{user}}
  // 人物 = { id, name, emoji, role, look, hint, met, isNew, metAt, facts: [{ k, v, keys, known }], img, pic }
  const NPC_USER = 'USER';
  const userName = () => { try { return substitudeMacros('{{user}}') || '你'; } catch (e) { return '你'; } };
  const npcData = () => {
    const N = codex().npc;
    if (!Array.isArray(N.links)) N.links = [];
    // 之前抠过透明底的头像：换回白底原图（随下一次保存写回去）
    for (const p of N.items) if (p.picRaw) { p.pic = p.picRaw; delete p.picRaw; }
    return N;
  };
  // 卡片下面那句话：像梗图表格里的台词，一听就知道是这个人
  // 画像 tag 的写法：按这个世界来，普通世界就是普通人，非人类才写种族特征
  // 画像 tag 的保险：mature male 换成 young adult（不然会画成大叔），场景词去掉（证件照是纯白底）
  function npcPortraitTags(raw) {
    const scene = /(interior|room|garden|shop|store|office|laboratory|\blab\b(?! coat)|hall|lakeside|workshop|clinic|kitchen|apartment|ship|banquet|\bsky\b|daylight|warm light|street|outdoors|indoors|computer setup|screen|sitting|teacup|fishing rod|holding)/i;
    return String(raw || '').split(',').map((t) => t.trim()).filter(Boolean)
      .map((t) => (/^mature (male|man)$/i.test(t) ? 'young adult man, handsome' : /^mature (female|woman)$/i.test(t) ? 'adult woman' : t))
      .filter((t) => !scene.test(t) && !LOWER.test(t.toLowerCase()) && !FEET.test(t.toLowerCase())).join(', ');
  }
  const NPC_PROMPTS = {
    open: ['开场', CAL_PROMPTS.open[1]],
    base: ['总要求', CAL_PROMPTS.base[1]],
    task: ["任务", "任务：为{{user}}做一本人物图鉴：把世界书和设定里所有有名有姓的人物都列出来，一个不漏（包括主要角色，不包括{{user}}本人），每人一张卡。站在{{user}}的视角：只有{{user}}在剧情里亲眼看到、亲耳听到、被人告诉过的事才算知道。"],
    met: ["见没见过", "met：这个人在最近剧情里真的跟{{user}}见过面才是 true；世界书里有、但还没跟{{user}}见过的写 false：只写 name、emoji、role、img、basic 和 hint（基本简介：这个世界里大家都知道的情况，一句话，30字以内，不剧透秘密），facts 给空数组，links 也先不写他。"],
    basic: ["基本信息标签", "basic：这个人的生日、年龄、星座、身高、体重、血型、MBTI、种族这类基本信息。只能从世界书和角色卡里抄，聊天正文不算；没写的一律不写，不推算（不能从生日推星座、不能从年份推年龄），不猜、不补全，一条都没有就给空数组。v 只写值，尽量短，不带名目：1月1日、28岁、摩羯座、183cm、O型、INTJ。src 从设定里一字不差抄下写着这个值的那一小段原文（4-40字），程序会拿它去设定里核对，对不上的会被扔掉。"],
    facts: ["栏位", "facts（只给 met 为 true 的人写）：每人 5-7 条，k 从「性格」「擅长」「不会」「喜好」「讨厌」「过去」「对{{user}}」「秘密」里挑，也可以按世界观加（如「兽形」「修为」）；「擅长」「不会」「对{{user}}」必须有。生日、年龄、身高这类写在 basic 里，不要放进 facts。v 写具体的事，20-50字。「不会」写这个人真的不会、做不到、不懂的事，剧情里要守住。known：{{user}}已经知道的才 true，不确定就 false；秘密几乎都是 false。keys：剧情里真说到这件事时一定会出现的 1-3 个词（不要用人名，不要用太常见的词）。"],
    links: ["关系", "links：人物之间、人物和{{user}}之间的关系（{{user}}写成 \"{{user}}\"）。label 是关系，2-6字（如“亲兄弟”“欠他一条命”“暗恋”“师徒”）；known：{{user}}知道这层关系才 true；keys 同上。"],
    line: ["台词", "ta 对{{user}}说过、或者常挂在嘴边的一句话，15字以内，一听就是这个人，可以带点好笑或反差；只写{{user}}真的听过的"],
    img: ["画像 tag 怎么写", "画这个人半身像的英文 danbooru tag，逗号分隔，8-15 个：先写 1boy 或 1girl，再写年龄（按真实年纪：二三十岁写 young man / young woman，四五十岁才写 middle-aged，六十以上写 old man / old woman；不要用 mature male、mature female 这类词，NovelAI 会把人画老），再写发型发色、眼睛、体型、符合世界观和身份的衣着；只有非人类才写种族特征（如 wolf ears），普通人不写；不写名字，不写背景和场景（房间、店铺、花园、实验室这些都不要）"],
    fill: ["补全一张卡：栏位", "facts 5-7 条，k 从「性格」「擅长」「不会」「喜好」「讨厌」「过去」「对{{user}}」「秘密」里挑，也可以按世界观加；「擅长」「不会」「对{{user}}」必须有。生日、年龄、身高这类写在 basic 里，不要放进 facts。v 写具体的事，20-50字。keys：剧情里真说到这件事时一定会出现的 1-3 个词（不要用人名）。"],
    fillLinks: ["补全一张卡：关系", "links：这个人和别人、和{{user}}的关系（{{user}}写成 \"{{user}}\"），label 2-6字，known 同上。"],
    frame: ["画像构图（长相前面）", "solo, portrait, head and shoulders, front view, facing viewer, looking at viewer"],
    back: ["画像背景（长相后面）", "simple background, white background, even lighting"],
    negative: ["画像负面", "2::multiple views::, 1.5::character sheet::, 1.5::reference sheet::, full body, multiple people, inset, collage"],
  };
  const npcPrompt = (k) => promptOf('npc', k).replace(/\s*\n\s*/g, ' ');
  const npcByName = (name) => npcData().items.find((p) => p.name === name);
  const npcKnownN = (p) => (p.facts || []).filter((f) => f.known).length;
  function npcSide(name) {
    const n = txt(name);
    if (!n || n === '{{user}}' || n === userName() || n === '你' || n.toUpperCase() === NPC_USER) return NPC_USER;
    return n;
  }
  const npcLabel = (n) => (n === NPC_USER ? userName() : n);
  const npcT = (s) => String(s ?? '').split('{{user}}').join(userName());
  function npcLinksOf(p) { return npcData().links.filter((l) => l.a === p.name || l.b === p.name); }
  function npcAvatar(p, cls = '') {
    if (!p.met) return `<i class="xsj-np-av is-locked ${cls}">${esc(p.emoji || '?')}</i>`;
    if (view.drawing?.id === p.id) return `<i class="xsj-np-av ${cls}">⏳</i>`;
    return p.pic ? `<i class="xsj-np-av ${cls}"><img src="${esc(p.pic)}" alt=""></i>` : `<i class="xsj-np-av ${cls}" style="background:${avatarColor(p.name)}">${esc(p.emoji || [...p.name][0])}</i>`;
  }
  function npcView() {
    const N = npcData();
    const top = npcTop();
    if (view.npcSet) return top + promptCard('npc');
    const tab = view.npcTab === 'web' ? 'web' : 'list';
    const tabs = `${top}<div class="xsj-np-tabs">${[['list', '人物'], ['web', '关系网']].map(([k, n]) => `<button data-npctab="${k}" class="${tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    if (!N.items.length) {
      return tabs + blank('npc', `${esc(appTitle('npc'))}还是空的`, '读世界书和最近剧情，给每个人建一张卡。你在剧情里还不知道的事是涂黑的：剧情里说到会自动解开，也可以自己点开。', blankBtn('gen-npc', '整理认识的人'));
    }
    const sel = N.items.find((p) => p.id === view.npc);
    if (sel) return top + npcDetail(sel);
    const met = N.items.filter((p) => p.met);
    const tools = view.batch ? `<div class="xsj-hint" style="text-align:center">正在一键生图 ${view.batch}</div>` : '';
    if (tab === 'web') return tabs + npcWeb() + tools;
    const card = (p) => {
      // 排版参考“表格”梗图：竖长方块，下面粗体名字，再下面一句 ta 的话（没有就写身份）
      if (!p.met) return `<button class="xsj-np-card is-locked" data-npc="${p.id}">${npcAvatar(p)}<b>${esc(p.name)}</b><small>${esc(p.role || p.hint || '')}</small><u>没见过</u></button>`;
      return `<button class="xsj-np-card${p.isNew ? ' is-new' : ''}" data-npc="${p.id}">${npcAvatar(p)}<b>${esc(p.name)}</b>${p.line ? `<small class="xsj-np-line">“${esc(npcT(p.line))}”</small>` : `<small>${esc(p.role || '')}</small>`}</button>`;
    };
    return `${tabs}<div class="xsj-np-grid">${[...met, ...N.items.filter((p) => !p.met)].map(card).join('')}</div>${tools}`;
  }
  // 一个人的档案：没解开的事是涂黑条，点一下揭开
  const CLIP = '<svg class="clip" viewBox="0 0 24 52" aria-hidden="true"><path d="M7 18v19a5 5 0 0 0 10 0V11a7.500 7.500 0 0 0-15 0v25"/></svg>';
  function npcDetail(p) {
    const no = String(npcData().items.indexOf(p) + 1).padStart(3, '0');
    const drawing = view.drawing?.id === p.id;
    const photo = drawing ? drawingBox(p.id, 'xsj-drawing-place') : p.met && p.pic ? `<img src="${esc(p.pic)}" alt="">` : npcAvatar(p);
    const tags = npcBasic(p);
    const top = (extra) => `<div class="xsj-file-top"><span class="ph">${photo}${CLIP}</span><div class="id"><small>姓名</small><b>${esc(p.name)}</b>${p.role ? `<small>身份</small><p>${esc(p.role)}</p>` : ''}${extra}</div></div>`;
    const page = (inner, stamp, acts) => `<div class="xsj-file"><span class="tabx">档案 No.${no}</span><div class="paper">${inner}<div class="stamp${p.met ? '' : ' is-sealed'}"><b>${p.met ? '已建档' : '未解封'}</b>${stamp ? `<small>${esc(stamp)}</small>` : ''}</div></div></div><div class="xsj-np-acts">${acts}</div>`;
    if (!p.met) return page(top('') + `<h4>简介</h4><div class="row"><p>${esc(p.hint || '还没见过')}</p></div><h4>详情</h4><div class="row"><span>性格</span><s class="bar" style="width:62%"></s></div><div class="row"><span>擅长</span><s class="bar" style="width:78%"></s></div><div class="row"><span>过去</span><s class="bar" style="width:48%"></s></div>`, '', '<button data-act="npc-meet">已经见过了</button><button data-act="npc-del" class="xsj-danger">删除</button>');
    const bar = (n) => `<s class="bar" style="width:${45 + (n * 23) % 46}%"></s>`;
    const facts = (p.facts || []).map((f, n) => BASIC_KEYS.test(f.k) && (p.basic || f.known) ? '' : f.known
      ? `<div class="row" data-hold="fact:${n}"><span>${esc(npcT(f.k))}</span><p>${esc(npcT(f.v))}</p></div>`
      : `<button class="row is-q" data-npcfact="${n}" title="点一下揭开"><span>${esc(npcT(f.k))}</span>${bar(n)}</button>`).join('');
    const links = npcLinksOf(p).map((l, n) => {
      const other = npcLabel(l.a === p.name ? l.b : l.a), otherP = npcByName(other);
      return l.known && !(otherP && !otherP.met)
        ? `<div class="row" data-hold="link:${l.id}"><span>${esc(other)}</span><p>${esc(l.label)}</p></div>`
        : `<button class="row is-q" data-npclink="${l.id}" title="点一下揭开"><span>${esc(other)}</span>${bar(n + 2)}</button>`;
    }).join('');
    return page(`${top(tags.length ? `<div class="xsj-np-tags">${tags.map((x) => `<i title="${esc(x.k)}" data-hold="basic:${esc(x.k)}">${esc(x.v)}</i>`).join('')}</div>` : '')}
      ${p.line ? `<blockquote>“${esc(npcT(p.line))}”</blockquote>` : ''}
      ${p.look ? `<h4>外貌</h4><div class="row"><p>${esc(p.look)}</p></div>` : ''}
      <h4>记录</h4>${facts || '<div class="row"><p class="dim">刚认识，还没写。点右上 ✦ 补全这张卡，或者等下次整理人物时一起补。</p></div>'}
      ${links ? `<h4>关系</h4>${links}` : ''}
      ${facts.includes('is-q') || links.includes('is-q') ? '<div class="note">涂黑的是你在剧情里还不知道的事：剧情里说到会自动解开，也可以点一下直接揭开。</div>' : ''}`,
      p.metAt ? `初见 ${p.metAt}` : '', `<button data-act="quote" data-kind="npc" data-id="${p.id}">📎 带进剧情</button><button data-act="npc-del" class="xsj-danger">删除</button>`);
  }
  // 关系网：{{user}} 在中间，见过的人围成一圈；知道的关系是实线带字，不知道的是虚线「？」
  function npcWeb() {
    const N = npcData();
    const metAll = N.items.filter((p) => p.met);
    if (!metAll.length) return '<div class="xsj-none">还没认识任何人</div>';
    // 只画见过的人之间（和你之间）的线；一条线都没有的人不上图
    const onMap = new Set([NPC_USER, ...metAll.map((p) => p.name)]);
    const vis = N.links.filter((l) => onMap.has(l.a) && onMap.has(l.b));
    // 重要程度：知道的关系算 1，还是「？」的算 0.6，跟你有关系再加 1
    const weight = {};
    for (const l of vis) for (const e of [l.a, l.b]) weight[e] = (weight[e] || 0) + (l.known ? 1 : 0.6) + (l.a === NPC_USER || l.b === NPC_USER ? 1 : 0);
    const pool = metAll.filter((p) => weight[p.name]).sort((a, b) => weight[b.name] - weight[a.name]);
    if (!pool.length) return '<div class="xsj-none">还没发现谁跟谁有关系</div>';
    // 排座位：从最重要的人开始，下一个挑跟上一个有关系的人，让有关系的人挨着坐，线不用横穿整张图
    const linked = (a, b) => vis.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
    const met = [pool.shift()];
    while (pool.length) {
      const last = met[met.length - 1].name;
      const i = pool.findIndex((p) => linked(last, p.name));
      met.push(pool.splice(i >= 0 ? i : 0, 1)[0]);
    }
    const rOf = (p) => Math.round(15 + Math.max(-2, Math.min(15, (weight[p.name] - 1) * 4)));
    const C = 160, R = 118;
    const pos = { [NPC_USER]: [C, C] };
    const ang = {};
    met.forEach((p, i) => { const a = -Math.PI / 2 + (i / met.length) * Math.PI * 2; ang[p.name] = a; pos[p.name] = [C + R * Math.cos(a), C + R * Math.sin(a)]; });
    const lines = vis.filter((l) => pos[l.a] && pos[l.b]).map((l) => {
      const [x1, y1] = pos[l.a], [x2, y2] = pos[l.b];
      let mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      let path = `M${x1} ${y1}L${x2} ${y2}`;
      // 外圈两个人之间：线往外弯，不从中间的「你」身上穿过去
      if (l.a !== NPC_USER && l.b !== NPC_USER) {
        let dx = mx - C, dy = my - C, d = Math.hypot(dx, dy);
        const push = Math.max(0, R * 0.85 - d) * 1.3;
        if (d < 1) { dx = -(y2 - y1); dy = x2 - x1; d = Math.hypot(dx, dy); }
        const qx = mx + (dx / d) * push, qy = my + (dy / d) * push;
        path = `M${x1} ${y1}Q${qx} ${qy} ${x2} ${y2}`;
        mx = 0.25 * x1 + 0.5 * qx + 0.25 * x2; my = 0.25 * y1 + 0.5 * qy + 0.25 * y2;
      }
      const lab = l.known ? l.label : '？';
      const w = Math.max(14, [...lab].length * 9 + 8);
      return `<g class="xsj-np-edge${l.known ? '' : ' is-q'}"${l.known ? '' : ` data-npclink="${l.id}"`}><path d="${path}"/><rect x="${mx - w / 2}" y="${my - 8}" width="${w}" height="16" rx="8"/><text x="${mx}" y="${my + 4}">${esc(lab)}</text></g>`;
    }).join('');
    const node = (p) => {
      const [x, y] = pos[p.name];
      const r = rOf(p);
      const img = p.pic ? `<clipPath id="np-c-${p.id}"><circle cx="${x}" cy="${y}" r="${r - 1}"/></clipPath><image href="${esc(p.pic)}" x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" preserveAspectRatio="xMidYMin slice" clip-path="url(#np-c-${p.id})"/>` : `<text class="xsj-np-ne" x="${x}" y="${y + r * 0.35}" style="font-size:${Math.round(r * 0.95)}px">${esc(p.emoji || [...p.name][0])}</text>`;
      const lr = R + r + 13;
      return `<g class="xsj-np-node" data-npc="${p.id}"><circle cx="${x}" cy="${y}" r="${r}" style="fill:${avatarColor(p.name)}"/>${img}<text class="xsj-np-nn" x="${C + lr * Math.cos(ang[p.name])}" y="${C + lr * Math.sin(ang[p.name]) + 4}">${esc(p.name)}</text></g>`;
    };
    const me = `<g class="xsj-np-node is-me"><circle cx="${C}" cy="${C}" r="24"/><text class="xsj-np-ne" x="${C}" y="${C + 5}">你</text><text class="xsj-np-nn" x="${C}" y="${C + 39}">${esc(userName())}</text></g>`;
    const hiddenN = N.items.length - met.length;
    return `<div class="xsj-np-web"><svg viewBox="-26 -26 372 372">${lines}${me}${met.map(node).join('')}</svg></div>
      <div class="xsj-hint">点头像看人物卡；圆越大，关系越多、跟你越近。虚线「？」是还不知道的关系，点一下可以直接揭开。${hiddenN ? `没见过、或者还没发现关系的 ${hiddenN} 个人不在图上。` : ''}</div>`;
  }
  // 生日：从 "03-14" 或 "3月14日" 里取出月日
  function npcMd(f) {
    const m = String(f.md || '').match(/^(\d{1,2})\D(\d{1,2})$/) || String(f.v || '').match(/(\d{1,2})\s*月\s*(\d{1,2})/);
    if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > 31) return '';
    return `${pad(m[1])}-${pad(m[2])}`;
  }
  // 基本信息：只留能在世界书或角色卡原文里核对到的
  const BASIC_KEYS = /^(?:生日|年龄|星座|身高|体重|血型|MBTI|属相|生肖|种族)$/i;
  const BASIC_ORDER = ['生日', '年龄', '星座', '身高', '体重', '血型', 'MBTI', '生肖', '属相', '种族'];
  const bareText = (x) => String(x || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
  async function settingBlocks() {
    const out = [];
    const add = (t) => { let x = String(t || ''); try { x = substitudeMacros(x); } catch (e) {} if (x.trim()) out.push(bareText(x)); };
    try { const b = await openWorldbooksText(); String(b.text || '').split(/\n(?=##)/).forEach(add); } catch (e) {}
    try {
      const c = stCtx(), ch = c?.characters?.[c.characterId];
      for (const t of [ch?.description, ch?.personality, ch?.scenario]) if (t) add(`${ch.name}\n${t}`);
    } catch (e) {}
    return out;
  }
  function checkBasic(arr, name, blocks) {
    const out = [], nums = (x) => (String(x).match(/\d+(?:\.\d+)?/g) || []).map(Number);
    for (const x of Array.isArray(arr) ? arr : []) {
      const k = txt(x?.k).slice(0, 8), v = txt(x?.v).replace(/^[^：:]{1,6}[：:]\s*/, '').slice(0, 16), raw = txt(x?.src), src = bareText(raw);
      if (!k || !v || src.length < 2 || out.some((o) => o.k === k)) continue;
      // 原文要在设定里找得到，而且那一段设定说的是这个人
      if (!blocks.some((b) => b.includes(src) && b.includes(bareText(name)))) continue;
      const a = nums(v), b = nums(raw);
      if (a.length ? !a.every((n) => b.includes(n)) : !src.includes(bareText(v).replace(/(?:型血|型|座|族|血)$/, ''))) continue;
      const o = { k, v };
      if (k === '生日') o.md = npcMd({ v });
      out.push(o);
    }
    const at = (o) => { const n = BASIC_ORDER.indexOf(o.k); return n < 0 ? 99 : n; };
    return out.sort((p, q) => at(p) - at(q)).slice(0, 10);
  }
  // 没查过的旧卡：先用栏位里已经知道的
  const npcBasic = (p) => p.basic || (p.facts || []).filter((x) => x.known && BASIC_KEYS.test(x.k)).map((x) => ({ k: x.k, v: npcT(x.v).split(/[，。,；;（(]/)[0].slice(0, 16), md: x.md }));
  const npcFacts = (arr) => (Array.isArray(arr) ? arr : []).filter((f) => f && txt(f.k) && txt(f.v)).slice(0, 10).map((f) => {
    const o = { k: txt(f.k).slice(0, 16), v: txt(f.v), known: f.known === true || f.known === 'true', keys: (Array.isArray(f.keys) ? f.keys : []).map(txt).filter((k) => k.length >= 2).slice(0, 4) };
    if (BASIC_KEYS.test(o.k)) return null;
    return o;
  }).filter(Boolean);
  // 已经知道的生日同步进日程（日历上显示 🎂），每人一条
  function npcSyncBirthdays() {
    if (!Array.isArray(chat.birthdays)) chat.birthdays = [];
    let n = 0;
    for (const p of npcData().items) {
      const f = npcBasic(p).find((o) => o.k === '生日' && o.md);
      if (!p.met) continue;
      if (!f) continue;
      const old = chat.birthdays.find((b) => b.who === p.name && b.kind === '生日');
      if (old) { if (old.fromNpc && old.md !== f.md) old.md = f.md; continue; }
      chat.birthdays.push({ id: uid(), who: p.name, md: f.md, kind: '生日', note: '', fromNpc: true });
      n++;
    }
    return n;
  }
  // 刚认识、还没写栏位的人：单独补一张卡
  async function fillNpc(p) {
    if (view.busy) return;
    const sd = storyDate();
    const instr = [
      ...baseInstr(sd.y, sd.m, false, 'npc'),
      `为{{user}}的人物图鉴补全一张卡：「${p.name}」${p.role ? `（${p.role}）` : ''}。依据世界书、人物设定与最近剧情来写，名字不变。站在{{user}}的视角：只有{{user}}在剧情里亲眼看到、亲耳听到、被人告诉过的事才算 known。`,
      npcPrompt('basic'),
      npcPrompt('fill'),
      npcPrompt('fillLinks'),
      `JSON 结构：{"role": "身份", "look": "外貌，20字以内", "line": "${npcPrompt('line')}", "basic": [{"k": "生日", "v": "1月1日", "src": "设定原文"}], "facts": [{"k": "栏位", "v": "内容", "known": false, "keys": ["词"]}], "links": [{"a": "${p.name}", "b": "人名或{{user}}", "label": "关系", "known": false, "keys": ["词"]}], "img": "${npcPrompt('img')}"}`,
    ].join('\n');
    const data = await callAI(instr, `正在补全「${p.name}」…`, true, false);
    if (!data) return;
    const facts = npcFacts(data.facts);
    if (!facts.length) { toast('没补出来，再试一次', 'error'); return; }
    if (!p.basic && Array.isArray(data.basic)) p.basic = checkBasic(data.basic, p.name, await settingBlocks());
    Object.assign(p, { facts, role: p.role || txt(data.role), look: p.look || txt(data.look), line: p.line || txt(data.line).replace(/^[“"「]|[”"」]$/g, ''), img: p.img || txt(data.img) });
    npcAddLinks(data.links);
    if (npcSyncBirthdays()) toast(`🎂 ${p.name}的生日记进了日程`, 'success');
    saveChat();
    render();
  }
  function npcAddLinks(arr) {
    const N = npcData();
    let n = 0;
    for (const l of Array.isArray(arr) ? arr : []) {
      const a = npcSide(l?.a), b = npcSide(l?.b);
      if (!a || !b || a === b || !txt(l.label)) continue;
      if (N.links.some((o) => (o.a === a && o.b === b) || (o.a === b && o.b === a))) continue;
      N.links.push({ id: uid(), a, b, label: txt(l.label).slice(0, 10), known: l.known === true || l.known === 'true', keys: (Array.isArray(l.keys) ? l.keys : []).map(txt).filter((k) => k.length >= 2).slice(0, 4) });
      n++;
    }
    return n;
  }
  function npcInstr() {
    const N = npcData();
    const sd = storyDate();
    const known = N.items.map((p) => `${p.name}（${p.met ? '见过' : '没见过'}${p.met && !(p.facts || []).length ? '，还没写栏位' : ''}${p.img ? '' : '，没有画像描述'}${p.basic ? '' : '，还没查基本信息'}；已知：${(p.facts || []).filter((f) => f.known).map((f) => f.k).join('、') || '无'}；未知：${(p.facts || []).filter((f) => !f.known).map((f) => f.k).join('、') || '无'}）`).join('\n');
    const knownLinks = N.links.map((l) => `${npcLabel(l.a)}—${npcLabel(l.b)}（${l.known ? '已知' : '未知'}）`).join('、');
    return [
      ...baseInstr(sd.y, sd.m, false, 'npc'),
      npcPrompt('task'),
      npcPrompt('met'),
      npcPrompt('basic'),
      npcPrompt('facts'),
      npcPrompt('links'),
      known ? `人物图鉴里已经有：\n${known}\n已有的人不要再放进 people。如果剧情里有人这次见到了、或者某条未知的事这次在剧情里被说出来了，写进 update；见过了但还没写栏位的人，在 update 里给他补上 facts（写法同上）；没有画像描述的人，在 update 里补上 img；还没查基本信息的人，在 update 里补上 basic（设定里没写就给空数组）；见过但没有 line 的人补上 line。` : '',
      knownLinks ? `已有的关系：${knownLinks}。不要重复；这次在剧情里被说破的写进 linkReveal。` : '',
      `JSON 结构：{"people": [{"name": "名字", "emoji": "一个emoji", "met": true, "role": "身份，一句话", "look": "外貌，一句话，20字以内", "line": "${npcPrompt('line')}（没见过的留空）","hint": "基本简介（没见过的人必写）", "basic": [{"k": "生日", "v": "1月1日", "src": "设定原文"}], "facts": [{"k": "栏位", "v": "内容", "known": false, "keys": ["词"]}], "img": "${npcPrompt('img')}"}], "update": [{"name": "已有的人名", "met": true, "reveal": ["这次知道了的栏位名"], "basic": [], "facts": [], "img": "", "line": ""}], "links": [{"a": "人名", "b": "人名或{{user}}", "label": "关系", "known": false, "keys": ["词"]}], "linkReveal": [{"a": "人名", "b": "人名"}]}  // people 最多 40 人；没见过的人写得越短越好`,
    ].filter(Boolean).join('\n');
  }
  async function generateNpc() {
    if (view.busy) return;
    const N = npcData();
    const sd = storyDate();
    const instr = npcInstr();
    const data = await callAI(instr, `正在整理${appTitle('npc')}…`, true, false);
    if (!data) return;
    const today = dateKey(sd);
    let added = 0, met = 0, learned = 0, linksN = 0;
    const blocks = await settingBlocks();
    for (const x of (Array.isArray(data.people) ? data.people : []).slice(0, capN(40))) {
      const name = txt(x?.name);
      if (!name || npcSide(name) === NPC_USER || npcByName(name)) continue;
      const isMet = x.met === true || x.met === 'true';
      N.items.push({
        id: uid(), name, emoji: txt(x.emoji) || '👤', role: txt(x.role), look: txt(x.look), line: isMet ? txt(x.line).replace(/^[“"「]|[”"」]$/g, '') : '', hint: txt(x.hint), met: isMet, isNew: isMet, metAt: isMet ? today : '',
        basic: checkBasic(x.basic, name, blocks), facts: npcFacts(x.facts),
        img: txt(x.img), pic: '',
      });
      added++;
    }
    for (const u of Array.isArray(data.update) ? data.update : []) {
      const p = npcByName(txt(u?.name));
      if (!p) continue;
      if ((u.met === true || u.met === 'true') && !p.met) { Object.assign(p, { met: true, isNew: true, metAt: today }); met++; }
      if (!(p.facts || []).length && Array.isArray(u.facts) && u.facts.length) p.facts = npcFacts(u.facts);
      if (!p.basic && Array.isArray(u.basic)) p.basic = checkBasic(u.basic, p.name, blocks);
      if (!p.img && txt(u.img)) p.img = txt(u.img);
      if (p.met && !p.line && txt(u.line)) p.line = txt(u.line).replace(/^[“"「]|[”"」]$/g, '');
      for (const k of Array.isArray(u.reveal) ? u.reveal : []) {
        const f = (p.facts || []).find((o) => o.k === txt(k) && !o.known);
        if (f) { f.known = true; learned++; }
      }
    }
    linksN += npcAddLinks(data.links);
    for (const r of Array.isArray(data.linkReveal) ? data.linkReveal : []) {
      const a = npcSide(r?.a), b = npcSide(r?.b);
      const l = N.links.find((o) => !o.known && ((o.a === a && o.b === b) || (o.a === b && o.b === a)));
      if (l) { l.known = true; learned++; }
    }
    const bd = npcSyncBirthdays();
    if (bd) toast(`🎂 ${bd} 个生日记进了日程`, 'success');
    saveChat();
    toast(added + met + learned + linksN ? `新建 ${added} 张卡，新认识 ${met} 人，揭开 ${learned} 条，新关系 ${linksN} 条` : '这次没有新东西', added + met + learned ? 'success' : 'info');
    render();
  }
  // AI 回复里：说出没见过的人的名字 → 见过；说到某人的名字 + 某条未知的关键词 → 这条知道了
  function autoNpc(text) {
    const N = npcData();
    if (!N.items.length) return { met: [], facts: [] };
    const plain = String(text || '').replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '').replace(/<[^>]+>/g, ' ');
    const today = dateKey(storyDate());
    const named = (n) => n === NPC_USER || (txt(n).length >= 2 && plain.includes(n));
    const hasKey = (keys) => (keys || []).some((k) => txt(k).length >= 2 && plain.includes(k));
    const metNow = N.items.filter((p) => !p.met && named(p.name));
    for (const p of metNow) Object.assign(p, { met: true, isNew: true, metAt: today });
    const facts = [];
    for (const p of N.items) {
      if (!p.met || !named(p.name)) continue;
      for (const f of p.facts || []) if (!f.known && hasKey(f.keys)) { f.known = true; facts.push(f.k === '生日' && f.md ? `${p.name}的生日（已记进日程 🎂）` : `${p.name}的「${npcT(f.k)}」`); }
    }
    for (const l of N.links) {
      if (l.known || !named(l.a) || !named(l.b) || !hasKey(l.keys)) continue;
      const pa = npcByName(l.a), pb = npcByName(l.b);
      if ((pa && !pa.met) || (pb && !pb.met)) continue;
      l.known = true; facts.push(`${npcLabel(l.a)}和${npcLabel(l.b)}：${l.label}`);
    }
    if (metNow.length || facts.length) {
      npcSyncBirthdays(); saveChat();
    }
    return { met: metNow, facts };
  }
  // 人物图鉴画像：外貌优先用柏宝绘角色库的，没有再用卡上的画像 tag
  async function drawNpcPic(p, label) {
    const bb = baibaiChar(p.name);
    const tags = bb?.tag ? cleanTags(bb.tag) : cleanTags(npcPortraitTags(p.img));
    // 没有 tag 的人：把卡上跟长相有关的写成描述（种族、兽形只有卡上写了才会带上）
    const looks = (p.facts || []).filter((f) => /外貌|长相|样子|种族|兽形|原形|年龄|性别|体型|身材|穿着|打扮|衣着/.test(f.k)).map((f) => `${f.k}：${npcT(f.v)}`);
    const nl = [`${p.name}的证件照式头像：正脸，肩膀以上，纯白背景`, p.role, p.look, ...looks].filter(Boolean).join('。');
    // 固定的证件照构图：正脸、肩膀以上、纯白底
    const pic = await drawImage({ prompt: [npcPrompt('frame'), tags, npcPrompt('back')].filter(Boolean).join(', '), nl: tags ? '' : nl, negative: npcPrompt('negative'), size: 'portrait' }, label, p.id);
    if (!pic) return false;
    p.pic = pic; delete p.picRaw;
    saveChat(); render();
    return true;
  }


  // ---------- 出图用的小工具（公开版：没有「生图」app，图都交给柏宝绘画） ----------
  const bareTag = (s) => String(s).toLowerCase().trim();
  const tagList = (...parts) => [...new Set(parts.flatMap((p) => String(p || '').split(/[,，、\n]/)).map((t) => t.trim()).filter(Boolean))];
  const PERSON_WORDS = 'girl boy other male female man woman people person solo'.split(' ');
  const isPerson = (s) => { const w = bareTag(s).replace(/^[0-9]+[+]? */, ''); return PERSON_WORDS.some((x) => w === x || w === x + 's') || w === 'men' || w === 'women'; };
  const UNDER = /\b(?:scars?|abs|tattoos?|birthmarks?|nipples?|navel|midriff|collarbone|body hair|chest hair|pubic hair)\b/;
  const FEET = /\b(?:shoes?|boots|socks|sneakers|heels|sandals|slippers|barefoot|stockings|pantyhose|thighhighs)\b/;
  const LOWER = /\b(?:skirts?|pants|jeans|trousers|shorts|leggings|bag|handbag|backpack|briefcase|belt)\b/;
  const MINOR = /\b(?:child|children|kid|toddler|baby|loli|shota|minor|underage|teen(?:age|aged|ager)?|preteen|young (?:girl|boy)|little (?:girl|boy)|(?:elementary|middle|high) school(?:er| student)?)\b/i;
  // 长相：用柏宝绘角色库里同名的人
  function baibaiChar(name) {
    try {
      const list = W.STBaiBaiImage?.getCharacters?.().characters || [];
      const n = txt(name);
      return list.find((c) => c.name === n) || list.find((c) => n.length >= 2 && (c.name.includes(n) || n.includes(c.name))) || null;
    } catch (e) { return null; }
  }

  // ---------- 🔔 更新提示（只在公开版里） ----------
  const XSJ_VERSION = '3.1.0', XSJ_NOTES = ["设置里可以检查更新、看更新内容、一键更新"];
  // 从 GitHub 装的文件夹名不一定叫什么，从脚本自己的地址里认
  const XSJ_DIR = (() => { try { return decodeURIComponent((/third-party\/([^/]+)\/index\.js/.exec(new Error().stack || '') || [])[1] || ''); } catch (e) { return ''; } })();
  const UPD_URLS = ['https://raw.githubusercontent.com/BoGphone/st-mini-phone/main/update.json', 'https://cdn.jsdelivr.net/gh/BoGphone/st-mini-phone@main/update.json'];
  const verNums = (v) => String(v || '').split('.').map((x) => parseInt(x, 10) || 0);
  const verNewer = (a, b) => { const x = verNums(a), y = verNums(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
  // 换了版本，以前查到的结果就不算了
  const updState = () => (settings.upd && settings.upd.from === XSJ_VERSION ? settings.upd : {});
  const updNew = () => !!updState().newer;
  let updBusy = '';
  const updSave = (p) => { settings.upd = { ...updState(), from: XSJ_VERSION, ...p }; saveSettings(settings); };
  async function updPost(path, body, ms) {
    return fetch(`/api/extensions/${path}`, { method: 'POST', headers: SillyTavern.getContext().getRequestHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  }
  // 先问酒馆：和装的时候同一个来源，装得上就查得到。不是从 GitHub 装的返回 null
  async function updGit() {
    if (!XSJ_DIR) return null;
    for (const global of [false, true]) {
      try {
        const r = await updPost('version', { extensionName: XSJ_DIR, global }, 25000);
        if (r.status === 404) continue;
        if (!r.ok) return null;
        const d = await r.json();
        return d.remoteUrl ? { global, newer: d.isUpToDate === false } : null;
      } catch (e) { return null; }
    }
    return null;
  }
  // 新版本号和更新内容
  async function updInfo() {
    for (const u of UPD_URLS) {
      try {
        const r = await fetch(`${u}?t=${Math.floor(Date.now() / 600000)}`, { signal: AbortSignal.timeout(7000), credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!r.ok) continue;
        const d = await r.json();
        if (/^\d+(\.\d+){1,2}$/.test(String(d?.version))) return { version: String(d.version), notes: (Array.isArray(d.notes) ? d.notes : []).map((x) => txt(x).slice(0, 120)).filter(Boolean).slice(0, 12) };
      } catch (e) { /* 换下一个地址 */ }
    }
    return null;
  }
  async function updCheck(byHand) {
    if (updBusy) return;
    updBusy = '正在检查…';
    if (byHand) render();
    const [git, info] = await Promise.all([updGit(), updInfo()]);
    updBusy = '';
    if (!git && !info) {
      if (byHand) { toast('没连上，过一会儿再试', 'warning'); render(); }
      return;
    }
    const newer = git ? git.newer : verNewer(info.version, XSJ_VERSION);
    const version = newer && info && verNewer(info.version, XSJ_VERSION) ? info.version : '';
    const told = updState().told;
    updSave({ at: Date.now(), newer, version, notes: version ? info.notes : [], git: git ? { global: git.global } : null });
    if (newer && told !== (version || 'new')) { updSave({ told: version || 'new' }); if (!byHand) toast(`小手机有新版${version ? ' ' + version : ''}，在小手机的「设置」里更新`); }
    if (byHand && !newer) toast('已经是最新版', 'success');
    if (D.getElementById(ROOT_ID) && ['home', 'set'].includes(view.tab) && !view.arrange && (byHand || (view.apiEdit == null && !D.querySelector(`#${ROOT_ID} :is(input,textarea):focus, #${ROOT_ID} .xsj-ask`)))) render();
  }
  // 打开手机时自动查，六小时最多一次
  function updAuto() { if (!settings.updOff && Date.now() - (updState().at || 0) > 6 * 3600e3) updCheck(false); }
  async function updRun() {
    const g = updState().git;
    const manual = '酒馆 → 扩展 → 管理扩展 → 找到「小手机」点更新';
    if (!g || !XSJ_DIR) { toast(`这里更新不了，请手动更新：${manual}`, 'warning'); return; }
    if (!(await ask('现在更新小手机？聊天和小手机里的内容都会保留，更新完要刷新页面。', '更新'))) return;
    updBusy = '正在更新…'; render();
    let ok = false, why = '';
    try {
      const r = await updPost('update', { extensionName: XSJ_DIR, global: g.global }, 90000);
      ok = r.ok;
      if (r.status === 403) why = '这个扩展装给了所有用户，要管理员来更新';
    } catch (e) { why = '太久没反应'; }
    updBusy = '';
    if (!ok) { toast(`没更新成功${why ? '：' + why : ''}。可以手动更新：${manual}`, 'error'); return render(); }
    updSave({ newer: false, version: '', notes: [] });
    render();
    if (await ask('更新好了。现在刷新页面？没发出去的字会丢。', '刷新')) W.location.reload();
  }
  function updCard() {
    const u = updState(), list = (a) => `<ul class="xsj-upd-l">${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    return `<div class="xsj-card xsj-set">
        <div class="xsj-set-h">🔔 更新 <small>现在是 ${esc(XSJ_VERSION)}</small></div>
        <small class="xsj-set-tip">${updBusy ? esc(updBusy) : u.newer ? `<b class="xsj-upd-n">有新版${u.version ? ' ' + esc(u.version) : ''}</b>` : u.at ? '已经是最新版' : '还没检查过'}</small>
        ${u.newer && u.notes?.length ? list(u.notes) : ''}
        <div class="xsj-set-row"><button data-act="upd-check" class="xsj-regen"${updBusy ? ' disabled' : ''}>检查更新</button>${u.newer ? `<button data-act="upd-run" class="xsj-primary"${updBusy ? ' disabled' : ''}>现在更新</button>` : ''}</div>
        <div class="xsj-set-row"><span>打开手机时自动检查</span><div class="xsj-seg"><button data-act="upd-auto-on" class="${settings.updOff ? '' : 'on'}">开</button><button data-act="upd-auto-off" class="${settings.updOff ? 'on' : ''}">关</button></div></div>
        <small class="xsj-set-tip">只向 GitHub（连不上时用 jsDelivr）查有没有新版，不发送你的任何内容。</small>
        ${XSJ_NOTES.length ? `<details class="xsj-raw"><summary>这一版改了什么</summary>${list(XSJ_NOTES)}</details>` : ''}
      </div>`;
  }
  function updClick(act) {
    if (act === 'upd-check') return updCheck(true);
    if (act === 'upd-run') return updBusy ? undefined : updRun();
    if (act === 'upd-auto-on' || act === 'upd-auto-off') { settings.updOff = act === 'upd-auto-off'; saveSettings(settings); return render(); }
  }
  // ---------- 桌面图标：磨砂果冻（由 icon-preview/install.mjs 生成，不手改） ----------
  const ICON_FILTER = "<filter id=\"jelly\" filterUnits=\"userSpaceOnUse\" x=\"-25\" y=\"-25\" width=\"150\" height=\"160\" color-interpolation-filters=\"sRGB\"><feGaussianBlur in=\"SourceGraphic\" stdDeviation=\"4.6\" result=\"b1\"/><feOffset in=\"b1\" dx=\"2\" dy=\"6.5\" result=\"o1\"/><feColorMatrix in=\"o1\" type=\"matrix\" values=\".82 0 0 0 0 0 .82 0 0 0 0 0 .86 0 0 0 0 0 .5 0\" result=\"sh1\"/><feGaussianBlur in=\"SourceAlpha\" stdDeviation=\"1.3\"/><feOffset dx=\".8\" dy=\"1.8\"/><feColorMatrix type=\"matrix\" values=\"0 0 0 0 .3 0 0 0 0 .34 0 0 0 0 .5 0 0 0 .16 0\" result=\"sh2\"/><feMerge result=\"s0\"><feMergeNode in=\"sh1\"/><feMergeNode in=\"sh2\"/></feMerge><feComposite in=\"s0\" in2=\"SourceAlpha\" operator=\"out\" result=\"shadow\"/><feComponentTransfer in=\"SourceAlpha\" result=\"solid\"><feFuncA type=\"linear\" slope=\"1.5\"/></feComponentTransfer><feGaussianBlur in=\"solid\" stdDeviation=\".95\"/><feComponentTransfer result=\"e1\"><feFuncA type=\"linear\" slope=\"4\" intercept=\"-2.9\"/></feComponentTransfer><feComposite in=\"solid\" in2=\"e1\" operator=\"out\" result=\"edge\"/><feFlood flood-color=\"#fff\" flood-opacity=\".8\"/><feComposite in2=\"edge\" operator=\"in\"/><feGaussianBlur stdDeviation=\".25\" result=\"rim\"/><feGaussianBlur in=\"e1\" stdDeviation=\"3.6\" result=\"eb\"/><feComposite in=\"e1\" in2=\"eb\" operator=\"arithmetic\" k2=\"1\" k3=\"-1\" result=\"band\"/><feColorMatrix in=\"SourceGraphic\" type=\"saturate\" values=\"1.5\" result=\"sat\"/><feColorMatrix in=\"sat\" type=\"matrix\" values=\".84 0 0 0 0 0 .84 0 0 0 0 0 .88 0 0 0 0 0 1 0\" result=\"dk\"/><feComposite in=\"dk\" in2=\"band\" operator=\"in\" result=\"deep\"/><feGaussianBlur in=\"solid\" stdDeviation=\"4.2\" result=\"bb\"/><feSpecularLighting in=\"bb\" surfaceScale=\"4\" specularConstant=\".62\" specularExponent=\"13\" lighting-color=\"#fff\" result=\"sp\"><feDistantLight azimuth=\"238\" elevation=\"52\"/></feSpecularLighting><feComposite in=\"sp\" in2=\"e1\" operator=\"in\" result=\"spec\"/><feOffset in=\"e1\" dx=\"-1.4\" dy=\"-2\" result=\"up\"/><feComposite in=\"e1\" in2=\"up\" operator=\"out\"/><feGaussianBlur stdDeviation=\".7\"/><feColorMatrix type=\"matrix\" values=\"0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .75 0\"/><feComposite in2=\"e1\" operator=\"in\" result=\"bot\"/><feMerge><feMergeNode in=\"shadow\"/><feMergeNode in=\"SourceGraphic\"/><feMergeNode in=\"deep\"/><feMergeNode in=\"spec\"/><feMergeNode in=\"bot\"/><feMergeNode in=\"rim\"/></feMerge></filter><filter id=\"emb\" filterUnits=\"userSpaceOnUse\" x=\"-10\" y=\"-10\" width=\"120\" height=\"125\" color-interpolation-filters=\"sRGB\"><feGaussianBlur in=\"SourceAlpha\" stdDeviation=\"1\"/><feOffset dx=\".5\" dy=\"1.3\"/><feColorMatrix type=\"matrix\" values=\"0 0 0 0 .25 0 0 0 0 .25 0 0 0 0 .4 0 0 0 .22 0\"/><feComposite in2=\"SourceAlpha\" operator=\"out\" result=\"s\"/><feMerge><feMergeNode in=\"s\"/><feMergeNode in=\"SourceGraphic\"/></feMerge></filter>";
  const ICON_ART = {
    cal: "<defs><linearGradient id=\"cala\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffa2bc\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#ff94b3\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#ffc7bc\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"calp\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffcbd9\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#ffdbe4\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#ffdecd\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"calh\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#fff3f6\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"cald\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ff8aac\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#ff7da4\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><rect x=\"14\" y=\"20\" width=\"72\" height=\"66\" rx=\"18\" fill=\"url(#cala)\"/></g><g filter=\"url(#emb)\"><rect x=\"22\" y=\"40\" width=\"56\" height=\"38\" rx=\"11\" fill=\"url(#calh)\" opacity=\".72\"/></g><g filter=\"url(#jelly)\"><path d=\"M34 12v17M66 12v17\" fill=\"none\" stroke=\"url(#cald)\" stroke-width=\"8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g><g filter=\"url(#emb)\"><circle cx=\"36\" cy=\"52\" r=\"4.4\" fill=\"url(#cald)\"/><circle cx=\"50\" cy=\"52\" r=\"4.4\" fill=\"url(#cald)\"/><circle cx=\"64\" cy=\"52\" r=\"4.4\" fill=\"url(#cald)\"/><circle cx=\"36\" cy=\"66\" r=\"4.4\" fill=\"url(#cald)\"/><circle cx=\"50\" cy=\"66\" r=\"4.4\" fill=\"url(#cald)\"/></g>",
    map: "<defs><linearGradient id=\"mapa\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#84cab6\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#6ebea8\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#b1e2e5\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"mapp\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#bee4d8\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#d1ece4\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#ceeef6\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"maph\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#f0f9f6\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"mapd\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#5eb69e\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#4aab92\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><path d=\"M12 35q0-3 3-4l20-8 30 9 20-8q4-1 4 3v47q0 3-3 4l-21 9-30-9-20 8q-3 1-3-3z\" fill=\"url(#mapp)\"/></g><path d=\"M36 25v51M64 33v51\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\".75\"/><g filter=\"url(#jelly)\"><path d=\"M55 8a22 22 0 0 1 22 22c0 16-22 35-22 35S33 46 33 30A22 22 0 0 1 55 8z\" fill=\"url(#mapa)\"/></g><g filter=\"url(#emb)\"><circle cx=\"55\" cy=\"30\" r=\"9\" fill=\"url(#maph)\"/></g>",
    ev: "<defs><linearGradient id=\"eva\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#fbc585\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#f7b870\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#ffc6ab\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"evp\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffe2bd\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#ffebd0\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#ffd3c8\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"evh\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#fff8ef\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"evd\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#f4af62\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#f1a34f\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><rect x=\"17\" y=\"17\" width=\"66\" height=\"66\" rx=\"20\" fill=\"url(#eva)\" transform=\"rotate(-10 50 50)\"/></g><g filter=\"url(#emb)\"><g fill=\"url(#evh)\" transform=\"rotate(-10 50 50)\"><circle cx=\"35\" cy=\"35\" r=\"6.6\"/><circle cx=\"65\" cy=\"35\" r=\"6.6\"/><circle cx=\"50\" cy=\"50\" r=\"6.6\"/><circle cx=\"35\" cy=\"65\" r=\"6.6\"/><circle cx=\"65\" cy=\"65\" r=\"6.6\"/></g></g>",
    mon: "<defs><linearGradient id=\"mona\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ff6e78\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#ff5768\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#ff9eb1\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"monp\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffafaf\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#ffc7c7\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#ffc1d4\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"monh\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#ffecec\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"mond\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ff485e\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#ff3350\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><rect x=\"20\" y=\"11\" width=\"62\" height=\"78\" rx=\"15\" fill=\"url(#mona)\"/></g><g filter=\"url(#jelly)\"><rect x=\"16\" y=\"11\" width=\"15\" height=\"78\" rx=\"7.5\" fill=\"url(#monp)\"/></g><g filter=\"url(#emb)\"><path d=\"M57 67C43 57 40.5 50 40.5 45a8.5 8.5 0 0 1 16.5-3 8.5 8.5 0 0 1 16.5 3C73.5 50 71 57 57 67z\" fill=\"url(#monh)\"/></g>",
    x: "<defs><linearGradient id=\"xa\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#7f8491\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#686d79\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#acabc0\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"xp\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#babec7\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#cfd1d8\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#cbc8d9\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"xh\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#eff0f2\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"xd\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#585e69\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#444954\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><path d=\"M24 20L76 80\" fill=\"none\" stroke=\"url(#xa)\" stroke-width=\"17\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g><g filter=\"url(#jelly)\"><path d=\"M76 20L24 80\" fill=\"none\" stroke=\"url(#xp)\" stroke-width=\"10\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g>",
    dex: "<defs><linearGradient id=\"dexa\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#9080d2\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#7f6dc6\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#cea7e4\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"dexp\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#c2b8ea\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#d4cdf0\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#e9c6ee\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"dexh\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#f1eefa\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"dexd\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#7360bd\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#634fb2\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><path d=\"M50 26C39 17 25 15 13 18q-3 .6-3 4v52q0 3 3 2.5c13-2 26 0 37 9z\" fill=\"url(#dexp)\"/></g><g filter=\"url(#jelly)\"><path d=\"M50 26c11-9 25-11 37-8q3 .6 3 4v52q0 3-3 2.5c-13-2-26 0-37 9z\" fill=\"url(#dexa)\"/></g><g filter=\"url(#emb)\"><path d=\"M22 36c6-.6 12 .6 18 4M22 50c6-.6 12 .6 18 4\" fill=\"none\" stroke=\"url(#dexh)\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M69.5 33l3.8 9 9.7.8-7.4 6.3 2.3 9.4-8.4-5-8.4 5 2.3-9.4-7.4-6.3 9.7-.8z\" fill=\"url(#dexh)\"/></g>",
    wiki: "<defs><linearGradient id=\"wikia\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#8dce8e\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#77c080\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#cae89c\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"wikip\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#c4eabe\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#d5f0d1\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#e4f2b8\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"wikih\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#f1faf0\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"wikid\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#68b676\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#53a868\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><path d=\"M47 80C23 77 11 59 14 33c24 1 37 18 33 47z\" fill=\"url(#wikip)\"/></g><g filter=\"url(#jelly)\"><path d=\"M47 74c-10-32 4-59 40-66 7 36-10 63-40 66z\" fill=\"url(#wikia)\"/></g><g filter=\"url(#emb)\"><path d=\"M42 90c1-22 12-41 30-60\" fill=\"none\" stroke=\"url(#wikih)\" stroke-width=\"4.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g>",
    log: "<defs><linearGradient id=\"loga\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#dfbf89\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#d4ae74\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#f3ccaf\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"logp\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#f2e1c0\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#f6ead2\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#f9d9cb\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"logh\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#fcf8f0\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"logd\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#cca266\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#c29252\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><rect x=\"23\" y=\"20\" width=\"54\" height=\"60\" rx=\"8\" fill=\"url(#logp)\"/></g><g filter=\"url(#jelly)\"><rect x=\"13\" y=\"10\" width=\"74\" height=\"19\" rx=\"9.5\" fill=\"url(#loga)\"/></g><g filter=\"url(#jelly)\"><rect x=\"13\" y=\"71\" width=\"74\" height=\"19\" rx=\"9.5\" fill=\"url(#loga)\"/></g><g filter=\"url(#emb)\"><path d=\"M36 41h28M36 50h28M36 59h16\" fill=\"none\" stroke=\"url(#logd)\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g>",
    quest: "<defs><linearGradient id=\"questa\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#d7ac7e\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#ca9966\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#eeb99b\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"questp\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#eed7ba\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#f3e3cf\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#f6cbba\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"questh\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#fbf6ef\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"questd\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#c18b56\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#b67940\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><rect x=\"15\" y=\"26\" width=\"70\" height=\"62\" rx=\"17\" fill=\"url(#questp)\"/></g><g filter=\"url(#emb)\"><path d=\"M30 57h40M30 70h24\" fill=\"none\" stroke=\"url(#questh)\" stroke-width=\"5.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g><g filter=\"url(#jelly)\"><circle cx=\"50\" cy=\"26\" r=\"16\" fill=\"url(#questa)\"/></g>",
    omen: "<defs><linearGradient id=\"omena\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#67b8c5\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#53a3b6\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#a6bce8\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"omenp\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#a8dfe3\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#c2e8eb\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#cccbf5\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"omenh\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#ebf7f8\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"omend\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#4596ac\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#33839f\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><path d=\"M25 89c0-12 9-20 25-20s25 8 25 20q0 2-2 2H27q-2 0-2-2z\" fill=\"url(#omend)\"/></g><g filter=\"url(#jelly)\"><circle cx=\"50\" cy=\"43\" r=\"35\" fill=\"url(#omena)\"/></g><g filter=\"url(#emb)\"><path d=\"M50 24c2.4 12.5 6.5 16.6 19 19-12.5 2.4-16.6 6.5-19 19-2.4-12.5-6.5-16.6-19-19 12.5-2.4 16.6-6.5 19-19z\" fill=\"url(#omenh)\"/></g>",
    dream: "<defs><linearGradient id=\"dreama\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#72b5f3\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#5a9ce8\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#b3bcff\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"dreamp\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#b3e1ff\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#c9eaff\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#d5c9ff\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"dreamh\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#edf8ff\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"dreamd\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#4a8be1\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#3474d8\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><path d=\"M10.3 71.1A45 14 -28 0 1 89.7 28.9\" fill=\"none\" stroke=\"url(#dreamd)\" stroke-width=\"5.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g><g filter=\"url(#jelly)\"><circle cx=\"50\" cy=\"50\" r=\"32\" fill=\"url(#dreama)\"/></g><g filter=\"url(#jelly)\"><path d=\"M10.3 71.1A45 14 -28 0 0 89.7 28.9\" fill=\"none\" stroke=\"url(#dreamp)\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g>",
    npc: "<defs><linearGradient id=\"npca\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#b19bd8\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#9e85cb\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#e4b7e0\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"npcp\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#dacdef\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#e5dcf4\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#f5cde7\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"npch\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#f6f3fb\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"npcd\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#9075c3\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#7e61b7\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><rect x=\"10\" y=\"20\" width=\"80\" height=\"62\" rx=\"17\" fill=\"url(#npcp)\"/></g><g filter=\"url(#jelly)\"><circle cx=\"36\" cy=\"42\" r=\"11.5\" fill=\"url(#npca)\"/><path d=\"M18 71c1-12 8-16.5 18-16.5S53 59 54 71q0 1.5-2 1.5H20q-2 0-2-1.5z\" fill=\"url(#npca)\"/></g><g filter=\"url(#emb)\"><path d=\"M64 41h15M64 53h15M64 65h8\" fill=\"none\" stroke=\"url(#npch)\" stroke-width=\"5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g>",
    closet: "<defs><linearGradient id=\"closeta\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ecacc6\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#e394b6\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#e8c3ec\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"closetp\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#fadae5\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#fbe5ed\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#ebd3f7\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"closeth\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#fef6f9\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"closetd\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#dc83ac\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#d46d9d\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><path d=\"M50 27v-5c0-3.5 7-4.5 7-10.5a7 7 0 0 0-14 0\" fill=\"none\" stroke=\"url(#closetd)\" stroke-width=\"5.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g><g filter=\"url(#jelly)\"><path d=\"M38 24c3 12 21 12 24 0l10 5c1 11-2 18-8 23l23 36c-20 8-54 8-74 0l23-36c-6-5-9-12-8-23z\" fill=\"url(#closeta)\"/></g><g filter=\"url(#emb)\"><rect x=\"35\" y=\"47\" width=\"30\" height=\"8.5\" rx=\"4.25\" fill=\"url(#closeth)\"/></g>",
    pic: "<defs><linearGradient id=\"pica\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#e4aa96\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#d9958e\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#f4bac1\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"picp\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#f6d6be\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#f9e2d1\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#f8ccdd\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"pich\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#fdf5f0\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"picd\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#d18788\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#c67481\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><rect x=\"11\" y=\"17\" width=\"78\" height=\"67\" rx=\"18\" fill=\"url(#picp)\"/></g><g filter=\"url(#jelly)\"><circle cx=\"68\" cy=\"36\" r=\"9\" fill=\"url(#pich)\"/></g><g filter=\"url(#jelly)\"><path d=\"M19 70l22-29c2.6-3.4 6.6-3.4 9.2 0l13 18 6-7c2.6-3 5.6-3 8 0L83 60v6c0 6-4 10-10 10H27c-5 0-9-2-8-6z\" fill=\"url(#pica)\"/></g>",
    set: "<defs><linearGradient id=\"seta\" x1=\"26\" y1=\"8\" x2=\"70\" y2=\"94\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#c8c8d2\" stop-opacity=\"0.86\"/><stop offset=\"0.5\" stop-color=\"#b8b8c3\" stop-opacity=\"0.8\"/><stop offset=\"1\" stop-color=\"#d2d6eb\" stop-opacity=\"0.84\"/></linearGradient><linearGradient id=\"setp\" x1=\"24\" y1=\"10\" x2=\"72\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#e7e7ed\" stop-opacity=\"0.82\"/><stop offset=\"0.55\" stop-color=\"#eeeef2\" stop-opacity=\"0.72\"/><stop offset=\"1\" stop-color=\"#dce0f3\" stop-opacity=\"0.8\"/></linearGradient><linearGradient id=\"seth\" x1=\"50\" y1=\"15\" x2=\"50\" y2=\"85\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.96\"/><stop offset=\"1\" stop-color=\"#f9f9fb\" stop-opacity=\"0.86\"/></linearGradient><linearGradient id=\"setd\" x1=\"50\" y1=\"10\" x2=\"50\" y2=\"92\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#acacb9\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#9d9dab\" stop-opacity=\"0.85\"/></linearGradient></defs><g filter=\"url(#jelly)\"><path d=\"M50.0 10.4L52.1 10.4L54.1 10.8L55.9 12.5L56.9 17.6L57.8 21.0L59.1 22.0L60.5 22.6L61.9 23.2L63.4 23.8L65.0 24.0L68.0 22.2L72.3 19.3L74.8 19.4L76.5 20.6L78.0 22.0L79.4 23.5L80.6 25.2L80.7 27.7L77.8 32.0L76.0 35.0L76.2 36.6L76.8 38.1L77.4 39.5L78.0 40.9L79.0 42.2L82.4 43.1L87.5 44.1L89.2 45.9L89.6 47.9L89.6 50.0L89.6 52.1L89.2 54.1L87.5 55.9L82.4 56.9L79.0 57.8L78.0 59.1L77.4 60.5L76.8 61.9L76.2 63.4L76.0 65.0L77.8 68.0L80.7 72.3L80.6 74.8L79.4 76.5L78.0 78.0L76.5 79.4L74.8 80.6L72.3 80.7L68.0 77.8L65.0 76.0L63.4 76.2L61.9 76.8L60.5 77.4L59.1 78.0L57.8 79.0L56.9 82.4L55.9 87.5L54.1 89.2L52.1 89.6L50.0 89.6L47.9 89.6L45.9 89.2L44.1 87.5L43.1 82.4L42.2 79.0L40.9 78.0L39.5 77.4L38.1 76.8L36.6 76.2L35.0 76.0L32.0 77.8L27.7 80.7L25.2 80.6L23.5 79.4L22.0 78.0L20.6 76.5L19.4 74.8L19.3 72.3L22.2 68.0L24.0 65.0L23.8 63.4L23.2 61.9L22.6 60.5L22.0 59.1L21.0 57.8L17.6 56.9L12.5 55.9L10.8 54.1L10.4 52.1L10.4 50.0L10.4 47.9L10.8 45.9L12.5 44.1L17.6 43.1L21.0 42.2L22.0 40.9L22.6 39.5L23.2 38.1L23.8 36.6L24.0 35.0L22.2 32.0L19.3 27.7L19.4 25.2L20.6 23.5L22.0 22.0L23.5 20.6L25.2 19.4L27.7 19.3L32.0 22.2L35.0 24.0L36.6 23.8L38.1 23.2L39.5 22.6L40.9 22.0L42.2 21.0L43.1 17.6L44.1 12.5L45.9 10.8L47.9 10.4L50.0 10.4z\" fill=\"url(#seta)\"/></g><g filter=\"url(#jelly)\"><circle cx=\"50\" cy=\"50\" r=\"14\" fill=\"url(#seth)\"/></g>",
  };
  const ICON_URI = Object.fromEntries(Object.entries(ICON_ART).map(([k, s]) => [k, 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="405" viewBox="-15 -15 130 135"><defs>' + ICON_FILTER + '</defs>' + s + '</svg>')]));

  // ---------- 交互 ----------
  function shiftMonth(n) {
    let [y, m] = view.month.split('-').map(Number);
    m += n; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    view.month = ym(y, m); view.day = `${view.month}-01`; view.editing = null; view.note = null; render();
  }

  async function onClick(ev) {
    // 长按/拖动图标之后松手会带一个 click：吞掉，不打开 app
    if (swallowClick) { swallowClick = false; if (ev.target.closest?.('.xsj-app')) return; }
    if (view.tab === 'home' && view.arrange) {
      // 整理模式：点图标不打开；点「完成」或空白处结束
      if (ev.target.closest?.('.xsj-app')) return;
      if (ev.target.closest?.('.xsj-screen') && !ev.target.closest?.('.xsj-close')) { view.arrange = false; return render(); }
    }
    const t = ev.target.closest('button, [data-day], [data-item], [data-place], [data-region], [data-xopen], [data-dreamopen], [data-npc], [data-npclink], [data-wland], [data-wspot]');
    if (!t || !D.getElementById(ROOT_ID)?.contains(t)) return;
    const act = t.dataset.act;
    if (t.classList.contains('xsj-close')) return close();
    if (act === 'back') return goBack();
    if (act?.startsWith('upd-')) return updClick(act);
    // 生成前问：只新增，还是全部重新生成；全部重来但没生成出东西时，把原来的还回去
    if (act === 'gen-dex' && !view.busy && !chat.dexEra) {
      const v = await askChoice('这个故事是什么时代背景？选一次就记住，设置里能改', Object.entries(DEX_ERAS).map(([k, [n]]) => ({ v: k, label: k === 'auto' ? '自动（看世界书和剧情）' : n, primary: k === 'auto' })));
      if (!v) return;
      chat.dexEra = v; saveChat(); render();
    }
    if (REGEN[act] && !view.busy) {
      const c = await regenChoice(act);
      if (!c.go) return;
      if (c.undo) {
        render();
        const run = { 'gen-dex': generateDex, 'gen-wiki': generateWiki, 'gen-dream': generateDream, 'gen-npc': generateNpc }[act];
        await run();
        if (!REGEN[act].n()) { c.undo(); toast('这次没生成出来，原来的内容已经还原', 'warning'); render(); }
        return;
      }
    }
    if (t.dataset.tab || act === 'home') { view.calSet = false; view.npcSet = false; view.dexSet = false; view.mapSet = false; view.evSet = false; view.appSet = false; view.picSet = false; view.closetOpen = false; view.closetSet = null; if (t.dataset.today) { view.day = t.dataset.today; view.month = t.dataset.today.slice(0, t.dataset.today.lastIndexOf('-')); } view.lookEdit = null; view.shotEdit = null; view.styleEdit = null; view.tab = t.dataset.tab || 'home'; view.editing = null; view.note = null; view.place = null; view.region = null; view.mapEdit = false; view.dex = null; view.wiki = null; view.dream = null; view.npc = null; view.closetItem = null; return render(); }
    if (t.dataset.dex) {
      const x = codex().dex.items.find((o) => o.id === t.dataset.dex);
      view.dex = t.dataset.dex;
      if (x?.isNew) { delete x.isNew; saveChat(); }
      render(); D.querySelector(`#${ROOT_ID} .xsj-body`).scrollTop = 0; return;
    }
    if (t.dataset.godex) {
      const x = codex().dex.items.find((o) => o.id === t.dataset.godex);
      if (!x) return;
      view.tab = 'dex'; view.dex = x.id; view.place = null; view.region = null; view.mapEdit = false;
      if (x.isNew) { delete x.isNew; saveChat(); }
      render(); D.querySelector(`#${ROOT_ID} .xsj-body`).scrollTop = 0; return;
    }
    if (t.dataset.goplace) {
      if (!currentMap()?.places.some((p) => p.id === t.dataset.goplace)) return;
      view.tab = 'map'; view.place = t.dataset.goplace; view.region = null; view.dex = null;
      render(); return;
    }
    if (t.dataset.dreamopen) { view.dream = t.dataset.dreamopen; render(); D.querySelector(`#${ROOT_ID} .xsj-body`).scrollTop = 0; return; }
    if (t.dataset.dreamcat) { view.dreamCat = t.dataset.dreamcat; return render(); }
    if (t.dataset.maplevel) { view.mapLevel = t.dataset.maplevel === 'world' ? 'world' : 'local'; view.place = null; view.region = null; view.wland = null; view.wspot = null; view.mapEdit = false; view.mapZoom = 1; return render(); }
    if (t.dataset.wland) { view.wland = t.dataset.wland; view.wspot = null; return render(); }
    if (t.dataset.wspot) { view.wspot = t.dataset.wspot; view.wland = null; return render(); }
    if (t.dataset.npctab) { view.lookEdit = null; view.npcTab = t.dataset.npctab; return render(); }
    if (t.dataset.npc) {
      const p = npcData().items.find((o) => o.id === t.dataset.npc);
      if (!p) return;
      view.npc = p.id; if (p.isNew) { delete p.isNew; saveChat(); }
      render(); D.querySelector(`#${ROOT_ID} .xsj-body`).scrollTop = 0; return;
    }
    if (t.dataset.npcfact) {
      const p = npcData().items.find((o) => o.id === view.npc);
      const f = p?.facts?.[Number(t.dataset.npcfact)];
      if (!f || f.known) return;
      if (!(await ask(`不等剧情，直接揭开${p.name}的「${npcT(f.k)}」？`, '揭开'))) return;
      f.known = true;
      if (npcSyncBirthdays()) toast(`🎂 ${p.name}的生日记进了日程`, 'success');
      saveChat(); return render();
    }
    if (t.dataset.npclink) {
      const l = npcData().links.find((o) => o.id === t.dataset.npclink);
      if (!l || l.known) return;
      const hidden = [l.a, l.b].map(npcByName).some((p) => p && !p.met);
      if (hidden) { toast('还没见过这个人', 'info'); return; }
      if (!(await ask(`不等剧情，直接揭开${npcLabel(l.a)}和${npcLabel(l.b)}之间的关系？`, '揭开'))) return;
      l.known = true; saveChat(); return render();
    }
    if (t.dataset.ev) {
      if (view.evRolling) return;
      const o = evOpt(), v = t.dataset.v, k = t.dataset.ev;
      if (k === 'who') { const w = chat.evWho || []; chat.evWho = w.includes(v) ? w.filter((x) => x !== v) : [...w, v]; saveChat(); return render(); }
      if (k === 'kind') o.kinds = o.kinds.includes(v) ? o.kinds.filter((x) => x !== v) : [...o.kinds, v];
      else o[k] = k === 'count' ? Number(v) : v;
      settings.evOpt = o; saveSettings(settings); return render();
    }
    if (t.dataset.dexera) { chat.dexEra = t.dataset.dexera; view.cpOpen = ''; saveChat(); return render(); }
    if (t.dataset.dexcat) { view.dexCat = t.dataset.dexcat; return render(); }
    if (t.dataset.wiki) { view.wiki = t.dataset.wiki; render(); D.querySelector(`#${ROOT_ID} .xsj-body`).scrollTop = 0; return; }
    if (t.dataset.wikicat) { view.wikiCat = t.dataset.wikicat; return render(); }
    if (t.dataset.place) { if (!view.mapEdit) { view.place = t.dataset.place; view.region = null; render(); } return; }
    if (t.dataset.region) { if (!view.mapEdit) { view.region = view.region === t.dataset.region ? null : t.dataset.region; view.place = null; render(); } return; }
    if (t.dataset.xtab) { view.xTab = t.dataset.xtab; view.xMenu = false; render(); D.querySelector(`#${ROOT_ID} .xsj-body`).scrollTop = 0; return; }
    if (act === 'x-menu') { view.xMenu = !view.xMenu; return render(); }
    if (['x-reveal', 'gen-x', 'x-pic-all'].includes(act)) view.xMenu = false;
    if (t.dataset.xopen) { view.xOpen = { ...(view.xOpen || {}), [t.dataset.xopen]: !view.xOpen?.[t.dataset.xopen] }; return render(); }
    if (t.dataset.gonote) { view.appSet = false; view.tab = 'mon'; view.note = t.dataset.gonote; return render(); }
    if (t.dataset.note) { view.note = t.dataset.note; render(); D.querySelector(`#${ROOT_ID} .xsj-body`).scrollTop = 0; return; }
    if (t.dataset.cat) { view.noteCat = t.dataset.cat; return render(); }
    if (t.dataset.day) { view.day = t.dataset.day; view.editing = null; return render(); }
    if (t.dataset.hol) {
      const h = monthData(view.month).holidays.find((x) => x.id === t.dataset.hol);
      if (h) { view.editing = { id: h.id, date: h.date, time: '', title: h.name, place: '', end: h.end || '', note: '', type: h.kind === VAC ? VAC : HOL }; render(); }
      return;
    }
    if (t.dataset.bd) {
      const b = chat.birthdays.find((x) => x.id === t.dataset.bd);
      if (b) { view.editing = { id: b.id, date: view.day, time: '', title: b.who, place: '', end: '', note: b.note || '', type: b.kind }; render(); }
      return;
    }
    if (t.dataset.item) {
      const it = monthData(view.month).schedule.find((x) => x.id === t.dataset.item);
      if (it) { view.editing = { ...it }; render(); }
      return;
    }
    if (t.dataset.type && view.editing) { syncForm(); view.editing.type = t.dataset.type; return render(); }
    if (t.dataset.calstyle) { chat.calStyle = t.dataset.calstyle; saveChat(); applyWeek(); return render(); }
    if (t.dataset.glass) { settings.glass = t.dataset.glass; saveSettings(settings); return render(); }
    if (t.dataset.owner) { settings.owner = t.dataset.owner; saveSettings(settings); return render(); }
    switch (act) {
      case 'prev': return shiftMonth(-1);
      case 'next': return shiftMonth(1);
      case 'app-set': view.cpOpen = ''; view.appSet = true; return render();
      case 'ev-set': view.cpOpen = ''; view.evSet = true; return render();
      case 'ev-clear': {
        const md = monthData(view.month);
        if (!(await ask('清空掷出的剧情？★ 收藏的会留着。', '清空'))) return;
        md.events = md.events.filter((x) => x.star); saveChat(); return render();
      }
      case 'ev-roll': {
        if (view.busy || view.evRolling) return;
        const el = D.querySelector(`#${ROOT_ID} [data-evwish]`); if (el) chat.evWish = el.value;
        const slots = evRoll(), opts = evOpts(slots);
        chat.evLast = { n: slots[0].n, text: slots.map((x) => `${x.kind}·${{ 轻: '小', 中: '中', 重: '大' }[x.level]}`).join('，') };
        saveChat();
        view.evRolling = true; render();
        const had = monthData(view.month).events.length;
        try { await generate(['events'], view.month, true, opts); } finally { view.evRolling = false; render(); }
        if (view.tab === 'ev' && monthData(view.month).events.length > had) D.querySelector(`#${ROOT_ID} .xsj-evhead`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      case 'map-set': view.cpOpen = ''; view.mapSet = true; view.place = null; view.region = null; return render();
      case 'dex-set': view.cpOpen = ''; view.dexSet = true; return render();
      case 'npc-set': view.cpOpen = ''; view.npcSet = true; return render();
      case 'cp-reset': setPrompt(t.dataset.cps, t.dataset.k, ''); view.cpOpen = t.dataset.k; toast('恢复成默认的了', 'success'); return render();
      case 'cal-set': view.cpOpen = ''; view.calSet = true; view.editing = null; return render();
      case 'add-item': {
        if (!view.day || !view.day.startsWith(view.month + '-')) view.day = view.month + '-01';
        view.editing = { id: '', date: view.day, time: '', title: '', place: '', end: '', note: '', type: '私事' };
        render();
        return;
      }
      case 'cancel-edit': view.editing = null; return render();
      case 'save-item': {
        syncForm();
        const e = view.editing;
        if (!e.title.trim()) return toast('先写个名字', 'warning');
        const md = monthData(view.month);
        const id = e.id || uid();
        md.schedule = md.schedule.filter((x) => x.id !== id);
        md.holidays = md.holidays.filter((x) => x.id !== id);
        chat.birthdays = chat.birthdays.filter((x) => x.id !== id);
        if (e.type === HOL || e.type === VAC) {
          const m = String(e.end || '').trim().match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})$/);
          const end = e.type === VAC && m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : '';
          md.holidays.push({ id, date: e.date, kind: e.type, end, name: e.title.trim(), manual: true });
        } else if (FIXED.includes(e.type)) {
          chat.birthdays.push({ id, who: e.title.trim(), md: e.date.slice(-5), kind: e.type, note: String(e.note || '').trim(), manual: true });
        } else md.schedule.push({ id, date: e.date, time: e.time, title: e.title.trim(), place: e.place, type: e.type, manual: true });
        view.editing = null; saveChat(); return render();
      }
      case 'del-item': {
        const what = { [HOL]: '这个节日', [VAC]: '这个假期', 生日: '这个生日（以后每年都不再显示）', 纪念日: '这个纪念日（以后每年都不再显示）' }[view.editing.type] || '这条日程';
        if (!(await ask(`删除${what}？`, '删除'))) return;
        const md = monthData(view.month);
        md.schedule = md.schedule.filter((x) => x.id !== view.editing.id);
        md.holidays = md.holidays.filter((x) => x.id !== view.editing.id);
        chat.birthdays = chat.birthdays.filter((x) => x.id !== view.editing.id);
        view.editing = null; saveChat(); return render();
      }
      case 'regen-bd': {
        if (chat.birthdays.some((x) => !x.manual) && !(await ask('重新从设定里找生日和纪念日？自己加的会保留。', '重新找'))) return;
        return generate(['birthdays'], view.month);
      }
      case 'gen-map': {
        const mpx = currentMap();
        const v = await askRegen(mpx ? mpx.name || '地图' : '生成地图', mpx ? mpx.places.filter((p) => !p.fog).length : 0, '个地点', '重新画，自己加的、挪过的、迷雾地点会保留', 'map', mpx && !mpx.places.some((p) => !p.fog) ? '<button data-v="add" data-go class="xsj-primary">保留现在的，只新增</button><button data-v="reset" data-go class="xsj-regen-reset">全部重新画</button>' : null);
        if (v) return generateMap(v === 'add');
        return;
      }
      case 'zoom-in': view.mapZoom = Math.min(3, (view.mapZoom || 1) + 0.5); return render();
      case 'zoom-out': view.mapZoom = Math.max(1, (view.mapZoom || 1) - 0.5); return render();
      case 'map-edit': view.mapEdit = !view.mapEdit; view.place = null; return render();
      case 'place-close': view.place = null; return render();
      case 'region-close': view.region = null; return render();
      case 'gen-fog': if (view.busy || !(await askRegen('打听消息', 0, '', '', 'fog', '<button data-v="new" data-go class="xsj-primary">打听</button>'))) return; return generateFog();
      case 'fog-reveal': case 'fog-del': {
        const mp = currentMap();
        const p = mp?.places.find((x) => x.id === view.place && x.fog);
        if (!p) return;
        if (act === 'fog-del') {
          if (!(await ask('不要这个传闻了？地图上的「？」会去掉。', '去掉'))) return;
          mp.places = mp.places.filter((x) => x !== p); view.place = null;
        } else { revealFog(p); toast(`🗺 发现新地点：${p.name}`, 'success'); }
        saveMap(mp); return render();
      }
      case 'region-pic': {
        const r = currentMap()?.regions.find((x) => x.id === view.region);
        if (r) await drawRegionPic(r, '正在画');
        return;
      }
      case 'gen-world': {
        const v = await askRegen(currentWorld() ? '世界地图要怎么更新？' : '生成世界地图', 0, '', '', 'world', currentWorld() ? '<button data-v="add" data-go class="xsj-primary">保留现在的，再打听更远的地方</button><button data-v="reset" data-go class="xsj-regen-reset">全部重新画（去过的地方还是亮的）</button>' : null);
        if (v) return generateWorld(v === 'add');
        return;
      }
      case 'world-pics': {
        const w = currentWorld();
        if (!w) return;
        const v = await askChoice('世界地图的大背景', [{ v: 'bg', label: w.pic ? '↻ 重画大背景' : '🌍 画一张大背景', primary: true }, ...(w.pic ? [{ v: 'clear', label: '去掉大背景', danger: true }] : [])]);
        if (v === 'bg') return drawWorldPic('正在画世界地图');
        if (v === 'clear') { w.pic = ''; saveWorld(w); return render(); }
        return;
      }
      case 'wclose': view.wland = null; view.wspot = null; return render();
      case 'wreveal': {
        const w = currentWorld();
        const x = w && [...w.lands, ...w.spots].find((o) => o.id === t.dataset.id);
        if (!x || !(await ask('不等剧情，直接揭开这个地方？（想让角色在剧情里打听，就点「📎 带进剧情」）', '直接揭开'))) return;
        x.known = true;
        if (x.land) { const l = w.lands.find((o) => o.name === x.land); if (l) l.known = true; }
        saveWorld(w); return render();
      }
      case 'map-pics': {
        const mp = currentMap();
        if (!mp) return;
        const nR = mp.regions.filter((x) => !x.pic).length, nP = mp.places.filter((p) => !p.pic && !p.fog).length;
        const v = await askChoice('要画哪一种？', [
          { v: 'bg', label: mp.pic ? '↻ 重画整张地图的大背景' : '🗺 整张地图的大背景', primary: true },
          ...(nR ? [{ v: 'region', label: `🏞 区域背景（还没图的 ${nR} 个）` }] : []),
          ...(nP ? [{ v: 'place', label: `📍 地点图（还没图的 ${nP} 个）` }] : []),
          ...(mp.pic ? [{ v: 'clear', label: '去掉大背景', danger: true }] : []),
        ]);
        if (v === 'bg') return drawMapPic('正在画整张地图');
        if (v === 'clear') { mp.pic = ''; saveMap(mp); return render(); }
        if (v === 'region' || v === 'place') { t.dataset.act = v === 'region' ? 'region-pic-all' : 'place-pic-all'; return onClick({ target: t }); }
        return;
      }
      case 'region-pic-all': {
        const todo = (currentMap()?.regions || []).filter((x) => !x.pic);
        if (!todo.length) return;
        if (!(await ask(`给还没背景的 ${todo.length} 个区域一张张画俯瞰图？中途可以取消，已经画好的会留着。`, `画 ${todo.length} 张`))) return;
        batchStop = false;
        let done = 0;
        for (const [i, r] of todo.entries()) {
          if (batchStop) break;
          view.batch = `${i + 1}/${todo.length}`;
          if (await drawRegionPic(r, `区域背景 ${i + 1}/${todo.length}`)) done++;
          else if (batchStop) break;
        }
        toast(batchStop ? `已取消，画好了 ${done} 张` : `画好了 ${done}/${todo.length} 张`, done ? 'success' : 'warning');
        batchStop = false; view.batch = null; render();
        return;
      }
      case 'add-here': {
        const mp = currentMap(); const loc = detectLocation();
        if (!mp || !loc) return;
        const np = { id: uid(), name: loc.split(/[·・\/]/)[0].trim().slice(0, 16), emoji: '📍', type: '其他', region: '', x: 50, y: 50, desc: '', vibe: '', people: '', manual: true };
        mp.places.push(np); saveMap(mp);
        view.mapEdit = true; view.place = np.id; toast('加在地图中间了，拖到合适的位置', 'info'); return render();
      }
      case 'save-place': case 'del-place': {
        const mp = currentMap(); if (!mp) return;
        const p = mp.places.find((x) => x.id === view.place); if (!p) return;
        if (act === 'del-place') {
          if (!(await ask(`从地图上删除「${p.name}」？`, '删除'))) return;
          mp.places = mp.places.filter((x) => x.id !== p.id);
        } else {
          D.querySelectorAll(`#${ROOT_ID} [data-pf]`).forEach((el) => { p[el.dataset.pf] = el.value.trim(); });
          p.name ||= '未命名'; p.emoji ||= '📍'; p.manual = true;
        }
        saveMap(mp); view.place = null; return render();
      }
      case 'gen-x': {
        const n = chat.xlog?.items?.length || 0;
        const v = await askRegen(n ? 'X 浏览记录' : '生成 X 浏览记录', n, '条', '换一批，收藏过的会留着', 'x');
        if (v) return generateX(v === 'add');
        return;
      }
      case 'x-reveal': view.xReveal = !view.xReveal; return render();
      case 'wp-draw': {
        const desc = D.getElementById('xsj-wp-desc')?.value.trim() || '';
        const withChar = !!D.getElementById('xsj-wp-char')?.checked;
        let tag = '';
        if (withChar) {
          tag = baibaiChar(charKey())?.tag || '';
          if (!tag) toast(`柏宝绘角色库里没找到 ${charKey()}，这次只画风景`, 'warning');
        }
        const base = 'phone wallpaper, vertical composition, aesthetic, detailed background, soft lighting, masterpiece';
        const prompt = tag ? `${tag}, solo, ${base}` : `no humans, scenery, ${base}`;
        const nl = desc || `${currentMap()?.name || '这个世界'}的风景，适合做手机壁纸`;
        const pic = await drawImage({ prompt, nl, size: 'portrait' }, '正在画壁纸');
        if (pic) { settings.wallpaper = pic; settings.wpTone = ''; saveSettings(settings); toast('壁纸换好了', 'success'); render(); }
        return;
      }
      case 'note-pic': {
        const n = notesFor(monthData(view.month)).items.find((x) => x.id === view.note);
        if (!n) return;
        await drawNotePic(n, '正在画封面');
        return;
      }
      case 'note-pic-all': {
        const todo = notesFor(monthData(view.month)).items.filter((n) => !n.pic);
        if (!todo.length) { toast('帖子都有封面了', 'info'); return; }
        if (!(await ask(`把还没封面的 ${todo.length} 篇一张张画出来？中途可以取消，已经画好的会留着。`, `画 ${todo.length} 张`))) return;
        batchStop = false;
        let done = 0;
        for (const [i, n] of todo.entries()) {
          if (batchStop) break;
          view.batch = `${i + 1}/${todo.length}`;
          if (await drawNotePic(n, `一键生图 ${i + 1}/${todo.length}`)) done++;
          else if (batchStop) break;
        }
        toast(batchStop ? `已取消，画好了 ${done} 张` : `画好了 ${done}/${todo.length} 张`, done ? 'success' : 'warning');
        batchStop = false; view.batch = null; render();
        return;
      }
      case 'quote': {
        const q = quoteFor(t.dataset.kind, t.dataset.id);
        if (!q) return;
        setQuote(q);
        toast(`已附带${q.label}，发消息时 AI 会看到`, 'success');
        return;
      }
      case 'place-pic': {
        const p = currentMap()?.places.find((x) => x.id === view.place);
        if (p) await drawPlacePic(p, '正在画');
        return;
      }
      case 'gen-dex': return generateDex();
      case 'dex-back': view.dex = null; return render();
      case 'dex-step': {
        const list = dexList();
        const i = list.findIndex((x) => x.id === view.dex);
        const nx = list[(i + Number(t.dataset.n) + list.length) % list.length];
        if (nx) { view.dex = nx.id; if (nx.isNew) { delete nx.isNew; saveChat(); } }
        return render();
      }
      case 'dex-unlock': case 'dex-fill': {
        const x = codex().dex.items.find((o) => o.id === view.dex);
        if (!x) return;
        if (act === 'dex-unlock') { x.found = true; x.foundAt = dateKey(storyDate()); saveChat(); render(); }
        if (!x.desc) await fillDex(x);
        return;
      }
      case 'dex-pic': {
        const x = codex().dex.items.find((o) => o.id === view.dex);
        if (x) await drawDexPic(x, '正在画');
        return;
      }
      case 'dex-pic-all': {
        const todo = codex().dex.items.filter((x) => x.found && !x.pic);
        if (!todo.length) { toast('已发现的都有图了', 'info'); return; }
        if (!(await ask(`把已发现、还没图的 ${todo.length} 个一张张画出来？中途可以取消，已经画好的会留着。`, `画 ${todo.length} 张`))) return;
        batchStop = false;
        let done = 0;
        for (const [i, x] of todo.entries()) {
          if (batchStop) break;
          view.batch = `${i + 1}/${todo.length}`;
          if (await drawDexPic(x, `一键生图 ${i + 1}/${todo.length}`)) done++;
          else if (batchStop) break;
        }
        toast(batchStop ? `已取消，画好了 ${done} 张` : `画好了 ${done}/${todo.length} 张`, done ? 'success' : 'warning');
        batchStop = false; view.batch = null; render();
        return;
      }
      case 'dex-del': {
        const d = codex().dex;
        const x = d.items.find((o) => o.id === view.dex);
        if (!x || !(await ask(`从${appTitle('dex')}里删掉「${x.found ? x.name : '？？？'}」？`, '删除'))) return;
        d.items = d.items.filter((o) => o !== x); view.dex = null; saveChat(); return render();
      }
      case 'gen-wiki': return generateWiki();
      case 'wiki-pic-all': return batchDraw(codex().wiki.items.filter((x) => !x.pic), drawWikiPic, '条百科');
      case 'dream-pic-all': return batchDraw(codex().dream.items.filter((p) => (p.img || p.imgDesc) && !p.pic), drawDreamPic, '条帖子');
      case 'wiki-back': view.wiki = null; return render();
      case 'wiki-pic': {
        const x = codex().wiki.items.find((o) => o.id === view.wiki);
        if (x) await drawWikiPic(x, '正在画');
        return;
      }
      case 'wiki-del': {
        const w = codex().wiki;
        const x = w.items.find((o) => o.id === view.wiki);
        if (!x || !(await ask(`删掉「${x.title}」？`, '删除'))) return;
        w.items = w.items.filter((o) => o !== x); view.wiki = null; saveChat(); return render();
      }
      case 'gen-dream': {
        const D0 = codex().dream;
        const c = await askDream(D0.items.length);
        if (!c) return;
        if (c.add || !D0.items.length) return generateDream({ dir: c.dir });
        // 全部重新生成：先清掉；没刷出来就还原
        const snap = D0.items;
        D0.items = []; view.dream = null;
        await generateDream({ dir: c.dir });
        if (!codex().dream.items.length) { codex().dream.items = snap; saveChat(); toast('这次没刷出来，原来的帖子已经还原', 'warning'); render(); }
        return;
      }
      case 'gen-npc': return generateNpc();
      case 'npc-back': view.npc = null; return render();
      case 'npc-pic-all': {
        const todo = npcData().items.filter((p) => p.met && !p.pic);
        if (!todo.length) { toast('见过的人都已经有画像了', 'info'); return; }
        if (!(await ask(`给见过、还没画像的 ${todo.length} 个人一张张画像？中途可以停，画好的会留着。`, `画 ${todo.length} 张`))) return;
        batchStop = false;
        let done = 0;
        for (const [i, p] of todo.entries()) {
          if (batchStop) break;
          view.batch = `${i + 1}/${todo.length}`;
          if (await drawNpcPic(p, `一键生图 ${i + 1}/${todo.length}`)) done++;
          else if (batchStop) break;
        }
        toast(batchStop ? `已停止，画好了 ${done} 张` : `画好了 ${done}/${todo.length} 张`, done ? 'success' : 'warning');
        batchStop = false; view.batch = null; render();
        return;
      }
      case 'npc-fill': {
        const p = npcData().items.find((o) => o.id === view.npc);
        if (p) await fillNpc(p);
        return;
      }
      case 'npc-meet': {
        const p = npcData().items.find((o) => o.id === view.npc);
        if (p) { Object.assign(p, { met: true, metAt: dateKey(storyDate()) }); saveChat(); render(); }
        return;
      }
      case 'npc-pic': {
        const p = npcData().items.find((o) => o.id === view.npc);
        if (p) await drawNpcPic(p, '正在画');
        return;
      }
      case 'npc-del': {
        const N = npcData();
        const p = N.items.find((o) => o.id === view.npc);
        if (!p || !(await ask(`从${appTitle('npc')}里删掉「${p.name}」？他的关系也会一起删掉。`, '删除'))) return;
        N.items = N.items.filter((o) => o !== p); N.links = N.links.filter((l) => l.a !== p.name && l.b !== p.name);
        view.npc = null; saveChat(); return render();
      }
      case 'dream-back': view.dream = null; return render();
      case 'dream-pic': {
        const p = codex().dream.items.find((o) => o.id === view.dream);
        if (p) await drawDreamPic(p, '正在画');
        return;
      }
      case 'dream-del': {
        const D0 = codex().dream;
        if (!(await ask('删掉这条帖子？', '删帖'))) return;
        D0.items = D0.items.filter((o) => o.id !== view.dream); view.dream = null; saveChat(); return render();
      }
      case 'gen-closet': {
        const w = closetWho(), o = await askCloset(w);
        if (o) await generateCloset(w, o);
        return;
      }
      case 'closet-folder': view.closetOpen = true; view.closetWho = t.dataset.k; view.closetCat = ''; view.closetItem = null; view.closetSet = null; view.closetTab = 'item'; return render();
      case 'closet-add': {
        const n = await askClosetName();
        if (!n) return;
        const hit = closetKeys().find((k) => closetName(k) === n);
        if (!hit) { closet(); chat.closet['n:' + n] = { style: '', items: [], sets: [] }; saveChat(); }
        view.closetOpen = true; view.closetWho = hit || 'n:' + n; view.closetTab = 'item'; return render();
      }
      case 'closet-tab': view.closetTab = t.dataset.v; return render();
      case 'closet-style': return readClosetStyle(closetWho());
      case 'closet-cat': view.closetCat = t.dataset.cat || ''; return render();
      case 'closet-open': view.closetItem = t.dataset.id; render(); D.querySelector(`#${ROOT_ID} .xsj-body`).scrollTop = 0; return;
      case 'closet-set-open': view.closetItem = null; view.closetSet = t.dataset.id; render(); D.querySelector(`#${ROOT_ID} .xsj-body`).scrollTop = 0; return;
      case 'closet-fav': case 'closet-set-fav': {
        const x = (act === 'closet-fav' ? closetOf().items : closetOf().sets).find((o) => o.id === t.dataset.id);
        if (x) { x.fav = !x.fav; saveChat(); render(); }
        return;
      }
      case 'closet-pic': {
        const it = closetOf().items.find((x) => x.id === t.dataset.id);
        if (it) await drawClosetPic(it, '正在画', true);
        return;
      }
      case 'closet-set-pic': {
        const x = closetOf().sets.find((o) => o.id === t.dataset.id);
        if (x) await drawClosetSet(x, '正在画', true);
        return;
      }
      case 'closet-on': {
        const key = closetWho(), set = t.dataset.kind === 'set', on = set ? chat.wear?.[key]?.set === t.dataset.id : (chat.wear?.[key]?.items || []).includes(t.dataset.id);
        if (on) { takeOff(key); toast('不穿了'); return render(); }
        putOn(key, set ? 'set' : 'item', t.dataset.id);
        const q = quoteFor(set ? 'closetset' : 'closet', t.dataset.id);
        if (q) setQuote(q);
        toast('穿上了：下一次回复会告诉 AI', 'success');
        return render();
      }
      case 'wear-off': takeOff(t.dataset.k); return render();
      case 'closet-wear': {
        const x = closetOf().sets.find((o) => o.id === t.dataset.id);
        if (x) await drawClosetWear(x);
        return;
      }
      case 'closet-pic-all':
        return view.closetTab === 'set' ? batchDraw(closetOf().sets.filter((x) => !x.pic), (x, label) => drawClosetSet(x, label), '套衣服') : batchDraw(closetOf().items.filter((x) => !x.pic), (x, label) => drawClosetPic(x, label), '件衣服');
      case 'closet-del': {
        const W0 = closetOf(), used = W0.sets.filter((x) => x.ids.includes(t.dataset.id)).length;
        if (!(await ask(`从衣橱里拿掉这件？${used ? `有 ${used} 套用到它，会一起从套装里去掉。` : ''}`, '删除'))) return;
        W0.items = W0.items.filter((x) => x.id !== t.dataset.id);
        W0.sets.forEach((x) => { x.ids = x.ids.filter((id) => id !== t.dataset.id); });
        W0.sets = W0.sets.filter((x) => x.ids.length);
        view.closetItem = null; saveChat(); return render();
      }
      case 'closet-set-del': {
        if (!(await ask('拆掉这套？里面的单品还在。', '拆掉'))) return;
        closetOf().sets = closetOf().sets.filter((x) => x.id !== t.dataset.id); view.closetSet = null; saveChat(); return render();
      }
      case 'closet-drop': {
        const w = closetWho();
        if (!w.startsWith('n:') || !(await ask(`删掉「${closetName(w)}」的衣橱？里面的衣服和套装都会没有。`, '删除'))) return;
        delete chat.closet[w]; view.closetOpen = false; view.closetWho = 'char'; saveChat(); return render();
      }
      case 'place-pic-all': {
        const todo = (currentMap()?.places || []).filter((x) => !x.pic && !x.fog);
        if (!todo.length) return;
        if (!(await ask(`把还没图的 ${todo.length} 个地点一张张画出来？中途可以取消，已经画好的会留着。`, `画 ${todo.length} 张`))) return;
        batchStop = false;
        let done = 0;
        for (const [i, p] of todo.entries()) {
          if (batchStop) break;
          view.batch = `${i + 1}/${todo.length}`;
          if (await drawPlacePic(p, `一键生图 ${i + 1}/${todo.length}`)) done++;
          else if (batchStop) break;
        }
        toast(batchStop ? `已取消，画好了 ${done} 张` : `画好了 ${done}/${todo.length} 张`, done ? 'success' : 'warning');
        batchStop = false; view.batch = null; render();
        return;
      }
      case 'x-pic': {
        const it = chat.xlog?.items?.find((x) => x.id === t.dataset.id);
        if (!it) return;
        await drawXPic(it, '正在出图');
        return;
      }
      case 'x-pic-all': {
        const todo = (chat.xlog?.items || []).filter((x) => (x.media || x.img) && !x.pic);
        if (!todo.length) return;
        if (!(await ask(`把还没出图的 ${todo.length} 条一张张画出来？中途可以取消，已经画好的会留着。`, `画 ${todo.length} 张`))) return;
        batchStop = false;
        let done = 0;
        for (const [i, it] of todo.entries()) {
          if (batchStop) break;
          view.batch = `${i + 1}/${todo.length}`;
          if (await drawXPic(it, `一键生图 ${i + 1}/${todo.length}`)) done++;
          else if (batchStop) break;
        }
        toast(batchStop ? `已取消，画好了 ${done} 张` : `画好了 ${done}/${todo.length} 张`, done ? 'success' : 'warning');
        batchStop = false; view.batch = null; render();
        return;
      }
      case 'wp-clear': settings.wallpaper = ''; settings.wpTone = ''; saveSettings(settings); return render();
      case 'buy': case 'cart-del': {
        const md = monthData(view.month);
        if (act === 'buy') { const c = md.cart.find((x) => x.id === t.dataset.id); if (c) c.bought = !c.bought; }
        else md.cart = md.cart.filter((x) => x.id !== t.dataset.id);
        saveChat(); return render();
      }
      case 'gen': {
        const parts = t.dataset.parts.split(',');
        const md = monthData(view.month);
        // 日历：已经有生成的日程就问——只新增，还是全部重新生成（自己记的都会保留）
        if (parts.join() === 'schedule,holidays') {
          const n = md.schedule.filter((x) => !x.manual).length;
          const mn = `${monthName(+view.month.split('-')[1])}日程`, v = await askRegen(n ? mn : `生成${mn}`, n, '条', '换掉 AI 生成的日程和节日，自己记的会保留', 'cal');
          if (!v) return;
          return generate(parts, view.month, v === 'add');
        }
        const cnt = (parts.includes('schedule') ? md.schedule.filter((x) => !x.manual).length : 0) + (parts.includes('events') ? md.events.length : 0) + (parts.includes('notes') ? notesFor(md).items.length : 0) + (parts.includes('cart') ? md.cart.length : 0);
        const mName = monthName(+view.month.split('-')[1]);
        const what = parts.length > 2 ? `${mName}的内容` : parts.includes('events') ? `${mName}随机事件` : parts.includes('notes') ? `${mName}小红书` : parts.includes('cart') ? `${mName}购物车` : `${mName}的内容`;
        const ck = parts.includes('notes') ? 'mon' : parts.join() === 'cart' ? 'cart' : '';
        if (cnt || ck) {
          const v = await askRegen(cnt ? what : `生成${what}`, cnt, '条', '换掉 AI 生成的，自己记的、★事件、已买的会保留', ck);
          if (!v) return;
          return generate(parts, view.month, v === 'add');
        }
        const has = false && (parts.includes('cart') && md.cart.some((x) => !x.bought));
        if (has && !(await ask('会替换这部分已生成的内容（自己记的、★事件、已买的会保留），继续吗？', '重新生成'))) return;
        return generate(parts, view.month);
      }
      case 'cancel-gen': return cancelGen();
      case 'note-back': view.note = null; return render();
      case 'comments': {
        const n = notesFor(monthData(view.month)).items.find((x) => x.id === view.note);
        if (!n) return;
        if (n.comments && !(await ask('换一批评论？', '换一批'))) return;
        return genComments(n, view.month);
      }
      case 'star': case 'used': {
        const e = monthData(view.month).events.find((x) => x.id === t.dataset.id);
        if (e) { e[act] = !e[act]; saveChat(); render(); }
        return;
      }
      case 'use-api': {
        const i = +t.dataset.i;
        readApiDraft();
        if (i >= 0 && view.apiEdit === i && settings.apiActive === i) { closeApiEditor(); return render(); }
        settings.apiActive = i; applyApi(settings); saveSettings(settings);
        if (i < 0) closeApiEditor(); else openApiEditor(i);
        toast(i < 0 ? '已改成跟随主 API' : `已换成「${settings.apiProfiles[i].name}」`, 'success');
        return render();
      }
      case 'add-api': {
        readApiDraft();
        settings.apiProfiles.push({ name: `方案${settings.apiProfiles.length + 1}`, url: '', key: '', model: '' });
        saveSettings(settings); openApiEditor(settings.apiProfiles.length - 1);
        return render();
      }
      case 'close-api': closeApiEditor(); return render();
      case 'save-api': {
        const i = view.apiEdit; if (i == null) return;
        readApiDraft();
        const d = { ...settings.apiProfiles[i], ...view.apiDraft };
        d.name = d.name.trim() || `方案${i + 1}`;
        if (!d.url) return toast('地址是空的', 'warning');
        if (!d.model) return toast('还没选模型', 'warning');
        settings.apiProfiles[i] = d; settings.apiActive = i; applyApi(settings); saveSettings(settings);
        closeApiEditor(); toast(`已保存并使用「${d.name}」`, 'success');
        return render();
      }
      case 'del-api': {
        const i = view.apiEdit; if (i == null) return;
        readApiDraft();
        if (!view.apiDel) { view.apiDel = true; return render(); }
        const [gone] = settings.apiProfiles.splice(i, 1);
        if (settings.apiActive === i) settings.apiActive = -1; else if (settings.apiActive > i) settings.apiActive--;
        normalizeApi(settings); saveSettings(settings); closeApiEditor();
        toast(`已删除「${gone?.name}」`, 'info');
        return render();
      }
      case 'pick-model': {
        const input = D.getElementById(ROOT_ID)?.querySelector('[data-ap="model"]');
        if (input) input.value = t.dataset.m;
        D.getElementById(ROOT_ID)?.querySelectorAll('.xsj-mlist button').forEach((b) => b.classList.toggle('on', b === t));
        return;
      }
      case 'peek': {
        D.getElementById(ROOT_ID)?.querySelector('[data-ap="key"]')?.classList.toggle('xsj-secret');
        return;
      }
      case 'paste': {
        const input = D.getElementById(ROOT_ID)?.querySelector(`[data-ap="${t.dataset.for}"]`);
        if (!input) return;
        try {
          if (!W.navigator.clipboard?.readText) throw new Error('no clipboard');
          const text = (await W.navigator.clipboard.readText()).trim();
          if (!text) return toast('剪贴板是空的', 'warning');
          input.value = text;
        } catch (e) {
          input.focus();
          toast('这个浏览器不让网页读剪贴板，请长按输入框粘贴', 'warning');
        }
        return;
      }
      case 'models': {
        readApiDraft();
        const d = view.apiDraft || {};
        if (!d.url) return toast('先填地址', 'warning');
        view.apiBusy = true; render();
        try {
          const list = await getModelList({ apiurl: d.url, key: d.key });
          view.apiModels = (list || []).map((x) => (typeof x === 'string' ? x : x?.id || x?.name || '')).filter(Boolean).sort();
          if (!view.apiModels.length) toast('这个地址没有返回模型列表，请手填模型名', 'warning');
        } catch (e) { toast('获取失败：' + (e?.message || e), 'error'); }
        view.apiBusy = false;
        return render();
      }
      case 'save-set': {
        syncSettings(); saveSettings(settings); saveChat();
        view.month = ym(storyDate().y, storyDate().m); view.day = dateKey(storyDate());
        toast('已保存', 'success'); return render();
      }
    }
  }
  function syncForm() {
    const root = D.getElementById(ROOT_ID);
    root.querySelectorAll('.xsj-form [data-f]').forEach((el) => { view.editing[el.dataset.f] = el.value; });
  }
  function syncSettings() {
    const root = D.getElementById(ROOT_ID);
    const get = (k) => root.querySelector(`[data-set="${k}"]`);
    if (get('dateOverride')) chat.dateOverride = get('dateOverride').value.trim();
    readApiDraft();
  }
  // 方案编辑框里没保存的内容先记在 view 里，重画界面时不会丢
  function readApiDraft() {
    const root = D.getElementById(ROOT_ID);
    if (!root || view.apiEdit == null) return;
    const d = {};
    for (const k of ['name', 'url', 'key', 'model']) { const el = root.querySelector(`[data-ap="${k}"]`); if (el) d[k] = el.value.trim(); }
    if (Object.keys(d).length) view.apiDraft = d;
  }
  function openApiEditor(i) { if (view.apiEdit !== i) { view.apiModels = null; view.apiDraft = null; } view.apiEdit = i; view.apiDel = false; }
  function closeApiEditor() { view.apiEdit = null; view.apiDraft = null; view.apiModels = null; view.apiDel = false; }
  function onChange(ev) {
    if (numChange(ev.target)) return;
    if (ev.target.matches?.('[data-closetstyle]')) { closetOf().style = ev.target.value.trim().slice(0, 120); saveChat(); toast('风格存好了', 'success'); return; }
    if (ev.target.matches?.('[data-evwish]')) { chat.evWish = ev.target.value; saveChat(); return; }
    if (ev.target.dataset?.cp) {
      const k = ev.target.dataset.cp, set = ev.target.dataset.cps, box = ev.target.closest('.xsj-cp');
      setPrompt(set, k, ev.target.value); view.cpOpen = k;
      // 不整页重画：正要点的按钮不会被换掉
      if (!ev.target.value.trim()) ev.target.value = promptOf(set, k);
      box.querySelector('em').textContent = ownPrompt(set, k) ? '改过' : '';
      const pre = D.querySelector(`#${ROOT_ID} [data-cppre]`); if (pre) pre.textContent = promptPreview(set);
      toast('存好了', 'success'); return;
    }
    if (ev.target.matches?.('[data-set="dateOverride"]')) {
      const v = ev.target.value.trim();
      if (v && !/^\d{1,4}-\d{1,2}-\d{1,2}$/.test(v)) { toast('日期写成 1996-11-09 这样', 'warning'); return; }
      chat.dateOverride = v; saveChat(); applyWeek();
      view.month = ym(storyDate().y, storyDate().m); view.day = dateKey(storyDate());
      toast(v ? '剧情日期改好了' : '改回自动认日期', 'success'); return render();
    }
    if (ev.target.matches?.('[data-set="weekInject"]')) {
      settings.weekInject = ev.target.checked; saveSettings(settings); applyWeek();
      toast(settings.weekInject ? '已开启：回复时会附上本周日程' : '已关闭本周日程注入', 'info');
      return render();
    }
    if (ev.target.id === 'xsj-wp-file' && ev.target.files?.[0]) uploadWallpaper(ev.target.files[0]);
  }

  // 玻璃颜色：设置里选「自动」时看壁纸明暗，暗壁纸用深色玻璃
  function glassTone() {
    const pick = settings.glass || 'auto';
    if (pick !== 'auto') return pick;
    return settings.wallpaper && settings.wpTone === 'dark' ? 'dark' : 'light';
  }
  let measuring = false;
  function measureTone() {
    if (measuring || !settings.wallpaper) return;
    measuring = true;
    const img = new Image();
    img.onload = () => {
      try {
        const cv = D.createElement('canvas'); cv.width = 24; cv.height = 40;
        const g = cv.getContext('2d'); g.drawImage(img, 0, 0, 24, 40);
        const px = g.getImageData(0, 0, 24, 40).data;
        let sum = 0;
        for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        settings.wpTone = sum / (px.length / 4) < 128 ? 'dark' : 'light';
        saveSettings(settings);
      } catch (e) { settings.wpTone = 'light'; }
      measuring = false; render();
    };
    img.onerror = () => { measuring = false; };
    img.src = settings.wallpaper;
  }

  // 壁纸：压到最长边 1600px 的 JPEG，存进酒馆的 user/images/小手机；上传失败就直接存在设置里
  async function uploadWallpaper(file) {
    try {
      view.busy = '正在处理壁纸…'; render();
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = D.createElement('canvas');
      cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const dataUrl = cv.toDataURL('image/jpeg', 0.86);
      let url = '';
      try {
        const st = W.SillyTavern?.getContext?.();
        const res = await fetch('/api/images/upload', {
          method: 'POST',
          headers: st?.getRequestHeaders ? st.getRequestHeaders() : { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl.split(',')[1], format: 'jpg', ch_name: '小手机', filename: `wallpaper-${Date.now()}` }),
        });
        if (res.ok) { const j = await res.json(); if (j.path) url = '/' + String(j.path).replace(/\\/g, '/').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/'); }
      } catch (e) { console.warn('[小手机] 壁纸上传失败，改存在设置里', e); }
      settings.wallpaper = url || dataUrl;
      settings.wpTone = '';
      saveSettings(settings);
      toast('壁纸换好了', 'success');
    } catch (e) {
      toast('这张图读不了：' + (e?.message || e), 'error');
    } finally { view.busy = null; render(); }
  }

  // ---------- 打开 / 关闭 ----------
  function open() {
    if (D.getElementById(ROOT_ID)) return close();
    syncChat();
    // 设置（地图、API）也一样：有图或地图正在生成时不要换掉
    if (!view.busy && !view.drawing && !view.batch) settings = loadSettings();
    const sd = storyDate();
    view.month = ym(sd.y, sd.m); view.day = dateKey(sd); view.editing = null; view.note = null;
    view.tab = 'home'; view.dex = null; view.wiki = null; view.arrange = false;
    setTimeout(updAuto, 1500);
    const root = D.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `<div class="xsj-phone"><div class="xsj-notch"></div><button class="xsj-close" title="关闭">×</button><div class="xsj-resize" title="拖动调整大小（双击恢复默认大小）"><svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 1h5L4.3 2.7l7 7L13 8v5H8l1.7-1.7-7-7L1 6z"/></svg></div><div class="xsj-drag" title="拖动小手机（双击回到默认位置）"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 1 5.6 3.4h1.6V7.2H3.4V5.6L1 8l2.4 2.4V8.8h3.8v3.8H5.6L8 15l2.4-2.4H8.8V8.8h3.8v1.6L15 8l-2.4-2.4v1.6H8.8V3.4h1.6z"/></svg></div><div class="xsj-screen"></div></div>`;
    setupPhoneDrag(root);
    setupPhoneResize(root);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', (ev) => {
      if (numInput(ev.target)) return;
      if (!ev.target.matches?.('[data-ap="filter"]')) return;
      const q = ev.target.value.trim().toLowerCase();
      ev.target.parentElement.querySelectorAll('.xsj-mlist button').forEach((b) => { b.style.display = !q || b.dataset.m.toLowerCase().includes(q) ? '' : 'none'; });
    });
    root.addEventListener('focusin', (ev) => {
      if (!typing()) return;
      // 键盘弹出后，把正在填的那一栏滚到手机屏幕里看得见的地方
      setTimeout(() => {
        const el = ev.target, body = el.closest?.('.xsj-body');
        if (!body || D.activeElement !== el) return;
        const off = el.getBoundingClientRect().top - body.getBoundingClientRect().top;
        if (off < 40 || off > body.clientHeight * 0.45) body.scrollTop += off - body.clientHeight * 0.3;
      }, 350);
    });
    root.addEventListener('focusout', () => setTimeout(() => { if (!typing()) fitPhone(); }, 400));
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointerdown', holdDown);
    root.addEventListener('pointermove', holdMove);
    root.addEventListener('pointerup', holdUp);
    root.addEventListener('pointercancel', holdUp);
    root.addEventListener('scroll', holdEnd, true);
    root.addEventListener('click', holdClick, true);
    root.addEventListener('contextmenu', (ev) => { if (holdTouch && ev.target.closest?.(HOLD_SEL)) ev.preventDefault(); });
    root.addEventListener('pointerdown', appPointerDown);
    root.addEventListener('pointermove', appPointerMove);
    root.addEventListener('pointerup', appPointerUp);
    root.addEventListener('pointercancel', appPointerUp);
    // 拖图标时不让页面跟着滚；长按图标不弹系统菜单
    root.addEventListener('touchmove', (ev) => { if (appDrag?.live) ev.preventDefault(); }, { passive: false });
    root.addEventListener('contextmenu', (ev) => { if (ev.target.closest?.('.xsj-app')) ev.preventDefault(); });
    root.addEventListener('touchstart', swipeStart, { passive: true });
    root.addEventListener('touchmove', swipeMove, { passive: true });
    root.addEventListener('touchend', swipeEnd);
    root.addEventListener('touchcancel', () => { swipeReset(); swipe = null; });
    D.body.appendChild(root);
    fitPhone();
    render();
  }
  function close() { D.getElementById(ROOT_ID)?.remove(); }

  // 按真实窗口大小算手机尺寸，不依赖 dvh、min() 这些较新的 CSS（旧浏览器、QQ/微信内置浏览器也能正常显示）
  // 正在手机里打字（键盘弹着）：不跟着可视区域变小，不然 iPhone 上手机会被压扁、输入框被挤出画面
  function typing() {
    const a = D.activeElement;
    return !!(a && a.matches?.('input:not([type=checkbox]):not([type=file]), textarea') && D.getElementById(ROOT_ID)?.contains(a));
  }
  function fitPhone() {
    const phone = D.querySelector(`#${ROOT_ID} .xsj-phone`);
    if (!phone || typing()) return;
    const vv = W.visualViewport;
    const vw = Math.round(vv?.width || W.innerWidth || D.documentElement.clientWidth || 360);
    const vh = Math.round(vv?.height || W.innerHeight || D.documentElement.clientHeight || 640);
    const small = vw <= 600;
    const us = userSize();
    if (us) {
      // 用户自己拖过大小：按那个大小，只是不能超出屏幕
      phone.style.width = Math.max(Math.min(MIN_W, vw - 16), Math.min(us.w, vw - 16)) + 'px';
      phone.style.height = Math.max(Math.min(MIN_H, vh - 16), Math.min(us.h, vh - 16)) + 'px';
    } else {
      phone.style.width = Math.max(240, Math.min(340, vw - (small ? 16 : 32))) + 'px';
      phone.style.height = Math.max(Math.min(360, vh - 16), Math.min(680, vh - (small ? 24 : 90))) + 'px';
    }
    phone.style.maxWidth = 'none';
    phone.style.maxHeight = 'none';
    const wrap = D.querySelector(`#${ROOT_ID} .xsj-mapwrap`);
    if (wrap && !(W.CSS && CSS.supports && CSS.supports('aspect-ratio', '1/1'))) wrap.style.height = wrap.clientWidth + 'px';
  }
  W.addEventListener('resize', fitPhone);
  W.visualViewport?.addEventListener('resize', fitPhone);

  // ---------- 左上角调整大小：右下角不动，往外拉变大、往里推变小 ----------
  const PHONE_SIZE_KEY = 'xsj-phone-size';
  const MIN_W = 260, MIN_H = 420;
  function userSize() {
    try { const s = JSON.parse(W.localStorage.getItem(PHONE_SIZE_KEY) || 'null'); return s && Number.isFinite(s.w) ? s : null; } catch (e) { return null; }
  }
  function setupPhoneResize(root) {
    const handle = root.querySelector('.xsj-resize');
    const phone = root.querySelector('.xsj-phone');
    let start = null;
    handle.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const r = root.getBoundingClientRect();
      // 先把位置固定成左上角坐标，拉的时候右下角才不会跟着动
      Object.assign(root.style, { left: r.left + 'px', top: r.top + 'px', right: 'auto', transform: 'none' });
      start = { px: ev.clientX, py: ev.clientY, w: phone.offsetWidth, h: phone.offsetHeight, right: r.right, bottom: r.bottom, done: null };
      handle.setPointerCapture(ev.pointerId);
      root.classList.add('is-moving');
    });
    handle.addEventListener('pointermove', (ev) => {
      if (!start) return;
      const w = Math.round(Math.min(Math.max(MIN_W, start.w - (ev.clientX - start.px)), start.right - 8));
      const h = Math.round(Math.min(Math.max(MIN_H, start.h - (ev.clientY - start.py)), start.bottom - 8));
      phone.style.width = w + 'px'; phone.style.height = h + 'px';
      root.style.left = start.right - w + 'px'; root.style.top = start.bottom - h + 'px';
      start.done = { w, h, x: start.right - w, y: start.bottom - h };
    });
    const end = () => {
      if (!start) return;
      if (start.done) {
        try {
          W.localStorage.setItem(PHONE_SIZE_KEY, JSON.stringify({ w: start.done.w, h: start.done.h }));
          W.localStorage.setItem(PHONE_POS_KEY, JSON.stringify({ x: start.done.x, y: start.done.y }));
        } catch (e) {}
        fitPhone();
      }
      start = null; root.classList.remove('is-moving');
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('dblclick', () => {
      try { W.localStorage.removeItem(PHONE_SIZE_KEY); } catch (e) {}
      fitPhone();
      if (root.style.left) placePhone(root, { x: parseFloat(root.style.left), y: parseFloat(root.style.top) });
    });
  }

  // ---------- 左下角拖动键：拖着整部手机走，位置记在本机浏览器里 ----------
  const PHONE_POS_KEY = 'xsj-phone-pos';
  function placePhone(root, pos) {
    const box = root.getBoundingClientRect();
    const vw = W.innerWidth, vh = W.innerHeight;
    const x = Math.min(Math.max(8, pos.x), Math.max(8, vw - box.width - 8));
    const y = Math.min(Math.max(8, pos.y), Math.max(8, vh - box.height - 8));
    Object.assign(root.style, { left: x + 'px', top: y + 'px', right: 'auto', transform: 'none' });
    return { x, y };
  }
  function resetPhonePos(root) {
    Object.assign(root.style, { left: '', top: '', right: '', transform: '' });
    try { W.localStorage.removeItem(PHONE_POS_KEY); } catch (e) {}
  }
  function setupPhoneDrag(root) {
    const handle = root.querySelector('.xsj-drag');
    let saved = null;
    try { saved = JSON.parse(W.localStorage.getItem(PHONE_POS_KEY) || 'null'); } catch (e) {}
    if (saved && Number.isFinite(saved.x)) requestAnimationFrame(() => placePhone(root, saved));
    let start = null;
    handle.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const r = root.getBoundingClientRect();
      start = { px: ev.clientX, py: ev.clientY, x: r.left, y: r.top, last: null };
      handle.setPointerCapture(ev.pointerId);
      root.classList.add('is-moving');
    });
    handle.addEventListener('pointermove', (ev) => {
      if (!start) return;
      start.last = placePhone(root, { x: start.x + ev.clientX - start.px, y: start.y + ev.clientY - start.py });
    });
    const end = () => {
      if (!start) return;
      if (start.last) { try { W.localStorage.setItem(PHONE_POS_KEY, JSON.stringify(start.last)); } catch (e) {} }
      start = null; root.classList.remove('is-moving');
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('dblclick', () => resetPhonePos(root));
  }
  // 窗口变了大小，手机别跑出屏幕
  W.addEventListener('resize', () => {
    const root = D.getElementById(ROOT_ID);
    if (root && root.style.left && !typing()) requestAnimationFrame(() => placePhone(root, { x: parseFloat(root.style.left), y: parseFloat(root.style.top) }));
  });

  // ---------- 漂浮的 📱 ----------
  const BUBBLE_ID = 'xsj-bubble';
  const POS_KEY = 'xsj-bubble-pos';
  function clampPos(x, y) {
    const s = 48;
    return { x: Math.min(Math.max(4, x), W.innerWidth - s - 4), y: Math.min(Math.max(4, y), W.innerHeight - s - 4) };
  }
  function makeBubble() {
    D.getElementById(BUBBLE_ID)?.remove();
    const b = D.createElement('div');
    b.id = BUBBLE_ID;
    b.textContent = '📱';
    b.title = '小手机日程（可拖动）';
    let pos = null;
    try { pos = JSON.parse(W.localStorage.getItem(POS_KEY) || 'null'); } catch (e) {}
    const place = (p) => { const c = clampPos(p.x, p.y); b.style.left = c.x + 'px'; b.style.top = c.y + 'px'; return c; };
    pos = place(pos && Number.isFinite(pos.x) ? pos : { x: W.innerWidth - 60, y: W.innerHeight - 200 });
    let start = null, moved = false;
    b.addEventListener('pointerdown', (ev) => {
      start = { px: ev.clientX, py: ev.clientY, x: pos.x, y: pos.y }; moved = false;
      b.setPointerCapture(ev.pointerId); b.classList.add('is-drag');
    });
    b.addEventListener('pointermove', (ev) => {
      if (!start) return;
      const dx = ev.clientX - start.px, dy = ev.clientY - start.py;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      pos = place({ x: start.x + dx, y: start.y + dy });
    });
    const end = () => {
      if (!start) return;
      start = null; b.classList.remove('is-drag');
      if (moved) { try { W.localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) {} }
      else open();
    };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', () => { start = null; b.classList.remove('is-drag'); });
    D.body.appendChild(b);
    onResize = () => { pos = place(pos); };
    W.addEventListener('resize', onResize);
  }
  let onResize = null;

  function injectStyle() {
    D.getElementById(STYLE_ID)?.remove();
    const st = D.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
#${ROOT_ID}{position:fixed;z-index:30000;right:16px;top:50%;transform:translateY(-50%);font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#3b3340}
#${ROOT_ID} *{box-sizing:border-box}
:where(#${ROOT_ID}) :is(small,em,b,strong,i,h4,label,span,div,p){color:inherit}
#${ROOT_ID} button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
#${ROOT_ID} input{user-select:text;-webkit-user-select:text;-webkit-touch-callout:default;font:inherit;width:100%;padding:8px 10px;margin:4px 0;border:1px solid #eadfe6;border-radius:10px;background:#fff;color:#3b3340}
.xsj-phone{position:relative;width:340px;max-width:calc(100vw - 32px);height:680px;max-height:calc(100vh - 90px);max-height:calc(100dvh - 90px);background:#1d1a20;border-radius:42px;padding:3.3px;box-shadow:0 18px 50px rgba(0,0,0,.35)}
.xsj-notch{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:84px;height:22px;border-radius:12px;background:#1d1a20;z-index:3}
.xsj-close{position:absolute!important;top:-10px;right:-10px;width:30px;height:30px;border-radius:50%;background:#fff!important;box-shadow:0 2px 8px rgba(0,0,0,.25);font-size:18px;z-index:4}
.xsj-screen{position:relative;height:100%;border-radius:39px;overflow:hidden;background:linear-gradient(180deg,#fff7f9 0%,#fbf8ff 100%);display:flex;flex-direction:column}
.xsj-status{display:flex;justify-content:space-between;align-items:center;padding:14px 26px 4px;font-size:12px;font-weight:600}
.xsj-src{font-weight:400;opacity:.5;font-size:10px;margin-right:auto;margin-left:6px}
.xsj-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px 6px}
.xsj-head>div{text-align:center}.xsj-head b{display:block;font-size:17px}.xsj-head small{font-size:11px;opacity:.55}
.xsj-head button{width:32px;height:32px;border-radius:50%;font-size:20px;background:#f3e9ef!important}
#${ROOT_ID} .xsj-head .xsj-mnav{width:auto;height:28px;padding:0 10px;border-radius:999px;font-size:12px;white-space:nowrap;flex:none}.xsj-head>div{flex:1;min-width:0}.xsj-head small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xsj-body{flex:1;overflow-y:auto;padding:4px 14px 12px}
.xsj-week,.xsj-grid{display:grid;grid-template-columns:repeat(7,1fr);text-align:center}
.xsj-week{font-size:11px;opacity:.45;margin-bottom:2px}
.xsj-calnav{display:flex;align-items:center;justify-content:space-between;margin:0 0 8px}
.xsj-calnav b{font-size:14px}
#${ROOT_ID} .xsj-calnav button{padding:3px 10px!important;border-radius:999px;font-size:12px;background:rgba(255,255,255,.35)!important;border:0!important;box-shadow:none!important;opacity:.75}
.xsj-hol{display:block;width:100%;padding:0;font-size:8px;letter-spacing:-.4px;line-height:1.15;text-align:center;color:#d4881c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xsj-day.has-hol span{color:#d4881c}
.xsj-hol.xsj-bd{color:#e8508f}.xsj-hol.xsj-vac{color:#3f9a6c}
.xsj-day.is-off{background:#eaf7ef!important}.xsj-day.is-off.is-sel{background:#ffe3ec!important}
.xsj-day.has-bd span{color:#e8508f}
.xsj-bdpill{background:#ffe6f1!important;color:#d43f7f!important}.xsj-vacpill{background:#e3f5ea!important;color:#2f8a5b!important}
.xsj-bdnote{font-size:12px;color:#c4477d;background:#fff0f6;border-radius:10px;padding:6px 10px;margin-bottom:6px}
.xsj-loc{background:#fff;border-radius:12px;padding:8px 10px;font-size:12.5px;margin-bottom:8px;display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}
.xsj-loc small{width:100%;font-size:10.5px;opacity:.5}.xsj-loc-none{opacity:.55}
.xsj-mini{font-size:11px!important;padding:2px 8px!important;border-radius:8px;background:#ffe3ec!important;color:#d43f7f!important;margin-left:auto}
.xsj-maptools{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;margin-bottom:6px}
.xsj-maptools button{min-width:30px;height:28px;border-radius:9px;background:#fff!important;box-shadow:0 1px 3px rgba(80,40,60,.1);font-size:13px;padding:0 8px!important}
.xsj-maptools button.on{background:#e86a95!important;color:#fff!important}
.xsj-mapwrap{width:100%;height:360px;aspect-ratio:106/120;overflow:auto;border-radius:16px;box-shadow:inset 0 0 0 1px #efe3d6;background:#fbf7f1;touch-action:pan-x pan-y}
.xsj-mapframe{position:relative}
.xsj-mapswitch{margin-bottom:8px}
.xsj-world .xsj-wland path{stroke:rgba(90,70,50,.45);stroke-width:.35}
.xsj-mapframe.has-bg .xsj-wland path{fill-opacity:.45}
.xsj-world .xsj-wland.is-fog path{stroke-dasharray:1.2 1;stroke:rgba(90,100,110,.5);fill-opacity:.85}
.xsj-world .xsj-wland.is-sel path{stroke:#e86a95;stroke-width:.8}
.xsj-world .xsj-wland{cursor:pointer}
.xsj-wlabel{font-size:calc(3.1px / var(--z, 1));font-weight:700;text-anchor:middle;fill:#4a3b30;paint-order:stroke;stroke:rgba(255,255,255,.75);stroke-width:calc(.7px / var(--z, 1))}
.xsj-wland.is-fog .xsj-wlabel{fill:#6d7780}
.xsj-mapctl{position:absolute;left:8px;bottom:8px;display:flex;gap:5px;z-index:2}
#${ROOT_ID} .xsj-mapctl button{min-width:30px;height:28px;padding:0 8px!important;border-radius:9px;font-size:13px;background:rgba(255,255,255,.88)!important;border:1px solid rgba(0,0,0,.06)!important;box-shadow:0 2px 6px rgba(80,40,60,.15)!important;color:#5a4650!important}
#${ROOT_ID} .xsj-mapctl button.on{background:#e86a95!important;color:#fff!important}
.xsj-mapframe.has-bg .xsj-region>rect:first-child{fill-opacity:.28}
.xsj-map{display:block;height:auto;user-select:none;-webkit-user-select:none}
.xsj-map.is-edit{touch-action:none;cursor:crosshair}
.xsj-region rect{stroke:#fff;stroke-width:.6;opacity:.95}
.xsj-rlabel{font-size:calc(3px / var(--z, 1));font-weight:700;fill:#8a7a8c;letter-spacing:.1px}
.xsj-region{cursor:pointer}.xsj-map.is-edit .xsj-region{cursor:crosshair}
.xsj-region .xsj-rimg{opacity:.88}
.xsj-region .xsj-rframe{fill:none;stroke:rgba(255,255,255,.9);stroke-width:.6}
.xsj-region.is-sel .xsj-rframe{stroke:#e86a95;stroke-width:1}
.xsj-rlabel.on-pic{fill:#3b3340;paint-order:stroke;stroke:rgba(255,255,255,.92);stroke-width:.9px;stroke-linejoin:round}
.xsj-pin{cursor:pointer}.xsj-map.is-edit .xsj-pin{cursor:grab}
.xsj-pin-bg{fill:#fff;stroke:#e9c9d6;stroke-width:.5;filter:drop-shadow(0 .4px .6px rgba(0,0,0,.25))}
.xsj-pin-e{font-size:4.6px;text-anchor:middle;dominant-baseline:middle}
.xsj-pin-n{font-size:2.9px;text-anchor:middle;fill:#4a3f4d;font-weight:600;paint-order:stroke;stroke:#fbf7f1;stroke-width:.8px}
.xsj-pin-ring{fill:none;stroke:#fff;stroke-width:.7}.xsj-pin.is-sel .xsj-pin-ring{stroke:#e86a95;stroke-width:.9}.xsj-pin.is-here .xsj-pin-ring{stroke:#e0445e;stroke-width:1}
.xsj-place-pic{display:block;width:calc(100% + 24px);margin:-10px -12px 8px;aspect-ratio:3/2;height:auto;object-fit:cover;border-radius:14px 14px 0 0}.xsj-drawing-place{min-height:150px}
.xsj-pin.is-sel .xsj-pin-bg{stroke:#e86a95;stroke-width:.9}
.xsj-pin.is-here .xsj-pin-bg{stroke:#e0445e;stroke-width:1}
.xsj-pin.is-fog{opacity:.82}
.xsj-pin.is-fog .xsj-pin-bg{fill:rgba(240,236,246,.9);stroke:#a99cc8;stroke-width:.5;stroke-dasharray:1.2 .8}
.xsj-pin.is-fog.is-sel .xsj-pin-bg{stroke:#e86a95;stroke-dasharray:none;stroke-width:.9}
.xsj-fog-cloud{fill:rgba(200,192,220,.45);filter:blur(.8px);animation:xsjfog 3.2s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:center}
@keyframes xsjfog{from{transform:scale(.9);opacity:.55}to{transform:scale(1.12);opacity:.9}}
.xsj-fog-q{font-weight:800;fill:#7d6fa8;font-family:Georgia,serif}
.xsj-pin.is-fog .xsj-pin-n{fill:#7d6fa8}
.xsj-fogrumor{font-size:13px;line-height:1.65;font-style:italic;margin:4px 0 6px;padding:6px 10px;border-radius:10px;background:rgba(169,156,200,.14)}
.xsj-fogcard .xsj-row2{margin-top:8px;flex-wrap:wrap}.xsj-fogcard .xsj-row2 span{display:flex;gap:6px;align-items:center}
.xsj-fogcard .xsj-primary{margin-top:0}
.xsj-pulse{fill:#e0445e;opacity:.25;animation:xsjpulse 1.6s ease-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes xsjpulse{0%{transform:scale(.6);opacity:.45}100%{transform:scale(1.6);opacity:0}}
.xsj-place{background:#fff;border-radius:14px;padding:10px 12px;margin-top:8px;font-size:13px;line-height:1.6;box-shadow:0 1px 4px rgba(80,40,60,.08)}
.xsj-place-top{display:flex;align-items:center;gap:8px;margin-bottom:4px}.xsj-place-top>div{flex:1}
.xsj-place-top b{font-size:15px;display:block}.xsj-place-top small{font-size:11px;opacity:.55}
.xsj-place-e{font-size:28px}
.xsj-place-v{font-size:12px;opacity:.75}
.xsj-place-li{display:block;width:100%;text-align:left;font-size:12px;padding:3px 0!important;border-bottom:1px dashed #f2e8ee}
.xsj-linknote{color:#3a6fc4!important}
.xsj-tabs button{padding:2px 4px!important}
.xsj-raw{margin-top:14px;font-size:11px;opacity:.7}.xsj-raw pre{white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:auto;background:#fff;border-radius:8px;padding:6px;font-size:10px}
.xsj-genall{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#fff;border-radius:14px;padding:10px 12px}
.xsj-genall b{display:block;font-size:14px}.xsj-genall small{font-size:11px;opacity:.55}.xsj-genall .xsj-primary{margin-top:0;flex:none}
.xsj-fixed{display:flex;justify-content:space-between;font-size:13px;padding:5px 2px;border-bottom:1px solid #f2e8ee}.xsj-fixed em{font-style:normal;opacity:.55;font-size:12px}
.xsj-cart{display:flex;align-items:center;gap:8px;background:#fff;border-radius:14px;padding:10px;margin-bottom:6px;box-shadow:0 1px 3px rgba(80,40,60,.06)}
.xsj-tick{width:20px;height:20px;flex:none;border-radius:50%!important;border:1.5px solid #e86a95!important;color:#fff!important;font-size:12px;padding:0!important;display:flex;align-items:center;justify-content:center}
.xsj-cart.is-bought .xsj-tick{background:#e86a95!important}
.xsj-cart-e{font-size:24px;flex:none}
.xsj-cart-m{flex:1;min-width:0;font-size:13.5px}.xsj-cart-m small{display:block;font-size:11px;opacity:.55}
.xsj-cart em{font-style:normal;font-size:12.5px;color:#e0445e;font-weight:600;flex:none}
.xsj-x{opacity:.35;font-size:16px;padding:0 2px!important}
.xsj-cart.is-bought{opacity:.5}.xsj-cart.is-bought b{text-decoration:line-through}
.xsj-dayhead>span{display:flex;align-items:center;flex-wrap:wrap;gap:4px;min-width:0}
.xsj-holpill{display:inline-block;width:auto!important;white-space:nowrap;margin-left:2px;padding:1px 8px!important;border-radius:8px;background:#fff3dd!important;color:#c47a10!important;font-size:11px!important;font-weight:400}
.xsj-day{height:52px;min-width:0;padding:0!important;margin:0!important;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:13px}
.xsj-day b{display:flex;gap:2px;height:5px;margin-top:2px}.xsj-day b i{width:5px;height:5px;border-radius:50%}
.xsj-day.is-today span{color:#e05a8a;font-weight:700}
.xsj-day.is-sel{background:#ffe3ec!important}
.xsj-dayhead{display:flex;justify-content:space-between;align-items:center;margin:10px 2px 6px;font-weight:600}
.xsj-dayhead button{width:28px;height:28px;border-radius:50%;background:#ffe3ec!important;font-size:16px}
.xsj-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:#fff!important;border-radius:14px;padding:10px 12px;margin-bottom:6px;box-shadow:0 1px 3px rgba(80,40,60,.06)}
.xsj-item>i{width:4px;align-self:stretch;border-radius:2px}
.xsj-time{font-size:11px;opacity:.6;width:72px;flex:none}
.xsj-title{flex:1;font-size:14px}.xsj-title small{display:block;font-size:11px;opacity:.55}
.xsj-item em{font-style:normal;font-size:10px;opacity:.5}
.xsj-none,.xsj-hint{font-size:12px;opacity:.5;padding:6px 2px}
.xsj-empty{text-align:center;padding:30px 10px;font-size:13px;opacity:.85;line-height:2}
.xsj-primary{background:#e86a95!important;color:#fff!important;border-radius:20px;padding:8px 16px;margin-top:6px}
.xsj-danger{color:#d9534f!important}
.xsj-block{display:block;width:100%;margin-top:14px}
.xsj-regen{display:block;margin:12px auto 0;font-size:12px;opacity:.6}
.xsj-form{background:#fff;border-radius:14px;padding:10px;margin-bottom:8px}
.xsj-row2{display:flex;gap:6px;align-items:center;justify-content:space-between}
.xsj-row2 button{padding:6px 10px}
.xsj-profs{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 4px}#${ROOT_ID} .xsj-prof{margin:0;padding:6px 12px;border-radius:999px;border:1px solid rgba(214,92,140,.35);background:rgba(255,255,255,.6);font-size:13px;color:inherit;box-shadow:none}#${ROOT_ID} .xsj-prof i{font-style:normal;font-size:11px;opacity:.5}#${ROOT_ID} .xsj-prof.on{background:#d65c8c;border-color:#d65c8c;color:#fff}#${ROOT_ID} .xsj-prof.on i{opacity:.8}#${ROOT_ID} .xsj-prof.open{box-shadow:0 0 0 2px rgba(214,92,140,.3)}#${ROOT_ID} .xsj-prof-add{opacity:.7}
.xsj-apied{margin-top:8px;padding-top:8px;border-top:1px dashed rgba(214,92,140,.3)}.xsj-models{margin:4px 0 6px}.xsj-mlist{max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;border-radius:10px;background:rgba(255,255,255,.5);padding:4px}#${ROOT_ID} .xsj-mlist button{margin:0;text-align:left;padding:7px 10px;border:0;border-radius:8px;background:none;font-size:13px;word-break:break-all;color:inherit;box-shadow:none}#${ROOT_ID} .xsj-mlist button.on{background:#d65c8c;color:#fff}
.xsj-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.xsj-chips button{padding:4px 10px;border-radius:12px;font-size:12px;border:1px solid var(--c)!important;color:var(--c)!important}
.xsj-chips button.on{background:var(--c)!important;color:#fff!important}
.xsj-card{background:#fff;border-radius:14px;padding:10px 12px;margin-bottom:8px;font-size:13px;line-height:1.6;box-shadow:0 1px 3px rgba(80,40,60,.06)}
.xsj-card small{display:block;opacity:.5;font-size:11px}
.xsj-card-top{display:flex;justify-content:space-between;gap:8px}
.xsj-card-top button{font-size:15px;padding:0 4px;opacity:.7}
.xsj-card.is-used{opacity:.45}.xsj-card.is-used b{text-decoration:line-through}
.xsj-lv{font-style:normal;font-size:11px;font-weight:600;border-radius:6px;padding:0 5px;margin-right:6px;vertical-align:1px}
.xsj-lv-1{background:#eef3ee;color:#5b7a5b}.xsj-lv-2{background:#fdf1e2;color:#b06a1c}.xsj-lv-3{background:#fde6e6;color:#b23a3a}.xsj-lv-v{background:#2d2233;color:#f3dfa8}
#${ROOT_ID} .xsj-card.is-villain,#${ROOT_ID} .xsj-villain-head{border-left:3px solid #4a2d55!important}
.xsj-hook{color:#8a5a6a;font-size:12px}
.xsj-villain-head b{color:#4a2d55}.xsj-villain-head small{display:block;opacity:.75}
.xsj-season b{font-size:16px}
.xsj-tags{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}.xsj-tags span{background:#fff0f4;border-radius:8px;padding:1px 8px;font-size:12px}
.xsj-sub{font-size:12px;font-weight:600;opacity:.55;margin:12px 2px 6px}
.xsj-trend{display:flex;gap:10px;align-items:flex-start;padding:8px 2px;border-bottom:1px solid #f2e8ee;font-size:13px}
.xsj-trend em{font-style:normal;font-size:10px;background:#efe8ff;color:#7a62c9;border-radius:6px;padding:2px 6px;flex:none;margin-top:2px}
.xsj-trend small{display:block;opacity:.55;font-size:11px}
.xsj-plat{font-size:13px;font-weight:700;color:#e0445e;margin:2px 2px 8px}
.xsj-weather{background:linear-gradient(135deg,#eef4ff,#fdf0f6);border-radius:14px;padding:10px 12px;margin-bottom:10px;font-size:12px;line-height:1.6}
.xsj-weather>div:first-child{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.xsj-weather b{font-size:14px}
.xsj-weather small{display:block;opacity:.55}
.xsj-cats{display:flex;gap:14px;overflow-x:auto;padding:2px 2px 8px;font-size:13px;scrollbar-width:none}
.xsj-cats button{flex:none;opacity:.5;padding:2px 0!important;border-bottom:2px solid transparent!important;border-radius:0}
.xsj-cats button.on{opacity:1;font-weight:700;border-bottom-color:#e0445e!important}
.xsj-flow{column-count:2;column-gap:8px}
.xsj-note{display:inline-block;width:100%;margin:0 0 8px;break-inside:avoid;text-align:left;background:#fff!important;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(80,40,60,.08);padding:0!important}
.xsj-cover{display:flex;align-items:center;justify-content:center}.xsj-cover span{font-size:40px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.15))}
.xsj-cover-big{height:170px;border-radius:14px;margin:6px 0 10px}.xsj-cover-big span{font-size:64px}
.xsj-note-t{font-size:12.5px;font-weight:600;line-height:1.4;padding:7px 8px 4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.xsj-note-f{display:flex;align-items:center;gap:5px;padding:2px 8px 8px;font-size:10.5px;opacity:.75}
.xsj-note-f i{width:16px;height:16px;border-radius:50%;color:#fff;font-style:normal;font-size:9px;display:flex;align-items:center;justify-content:center;flex:none}
.xsj-note-f span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.xsj-note-f em{font-style:normal;flex:none}
.xsj-note-author{padding:0 2px;font-size:12px;opacity:.9}.xsj-note-author i{width:22px;height:22px;font-size:11px}
.xsj-back{font-size:13px;opacity:.6;padding:2px 0!important}
.xsj-note-h{font-size:16px;margin:8px 2px 6px;line-height:1.4}
.xsj-note-text{font-size:13.5px;line-height:1.75;white-space:pre-wrap;padding:0 2px}
.xsj-note-tags{color:#3a6fc4;font-size:12.5px;margin:8px 2px}
.xsj-note-stat{font-size:11px;opacity:.5;margin:6px 2px;padding-bottom:8px;border-bottom:1px solid #f2e8ee}
.xsj-cmt{display:flex;gap:8px;padding:8px 2px;font-size:13px;line-height:1.5}
.xsj-cmt>i{width:26px;height:26px;border-radius:50%;background:#f3dbe4;color:#a0566f;font-style:normal;font-size:12px;display:flex;align-items:center;justify-content:center;flex:none}
.xsj-cmt>div{flex:1}.xsj-cmt small{opacity:.5;font-size:11px}.xsj-cmt em{font-style:normal;font-size:10.5px;opacity:.45;flex:none}
#${ROOT_ID} .xsj-secret{-webkit-text-security:disc;text-security:disc}
.xsj-check{display:flex;align-items:center;gap:6px;font-size:13px}.xsj-check input{width:auto!important;margin:0!important}
.xsj-off{opacity:.4;pointer-events:none}
.xsj-tabs{display:flex;justify-content:space-around;padding:6px 8px 14px;background:rgba(255,255,255,.85);border-top:1px solid #f2e8ee}
.xsj-tabs button{display:flex;flex-direction:column;align-items:center;font-size:10px;opacity:.5;padding:2px 8px}
.xsj-tabs button span{font-size:18px}.xsj-tabs button.on{opacity:1;color:#e05a8a!important}
.xsj-busy,.xsj-ask{position:absolute;top:0;right:0;bottom:0;left:0;background:rgba(255,247,249,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-size:13px;z-index:5}
.xsj-busy button{opacity:.6;font-size:12px}
.xsj-drawing{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:150px;margin:4px 0;padding:14px;border-radius:16px;background:rgba(232,106,149,.08);border:1px dashed rgba(232,106,149,.4);font-size:12px;text-align:center;color:inherit}.xsj-drawing button{margin:0;padding:4px 14px;font-size:12px}.xsj-drawing-cover{min-height:130px;border-radius:12px 12px 0 0;margin:0}.xsj-drawing-big{min-height:260px;border-radius:14px}
#xsj-quote{display:flex;align-items:center;gap:8px;margin:0 6px 4px;padding:5px 6px 5px 12px;border-radius:12px;background:rgba(232,106,149,.16);border:1px solid rgba(232,106,149,.45);font-size:12.5px;line-height:1.4;color:var(--SmartThemeBodyColor,#eee)}#xsj-quote>span{flex:1;min-width:0}#xsj-quote small{display:block;opacity:.6;font-size:11px}#xsj-quote button{flex:none;width:26px;height:26px;border:0;border-radius:50%;background:rgba(255,255,255,.15);color:inherit;font-size:15px;cursor:pointer}
#${ROOT_ID} .xsj-xquote{margin:0;padding:0 4px;border:0!important;background:none!important;box-shadow:none!important;font-size:14px;opacity:.75;color:#536471}
.xsj-note-acts{margin:4px 0}
.xsj-weekpre{white-space:pre-wrap;word-break:break-all;font-family:inherit;font-size:12px;line-height:1.55;margin:6px 0;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.55);max-height:220px;overflow:auto}
#${ROOT_ID} .tone-dark .xsj-weekpre{background:rgba(255,255,255,.07)}
.xsj-spin{width:28px;height:28px;border:3px solid #f5c6d6;border-top-color:#e86a95;border-radius:50%;animation:xsjspin 1s linear infinite}
@keyframes xsjspin{to{transform:rotate(360deg)}}
.xsj-ask-card{background:#fff;border-radius:16px;padding:16px;width:80%;box-shadow:0 6px 20px rgba(0,0,0,.12);line-height:1.6}
.xsj-ask-row{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}.xsj-ask-row button{padding:6px 12px}
#${ROOT_ID} .xsj-regen-card{display:flex;flex-direction:column;gap:8px}
#${ROOT_ID} .xsj-seg{display:flex;gap:4px;padding:3px;border-radius:12px;background:rgba(0,0,0,.05)}
#${ROOT_ID} .xsj-regen-card .xsj-seg button{flex:1;padding:7px 4px!important;border-radius:9px;font-size:12.5px;background:transparent!important;border:0!important;box-shadow:none!important;opacity:.65;color:#5a4650!important}
#${ROOT_ID} .xsj-regen-card .xsj-seg button.on{background:#fff!important;opacity:1;font-weight:600;color:#c4456f!important;box-shadow:0 1px 3px rgba(0,0,0,.12)!important}
#${ROOT_ID} .xsj-seg-h{font-size:11.5px;opacity:.55;margin:2px 2px -4px}
#${ROOT_ID} .xsj-seg-tip{font-size:11px;opacity:.55;margin:-4px 2px 0}
#${ROOT_ID} .xsj-regen-card>div{margin-bottom:4px}
#${ROOT_ID} .xsj-regen-card button{width:100%;padding:9px 12px!important;border-radius:12px;font-size:13.5px;text-align:center}
#${ROOT_ID} .xsj-regen-card .xsj-regen-reset{background:rgba(208,69,90,.08)!important;color:#d0455a!important;border:1px solid rgba(208,69,90,.25)!important}
#${ROOT_ID} .xsj-regen-card .xsj-regen-reset small{display:block;font-size:11px;opacity:.75;margin-top:1px}
#${ROOT_ID} .xsj-regen-card .xsj-regen-cancel{background:transparent!important;border:0!important;box-shadow:none!important;opacity:.6}
#xsj-bubble{position:fixed;z-index:29999;width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:34px;line-height:1;background:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35));cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;transition:transform .15s}
#xsj-bubble:hover{transform:scale(1.06)}
#xsj-bubble.is-drag{cursor:grabbing;transform:scale(1.12);opacity:.85;transition:none}
@media (pointer:coarse){#${ROOT_ID} :is(input,textarea,select){font-size:16px!important}}
@media (max-width:600px){#${ROOT_ID}{right:50%;top:50%;transform:translate(50%,-50%)}}
@supports (aspect-ratio:1/1){.xsj-mapwrap{height:auto;max-height:62vh}}
.xsj-drag{position:absolute;left:-10px;bottom:-10px;width:30px;height:30px;border-radius:50%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:4;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;color:#5a4a5e}
.xsj-drag svg{fill:currentColor;display:block}
.xsj-resize{position:absolute;left:-10px;top:-10px;width:30px;height:30px;border-radius:50%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:4;cursor:nwse-resize;touch-action:none;user-select:none;-webkit-user-select:none;color:#5a4a5e}
.xsj-resize svg{fill:currentColor;display:block}
#${ROOT_ID}.is-moving .xsj-drag{cursor:grabbing;transform:scale(1.12)}
#${ROOT_ID}.is-moving{transition:none}
#${ROOT_ID}.is-moving .xsj-phone{box-shadow:0 26px 70px rgba(0,0,0,.45)}
/* 矮屏（手机横屏、小窗口）：边框收窄 */
@media (max-height:560px){.xsj-close{top:4px!important;right:4px!important;width:26px!important;height:26px!important;font-size:16px!important}.xsj-drag{left:4px!important;bottom:4px!important;width:26px!important;height:26px!important}.xsj-resize{left:4px!important;top:4px!important;width:26px!important;height:26px!important}.xsj-phone{border-radius:28px;padding:2px}.xsj-screen{border-radius:26px!important}.xsj-notch{display:none}.xsj-status{padding-top:8px!important}}

/* ---------- 毛玻璃主题（覆盖上面的白底卡片） ---------- */
.xsj-screen{background:radial-gradient(120% 70% at 0% 0%,#ffd3e3 0%,transparent 55%),radial-gradient(90% 60% at 100% 22%,#dcd6ff 0%,transparent 60%),radial-gradient(100% 70% at 25% 100%,#cbecfb 0%,transparent 62%),linear-gradient(160deg,#fff3f7,#f2f0ff)!important}
.xsj-screen.has-wp{background:var(--xsj-wp) center/cover no-repeat!important}
.xsj-status{padding:14px 22px 4px;font-size:12.5px}
.xsj-sicons{display:flex;gap:5px;align-items:center}.xsj-sicons svg{display:block;fill:currentColor}
.xsj-status,.xsj-head,.xsj-sub,.xsj-hint,.xsj-none,.xsj-regen,.xsj-plat{text-shadow:0 1px 6px rgba(255,255,255,.95),0 0 2px rgba(255,255,255,.8)}
.xsj-head button,.xsj-maptools button{background:rgba(255,255,255,.5)!important;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.65)!important;box-shadow:0 2px 8px rgba(90,50,80,.08)!important}
.xsj-cal,.xsj-daycard,.xsj-card,.xsj-note,.xsj-form,.xsj-place,.xsj-loc,.xsj-genall,.xsj-cart,.xsj-weather,.xsj-ask-card,.xsj-wpset,.xsj-mapwrap,.xsj-empty,.xsj-raw pre{
  background:rgba(255,255,255,.5)!important;
  -webkit-backdrop-filter:blur(18px) saturate(170%);backdrop-filter:blur(18px) saturate(170%);
  border:1px solid rgba(255,255,255,.65)!important;
  box-shadow:0 4px 18px rgba(90,50,80,.10)!important}
.xsj-empty{border-radius:20px;margin-top:6px}
.xsj-tabs{background:rgba(255,255,255,.5)!important;-webkit-backdrop-filter:blur(22px) saturate(170%);backdrop-filter:blur(22px) saturate(170%);border-top:1px solid rgba(255,255,255,.6)!important}
.xsj-busy,.xsj-ask{background:rgba(255,255,255,.3)!important;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
#${ROOT_ID} input{background:rgba(255,255,255,.7);border-color:rgba(255,255,255,.85)}
.xsj-cover{opacity:.92}

/* 日历 */
.xsj-cal{border-radius:22px;padding:10px 6px 6px}
.xsj-week{opacity:1!important;margin-bottom:4px}.xsj-week span{font-size:11px;opacity:.5;font-weight:600}.xsj-week span.is-wkd{color:#c4567f;opacity:.75}
.xsj-day{height:50px;border-radius:14px;justify-content:flex-start;padding-top:4px!important;transition:background .15s}
.xsj-day span{display:block;width:26px;height:26px;line-height:26px;border-radius:50%;font-size:14px;font-weight:500;text-align:center}
.xsj-day.is-wkd span{color:#c4567f}
.xsj-day.has-hol span{color:#d4881c}.xsj-day.has-bd span{color:#e8508f}
.xsj-day.is-off{background:rgba(79,174,127,.14)!important}
.xsj-day.is-sel,.xsj-day.is-off.is-sel{background:rgba(255,255,255,.8)!important;box-shadow:0 3px 12px rgba(232,106,149,.25)}
.xsj-day.is-today span{background:#e86a95;color:#fff!important;font-weight:700;box-shadow:0 2px 8px rgba(232,106,149,.45)}
.xsj-day b{margin-top:auto;margin-bottom:5px}
.xsj-daycard{border-radius:20px;padding:12px 12px 6px;margin-top:10px}
.xsj-dayhead{margin:0 0 8px!important}
.xsj-dbig{font-size:26px;font-weight:700;line-height:1;margin-right:6px}
.xsj-dsub{font-size:12px;opacity:.6;font-weight:500;margin-right:4px}
.xsj-dayhead button[data-act="add-item"]{background:#e86a95!important;color:#fff!important;box-shadow:0 2px 8px rgba(232,106,149,.4)}
.xsj-daycard .xsj-item{background:transparent!important;box-shadow:none!important;border-radius:0;margin:0;padding:10px 2px;border-bottom:1px solid rgba(120,80,100,.1)!important}
.xsj-daycard .xsj-item:last-child{border-bottom:0!important}
.xsj-daycard .xsj-bdnote{background:rgba(255,240,246,.7)}
.xsj-daycard .xsj-form{box-shadow:none!important}

/* 壁纸设置 */
.xsj-wpset{display:flex;gap:12px;align-items:center;border-radius:16px;padding:10px}
.xsj-wpthumb{width:54px;height:96px;flex:none;border-radius:12px;background:linear-gradient(160deg,#ffd3e3,#dcd6ff,#cbecfb) center/cover;display:flex;align-items:center;justify-content:center;font-size:11px;color:#8a7a8c;box-shadow:inset 0 0 0 1px rgba(255,255,255,.7)}
.xsj-wpbtns{display:flex;flex-direction:column;align-items:flex-start;gap:2px}
.xsj-upload{display:inline-block;cursor:pointer;text-align:center}
.xsj-wpdraw{margin-top:8px}.xsj-wpdraw .xsj-check{font-size:12px}
/* X 浏览记录 */
.xsj-xbar{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:12px;margin-bottom:2px}
.xsj-xbtns{display:flex;gap:6px;flex:none}.xsj-xbtns .xsj-mini{margin-left:0}
.xsj-xsearch{display:flex;flex-wrap:wrap;gap:6px}
.xsj-xsearch span{font-size:12px;padding:4px 10px;border-radius:14px;background:rgba(20,20,25,.72);color:#fff!important;transition:filter .2s}
.xsj-xsearch span.is-blur{filter:blur(4px)}
.xsj-xitem{margin-bottom:10px}
.xsj-xmeta{display:flex;justify-content:space-between;font-size:11px;opacity:.6;padding:0 4px 3px;text-shadow:0 1px 6px rgba(255,255,255,.9)}
.xsj-xkind{font-weight:600}
.xsj-xpost{position:relative;border-radius:16px;padding:10px 12px;background:rgba(18,18,22,.78)!important;color:#f2f2f5!important;border:1px solid rgba(255,255,255,.12)!important;box-shadow:0 4px 18px rgba(0,0,0,.18);overflow:hidden;cursor:default}
.xsj-xpost[data-xopen]{cursor:pointer}
.xsj-xauthor{display:flex;align-items:center;gap:6px;font-size:12.5px;margin-bottom:4px;min-width:0}
.xsj-xauthor i{width:22px;height:22px;border-radius:50%;background:#3a3a44;color:#fff!important;font-style:normal;font-size:11px;display:flex;align-items:center;justify-content:center;flex:none}
.xsj-xauthor span{opacity:.5;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xsj-xtext{font-size:13.5px;line-height:1.6;white-space:pre-wrap}
.xsj-xmedia{margin-top:6px;font-size:12px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.08);color:#d8d8e0!important}
.xsj-xpost.is-blur :is(.xsj-xtext,.xsj-xmedia,.xsj-xauthor span){filter:blur(6px);user-select:none}
.xsj-cover-img{display:block;width:100%;object-fit:cover;opacity:1!important}
.xsj-cover-big.xsj-cover-img{height:auto;max-height:360px}
.xsj-xpic{display:block;width:100%;margin-top:8px;border-radius:12px;max-height:340px;object-fit:cover}
.xsj-xpost.is-blur .xsj-xpic{filter:blur(18px) brightness(.8)}
.xsj-xdraw{display:block;margin:4px 6px 0 auto;font-size:11.5px!important;padding:3px 10px!important;border-radius:10px;background:rgba(255,255,255,.55)!important;border:1px solid rgba(255,255,255,.7)!important;color:#5a4a5e!important}
.xsj-xmask{position:absolute;top:34px;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:600;color:#fff!important;text-shadow:0 1px 6px rgba(0,0,0,.6)}
.xsj-xitem.is-saved .xsj-xpost{box-shadow:0 0 0 1.5px #e86a95,0 4px 18px rgba(0,0,0,.18)}
.xsj-xnote{font-size:12px;color:#b2456f!important;padding:4px 6px 0;font-style:italic;text-shadow:0 1px 6px rgba(255,255,255,.95)}
/* ---------- X 页：照 X 的版式 ---------- */
#${ROOT_ID} .xsj-body-x{padding:0!important}
#${ROOT_ID} .xsj-xapp{min-height:100%;background:transparent;color:#0f1419;padding-bottom:14px}
#${ROOT_ID} .xsj-xhead{position:relative;display:flex;align-items:center;justify-content:space-between;padding:6px 14px 4px}
#${ROOT_ID} .xsj-xme{width:30px;height:30px;border-radius:50%;color:#fff!important;font-style:normal;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center}
#${ROOT_ID} .xsj-xlogo{font-size:24px;font-weight:900;line-height:1}
#${ROOT_ID} .xsj-xdots{width:30px;height:30px;font-size:20px!important;line-height:1;border-radius:50%}
#${ROOT_ID} .xsj-xtabs{display:flex;border-bottom:1px solid rgba(15,20,25,.1)}
#${ROOT_ID} .xsj-xtabs button{flex:1;padding:10px 0 0!important;font-size:14px;color:#536471!important;display:flex;justify-content:center}
#${ROOT_ID} .xsj-xtabs button span{padding-bottom:9px;border-bottom:4px solid transparent;border-radius:2px}
#${ROOT_ID} .xsj-xtabs button.on{color:#0f1419!important;font-weight:700}
#${ROOT_ID} .xsj-xtabs button.on span{border-bottom-color:#1d9bf0}
#${ROOT_ID} .xsj-xmenu{position:absolute;right:12px;top:44px;z-index:3;background:#fff;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:6px 0;min-width:150px}
#${ROOT_ID} .xsj-xmenu button{display:block;width:100%;text-align:left;padding:9px 16px!important;font-size:13.5px}
#${ROOT_ID} .xsj-xapp .xsj-xmenu{position:absolute}
#${ROOT_ID} .xsj-xapp{position:relative}
#${ROOT_ID} .xsj-xasof{font-size:11.5px;color:#536471;padding:8px 14px;border-bottom:1px solid rgba(15,20,25,.08)}
#${ROOT_ID} .xsj-xpost2{padding:8px 14px 10px;border-bottom:1px solid rgba(15,20,25,.08)}
#${ROOT_ID} .xsj-xctx{display:flex;justify-content:space-between;font-size:11.5px;color:#536471;padding-left:46px;margin-bottom:3px}
#${ROOT_ID} .xsj-xrow{display:flex;gap:8px}
#${ROOT_ID} .xsj-xav{width:38px;height:38px;flex:none;border-radius:50%;color:#fff!important;font-style:normal;font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center}
#${ROOT_ID} .xsj-xmain{flex:1;min-width:0}
#${ROOT_ID} .xsj-xname{display:flex;align-items:center;gap:3px;font-size:14px;min-width:0;white-space:nowrap}
#${ROOT_ID} .xsj-xname b{overflow:hidden;text-overflow:ellipsis;flex:0 1 auto}
#${ROOT_ID} .xsj-xv svg{width:15px;height:15px;display:block}
#${ROOT_ID} .xsj-xh{color:#536471!important;font-size:13px;overflow:hidden;text-overflow:ellipsis;margin-left:2px}
#${ROOT_ID} .xsj-xpost2 .xsj-xtext{font-size:14px;line-height:1.45;margin:2px 0 6px;white-space:pre-wrap;word-break:break-word}
#${ROOT_ID} .xsj-xpost2 .xsj-xtext.is-blur{filter:blur(5px);cursor:pointer;user-select:none}
#${ROOT_ID} .xsj-xpost2 .xsj-xpic{margin:4px 0;border-radius:16px;border:1px solid rgba(15,20,25,.1);max-height:300px}
#${ROOT_ID} .xsj-xpost2 .xsj-xmedia{margin:4px 0;border-radius:16px;background:#eff3f4;color:#536471!important;font-size:12.5px;padding:14px 12px;line-height:1.5}
#${ROOT_ID} .xsj-xwarn{position:relative;margin:4px 0;border-radius:16px;padding:16px 14px 46px;background:linear-gradient(135deg,#6b4a55,#3a2c33 60%,#2b2329);color:#fff!important;display:flex;flex-direction:column;gap:4px}
#${ROOT_ID} .xsj-xwarn svg{width:26px;height:26px;color:#fff;align-self:center;margin-bottom:8px}
#${ROOT_ID} .xsj-xwarn b{font-size:14px}
#${ROOT_ID} .xsj-xwarn span{font-size:12.5px;opacity:.85}
#${ROOT_ID} .xsj-xwarn button{position:absolute;right:10px;bottom:10px;padding:5px 16px!important;border-radius:20px;background:rgba(0,0,0,.35)!important;color:#fff!important;font-weight:700;font-size:13px}
#${ROOT_ID} .xsj-xpost2 .xsj-xdraw{margin:2px 0 4px auto}
#${ROOT_ID} .xsj-xacts{display:flex;justify-content:space-between;align-items:center;color:#536471;font-size:11.5px;margin-top:4px;padding-right:4px}
#${ROOT_ID} .xsj-xacts span{display:flex;align-items:center;gap:3px;color:#536471!important}
#${ROOT_ID} .xsj-xacts svg{width:16px;height:16px;display:block;color:#536471}
#${ROOT_ID} .xsj-xacts .is-on-like,#${ROOT_ID} .xsj-xacts .is-on-like svg{color:#f91880!important}
#${ROOT_ID} .xsj-xacts .is-on-mark svg{color:#1d9bf0!important}
#${ROOT_ID} .xsj-xnote2{margin-top:6px;font-size:12px;color:#b2456f!important;font-style:italic}
#${ROOT_ID} .xsj-xsearchbar{display:flex;align-items:center;gap:8px;margin:10px 14px;padding:9px 14px;border-radius:22px;background:#eff3f4;color:#536471!important;font-size:14px}
#${ROOT_ID} .xsj-xsearchbar svg,#${ROOT_ID} .xsj-xsrow svg{width:17px;height:17px;flex:none;display:block}
#${ROOT_ID} .xsj-xsec{font-size:17px;font-weight:800;padding:10px 14px 4px}
#${ROOT_ID} .xsj-xsec small{font-size:12px;font-weight:400;color:#536471}
#${ROOT_ID} .xsj-xsrow{display:flex;align-items:center;gap:12px;padding:10px 14px;font-size:14px;color:#0f1419}
#${ROOT_ID} .xsj-xsrow svg{color:#536471}
#${ROOT_ID} .xsj-xsrow span{flex:1;min-width:0}
#${ROOT_ID} .xsj-xsrow span.is-blur{filter:blur(4px)}
#${ROOT_ID} .xsj-xsrow em{font-style:normal;color:#536471;font-size:16px}
#${ROOT_ID} .xsj-xapp .xsj-none{padding:6px 14px;text-shadow:none}
#${ROOT_ID} .xsj-xapp .xsj-regen{text-shadow:none;color:#536471}
/* 深色 */
#${ROOT_ID} .tone-dark .xsj-xapp{background:transparent;color:#e7e9ea}
#${ROOT_ID} .tone-dark :is(.xsj-xtabs,.xsj-xasof,.xsj-xpost2){border-color:rgba(231,233,234,.12)}
#${ROOT_ID} .tone-dark .xsj-xtabs button.on{color:#e7e9ea!important}
#${ROOT_ID} .tone-dark :is(.xsj-xh,.xsj-xctx,.xsj-xasof,.xsj-xacts span,.xsj-xtabs button){color:#71767b!important}
#${ROOT_ID} .tone-dark .xsj-xacts svg{color:#71767b}
#${ROOT_ID} .tone-dark :is(.xsj-xsearchbar,.xsj-xpost2 .xsj-xmedia){background:#202327}
#${ROOT_ID} .tone-dark .xsj-xsrow{color:#e7e9ea}
#${ROOT_ID} .tone-dark .xsj-xmenu{background:#16181c;color:#e7e9ea}
#${ROOT_ID} .tone-dark .xsj-xnote2{color:#ff9cc0!important}
/* ---------- 玻璃质感细化：渐变 + 顶边高光 + 柔和阴影，顶部和底栏用渐隐代替硬条 ---------- */
#${ROOT_ID} :is(.xsj-cal,.xsj-daycard,.xsj-card,.xsj-note,.xsj-form,.xsj-place,.xsj-loc,.xsj-genall,.xsj-cart,.xsj-weather,.xsj-ask-card,.xsj-wpset,.xsj-mapwrap,.xsj-empty){
  background:linear-gradient(150deg,rgba(255,255,255,.6),rgba(255,255,255,.3))!important;
  border:1px solid rgba(255,255,255,.5)!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.75),0 10px 30px rgba(60,30,60,.12)!important}
#${ROOT_ID} .xsj-screen{position:relative}
#${ROOT_ID} .xsj-screen>:is(.xsj-status,.xsj-head,.xsj-body,.xsj-tabs){position:relative;z-index:1}
#${ROOT_ID} .xsj-screen.has-wp::before{content:'';position:absolute;left:0;right:0;top:0;height:120px;z-index:0;pointer-events:none;background:linear-gradient(rgba(255,255,255,.55),rgba(255,255,255,0))}
#${ROOT_ID} .xsj-tabs{background:linear-gradient(rgba(255,255,255,.2),rgba(255,255,255,.6))!important;border-top:0!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.35)}
#${ROOT_ID} .xsj-cal{border-radius:24px}#${ROOT_ID} .xsj-daycard{border-radius:22px}

/* 设置页：分组卡片 */
#${ROOT_ID} .xsj-set{padding:12px 14px;border-radius:20px;margin-bottom:10px}
#${ROOT_ID} .xsj-set-h{font-size:13px;font-weight:700;margin-bottom:8px}.xsj-set-h small{font-weight:400;opacity:.55;font-size:11px;margin-left:4px}
#${ROOT_ID} .xsj-set-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0;font-size:13px}
#${ROOT_ID} .xsj-set-row small{display:inline;opacity:.65;font-size:11.5px;text-align:right}
#${ROOT_ID} .xsj-set-tip{display:block;font-size:11px;opacity:.6;line-height:1.5;margin-top:4px}
#${ROOT_ID} .xsj-genall-in,#${ROOT_ID} .xsj-wpset-in{display:flex;align-items:center;justify-content:space-between;gap:10px}
#${ROOT_ID} .xsj-genall-in b{display:block;font-size:15px}#${ROOT_ID} .xsj-genall-in small{font-size:11px;opacity:.6}
#${ROOT_ID} .xsj-genall-in .xsj-primary{margin-top:0;flex:none}
#${ROOT_ID} .xsj-wpset-in{justify-content:flex-start;margin:8px 0 4px}
#${ROOT_ID} .xsj-nowrap{white-space:nowrap;flex:none;margin-top:0}
#${ROOT_ID} .xsj-seg{display:flex;padding:2px;border-radius:12px;background:rgba(120,90,110,.12);flex:none}
#${ROOT_ID} .xsj-seg button{padding:4px 11px!important;border-radius:10px;font-size:12px;opacity:.65}
#${ROOT_ID} .xsj-seg button.on{background:#e86a95!important;color:#fff!important;opacity:1;box-shadow:0 2px 6px rgba(232,106,149,.35)}
#${ROOT_ID} .tone-dark .xsj-seg{background:rgba(255,255,255,.1)}
#${ROOT_ID} .xsj-set .xsj-regen{margin-top:8px}
/* ---------- 深色玻璃（暗壁纸自动切换，或在设置里手选） ---------- */
#${ROOT_ID} .tone-dark{color:#f1ecf5}
#${ROOT_ID} .tone-dark:not(.has-wp){background:radial-gradient(120% 70% at 0% 0%,#3b2440 0%,transparent 55%),radial-gradient(90% 60% at 100% 25%,#24264a 0%,transparent 60%),linear-gradient(160deg,#17151d,#1e1b29)!important}
#${ROOT_ID} .tone-dark :is(.xsj-cal,.xsj-daycard,.xsj-card,.xsj-note,.xsj-form,.xsj-place,.xsj-loc,.xsj-genall,.xsj-cart,.xsj-weather,.xsj-ask-card,.xsj-wpset,.xsj-mapwrap,.xsj-empty){
  background:linear-gradient(150deg,rgba(46,40,60,.55),rgba(18,16,26,.32))!important;
  border:1px solid rgba(255,255,255,.12)!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 12px 32px rgba(0,0,0,.35)!important}
#${ROOT_ID} .tone-dark.has-wp::before{background:linear-gradient(rgba(10,8,16,.55),rgba(10,8,16,0))}
#${ROOT_ID} .tone-dark .xsj-tabs{background:linear-gradient(rgba(14,12,20,.15),rgba(14,12,20,.6))!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
#${ROOT_ID} .tone-dark .xsj-tabs button.on{color:#ff9cc0!important}
#${ROOT_ID} .tone-dark :is(.xsj-status,.xsj-head,.xsj-sub,.xsj-hint,.xsj-none,.xsj-regen,.xsj-plat,.xsj-xmeta,.xsj-xnote){text-shadow:0 1px 8px rgba(0,0,0,.55)}
#${ROOT_ID} .tone-dark :is(.xsj-head button,.xsj-maptools button){background:rgba(255,255,255,.1)!important;border-color:rgba(255,255,255,.14)!important}
#${ROOT_ID} .tone-dark .xsj-prof:not(.on){background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.2)}#${ROOT_ID} .tone-dark .xsj-mlist{background:rgba(255,255,255,.06)}
#${ROOT_ID} .tone-dark input{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.16);color:#f1ecf5}
#${ROOT_ID} .tone-dark input::placeholder{color:rgba(241,236,245,.45)}
#${ROOT_ID} .tone-dark :is(.xsj-week span.is-wkd,.xsj-day.is-wkd span){color:#ff9cc0}
#${ROOT_ID} .tone-dark .xsj-day.has-hol span,#${ROOT_ID} .tone-dark .xsj-hol{color:#ffc46b}
#${ROOT_ID} .tone-dark .xsj-day.has-bd span,#${ROOT_ID} .tone-dark .xsj-hol.xsj-bd{color:#ff8fbb}
#${ROOT_ID} .tone-dark .xsj-hol.xsj-vac{color:#7fd6a4}
#${ROOT_ID} .tone-dark .xsj-day.is-off{background:rgba(127,214,164,.14)!important}
#${ROOT_ID} .tone-dark :is(.xsj-day.is-sel,.xsj-day.is-off.is-sel){background:rgba(255,255,255,.14)!important;box-shadow:0 3px 14px rgba(0,0,0,.3)}
#${ROOT_ID} .tone-dark .xsj-day.is-today span{color:#fff!important}
#${ROOT_ID} .tone-dark .xsj-holpill{background:rgba(255,196,107,.16)!important;color:#ffc46b!important}
#${ROOT_ID} .tone-dark .xsj-bdpill{background:rgba(255,143,187,.16)!important;color:#ff8fbb!important}
#${ROOT_ID} .tone-dark .xsj-vacpill{background:rgba(127,214,164,.16)!important;color:#7fd6a4!important}
#${ROOT_ID} .tone-dark .xsj-bdnote{background:rgba(255,143,187,.12)!important;color:#ffb3cf}
#${ROOT_ID} .tone-dark .xsj-daycard .xsj-item{border-bottom-color:rgba(255,255,255,.08)!important}
#${ROOT_ID} .tone-dark :is(.xsj-plat,.xsj-cart em){color:#ff8fa8}
#${ROOT_ID} .tone-dark .xsj-note-tags,#${ROOT_ID} .tone-dark .xsj-linknote{color:#8fb8ff!important}
#${ROOT_ID} .tone-dark .xsj-cmt>i{background:rgba(255,143,187,.2);color:#ffb3cf}
#${ROOT_ID} .tone-dark :is(.xsj-trend,.xsj-fixed,.xsj-note-stat,.xsj-place-li){border-color:rgba(255,255,255,.1)!important}
#${ROOT_ID} .tone-dark .xsj-xnote{color:#ffb3cf!important}
#${ROOT_ID} .tone-dark .xsj-xdraw{background:rgba(255,255,255,.1)!important;border-color:rgba(255,255,255,.16)!important;color:#f1ecf5!important}
#${ROOT_ID} .tone-dark :is(.xsj-busy,.xsj-ask){background:rgba(10,8,16,.35)!important}
#${ROOT_ID} .tone-dark .xsj-spin{border-color:rgba(255,255,255,.2);border-top-color:#ff8fb4}
#${ROOT_ID} .tone-dark .xsj-mini{background:rgba(255,143,187,.18)!important;color:#ffb3cf!important}
#${ROOT_ID} .tone-dark .xsj-wpthumb{color:#cfc6d6}
/* ---------- 默认壁纸：纯白（没上传壁纸、浅色玻璃时） ---------- */
#${ROOT_ID} .xsj-screen:not(.has-wp):not(.tone-dark){background:#fff!important}
#${ROOT_ID} .xsj-screen:not(.has-wp):not(.tone-dark) :is(.xsj-cal,.xsj-daycard,.xsj-card,.xsj-form,.xsj-place,.xsj-loc,.xsj-genall,.xsj-cart,.xsj-wpset,.xsj-mapwrap,.xsj-empty,.xsj-ask-card){
  background:#f6f6f8!important;border:1px solid rgba(0,0,0,.04)!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
#${ROOT_ID} .xsj-screen:not(.has-wp):not(.tone-dark) .xsj-day.is-sel{background:none!important;box-shadow:none}
#${ROOT_ID} .xsj-screen:not(.has-wp):not(.tone-dark) .xsj-tabs{background:#fff!important;border-top:1px solid rgba(0,0,0,.07)!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
#${ROOT_ID} .xsj-screen:not(.has-wp):not(.tone-dark) :is(.xsj-head button,.xsj-maptools button){background:#f2f2f4!important;border-color:transparent!important;box-shadow:none!important}
#${ROOT_ID} .xsj-screen:not(.has-wp):not(.tone-dark) :is(.xsj-status,.xsj-head,.xsj-sub,.xsj-hint,.xsj-none,.xsj-regen,.xsj-plat){text-shadow:none!important}
#${ROOT_ID} .xsj-screen:not(.has-wp):not(.tone-dark) .xsj-wpthumb{background:#fff;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}
/* ---------- 小红书和 X：整屏实心白底（深色玻璃时黑底），不透壁纸 ---------- */
#${ROOT_ID} .xsj-screen.app-white{background:#fff!important}
#${ROOT_ID} .xsj-screen.app-white.tone-dark{background:#0b0b0d!important}
#${ROOT_ID} .xsj-screen.app-white::before{display:none}
#${ROOT_ID} .app-white :is(.xsj-status,.xsj-head,.xsj-sub,.xsj-hint,.xsj-none,.xsj-regen,.xsj-plat,.xsj-xmeta,.xsj-xnote){text-shadow:none!important}
#${ROOT_ID} .app-white .xsj-tabs{background:#fff!important;border-top:1px solid rgba(0,0,0,.07)!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
#${ROOT_ID} .app-white.tone-dark .xsj-tabs{background:#0b0b0d!important;border-top-color:rgba(255,255,255,.1)!important}
#${ROOT_ID} .app-white .xsj-head button{background:#f2f2f4!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
#${ROOT_ID} .app-white.tone-dark .xsj-head button{background:#1c1c1f!important}
#${ROOT_ID} .app-white :is(.xsj-note,.xsj-weather,.xsj-empty,.xsj-card,.xsj-ask-card){-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
#${ROOT_ID} .app-white .xsj-note{background:#fff!important;border:1px solid rgba(0,0,0,.06)!important;box-shadow:0 1px 4px rgba(0,0,0,.06)!important}
#${ROOT_ID} .app-white :is(.xsj-weather,.xsj-empty){background:#f6f6f8!important;border:0!important;box-shadow:none!important}
#${ROOT_ID} .app-white .xsj-ask-card{background:#fff!important;border:0!important;box-shadow:0 8px 30px rgba(0,0,0,.18)!important}
#${ROOT_ID} .app-white.tone-dark .xsj-note{background:#1c1c1f!important;border-color:rgba(255,255,255,.07)!important;box-shadow:none!important}
#${ROOT_ID} .app-white.tone-dark :is(.xsj-weather,.xsj-empty){background:#1c1c1f!important}
#${ROOT_ID} .app-white.tone-dark .xsj-ask-card{background:#1c1c1f!important}
#${ROOT_ID} .app-white :is(.xsj-busy,.xsj-ask){background:rgba(255,255,255,.6)!important}
#${ROOT_ID} .app-white.tone-dark :is(.xsj-busy,.xsj-ask){background:rgba(0,0,0,.55)!important}
/* 酒馆开了「禁用模糊」时会用 body.no-blur * 把所有模糊去掉；小手机里的毛玻璃单独保留 */
#${ROOT_ID} :is(.xsj-cal,.xsj-daycard,.xsj-card,.xsj-note,.xsj-form,.xsj-place,.xsj-loc,.xsj-genall,.xsj-cart,.xsj-weather,.xsj-ask-card,.xsj-wpset,.xsj-mapwrap,.xsj-empty,.xsj-tabs,.xsj-busy,.xsj-ask){-webkit-backdrop-filter:blur(18px) saturate(170%)!important;backdrop-filter:blur(18px) saturate(170%)!important}
#${ROOT_ID} :is(.xsj-head button,.xsj-maptools button){-webkit-backdrop-filter:blur(14px)!important;backdrop-filter:blur(14px)!important}

/* ---------- 桌面 ---------- */
#${ROOT_ID} .xsj-body-home{display:flex;flex-direction:column;padding:6px 16px 10px}
/* 选中和今天：只圈日期，不框整格 */
#${ROOT_ID} .xsj-phone .xsj-screen .xsj-day.is-sel{background:none!important;box-shadow:none!important}#${ROOT_ID} .xsj-phone .xsj-screen:not(.zz) .xsj-day.is-off.is-sel{background:rgba(79,174,127,.14)!important}
#${ROOT_ID} .xsj-day.is-today span{background:radial-gradient(38% 20% at 40% 17%,rgba(255,255,255,.85),rgba(255,255,255,0) 100%),radial-gradient(80% 58% at 58% 104%,rgba(255,190,206,.95),rgba(255,190,206,0) 100%),radial-gradient(circle at 50% 40%,#f78fb0,#f0749b);color:#fff!important;font-weight:700;text-shadow:0 1px 2px rgba(200,60,110,.4);box-shadow:1px 4px 8px -1px rgba(242,120,160,.5),inset 0 -.7px .8px rgba(255,255,255,.5)}
#${ROOT_ID} .xsj-day.is-sel:not(.is-today) span{background:radial-gradient(38% 20% at 40% 17%,rgba(255,255,255,.9),rgba(255,255,255,0) 100%),radial-gradient(circle at 50% 40%,#ffdfe9,#ffd0df);box-shadow:1px 3px 6px -1px rgba(232,116,154,.25)}
#${ROOT_ID} .tone-dark .xsj-day.is-sel:not(.is-today) span{background:rgba(255,170,200,.22);box-shadow:inset 0 0 0 1px rgba(255,255,255,.4)}
.xsj-caltop{display:flex;align-items:center;gap:8px;padding:6px 0 10px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Segoe UI","MiSans","HarmonyOS Sans SC","Microsoft YaHei",sans-serif}
.xsj-caltop h2{flex:1;min-width:0;margin:0;font-size:25px;font-weight:700;line-height:1.1;letter-spacing:-.3px;color:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.xsj-caltop h2 small{display:block;margin-top:1px;font-size:11px;font-weight:400;letter-spacing:0;opacity:.5}
.xsj-caltop svg{display:block;width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.100;stroke-linecap:round;stroke-linejoin:round}.xsj-caltop .gen.set svg{fill:none!important;stroke:currentColor!important;stroke-width:1.8}.xsj-caltop .gen svg{width:19px;height:19px;fill:currentColor;stroke:none}
#${ROOT_ID} .xsj-caltop button{display:flex;align-items:center;justify-content:center;flex:none;height:32px;padding:0!important;color:#e8749a!important;background:none!important;border:0!important;box-shadow:none!important}
#${ROOT_ID} .xsj-caltop .bk{width:24px;margin-left:-6px}#${ROOT_ID} .xsj-caltop .bk svg{width:24px;height:24px}
.xsj-caltop .cap,#${ROOT_ID} .xsj-caltop .gen{border-radius:16px;background:rgba(255,255,255,.6)!important;box-shadow:1px 3px 9px -1px rgba(120,115,145,.24),inset 0 0 0 1.200px rgba(255,255,255,.96),inset 0 0 0 1.800px rgba(120,120,150,.1)!important}
.xsj-caltop .cap{display:flex;flex:none}#${ROOT_ID} .xsj-caltop .cap button{width:30px}#${ROOT_ID} .xsj-caltop .cap .td{width:auto;font-size:13px;font-weight:600}#${ROOT_ID} .xsj-caltop .gen{width:32px}
#${ROOT_ID} .tone-dark .xsj-caltop button{color:#ff9dbb!important}#${ROOT_ID} .tone-dark .xsj-caltop :is(.cap,.gen){background:rgba(255,255,255,.1)!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)!important}
#${ROOT_ID} .xsj-cp{margin-top:8px;border-radius:12px;background:rgba(255,255,255,.55);padding:0 10px}#${ROOT_ID} .xsj-cp summary{padding:9px 0;font-size:13px;cursor:pointer}.xsj-cp summary em{float:right;font-style:normal;font-size:11px;color:#e8749a}
#${ROOT_ID} .xsj-cp textarea{display:block;width:100%;margin:0 0 4px;padding:8px;border:1px solid rgba(160,143,157,.3);border-radius:10px;background:#fff;color:#3b3340;font:inherit;font-size:12.5px;line-height:1.5;resize:vertical;height:auto}#${ROOT_ID} .xsj-cp pre{max-height:260px;overflow:auto;margin-bottom:10px}
#${ROOT_ID} .tone-dark .xsj-cp{background:rgba(255,255,255,.08)}#${ROOT_ID} .tone-dark .xsj-cp textarea{background:rgba(0,0,0,.25);color:#fff}
#${ROOT_ID} .xsj-grid.is-cn .xsj-day span{width:31px;font-size:12px;border-radius:13px}.xsj-calw .mg.is-cn i{font-size:8.500px;height:20px}.xsj-calw .mg.is-cn .now u{width:21px;border-radius:8px}
/* 人物图鉴：浅紫软糖 */
#${ROOT_ID} .xsj-phone .xsj-screen .xsj-caltop.is-npc .gen,#${ROOT_ID} .xsj-phone .xsj-screen .xsj-np-tabs button.on{background:radial-gradient(42% 22% at 38% 17%,rgba(255,255,255,.88),rgba(255,255,255,0) 100%),radial-gradient(85% 60% at 58% 106%,rgba(231,220,255,.95),transparent 100%),radial-gradient(circle at 50% 40%,#cdbaf3,#b39ae6)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(160,130,220,.48),inset 0 -.8px 1px rgba(255,255,255,.55)!important;text-shadow:0 1px 2px rgba(100,70,170,.4)}
#${ROOT_ID} .xsj-phone .xsj-screen .xsj-np-tabs button.on{background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.75),rgba(255,255,255,0) 100%),linear-gradient(180deg,#cdbaf3,#b59de7 55%,#d6c8f7)!important}
#${ROOT_ID} .xsj-phone .xsj-screen .xsj-caltop.is-npc .bk{color:#9a7fd6!important}#${ROOT_ID} .xsj-phone .xsj-screen .xsj-caltop.is-npc .gen svg{filter:drop-shadow(0 1px 1px rgba(100,70,170,.4))}
#${ROOT_ID} .xsj-caltop.is-npc~* .xsj-cp summary em{color:#9a7fd6}
#${ROOT_ID} .xsj-phone .xsj-screen.app-npc .xsj-primary{background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.75),rgba(255,255,255,0) 100%),linear-gradient(180deg,#cdbaf3,#b59de7 55%,#d6c8f7)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(160,130,220,.48),inset 0 -.8px 1px rgba(255,255,255,.55)!important;text-shadow:0 1px 2px rgba(100,70,170,.4)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-npc :is(.xsj-picrow button:not(.xsj-primary),.xsj-np-acts button:not(.xsj-danger)){background:radial-gradient(50% 34% at 30% 16%,rgba(255,255,255,.95),rgba(255,255,255,0) 100%),linear-gradient(180deg,#f3eefe,#e6dcfb)!important;color:#7a5fc0!important;border:0!important;box-shadow:1px 3px 6px -1px rgba(160,130,220,.28),inset 0 -.8px 1px rgba(255,255,255,.8)!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-npc .xsj-look{background:linear-gradient(150deg,#faf7ff,#f1ebfd)!important;border:0!important;border-radius:16px;box-shadow:1px 4px 10px -2px rgba(150,125,210,.24),inset 0 0 0 1.4px rgba(255,255,255,.95),inset 0 0 0 2px rgba(150,125,210,.14)!important;color:#443a56!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-npc .xsj-look em{background:linear-gradient(180deg,#e9defc,#d9caf7);color:#7a5fc0;border-radius:999px;padding:2px 8px}
#${ROOT_ID} .xsj-phone .xsj-screen.app-npc .xsj-lookform{background:linear-gradient(160deg,#fcfaff,#f4effe)!important;box-shadow:1px 5px 14px -3px rgba(150,125,210,.25),inset 0 0 0 1.4px rgba(255,255,255,.95),inset 0 0 0 2px rgba(150,125,210,.14)!important;border:0!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-npc .xsj-lookform label{color:#9a86c4}
#${ROOT_ID} .xsj-phone .xsj-screen.app-npc .xsj-lookform :is(input,textarea,select){border:1px solid #ddd0f5!important;background:#fff!important;color:#443a56!important;border-radius:10px}
#${ROOT_ID} .xsj-phone .xsj-screen.app-npc :is(input,textarea,select):focus{outline:2px solid #cdbaf3;outline-offset:0;border-color:#b39ae6!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-npc .xsj-pictip{color:#9a86c4;opacity:1}
#${ROOT_ID} .xsj-phone .xsj-screen.app-npc .xsj-trypic{box-shadow:0 0 0 3px #e3d8fa}
#${ROOT_ID} .xsj-phone .xsj-screen.app-npc.tone-dark :is(.xsj-look,.xsj-lookform){background:#241e33!important;color:#ece6f8!important;box-shadow:inset 0 0 0 1.2px rgba(200,180,245,.28)!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-npc.tone-dark :is(.xsj-picrow button:not(.xsj-primary),.xsj-np-acts button:not(.xsj-danger)){background:rgba(190,165,245,.2)!important;color:#e5dbff!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-npc.tone-dark .xsj-lookform :is(input,textarea,select){background:#17131f!important;color:#ece6f8!important;border-color:#4a3f63!important}
/* mon */
#${ROOT_ID} .xsj-phone .xsj-screen.app-mon .xsj-caltop .gen{background:radial-gradient(42% 22% at 38% 17%,rgba(255,255,255,.9),rgba(255,255,255,0) 100%),radial-gradient(85% 60% at 58% 106%,#ffc2c9,transparent 100%),radial-gradient(circle at 50% 40%,#ff9aa6,#fb6478)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(251,100,120,.42),inset 0 -.8px 1px rgba(255,255,255,.6)!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-mon .xsj-caltop .gen svg{filter:drop-shadow(0 1px 1px rgba(170,30,55,.4))}#${ROOT_ID} .xsj-phone .xsj-screen.app-mon .xsj-caltop .bk{color:#e0485e!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-mon .xsj-cp summary em{color:#e0485e}
#${ROOT_ID} .xsj-phone .xsj-screen.app-mon .xsj-primary{background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.78),rgba(255,255,255,0) 100%),linear-gradient(180deg,#ff9aa6,#fb6478 55%,#ffc2c9)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(251,100,120,.42),inset 0 -.8px 1px rgba(255,255,255,.6)!important;text-shadow:0 1px 2px rgba(170,30,55,.4)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-mon .xsj-cats button.on{background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.78),rgba(255,255,255,0) 100%),linear-gradient(180deg,#ff9aa6,#fb6478 55%,#ffc2c9)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(251,100,120,.42),inset 0 -.8px 1px rgba(255,255,255,.6)!important;text-shadow:0 1px 2px rgba(170,30,55,.4)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-mon :is(.xsj-xdraw,.xsj-dm-acts button:not(.xsj-danger)){background:radial-gradient(50% 34% at 30% 16%,#fff,rgba(255,255,255,0) 100%),linear-gradient(180deg,#fff3f4,#ffdfe3)!important;color:#e0485e!important;border:0!important;box-shadow:1px 3px 6px -1px rgba(251,100,120,.42),inset 0 -.8px 1px rgba(255,255,255,.85)!important;border-radius:999px}
#${ROOT_ID} .xsj-phone .xsj-screen.app-mon.tone-dark :is(.xsj-xdraw,.xsj-dm-acts button:not(.xsj-danger)){background:rgba(255,255,255,.12)!important;color:#fff!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)!important}
/* wiki */
#${ROOT_ID} .xsj-phone .xsj-screen.app-wiki .xsj-caltop .gen{background:radial-gradient(42% 22% at 38% 17%,rgba(255,255,255,.9),rgba(255,255,255,0) 100%),radial-gradient(85% 60% at 58% 106%,#e4f1bb,transparent 100%),radial-gradient(circle at 50% 40%,#c9e08a,#9dc455)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(157,196,85,.48),inset 0 -.8px 1px rgba(255,255,255,.6)!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-wiki .xsj-caltop .gen svg{filter:drop-shadow(0 1px 1px rgba(85,115,25,.42))}#${ROOT_ID} .xsj-phone .xsj-screen.app-wiki .xsj-caltop .bk{color:#739530!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-wiki .xsj-cp summary em{color:#739530}
#${ROOT_ID} .xsj-phone .xsj-screen.app-wiki .xsj-primary{background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.78),rgba(255,255,255,0) 100%),linear-gradient(180deg,#c9e08a,#9dc455 55%,#e4f1bb)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(157,196,85,.48),inset 0 -.8px 1px rgba(255,255,255,.6)!important;text-shadow:0 1px 2px rgba(85,115,25,.42)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-wiki .xsj-cats button.on{background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.78),rgba(255,255,255,0) 100%),linear-gradient(180deg,#c9e08a,#9dc455 55%,#e4f1bb)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(157,196,85,.48),inset 0 -.8px 1px rgba(255,255,255,.6)!important;text-shadow:0 1px 2px rgba(85,115,25,.42)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-wiki :is(.xsj-xdraw,.xsj-dm-acts button:not(.xsj-danger)){background:radial-gradient(50% 34% at 30% 16%,#fff,rgba(255,255,255,0) 100%),linear-gradient(180deg,#f9fdec,#eaf4cd)!important;color:#739530!important;border:0!important;box-shadow:1px 3px 6px -1px rgba(157,196,85,.48),inset 0 -.8px 1px rgba(255,255,255,.85)!important;border-radius:999px}
#${ROOT_ID} .xsj-phone .xsj-screen.app-wiki.tone-dark :is(.xsj-xdraw,.xsj-dm-acts button:not(.xsj-danger)){background:rgba(255,255,255,.12)!important;color:#fff!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)!important}
/* dream */
#${ROOT_ID} .xsj-phone .xsj-screen.app-dream .xsj-caltop .gen{background:radial-gradient(42% 22% at 38% 17%,rgba(255,255,255,.9),rgba(255,255,255,0) 100%),radial-gradient(85% 60% at 58% 106%,#c9e8ff,transparent 100%),radial-gradient(circle at 50% 40%,#9cd4ff,#62aef2)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(98,174,242,.48),inset 0 -.8px 1px rgba(255,255,255,.6)!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dream .xsj-caltop .gen svg{filter:drop-shadow(0 1px 1px rgba(30,90,155,.4))}#${ROOT_ID} .xsj-phone .xsj-screen.app-dream .xsj-caltop .bk{color:#3b87cf!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-dream .xsj-cp summary em{color:#3b87cf}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dream .xsj-primary{background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.78),rgba(255,255,255,0) 100%),linear-gradient(180deg,#9cd4ff,#62aef2 55%,#c9e8ff)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(98,174,242,.48),inset 0 -.8px 1px rgba(255,255,255,.6)!important;text-shadow:0 1px 2px rgba(30,90,155,.4)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dream .xsj-cats button.on{background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.78),rgba(255,255,255,0) 100%),linear-gradient(180deg,#9cd4ff,#62aef2 55%,#c9e8ff)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(98,174,242,.48),inset 0 -.8px 1px rgba(255,255,255,.6)!important;text-shadow:0 1px 2px rgba(30,90,155,.4)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dream :is(.xsj-xdraw,.xsj-dm-acts button:not(.xsj-danger)){background:radial-gradient(50% 34% at 30% 16%,#fff,rgba(255,255,255,0) 100%),linear-gradient(180deg,#f1f9ff,#d9eefe)!important;color:#3b87cf!important;border:0!important;box-shadow:1px 3px 6px -1px rgba(98,174,242,.48),inset 0 -.8px 1px rgba(255,255,255,.85)!important;border-radius:999px}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dream.tone-dark :is(.xsj-xdraw,.xsj-dm-acts button:not(.xsj-danger)){background:rgba(255,255,255,.12)!important;color:#fff!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)!important}
#${ROOT_ID} .xsj-phone .xsj-screen:is(.app-mon,.app-wiki,.app-dream) .xsj-cats{padding:2px 2px 8px}#${ROOT_ID} .xsj-phone .xsj-screen:is(.app-mon,.app-wiki,.app-dream) .xsj-cats button{padding:5px 13px!important;border-radius:999px;border-bottom:0!important}#${ROOT_ID} .xsj-phone .xsj-screen:is(.app-mon,.app-wiki,.app-dream) .xsj-cats button::after{display:none}
.xsj-wearing{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}#${ROOT_ID} .xsj-wearing button{padding:5px 12px!important;border-radius:999px;font-size:12px;background:radial-gradient(50% 34% at 30% 16%,#fff,rgba(255,255,255,0) 100%),linear-gradient(180deg,#fcf4f8,#f4e1ea)!important;color:#a2688a!important;border:0!important;box-shadow:1px 3px 6px -1px rgba(195,140,170,.35)!important}.xsj-wearing i{font-style:normal;opacity:.6;margin-left:3px}#${ROOT_ID} .tone-dark .xsj-wearing button{background:rgba(235,190,212,.18)!important;color:#f3d3e2!important}
/* 衣橱：藕粉 */
#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-caltop .gen{background:radial-gradient(42% 22% at 38% 17%,rgba(255,255,255,.9),rgba(255,255,255,0) 100%),radial-gradient(85% 60% at 58% 106%,#f5dbe6,transparent 100%),radial-gradient(circle at 50% 40%,#e9bdd2,#d092b1)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(200,140,172,.5),inset 0 -.8px 1px rgba(255,255,255,.6)!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-caltop .gen svg{filter:drop-shadow(0 1px 1px rgba(130,60,100,.4))}#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-caltop .bk,#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-cp summary em{color:#b9789b!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-closet :is(.xsj-primary,.xsj-np-tabs button.on,.xsj-cchips button.on){background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.78),rgba(255,255,255,0) 100%),linear-gradient(180deg,#e9bdd2,#d398b6 55%,#f0cfdd)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(200,140,172,.5),inset 0 -.8px 1px rgba(255,255,255,.6)!important;text-shadow:0 1px 2px rgba(130,60,100,.4)}#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-np-tabs{background:rgba(200,140,172,.13)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-closet :is(.xsj-cchips button:not(.on),.xsj-closet-a button:not(.xsj-danger),.xsj-closet-st button){background:radial-gradient(50% 34% at 30% 16%,#fff,rgba(255,255,255,0) 100%),linear-gradient(180deg,#fcf4f8,#f4e1ea)!important;color:#a2688a!important;border:0!important;box-shadow:1px 3px 6px -1px rgba(195,140,170,.35),inset 0 -.8px 1px rgba(255,255,255,.85)!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-cchips button,#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-closet-st button{padding:5px 12px!important;border-radius:999px;font-size:12.500px}#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-closet-a button{padding:7px 13px!important;border-radius:999px;font-size:12.500px}
#${ROOT_ID} .xsj-phone .xsj-numin{width:48px!important;min-width:0!important;flex:none;margin:0!important;padding:5px 3px!important;border-radius:999px!important;border:1px dashed rgba(150,110,90,.4)!important;background:rgba(255,255,255,.7)!important;color:inherit!important;font:inherit;font-size:12px!important;text-align:center;height:auto!important;min-height:0!important;box-shadow:none!important;-moz-appearance:textfield;appearance:textfield}#${ROOT_ID} .xsj-phone .xsj-numin::-webkit-inner-spin-button,#${ROOT_ID} .xsj-phone .xsj-numin::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}#${ROOT_ID} .xsj-phone .app-ev .xsj-numin{color:#b87a24!important}#${ROOT_ID} .xsj-phone .app-pic .xsj-numin{color:#c0705a!important}#${ROOT_ID} .xsj-phone .app-closet .xsj-numin{color:#a2688a!important}#${ROOT_ID} .xsj-phone .tone-dark .xsj-numin{color:#f6e6da!important}#${ROOT_ID} .xsj-phone .xsj-numin.on{border-style:solid!important;border-color:currentColor!important;font-weight:600}#${ROOT_ID} .xsj-phone .tone-dark .xsj-numin{background:rgba(255,255,255,.1)!important;border-color:rgba(255,255,255,.35)!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-dexb .xsj-caltop .gen{background:radial-gradient(42% 22% at 38% 17%,rgba(255,255,255,.9),rgba(255,255,255,0) 100%),radial-gradient(85% 60% at 58% 106%,rgba(255,243,208,.95),transparent 100%),radial-gradient(circle at 50% 40%,#f5dc95,#e3b758)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 10px -1px rgba(227,183,88,.45),inset 0 -.8px 1px rgba(255,255,255,.6)!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dexb .xsj-caltop .gen svg{filter:drop-shadow(0 1px 1px rgba(130,90,10,.5))}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dexb .xsj-primary{background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.8),rgba(255,255,255,0) 100%),linear-gradient(180deg,#f5dc95,#e5bb60 55%,#f8e6b4)!important;color:#4a3610!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(227,183,88,.4)!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dexb .xsj-caltop .bk{color:#c79a3a!important}
.xsj-blank{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:300px;padding:34px 26px 40px;text-align:center}.xsj-blank img{width:78px;height:78px;margin-bottom:4px}.xsj-blank b{font-size:16px;font-weight:600}.xsj-blank p{margin:0;max-width:260px;font-size:12.5px;line-height:1.75;opacity:.6}
#${ROOT_ID} .xsj-blank .xsj-primary{margin-top:8px;min-width:156px;padding:11px 24px!important;border-radius:999px!important;font-size:14px;font-weight:600}
#${ROOT_ID} :is(.xsj-blank.is-x .xsj-primary){background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.55),rgba(255,255,255,0) 100%),linear-gradient(180deg,#5b5b60,#2f2f33 55%,#6a6a70)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(0,0,0,.35)!important}
#${ROOT_ID} .xsj-phone .xsj-screen .xsj-genmonth{display:block;width:100%;margin:12px 0 4px!important;padding:12px!important;border-radius:999px!important;font-size:14px;font-weight:600;background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.78),rgba(255,255,255,0) 100%),linear-gradient(180deg,#f9a5c0,#f0749b 55%,#fcc9d9)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(242,120,160,.5),inset 0 -.8px 1px rgba(255,255,255,.6)!important;text-shadow:0 1px 2px rgba(200,60,110,.35)}
#${ROOT_ID} .has-wp:not(.app-white) .xsj-blank{border-radius:22px;background:rgba(255,255,255,.72);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}#${ROOT_ID} .has-wp.tone-dark:not(.app-white) .xsj-blank{background:rgba(20,18,24,.5)}
.xsj-upd-l{margin:6px 0;padding-left:18px;font-size:12.5px;line-height:1.7;list-style:disc}.xsj-upd-n{color:#e86a95}#${ROOT_ID} .xsj-held{opacity:.55!important}@media (pointer:coarse){#${ROOT_ID} :is([data-hold],[data-item],[data-note],[data-dex],[data-wiki],[data-npc],[data-dreamopen],[data-act="closet-open"],[data-act="pic-open"]),#${ROOT_ID} :is([data-hold],[data-note],[data-dex],[data-dreamopen],[data-act="closet-open"],[data-act="pic-open"]) *{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}}
#${ROOT_ID} .xsj-formask{justify-content:flex-start;padding-top:96px;overflow-y:auto}#${ROOT_ID} .xsj-formask .xsj-ask-card{width:88%;flex:none}.xsj-formask .t{font-size:15px;font-weight:600;margin:0 2px 8px}#${ROOT_ID} .xsj-phone .xsj-screen.xsj-screen .xsj-formask .xsj-form.xsj-form{margin:0;padding:0!important;background:none!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}#${ROOT_ID} .xsj-phone .xsj-screen .xsj-formask .xsj-primary{background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.78),rgba(255,255,255,0) 100%),linear-gradient(180deg,#f9a5c0,#f0749b 55%,#fcc9d9)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(242,120,160,.5)!important}#${ROOT_ID} .xsj-phone .xsj-closet-ask>*{flex:none}#${ROOT_ID} .xsj-phone .xsj-screen:not(.app-dex):not(.app-closet) .xsj-regen-card .xsj-cchips button[data-k="count"]:not(.xsj-primary){background:rgba(128,120,125,.12)!important;border:0!important;color:inherit!important}#${ROOT_ID} .xsj-phone .app-dex .xsj-numin{background:rgba(243,217,139,.1)!important;border-color:rgba(201,162,74,.5)!important;color:#f3d98b!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-dex.app-dex .xsj-empty{background:rgba(60,48,100,.55)!important;border:1px solid rgba(201,162,74,.4)!important}#${ROOT_ID} .xsj-phone .xsj-regen-card .xsj-cchips button{width:auto!important;padding:5px 13px!important;font-size:12.5px;border-radius:999px}.xsj-cchips{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}.xsj-closet-c{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding:2px 2px 8px;margin:0}#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-closet-c button{flex:none}
.xsj-folders{display:grid;grid-template-columns:repeat(2,1fr);gap:22px 16px;padding:22px 4px 10px}
#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-folder{position:relative;display:block;height:132px;padding:0!important;background:none!important;border:0!important;box-shadow:none!important;text-align:left;transition:transform .18s}#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-folder:active{transform:scale(.96)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-folder::before{content:"";position:absolute;left:0;top:8px;right:0;bottom:0;border-radius:6px 18px 18px 18px;background:linear-gradient(160deg,#e3b3c9,#cf95b2);box-shadow:2px 10px 18px -4px rgba(190,130,162,.5),inset 0 0 0 1.400px rgba(255,255,255,.6)}#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-folder::after{content:"";position:absolute;left:0;top:-5px;width:46%;height:24px;border-radius:12px 14px 0 0;background:#e3b3c9;box-shadow:inset 1.400px 1.400px 0 rgba(255,255,255,.6);z-index:0}
.xsj-folder .peek{position:absolute;left:12px;right:12px;top:-8px;height:74px;display:flex;justify-content:center;z-index:1}.xsj-folder .peek i{flex:none;width:46px;height:62px;margin:0 -4px;border-radius:7px;overflow:hidden;background:#fff;box-shadow:0 2px 6px rgba(120,70,95,.28);display:flex;align-items:center;justify-content:center}.xsj-folder .peek i:nth-child(1){transform:rotate(-7deg) translateY(6px)}.xsj-folder .peek i:nth-child(2){transform:translateY(0)}.xsj-folder .peek i:nth-child(3){transform:rotate(7deg) translateY(6px)}.xsj-folder .peek img{width:100%;height:100%;object-fit:cover}.xsj-folder .peek .xsj-closet-e{font-size:24px;line-height:1}
.xsj-folder .face{position:absolute;z-index:2;left:0;right:0;bottom:0;height:88px;padding:24px 14px 0;border-radius:14px 18px 18px 18px;color:#fff;background:radial-gradient(60% 26% at 30% 8%,rgba(255,255,255,.75),rgba(255,255,255,0) 100%),linear-gradient(170deg,rgba(240,207,221,.93),rgba(214,157,186,.94) 60%,rgba(238,203,218,.95));box-shadow:inset 0 0 0 1.500px rgba(255,255,255,.8),inset 0 -2px 5px rgba(255,255,255,.4);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}.xsj-folder .face b{display:block;font-size:16px;text-shadow:0 1px 2px rgba(130,60,100,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.xsj-folder .face small{font-size:11.500px;opacity:.95;text-shadow:0 1px 2px rgba(130,60,100,.4)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-folder.is-add{opacity:.62}.xsj-folder.is-add .face{text-align:center;padding-top:16px}.xsj-folder.is-add .face b{font-size:24px}
.xsj-closet-st{margin:0 0 10px;padding:10px 12px;border-radius:16px;background:rgba(255,255,255,.6);box-shadow:1px 5px 12px -4px rgba(190,130,162,.35),inset 0 0 0 1.400px rgba(255,255,255,.95),inset 0 0 0 2px rgba(200,140,172,.14)}.xsj-closet-st>div{display:flex;justify-content:space-between;align-items:center;font-size:13px}.xsj-closet-st p{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0 0}.xsj-closet-st p i{font-style:normal;font-size:11px;padding:2px 8px;border-radius:999px;background:#f6e3ec;color:#a2688a}
#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-closet-st textarea,#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-closet-want{display:block;width:100%;box-sizing:border-box;margin:6px 0 2px;padding:7px 9px;border:1px solid #ecd3df;border-radius:11px;background:#fff;color:#4a3540;font:inherit;font-size:12.500px;line-height:1.5;resize:vertical}#${ROOT_ID} .xsj-phone .xsj-screen.app-closet textarea:focus,#${ROOT_ID} .xsj-phone .xsj-screen.app-closet input:focus{outline:2px solid #eec9da}
.xsj-closet-sets{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-closet-sets>button{display:block;padding:8px!important;border-radius:16px;text-align:left;background:rgba(255,255,255,.75)!important;box-shadow:1px 5px 12px -3px rgba(190,130,162,.35),inset 0 0 0 1.400px rgba(255,255,255,.95)!important;color:#4a3540!important}.xsj-closet-sets img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:11px}.xsj-closet-sets b{display:block;margin-top:6px;font-size:13px}.xsj-closet-sets small{font-size:11px;opacity:.6}
.xsj-closet-mosaic{display:grid;grid-template-columns:1fr 1fr;gap:4px;aspect-ratio:3/4;border-radius:11px;overflow:hidden;background:#f8ecf2;padding:4px}.xsj-closet-mosaic i{display:flex;align-items:center;justify-content:center;min-height:0;border-radius:8px;overflow:hidden;background:#fff}.xsj-closet-mosaic img{width:100%;height:100%!important;aspect-ratio:auto!important;object-fit:cover;border-radius:0}.xsj-closet-detail .xsj-closet-mosaic{grid-template-columns:repeat(3,1fr);aspect-ratio:4/3;margin-bottom:8px}
.xsj-closet-list{margin:8px 0}#${ROOT_ID} .xsj-phone .xsj-screen.app-closet .xsj-closet-list button{display:flex;gap:10px;align-items:center;width:100%;padding:6px 2px!important;text-align:left;background:none!important;border:0!important;border-bottom:1px dashed #ecd3df!important;border-radius:0;color:inherit!important;box-shadow:none!important}.xsj-closet-list i{flex:none;width:38px;height:48px;border-radius:7px;overflow:hidden;background:#f8ecf2;display:flex;align-items:center;justify-content:center}.xsj-closet-list img{width:100%;height:100%;object-fit:cover}.xsj-closet-list .xsj-closet-e{font-size:20px}.xsj-closet-list b{display:block;font-size:13px}.xsj-closet-list small{font-size:11px;opacity:.6}
.xsj-closet-tag.is-add{background:#eee8ec;color:#8f7d87}.xsj-closet-ask{max-height:88%;overflow-y:auto}.xsj-closet-detail>img+img,.xsj-closet-a+img{margin-top:12px}
#${ROOT_ID} .xsj-phone .xsj-screen.app-closet.tone-dark :is(.xsj-closet-st,.xsj-closet-sets>button,.xsj-closet-item){background:rgba(60,42,52,.5)!important;color:#f6e8ef!important;box-shadow:inset 0 0 0 1.200px rgba(255,255,255,.14)!important}#${ROOT_ID} .app-closet.tone-dark .xsj-closet-item b{color:#f6e8ef}#${ROOT_ID} .xsj-phone .xsj-screen.app-closet.tone-dark :is(.xsj-cchips button:not(.on),.xsj-closet-a button:not(.xsj-danger),.xsj-closet-st button){background:rgba(235,190,212,.18)!important;color:#f3d3e2!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-closet.tone-dark :is(textarea,input.xsj-closet-want){background:rgba(0,0,0,.28)!important;color:#fff!important;border-color:rgba(235,190,212,.3)!important}
/* 随机剧情：橙色软糖骰子 */
#${ROOT_ID} .xsj-phone .xsj-screen.app-ev .xsj-caltop .gen{background:radial-gradient(42% 22% at 38% 17%,rgba(255,255,255,.9),rgba(255,255,255,0) 100%),radial-gradient(85% 60% at 58% 106%,rgba(255,232,200,.95),transparent 100%),radial-gradient(circle at 50% 40%,#ffd293,#f3a94f)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(240,160,75,.5),inset 0 -.8px 1px rgba(255,255,255,.6)!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-ev .xsj-caltop .gen svg{filter:drop-shadow(0 1px 1px rgba(150,85,10,.45))}#${ROOT_ID} .xsj-phone .xsj-screen.app-ev .xsj-caltop .bk{color:#e2933a!important}
.xsj-dice{display:flex;flex-direction:column;align-items:center;gap:7px;padding:12px 0 14px;text-align:center}.xsj-dice b{font-size:14px}.xsj-dice small{font-size:11.500px;opacity:.65;max-width:100%}
#${ROOT_ID} .xsj-phone .xsj-screen.app-ev .die{width:124px;height:124px;padding:0!important;margin:4px 0 8px;border-radius:34px;border:0!important;transform:rotate(-8deg);background:radial-gradient(46% 24% at 34% 15%,rgba(255,255,255,.92),rgba(255,255,255,0) 100%),radial-gradient(90% 60% at 62% 108%,rgba(255,228,190,.98),rgba(255,228,190,0) 100%),linear-gradient(155deg,#ffdca8,#f8b867 58%,#ffcb95)!important;box-shadow:3px 14px 24px -4px rgba(240,160,75,.6),0 2px 5px rgba(150,95,30,.16),inset 0 0 0 1.600px rgba(255,255,255,.85),inset 0 0 18px rgba(240,150,55,.4),inset -3px -5px 8px rgba(255,255,255,.5),inset 3px 4px 7px rgba(255,255,255,.6)!important;transition:transform .25s}
.xsj-dice .die svg{display:block;width:100%;height:100%;fill:#fffaf2;filter:drop-shadow(0 2px 2px rgba(165,95,20,.4))}#${ROOT_ID} .xsj-phone .xsj-screen.app-ev .die:active{transform:rotate(6deg) scale(.93)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-ev .die.is-rolling{animation:xsjroll 1.100s cubic-bezier(.45,.05,.55,.95) infinite}@keyframes xsjroll{0%{transform:translateY(0) rotate(-8deg)}25%{transform:translateY(-22px) rotate(95deg) scale(1.04,.97)}50%{transform:translateY(0) rotate(172deg) scale(1.07,.93)}75%{transform:translateY(-14px) rotate(268deg)}100%{transform:translateY(0) rotate(352deg) scale(1.03,.97)}}
#${ROOT_ID} .xsj-phone .xsj-screen.app-ev .stop{padding:4px 16px!important;border-radius:999px;font-size:12px;background:radial-gradient(50% 34% at 30% 16%,#fff,rgba(255,255,255,0) 100%),linear-gradient(180deg,#fff7ea,#fdebcf)!important;color:#a9702a!important;border:0!important;box-shadow:1px 3px 6px -1px rgba(225,165,85,.35),inset 0 -.8px 1px rgba(255,255,255,.85)!important}
.xsj-evform{border-radius:20px;padding:4px 14px 14px;margin-bottom:12px;background:rgba(255,255,255,.6);box-shadow:2px 8px 18px -4px rgba(150,130,110,.24),inset 0 0 0 1.500px rgba(255,255,255,.95),inset 0 0 0 2.100px rgba(200,160,110,.14)}
.xsj-evrow h4{display:flex;align-items:baseline;gap:8px;margin:12px 0 6px;font-size:13px;font-weight:600}.xsj-evrow h4 small{font-size:11px;font-weight:400;opacity:.55}.xsj-evrow .chips{display:flex;flex-wrap:wrap;gap:7px}
#${ROOT_ID} .xsj-phone .xsj-screen.app-ev .chips button{padding:6px 13px!important;border-radius:999px;font-size:13px;line-height:1.3;background:radial-gradient(50% 34% at 30% 16%,#fff,rgba(255,255,255,0) 100%),linear-gradient(180deg,#fff7ea,#fdebcf)!important;color:#a9702a!important;border:0!important;box-shadow:1px 3px 6px -1px rgba(225,165,85,.35),inset 0 -.8px 1px rgba(255,255,255,.85)!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-ev :is(.chips button.on,.xsj-primary){background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.8),rgba(255,255,255,0) 100%),linear-gradient(180deg,#ffd293,#f5ae58 55%,#ffddb0)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(240,160,75,.5),inset 0 -.8px 1px rgba(255,255,255,.6)!important;text-shadow:0 1px 2px rgba(150,85,10,.45)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-ev .xsj-evrow textarea{display:block;width:100%;padding:9px 11px;border:1px solid #f3dcb8;border-radius:14px;background:#fff;color:#4a3a28;font:inherit;font-size:13px;line-height:1.5;resize:vertical}#${ROOT_ID} .xsj-phone .xsj-screen.app-ev textarea:focus{outline:2px solid #ffd9a3;border-color:#f3a94f}
.xsj-evhead{display:flex;align-items:center;justify-content:space-between;margin:4px 2px 8px;font-size:14px}#${ROOT_ID} .xsj-phone .xsj-screen.app-ev .xsj-evhead button{padding:4px 12px!important;border-radius:999px;font-size:12px;background:radial-gradient(50% 34% at 30% 16%,#fff,rgba(255,255,255,0) 100%),linear-gradient(180deg,#fff7ea,#fdebcf)!important;color:#a9702a!important;border:0!important;box-shadow:1px 3px 6px -1px rgba(225,165,85,.35),inset 0 -.8px 1px rgba(255,255,255,.85)!important}
.xsj-lv-k{background:#fdebcf;color:#a9702a}#${ROOT_ID} .xsj-phone .xsj-screen.app-ev .xsj-cp summary em{color:#e2933a}
#${ROOT_ID} .xsj-phone .xsj-screen.app-ev .xsj-card{margin-bottom:9px}
#${ROOT_ID} .xsj-phone .xsj-screen.app-ev.tone-dark .xsj-evform{background:rgba(60,45,30,.45);box-shadow:inset 0 0 0 1.200px rgba(255,255,255,.16)}#${ROOT_ID} .xsj-phone .xsj-screen.app-ev.tone-dark :is(.chips button:not(.on),.stop,.xsj-evhead button){background:rgba(255,205,140,.16)!important;color:#ffdcae!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-ev.tone-dark textarea{background:rgba(0,0,0,.28)!important;color:#fff!important;border-color:rgba(255,210,150,.3)!important}
#${ROOT_ID} .app-ev.tone-dark .xsj-villain-head b{color:#f3c98a}#${ROOT_ID} .app-ev.tone-dark .xsj-hook{color:#f0b98c}
/* 地图：绿色软糖 */
#${ROOT_ID} .xsj-phone .xsj-screen.app-map .xsj-caltop .gen{background:radial-gradient(42% 22% at 38% 17%,rgba(255,255,255,.88),rgba(255,255,255,0) 100%),radial-gradient(85% 60% at 58% 106%,rgba(222,247,226,.95),transparent 100%),radial-gradient(circle at 50% 40%,#a5dcbb,#7cc49c)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(105,180,140,.5),inset 0 -.8px 1px rgba(255,255,255,.6)!important;text-shadow:0 1px 2px rgba(40,110,70,.45)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-map .xsj-caltop .gen svg{filter:drop-shadow(0 1px 1px rgba(40,110,70,.45))}#${ROOT_ID} .xsj-phone .xsj-screen.app-map .xsj-caltop .bk{color:#58ad80!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-map :is(.xsj-np-tabs button.on,.xsj-primary,.xsj-mapctl button.on){background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.75),rgba(255,255,255,0) 100%),linear-gradient(180deg,#a5dcbb,#7dc59d 55%,#bfe8cf)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(105,180,140,.5),inset 0 -.8px 1px rgba(255,255,255,.6)!important;text-shadow:0 1px 2px rgba(40,110,70,.45)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-map .xsj-np-tabs{background:rgba(88,173,128,.12)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-map :is(.xsj-mapctl button:not(.on),.xsj-mini,.xsj-xdraw){background:radial-gradient(50% 34% at 30% 16%,#fff,rgba(255,255,255,0) 100%),linear-gradient(180deg,#f3fcf6,#daf2e3)!important;color:#3f8a63!important;border:0!important;box-shadow:1px 3px 7px -1px rgba(90,160,120,.4),inset 0 -.8px 1px rgba(255,255,255,.85)!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-map .xsj-mapctl button{height:32px;min-width:34px;border-radius:999px;padding:0 12px!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-map .xsj-mapctl button:active{transform:scale(.94)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-map .xsj-cp summary em{color:#58ad80}#${ROOT_ID} .xsj-phone .xsj-screen.app-map :is(input,textarea,select):focus{outline:2px solid #a5dcbb;border-color:#7cc49c!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-map.tone-dark :is(.xsj-mini,.xsj-xdraw){background:rgba(140,215,175,.18)!important;color:#c8f0d8!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)!important}
#${ROOT_ID} .app-map :is(.xsj-region.is-sel .xsj-rframe,.xsj-pin.is-sel .xsj-pin-ring,.xsj-pin.is-sel .xsj-pin-bg,.xsj-wland.is-sel path){stroke:#58ad80}
/* 物品图鉴：图片两侧的果冻箭头 */
#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-dexarrow{position:absolute;z-index:3;top:50%;width:46px;height:46px;margin-top:-23px;padding:0!important;border-radius:50%;display:flex;align-items:center;justify-content:center;background:radial-gradient(42% 22% at 38% 17%,rgba(255,255,255,.95),rgba(255,255,255,0) 100%),radial-gradient(85% 60% at 58% 106%,rgba(255,243,208,.95),transparent 100%),radial-gradient(circle at 50% 40%,rgba(245,220,149,.94),rgba(227,183,88,.92))!important;border:0!important;color:#fff!important;box-shadow:1px 5px 12px -1px rgba(0,0,0,.45),0 0 12px -2px rgba(227,183,88,.5),inset 0 -1px 1.500px rgba(255,255,255,.6)!important;transition:transform .15s}
#${ROOT_ID} .xsj-dexarrow.is-l{left:7px}#${ROOT_ID} .xsj-dexarrow.is-r{right:7px}#${ROOT_ID} .xsj-dexarrow:active{transform:scale(.9)}
.xsj-dexarrow svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:2.800;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 1px 1px rgba(130,90,10,.55))}
.xsj-eras{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:6px 0}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-eras button{padding:8px 0!important;border-radius:999px;font-size:13px;color:#efe7cf!important;background:rgba(243,217,139,.1)!important;border:1px solid rgba(201,162,74,.4)!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-eras button.on{background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.8),rgba(255,255,255,0) 100%),linear-gradient(180deg,#f5dc95,#e5bb60 55%,#f8e6b4)!important;color:#4a3610!important;border:0!important;font-weight:700;box-shadow:1px 4px 9px -1px rgba(227,183,88,.4)!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dex.app-dex .xsj-ask .xsj-ask-card{background:#241d42!important;border:1px solid rgba(201,162,74,.6)!important;color:#efe7cf!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-ask-card button:not(.xsj-primary){color:#efe7cf!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-regen-card button:not(.xsj-primary):not(.xsj-regen-reset):not(.xsj-regen-cancel){border-radius:999px;background:rgba(243,217,139,.1)!important;border:1px solid rgba(201,162,74,.4)!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-regen-reset{color:#f0a0a0!important}
/* 物品图鉴：淡金软糖 */
#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-caltop .gen{background:radial-gradient(42% 22% at 38% 17%,rgba(255,255,255,.9),rgba(255,255,255,0) 100%),radial-gradient(85% 60% at 58% 106%,rgba(255,243,208,.95),transparent 100%),radial-gradient(circle at 50% 40%,#f5dc95,#e3b758)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 10px -1px rgba(227,183,88,.45),inset 0 -.8px 1px rgba(255,255,255,.6)!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-caltop .gen svg{filter:drop-shadow(0 1px 1px rgba(130,90,10,.5))}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-caltop h2{color:#f3d98b}#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-caltop h2 small{color:#efe7cf}#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-caltop .bk{color:#f3d98b!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-set{background:rgba(0,0,0,.26)!important;border:1px solid rgba(201,162,74,.45)!important;box-shadow:none!important;color:#efe7cf!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-set-tip{color:#cfc6ea;opacity:1}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-cp{background:rgba(243,217,139,.08)}#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-cp summary em{color:#f3d98b}#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-cp textarea{background:#171230!important;color:#efe7cf!important;border-color:rgba(201,162,74,.5)!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-cp .xsj-regen{color:#f3d98b!important}#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-weekpre{background:#171230!important;color:#d9cfee!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-primary{background:radial-gradient(34% 20% at 24% 17%,rgba(255,255,255,.8),rgba(255,255,255,0) 100%),linear-gradient(180deg,#f5dc95,#e5bb60 55%,#f8e6b4)!important;color:#4a3610!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(227,183,88,.4)!important}
/* 日程页能点的都是软糖 */
#${ROOT_ID} .xsj-phone .xsj-screen:not(.tone-dark) .xsj-caltop .cap{background:radial-gradient(34% 22% at 24% 18%,#fff,rgba(255,255,255,0) 100%),linear-gradient(180deg,#fff,#fbf7f9 55%,#fff)!important;box-shadow:1px 4px 9px -1px rgba(150,120,145,.28),inset 0 -1px 2px rgba(225,190,206,.35)!important}
#${ROOT_ID} .xsj-phone .xsj-screen .xsj-caltop .gen,#${ROOT_ID} .xsj-phone .xsj-screen .xsj-dayhead [data-act="add-item"],#${ROOT_ID} .xsj-phone .xsj-screen .xsj-daycard .xsj-primary{background:radial-gradient(42% 22% at 38% 17%,rgba(255,255,255,.85),rgba(255,255,255,0) 100%),radial-gradient(85% 60% at 58% 106%,rgba(255,190,206,.95),rgba(255,190,206,0) 100%),radial-gradient(circle at 50% 40%,#f78fb0,#f0749b)!important;color:#fff!important;border:0!important;box-shadow:1px 4px 9px -1px rgba(242,120,160,.5),inset 0 -.8px 1px rgba(255,255,255,.5)!important;text-shadow:0 1px 2px rgba(200,60,110,.35)}
#${ROOT_ID} .xsj-caltop .gen svg{filter:drop-shadow(0 1px 1px rgba(200,60,110,.35))}
#${ROOT_ID} :is(.xsj-caltop .gen,.xsj-dayhead [data-act="add-item"]){transition:transform .15s}#${ROOT_ID} :is(.xsj-caltop .gen,.xsj-dayhead [data-act="add-item"]):active{transform:scale(.9)}
#${ROOT_ID} .xsj-calw{display:flex;gap:14px;width:100%;flex:none;min-height:138px;margin:6px 0 16px;padding:12px 14px!important;border-radius:22px;text-align:left;background:rgba(255,255,255,.55)!important;color:#4a3f4c!important;box-shadow:2px 9px 20px -3px rgba(120,115,145,.26),1px 2px 5px rgba(90,88,115,.14),inset 0 0 0 1.6px rgba(255,255,255,.96),inset 0 0 0 2.3px rgba(120,120,150,.1),inset 3px 4px 7px rgba(255,255,255,.75),inset -2.5px -3.5px 4px rgba(255,255,255,.8);-webkit-backdrop-filter:blur(16px) saturate(1.3);backdrop-filter:blur(16px) saturate(1.3);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Segoe UI","MiSans","HarmonyOS Sans SC","Microsoft YaHei",sans-serif}
.xsj-calw em{display:block;font-style:normal;font-size:12px;font-weight:600;line-height:1.3;color:#e8749a}
.xsj-calw .l{flex:1 1 0;min-width:0;display:flex;flex-direction:column}.xsj-calw .l>b{font-size:40px;font-weight:300;line-height:1.08;letter-spacing:-1px;margin-bottom:auto}
.xsj-calw .ev{display:block;margin-top:5px;padding-left:7px;border-left:4px solid var(--c);border-radius:2px;line-height:1.3}.xsj-calw .ev strong{display:block;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.xsj-calw .ev small,.xsj-calw .none{display:block;font-size:11px;color:#a08f9d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.xsj-calw .none{margin-top:4px}
.xsj-calw .r{flex:0 0 55%;min-width:0}.xsj-calw .r em{display:flex;justify-content:space-between;gap:6px;white-space:nowrap}.xsj-calw .r em small{min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:10.5px;font-weight:400;color:#a08f9d}.xsj-calw .mg{display:grid;grid-template-columns:repeat(7,1fr);margin-top:3px}.xsj-calw .mg i{position:relative;display:flex;align-items:center;justify-content:center;height:16px;font-style:normal;font-size:10.5px;font-weight:500;font-variant-numeric:tabular-nums}.xsj-calw .mg u{text-decoration:none}.xsj-calw .mg .h{font-size:9px;font-weight:600;color:#a08f9d}.xsj-calw .mg .w{color:#a08f9d}.xsj-calw .mg .now u{display:flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:linear-gradient(150deg,#f48bab,#e2608c);box-shadow:0 2px 5px rgba(232,116,154,.45),inset 0 0 0 .8px rgba(255,255,255,.6),inset 1px 2px 2px rgba(255,255,255,.4);color:#fff;font-weight:600}.xsj-calw .mg .dot:not(.now)::after{content:"";position:absolute;bottom:0;left:calc(50% - 1.5px);width:3px;height:3px;border-radius:50%;background:#f5a6bf}
.xsj-calw+.xsj-appgrid{gap:13px 4px}
#${ROOT_ID} .tone-dark .xsj-calw{background:rgba(46,38,50,.55)!important;color:#fbf3f7!important;box-shadow:2px 9px 20px -3px rgba(0,0,0,.4),inset 0 0 0 1.4px rgba(255,255,255,.5),inset 3px 4px 7px rgba(255,255,255,.1),inset -2px -3px 4px rgba(255,255,255,.12)}#${ROOT_ID} .tone-dark .xsj-calw em{color:#ff9dbb}#${ROOT_ID} .tone-dark .xsj-calw :is(small,.mg .h,.mg .w){color:#c5b4c1}
.xsj-appgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px 4px}
#${ROOT_ID} .xsj-app{position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;padding:0!important;font-size:11px;min-width:0}
#${ROOT_ID} .xsj-app>i{position:relative;display:block;width:54px;height:54px}
#${ROOT_ID} .xsj-app>i>img{position:absolute;left:-15%;top:-15%;width:130%;height:135%;max-width:none;margin:0;border:0;border-radius:0;box-shadow:none;pointer-events:none;-webkit-user-drag:none}
#${ROOT_ID} .xsj-app:active>i{transform:scale(.92)}
#${ROOT_ID} .xsj-app>span{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 4px rgba(255,255,255,.95)}
#${ROOT_ID} .xsj-badge{position:absolute;top:-5px;right:calc(50% - 34px);min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#ff3b30;color:#fff;font-size:11px;line-height:18px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.25)}
#${ROOT_ID} .xsj-widget{display:block;width:100%;margin-top:auto;padding:12px 14px!important;border-radius:20px;text-align:left;background:linear-gradient(145deg,#4b3d7d,#241d42)!important;color:#efe7cf!important;box-shadow:0 6px 18px rgba(40,20,60,.25)}
#${ROOT_ID} .xsj-widget span{font-size:12px;opacity:.85}#${ROOT_ID} .xsj-widget b{float:right;color:#f3d98b;font-size:13px}
.xsj-widget i,.xsj-dexbar i{display:block;height:6px;border-radius:3px;background:rgba(255,255,255,.14);margin-top:8px;overflow:hidden}
.xsj-widget em,.xsj-dexbar em{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#c9a24a,#f3d98b)}
#${ROOT_ID} .xsj-body-home{padding-bottom:18px}
#${ROOT_ID} .xsj-headside{display:flex;align-items:center;gap:4px;flex:none;min-width:32px}
#${ROOT_ID} .xsj-head2 .xsj-headside{min-width:68px}
#${ROOT_ID} .xsj-head .xsj-exit.xsj-headbtn{font-size:15px;padding:0!important}
#${ROOT_ID} .xsj-headr{justify-content:flex-end}
#${ROOT_ID} .xsj-head .xsj-exit{width:32px;height:32px;flex:none;font-size:22px;line-height:1;padding:0 2px 2px 0!important;display:flex;align-items:center;justify-content:center}
#${ROOT_ID} .xsj-head .xsj-mnav{padding:0 9px}
#${ROOT_ID} .xsj-xexit{width:30px;height:30px;flex:none;border-radius:50%;font-size:22px;line-height:1;padding:0 2px 2px 0!important;display:flex;align-items:center;justify-content:center;background:#f2f2f4!important;color:#0f1419!important}
#${ROOT_ID} .tone-dark .xsj-xexit{background:#1c1c1f!important;color:#e7e9ea!important}
#${ROOT_ID} .xsj-xexit+.xsj-xme{margin-left:8px;margin-right:auto}
#${ROOT_ID} .xsj-xhead .xsj-xlogo{position:absolute;left:50%;transform:translateX(-50%)}
#${ROOT_ID} .xsj-phone .xsj-screen.app-dex .xsj-head .xsj-exit{background:rgba(0,0,0,.3)!important;border:1px solid rgba(201,162,74,.6)!important;color:#f3d98b!important;box-shadow:none!important}
#${ROOT_ID} .xsj-phone .xsj-screen.app-log .xsj-head .xsj-exit{background:rgba(0,0,0,.25)!important;border:1px solid rgba(243,227,192,.45)!important;color:#f3e3c0!important;box-shadow:none!important}
#${ROOT_ID} .xsj-app{touch-action:manipulation;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none}
#${ROOT_ID} .xsj-appgrid.is-arrange .xsj-app{touch-action:none}
#${ROOT_ID} .xsj-appgrid.is-arrange .xsj-app>i{animation:xsjjiggle .28s ease-in-out infinite alternate}
#${ROOT_ID} .xsj-appgrid.is-arrange .xsj-app:nth-child(2n)>i{animation-delay:-.14s}
@keyframes xsjjiggle{from{transform:rotate(-2.5deg)}to{transform:rotate(2.5deg)}}
#${ROOT_ID} .xsj-app.is-holding{opacity:.25}
#${ROOT_ID} .xsj-app-ghost{position:absolute;z-index:6;pointer-events:none;transform:scale(1.12);filter:drop-shadow(0 8px 14px rgba(0,0,0,.28))}
#${ROOT_ID} .xsj-app-ghost>i{animation:none!important}
#${ROOT_ID} .xsj-arrange-done{position:absolute;top:40px;right:16px;z-index:2;padding:4px 14px!important;border-radius:999px;background:rgba(255,255,255,.7)!important;font-size:12.5px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.12)}
#${ROOT_ID} .tone-dark .xsj-arrange-done{background:rgba(40,36,52,.75)!important}
.xsj-arrange-hint{text-align:center;margin-top:14px}
#${ROOT_ID} .tone-dark .xsj-app>span{text-shadow:0 1px 6px rgba(0,0,0,.7)}
#${ROOT_ID} .xsj-homebar{display:flex;justify-content:center;flex:none;width:100%;padding:8px 0 11px!important}
#${ROOT_ID} .xsj-homebar i{display:block;width:118px;height:5px;border-radius:3px;background:currentColor;opacity:.35}

/* ---------- 📖 图鉴（深色游戏界面） ---------- */
#${ROOT_ID} .xsj-phone .xsj-screen.app-dex{background:radial-gradient(120% 55% at 50% 0%,#3d3168 0%,transparent 62%),linear-gradient(180deg,#1d1834,#110e20)!important;color:#efe7cf}
#${ROOT_ID} .xsj-screen.app-dex::before{display:none}
#${ROOT_ID} .app-dex :is(.xsj-status,.xsj-head,.xsj-hint,.xsj-sub){text-shadow:none!important;color:#efe7cf}
#${ROOT_ID} .app-dex .xsj-head b{font-family:"Songti SC","STSong","SimSun",serif;letter-spacing:3px;color:#f3d98b}
#${ROOT_ID} .app-dex .xsj-empty{background:rgba(0,0,0,.28)!important;border:1px solid rgba(201,162,74,.55)!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;color:#efe7cf}
#${ROOT_ID} .app-dex :is(.xsj-busy,.xsj-ask){background:rgba(17,14,32,.88)!important;color:#efe7cf}
#${ROOT_ID} .app-dex .xsj-ask-card{background:#241d42!important;border:1px solid rgba(201,162,74,.6)!important;color:#efe7cf}
#${ROOT_ID} .app-dex .xsj-drawing{background:rgba(243,217,139,.07);border-color:rgba(243,217,139,.4);color:#efe7cf}
.xsj-dex-big{font-size:46px;line-height:1.2}
.xsj-dexbar{border:1px solid rgba(201,162,74,.55);border-radius:10px;padding:8px 11px 9px;background:rgba(0,0,0,.25);margin-bottom:8px}
.xsj-dexbar>div{display:flex;justify-content:space-between;font-size:12px}.xsj-dexbar span{color:#f3d98b;font-weight:700;font-family:monospace}
.xsj-dexcats{display:flex;gap:6px;overflow-x:auto;margin-bottom:8px;scrollbar-width:none}
#${ROOT_ID} .xsj-dexcats button{flex:none;padding:3px 10px!important;border-radius:6px;border:1px solid #5d4f8a!important;font-size:12px;color:#cfc6ea!important}
#${ROOT_ID} .xsj-dexcats button.on{background:#f3d98b!important;color:#1d1834!important;border-color:#f3d98b!important;font-weight:700}
.xsj-dexgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
#${ROOT_ID} .xsj-slot{position:relative;height:0;padding:0 0 132%!important;border-radius:8px;overflow:hidden;background:linear-gradient(160deg,#2e2654,#191530)!important;border:2px solid var(--r,#3a3458)!important;box-shadow:inset 0 0 14px rgba(0,0,0,.55),0 0 8px -2px var(--r,transparent)}
.xsj-slot>img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.xsj-slot-e,.xsj-slot>.xsj-slot-q{position:absolute;top:44%;left:50%;transform:translate(-50%,-50%);font-size:34px;line-height:1}
.xsj-slot-q{font-weight:800;color:#4b4475;font-family:Georgia,serif}
.xsj-slot>em{position:absolute;top:3px;left:3px;font-style:normal;font-size:9px;font-family:monospace;color:#f3d98b;background:rgba(0,0,0,.6);padding:0 4px;border-radius:3px;z-index:1}
.xsj-slot>i{position:absolute;top:3px;right:4px;font-style:normal;font-size:8px;letter-spacing:-1px;color:var(--r);text-shadow:0 0 3px #000,0 0 2px #000;z-index:1}
.xsj-slot>small{position:absolute;left:0;right:0;bottom:0;padding:12px 3px 4px;font-size:10.5px;text-align:center;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.82));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:1}
#${ROOT_ID} .xsj-slot.is-locked{border-color:#332d50!important;box-shadow:inset 0 0 14px rgba(0,0,0,.55)}
.xsj-slot.is-locked>small{color:#6d6698;background:none}
.xsj-slot.is-new::after{content:'NEW';position:absolute;top:16px;right:0;padding:0 4px;font-size:8px;font-weight:800;color:#1d1834;background:#f3d98b;border-radius:3px 0 0 3px;z-index:1}
.xsj-dextools,.xsj-dexacts{display:flex;flex-wrap:wrap;gap:7px;justify-content:center;margin-top:12px}
#${ROOT_ID} .xsj-dexbtn{border:1px solid rgba(201,162,74,.7)!important;border-radius:6px;padding:6px 12px!important;font-size:12px;color:#f3d98b!important;background:rgba(0,0,0,.28)!important;margin-top:6px}
#${ROOT_ID} .xsj-dexacts .xsj-dexbtn{margin-top:0}
#${ROOT_ID} .xsj-dexdel{color:#e58b8b!important;border-color:rgba(229,139,139,.5)!important}
.xsj-dexnav{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
#${ROOT_ID} .xsj-dexnav button{color:#f3d98b!important;font-size:13px;padding:2px 6px!important}
.xsj-dexcard{border:2px solid var(--r,#3a3458);border-radius:12px;background:rgba(0,0,0,.3);padding:10px;box-shadow:0 0 22px -6px var(--r,transparent)}
.xsj-dexart{position:relative;height:0;padding-bottom:120%;border-radius:8px;overflow:hidden;background:linear-gradient(160deg,#2e2654,#191530);border:1px solid rgba(243,217,139,.3)}
.xsj-dexart>img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.xsj-dexart>.xsj-dexart-e,.xsj-dexart>.xsj-slot-q{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:84px;line-height:1}
.xsj-dexart.is-drawing{height:auto;padding:0}.xsj-dexart.is-drawing .xsj-drawing{margin:0;border:0}
.xsj-dexname{text-align:center;margin:9px 0 6px}
.xsj-dexname em{font-style:normal;font-family:monospace;font-size:11px;color:#f3d98b;opacity:.85}
.xsj-dexname b{display:block;font-size:19px;letter-spacing:2px;font-family:"Songti SC","STSong","SimSun",serif}
.xsj-dexname small{font-size:11.5px;opacity:.8}.xsj-dexname small i{font-style:normal}
.xsj-dexattrs{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin:8px 0}
.xsj-dexattrs>div{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:4px 8px;font-size:12px;line-height:1.45}
.xsj-dexattrs span{display:block;font-size:10px;color:#f3d98b;opacity:.8}
.xsj-dexdesc{font-size:13px;line-height:1.75;margin:8px 2px}
.xsj-dexflavor{font-size:12.5px;font-style:italic;color:#d9cfae;border-left:2px solid #c9a24a;padding:2px 9px;margin:8px 2px}
.xsj-dexfound{font-size:10.5px;opacity:.55;text-align:right;margin-top:4px}
.xsj-dexplaces{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:8px;font-size:11px}
.xsj-dexplaces>span{opacity:.6;margin-right:2px}
#${ROOT_ID} .xsj-dexplaces button{padding:3px 9px!important;border-radius:999px;font-size:11.5px;background:rgba(243,217,139,.12)!important;border:1px solid rgba(243,217,139,.45)!important;color:#f3d98b!important}
.xsj-dexlinks{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 4px}
#${ROOT_ID} .xsj-dexlinks button{padding:4px 10px!important;border-radius:8px;font-size:12px;color:#efe7cf!important;background:linear-gradient(145deg,#3a2f63,#1d1834)!important;border:1px solid var(--r,#8a7440)!important;box-shadow:0 0 6px -2px var(--r,transparent)}

/* ---------- 🌿 百科 ---------- */
#${ROOT_ID} .xsj-wikirow{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 10px!important;margin-bottom:6px;border-radius:14px;background:rgba(255,255,255,.55)!important;border:1px solid rgba(255,255,255,.6)!important;box-shadow:0 2px 8px rgba(60,90,60,.08)}
#${ROOT_ID} .xsj-wikirow>i{width:40px;height:40px;flex:none;border-radius:12px;background:linear-gradient(145deg,#dff3da,#b9e0b2);display:flex;align-items:center;justify-content:center;font-style:normal;font-size:22px}
#${ROOT_ID} .xsj-wikirow>img{width:40px;height:40px;flex:none;border-radius:12px;object-fit:cover}
#${ROOT_ID} .xsj-wikirow>span{flex:1;min-width:0}.xsj-wikirow b{display:block;font-size:13.5px}
.xsj-wikirow small{display:block;font-size:11px;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xsj-wikirow>em{flex:none;font-style:normal;font-size:10px;padding:1px 7px;border-radius:8px;background:#e3f3df;color:#3f8a52}
.xsj-wikisum{font-size:12.5px;color:#3f8a52;margin:2px 0 6px}
.xsj-wikisteps{margin:8px 0 4px;padding-left:20px;font-size:13px;line-height:1.7}
.xsj-wikitip{margin-top:8px;font-size:12.5px;background:rgba(255,236,170,.45);border-radius:10px;padding:6px 10px}
#${ROOT_ID} .tone-dark :is(.xsj-wikirow){background:rgba(255,255,255,.08)!important;border-color:rgba(255,255,255,.1)!important}

/* ---------- 📜 手记（皮革底 + 羊皮纸） ---------- */
#${ROOT_ID} .xsj-phone .xsj-screen.app-log{background:radial-gradient(120% 60% at 50% 0%,#6b4a2c 0%,transparent 65%),linear-gradient(180deg,#4a3220,#2b1d12)!important;color:#f3e3c0}
#${ROOT_ID} .xsj-screen.app-log::before{display:none}
#${ROOT_ID} .app-log :is(.xsj-status,.xsj-head,.xsj-hint){text-shadow:none!important;color:#f3e3c0}
#${ROOT_ID} .app-log .xsj-head b{font-family:"Kaiti SC","STKaiti","KaiTi",serif;letter-spacing:3px}
#${ROOT_ID} .app-log :is(.xsj-busy,.xsj-ask){background:rgba(43,29,18,.88)!important;color:#f3e3c0}
#${ROOT_ID} .app-log .xsj-ask-card{background:#f3e3c0!important;color:#4a3520;border:0!important}
#${ROOT_ID} .xsj-logadd{display:block;width:100%;margin-bottom:12px;padding:9px!important;border-radius:10px;border:1px dashed rgba(243,227,192,.55)!important;color:#f3e3c0!important;font-size:13px}
.xsj-loghint{line-height:1.7}
.xsj-scroll{position:relative;margin:0 2px 14px;padding:14px 14px 10px;color:#4a3520;font-family:"Kaiti SC","STKaiti","KaiTi",serif;background:radial-gradient(130% 90% at 50% 50%,#f6e8c8 55%,#e2c891 100%);border-radius:3px 10px 4px 12px;box-shadow:inset 0 0 26px rgba(120,80,30,.35),0 6px 14px rgba(0,0,0,.4)}
.xsj-scroll-h{display:flex;justify-content:space-between;font-size:11.5px;opacity:.7;border-bottom:1px solid rgba(110,70,30,.3);padding-bottom:4px;margin-bottom:6px}
.xsj-scroll>b{display:block;font-size:16px;margin-bottom:4px}
.xsj-scroll>p{margin:0;font-size:14px;line-height:1.85;white-space:pre-wrap}
.xsj-scroll>img{display:block;width:100%;margin:10px 0 2px;border-radius:4px;filter:sepia(.55) saturate(.85) contrast(.95);mix-blend-mode:multiply;opacity:.92}
#${ROOT_ID} .xsj-scroll .xsj-drawing{color:#4a3520;background:rgba(110,70,30,.08);border-color:rgba(110,70,30,.35)}
.xsj-scroll-a{display:flex;justify-content:flex-end;gap:10px;margin-top:8px}
#${ROOT_ID} .xsj-scroll-a button{font-size:11.5px;opacity:.6;padding:0!important;font-family:inherit}
.xsj-scroll-a{flex-wrap:wrap;align-items:center}.xsj-relicat{margin-right:auto;font-size:10.5px;opacity:.5}
/* 💘 你的梦男：白底社区帖子流 */
.xsj-dm-search{display:flex;align-items:center;gap:8px;margin:2px 0 8px;padding:8px 14px;border-radius:999px;background:#f2f2f4;font-size:14px}
.xsj-dm-search b{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xsj-dm-search small{font-size:11px;opacity:.5;flex:none}
.xsj-dm-post{padding:12px 4px;border-bottom:1px solid rgba(0,0,0,.07);cursor:pointer}
.xsj-dm-post.is-full{cursor:default;border-bottom:0}
.xsj-dm-top{display:flex;align-items:center;gap:8px}
.xsj-dm-top>div{flex:1;min-width:0;line-height:1.3}
.xsj-dm-top b{display:block;font-size:13.5px}.xsj-dm-top small{font-size:11px;opacity:.5}
.xsj-dm-top em{flex:none;font-style:normal;font-size:10.5px;padding:1px 8px;border-radius:999px;background:#ffe3ef;color:#c2457e}
.xsj-dm-av{width:34px;height:34px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;font-style:normal;font-size:16px;color:#fff}
.xsj-dm-text{margin:6px 0 2px 42px;font-size:14px;line-height:1.65;white-space:pre-wrap;word-break:break-word}
.xsj-dm-post.is-full .xsj-dm-text{margin-left:0;font-size:15.5px}
.xsj-dm-tags{margin:2px 0 0 42px;font-size:12.5px;color:#3a6fc4}
.xsj-dm-post.is-full .xsj-dm-tags{margin-left:0}
.xsj-dm-img{display:block;width:calc(100% - 42px);margin:8px 0 0 42px;border-radius:12px}
.xsj-dm-post.is-full .xsj-dm-img{width:100%;margin-left:0}
.xsj-dm-ph{margin:8px 0 0 42px;padding:10px 12px;border-radius:12px;background:#f6f6f8;font-size:12px;opacity:.75;display:flex;align-items:center;justify-content:space-between;gap:8px}
.xsj-dm-post.is-full .xsj-dm-ph{margin-left:0}
#${ROOT_ID} .xsj-dm-ph button{flex:none;padding:3px 10px!important;border-radius:999px;background:#c2457e!important;color:#fff!important;font-size:11.5px}
.xsj-dm-stats{display:flex;gap:16px;margin:8px 0 0 42px;font-size:11.5px;opacity:.55}
.xsj-dm-post.is-full .xsj-dm-stats{margin-left:0;padding:10px 0;border-top:1px solid rgba(0,0,0,.07);border-bottom:1px solid rgba(0,0,0,.07);opacity:.7}
.xsj-dm-acts{display:flex;justify-content:flex-end;gap:16px;margin:6px 2px;font-size:12.5px}
#${ROOT_ID} .xsj-dm-acts button{padding:0!important;opacity:.7}
.xsj-dm-replyhead{font-size:12.5px;opacity:.55;margin:10px 2px 4px}
.xsj-dm-reply{display:flex;gap:10px;padding:10px 2px;border-bottom:1px solid rgba(0,0,0,.06)}
.xsj-dm-reply>div{flex:1;min-width:0}
.xsj-dm-reply .xsj-dm-av{width:30px;height:30px;font-size:13px}
.xsj-dm-rt b{font-size:13px}.xsj-dm-rt small{font-size:11px;opacity:.5;margin-left:4px}
.xsj-dm-to{display:block;font-size:11.5px;opacity:.55}.xsj-dm-to span{color:#3a6fc4}
.xsj-dm-reply .xsj-dm-text{margin:3px 0;font-size:13.5px}
.xsj-dm-rl{font-size:11px;opacity:.5}
#${ROOT_ID} .app-white.tone-dark :is(.xsj-dm-search,.xsj-dm-ph){background:#1c1c1f}
#${ROOT_ID} .app-white.tone-dark :is(.xsj-dm-post,.xsj-dm-reply,.xsj-dm-post.is-full .xsj-dm-stats){border-color:rgba(255,255,255,.1)}
/* 📇 人物图鉴 */
.xsj-np-tabs{display:flex;gap:4px;padding:3px;margin:2px 0 10px;border-radius:10px;background:rgba(107,79,158,.1)}
#${ROOT_ID} .xsj-np-tabs button{flex:1;padding:6px 0!important;border-radius:8px;font-size:13px;color:inherit!important;opacity:.6}
#${ROOT_ID} .xsj-np-tabs button.on{background:#6b4f9e!important;color:#fff!important;opacity:1;font-weight:600}
.xsj-np-sum{font-size:12px;opacity:.55;margin:0 2px 8px}
.xsj-np-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px 10px}
#${ROOT_ID} .xsj-np-card{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:2px;padding:0!important;border-radius:0;background:transparent!important;border:0!important;box-shadow:none!important;color:inherit!important;min-width:0}
#${ROOT_ID} .xsj-np-card.is-new::after{content:'NEW';position:absolute;top:4px;right:4px;font-size:9px;font-weight:700;color:#fff;background:#e0457b;border-radius:4px;padding:0 3px}
.xsj-np-card b{font-size:14px;font-weight:800;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:4px}
.xsj-np-card small{font-size:11px;opacity:.6;line-height:1.35;max-width:100%;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-align:center}
.xsj-np-card small.xsj-np-line{opacity:.8}
.xsj-np-card u{text-decoration:none;font-size:10px;opacity:.45}
.xsj-np-card .xsj-np-av{width:100%;height:auto;aspect-ratio:3/4;font-size:36px;border-radius:4px}
.xsj-np-av:has(img){background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.08)}
#${ROOT_ID} .xsj-np-card.is-locked{opacity:.6}
.xsj-np-quote{margin-top:8px;font-size:13px;text-align:center;opacity:.8}
.xsj-np-av{display:flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:12px;font-style:normal;font-size:22px;color:#fff;overflow:hidden;flex:none}
.xsj-np-av img{width:100%;height:100%;object-fit:cover;object-position:center top}
.xsj-np-av.is-locked{background:#cfc8dc;color:#fff;font-weight:700}
.xsj-np-av.is-big{width:120px;height:120px;font-size:54px;margin:4px auto 6px;border-radius:16px}
.xsj-np-detail{display:flex;flex-direction:column;align-items:center;padding:6px 2px 10px}
.xsj-np-pic{display:block;width:100%;max-height:300px;object-fit:cover;border-radius:14px;margin-bottom:8px}
.xsj-np-name{font-size:19px;margin-top:2px}
.xsj-np-role{font-size:12.5px;opacity:.65;margin-top:2px;text-align:center}
/* 档案 */
.xsj-file{position:relative;padding-top:24px;color:#443a56}
.xsj-file .tabx{position:absolute;left:14px;top:0;height:34px;padding:6px 16px 0;border-radius:12px 12px 0 0;font-size:12px;font-weight:600;letter-spacing:1px;color:#7a5fc0;background:linear-gradient(180deg,#e9e0fc,#dccff8)}
.xsj-file .paper{position:relative;padding:16px 14px 64px;border-radius:16px;background:linear-gradient(180deg,#fff,#fdfcff);box-shadow:0 0 0 3px #dccff8,2px 10px 20px -2px rgba(140,115,200,.3),inset 0 0 0 1px #fff;overflow:hidden}
.xsj-file .paper::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(180deg,transparent 0 27px,rgba(150,125,210,.055) 27px 28px);pointer-events:none}
.xsj-file .paper>*{position:relative}
.xsj-file-top{display:flex;gap:14px;align-items:flex-start}
.xsj-file-top .ph{position:relative;flex:none;width:104px;padding:5px 5px 9px;background:#fff;box-shadow:0 3px 9px rgba(90,70,140,.24),0 0 0 .5px rgba(120,100,170,.2);transform:rotate(-2deg)}
.xsj-file-top .ph>img,.xsj-file-top .ph>.xsj-np-av{display:flex;width:94px;height:125px;border-radius:2px;object-fit:cover;object-position:center top;font-size:42px}
.xsj-file-top .ph>.xsj-drawing-place{width:94px!important;height:125px!important;min-height:0!important;margin:0!important;border-radius:2px;font-size:11px;overflow:hidden}
.xsj-file-top .clip{position:absolute;left:10px;top:-13px;width:15px;height:36px;fill:none;stroke:#a993dc;stroke-width:2.600;stroke-linecap:round;filter:drop-shadow(1px 1.500px 1px rgba(70,50,120,.35))}
.xsj-file-top .id{flex:1;min-width:0}.xsj-file-top .id small{display:block;font-size:10px;letter-spacing:2px;color:#a795c9}.xsj-file-top .id>b{display:block;font-size:21px;line-height:1.25;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #e3daf6}.xsj-file-top .id p{margin:1px 0 0;padding-bottom:4px;border-bottom:1px solid #e3daf6;font-size:13px;line-height:1.4}
.xsj-file-top .xsj-np-tags{justify-content:flex-start;margin:9px 0 0}
.xsj-file blockquote{margin:14px 2px 0;padding:0 0 0 10px;border:0;border-left:3px solid #cdbaf3;font-size:13px;line-height:1.5;font-family:"Kaiti SC","STKaiti","KaiTi",serif;color:#6b5b8c}
.xsj-file h4{display:flex;align-items:center;gap:8px;margin:16px 0 2px;font-size:12px;font-weight:700;letter-spacing:3px;color:#8a6fd0}.xsj-file h4::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,#d9cdf5,transparent)}
#${ROOT_ID} .xsj-file .row{display:flex;gap:10px;align-items:flex-start;width:100%;padding:7px 2px!important;border:0!important;border-bottom:1px dashed #e0d6f5!important;border-radius:0;background:none!important;color:inherit!important;text-align:left;box-shadow:none!important}
.xsj-file .row span{flex:none;width:58px;font-size:12px;line-height:1.6;color:#9a86c4;overflow-wrap:anywhere}.xsj-file .row p{flex:1;margin:0;font-size:13px;line-height:1.55}.xsj-file .row .dim{opacity:.6}
.xsj-file .bar{height:15px;margin-top:2px;border-radius:2px;background:repeating-linear-gradient(100deg,#4d4264 0 22px,#584c72 22px 44px);transition:opacity .2s}.xsj-file button.row:active .bar{opacity:.4}
.xsj-file .note{margin-top:12px;font-size:11px;line-height:1.5;color:#a795c9}
.xsj-file .stamp{position:absolute!important;right:16px;bottom:13px;padding:5px 11px;border:2px solid #b39ae6;border-radius:7px;text-align:center;color:#a084de;transform:rotate(-9deg);opacity:.78;pointer-events:none}.xsj-file .stamp b{display:block;font-size:14px;letter-spacing:4px;margin-right:-4px}.xsj-file .stamp small{font-size:9.500px}.xsj-file .stamp.is-sealed{border-color:#d98aa6;color:#d0718f}
#${ROOT_ID} .xsj-file .xsj-nplook{margin:10px 0 0!important}
#${ROOT_ID} .tone-dark .xsj-file{color:#ece6f8}#${ROOT_ID} .tone-dark .xsj-file .tabx{background:#45395f;color:#d9cbff}#${ROOT_ID} .tone-dark .xsj-file .paper{background:#211c2d;box-shadow:0 0 0 3px #45395f,0 10px 22px rgba(0,0,0,.4)}#${ROOT_ID} .tone-dark .xsj-file-top .id :is(b,p){border-color:#453b5c}#${ROOT_ID} .tone-dark .xsj-file blockquote{color:#cfc2ea}#${ROOT_ID} .tone-dark .xsj-file .row{border-bottom-color:#453b5c!important}#${ROOT_ID} .tone-dark .xsj-file h4{color:#c3acf5}#${ROOT_ID} .tone-dark .xsj-file .bar{background:repeating-linear-gradient(100deg,#6a5c8a 0 22px,#75669a 22px 44px)}#${ROOT_ID} .tone-dark .xsj-file-top .ph{background:#efeaf8}
.xsj-np-tags{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin:4px 0 8px}.xsj-np-tags i{font-style:normal;font-size:12px;line-height:1;padding:6px 11px;border-radius:999px;color:#7a5fc0;background:radial-gradient(50% 34% at 34% 16%,rgba(255,255,255,.95),rgba(255,255,255,0) 100%),linear-gradient(180deg,#f0eafd,#e3d8fa);box-shadow:1px 3px 6px -1px rgba(160,130,220,.28),inset 0 -.8px 1px rgba(255,255,255,.8)}
#${ROOT_ID} .tone-dark .xsj-np-tags i{color:#e5dbff;background:rgba(190,165,245,.22);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22)}
.xsj-np-look{font-size:12.5px;opacity:.8;margin-top:6px;text-align:center;font-style:italic}
.xsj-np-hint{margin:10px 0;font-size:13px;opacity:.75;text-align:center}
.xsj-np-facts,.xsj-np-links{align-self:stretch;display:flex;flex-direction:column;gap:6px;margin-top:10px}
.xsj-np-links{margin-top:0}
.xsj-np-detail .xsj-sub{align-self:flex-start}
#${ROOT_ID} .xsj-np-fact,#${ROOT_ID} .xsj-np-link{display:flex;gap:10px;align-items:flex-start;text-align:left;padding:8px 10px!important;border-radius:10px;background:rgba(107,79,158,.07)!important;border:0!important;color:inherit!important;width:100%}
.xsj-np-fact span{flex:none;width:52px;font-size:11.5px;font-weight:600;color:#6b4f9e;padding-top:1px}
.xsj-np-fact p{margin:0;font-size:13px;line-height:1.5}
.xsj-np-link b{flex:none;font-size:13px}.xsj-np-link span{font-size:12.5px;opacity:.75;margin-left:auto}
#${ROOT_ID} :is(.xsj-np-fact,.xsj-np-link).is-q{background:transparent!important;border:1px dashed rgba(107,79,158,.35)!important;cursor:pointer}
#${ROOT_ID} :is(.xsj-np-fact,.xsj-np-link).is-q p,#${ROOT_ID} .xsj-np-link.is-q span{color:#6b4f9e;font-weight:700;opacity:.7}
.xsj-np-met{font-size:11px;opacity:.5;margin-top:10px}
.xsj-np-acts{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:10px}
#${ROOT_ID} .xsj-np-acts button{padding:6px 12px!important;border-radius:999px;font-size:12.5px;background:rgba(107,79,158,.1)!important;color:#6b4f9e!important;border:0!important}
#${ROOT_ID} .xsj-np-acts button.xsj-danger{color:#d0455a!important;background:rgba(208,69,90,.08)!important}
.xsj-np-web{border-radius:14px;background:rgba(107,79,158,.05);padding:4px}
.xsj-np-web svg{display:block;width:100%;height:auto}
.xsj-np-edge path{stroke:#8a72b8;stroke-width:1.4;fill:none}
.xsj-np-edge rect{fill:#fff;stroke:#b9a8d8;stroke-width:.8}
.xsj-np-edge text{font-size:9.5px;fill:#4b3672;text-anchor:middle}
.xsj-np-edge.is-q{cursor:pointer}.xsj-np-edge.is-q path{stroke-dasharray:4 4;opacity:.55}.xsj-np-edge.is-q text{font-weight:700}
.xsj-np-node{cursor:pointer}.xsj-np-node>circle{stroke:#fff;stroke-width:2}
.xsj-np-node.is-me{cursor:default}.xsj-np-node.is-me>circle{fill:#6b4f9e}
.xsj-np-ne{font-size:18px;text-anchor:middle;fill:#fff}.xsj-np-node.is-me .xsj-np-ne{font-size:13px;font-weight:700}
.xsj-np-nn{font-size:10.5px;text-anchor:middle;fill:currentColor;font-weight:600}
#${ROOT_ID} .app-white.tone-dark .xsj-np-edge rect{fill:#1c1c1f}
#${ROOT_ID} .app-white.tone-dark .xsj-np-edge text{fill:#d9cdf0}
#${ROOT_ID} .app-white.tone-dark :is(.xsj-np-fact span,.xsj-np-fact.is-q p,.xsj-np-link.is-q span){color:#b9a3e6}
#${ROOT_ID} .app-white.tone-dark .xsj-np-acts button:not(.xsj-danger){color:#cbb8ef!important}
/* 📌 委托：软木公告板 + 钉着的小纸条，点开放大 */
.xsj-board{position:relative;margin:2px 0 10px;padding:30px 10px 22px;border-radius:12px;min-height:300px;
  background-color:#c4955f;background-image:radial-gradient(rgba(90,55,20,.28) 1px,transparent 1.6px),radial-gradient(rgba(255,232,196,.22) 1px,transparent 1.6px),radial-gradient(rgba(120,70,25,.18) 2px,transparent 2.6px);
  background-size:7px 7px,11px 11px,23px 19px;background-position:0 0,3px 5px,9px 2px;
  border:9px solid #6e4524;box-shadow:inset 0 0 22px rgba(60,30,10,.5),inset 0 0 0 1px rgba(255,220,170,.15),0 8px 18px rgba(0,0,0,.22)}
.xsj-board-plate{position:absolute;top:-6px;left:50%;transform:translateX(-50%);padding:3px 18px;border-radius:4px;background:linear-gradient(#8a5a30,#5c3a1c);color:#f6e2c2;font-size:13px;font-weight:700;letter-spacing:3px;box-shadow:0 2px 4px rgba(0,0,0,.35);white-space:nowrap}
.xsj-board-tabs{display:flex;justify-content:center;gap:8px;margin:0 0 14px}
#${ROOT_ID} .xsj-board-tabs button{padding:3px 12px!important;border-radius:999px;font-size:12px;color:#fff6e6!important;background:rgba(70,40,15,.35)!important}
#${ROOT_ID} .xsj-board-tabs button.on{background:#fff6e6!important;color:#6e4524!important;font-weight:700}
.xsj-qnotes{display:grid;grid-template-columns:1fr 1fr;gap:18px 14px;padding:0 4px}
#${ROOT_ID} .xsj-qnote{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:104px;padding:16px 8px 10px!important;background:var(--paper)!important;color:#3d2a16!important;border-radius:2px 2px 8px 3px;box-shadow:2px 4px 8px rgba(50,25,5,.35);transform:rotate(var(--rot)) translateY(var(--dy));transition:transform .15s}
#${ROOT_ID} .xsj-qnote:active{transform:rotate(0deg) scale(1.05)}
#${ROOT_ID} .xsj-qnote::after{content:'';position:absolute;right:0;bottom:0;width:14px;height:14px;background:linear-gradient(135deg,rgba(0,0,0,.08) 50%,rgba(255,255,255,.35) 50%);border-radius:0 0 8px 0}
.xsj-qnote-pin,.xsj-quest-pin{position:absolute;top:-6px;left:50%;width:13px;height:13px;margin-left:-6.5px;border-radius:50%;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.75),var(--pin,#e0453a) 45%,rgba(0,0,0,.35));box-shadow:0 3px 3px rgba(0,0,0,.35)}
.xsj-qnote-e{font-size:24px;line-height:1.1}
#${ROOT_ID} .xsj-qnote b{font-size:12.5px;line-height:1.35;text-align:center;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#${ROOT_ID} .xsj-qnote small{font-size:10.5px;opacity:.6}
.xsj-qnote-urgent,.xsj-qnote-done{position:absolute;top:6px;right:6px;font-style:normal;font-size:10px;font-weight:800;padding:0 5px;border-radius:4px;color:#fff;background:#d9443a}
.xsj-qnote-done{background:none;color:#c0392b;border:1.5px solid #c0392b;transform:rotate(12deg)}
#${ROOT_ID} .xsj-qnote.is-done{opacity:.75}
.xsj-board-empty{text-align:center;color:#fff6e6;font-size:12.5px;line-height:1.8;padding:40px 16px;text-shadow:0 1px 3px rgba(60,30,10,.6)}
#${ROOT_ID} .xsj-board-gen{display:block;margin:4px auto 0;padding:7px 16px!important;border-radius:999px;font-size:12.5px;background:#6e4524!important;color:#f6e2c2!important}
/* 放大的纸条 */
.xsj-qmodal{position:absolute;top:0;right:0;bottom:0;left:0;z-index:5;display:flex;align-items:center;justify-content:center;padding:22px 18px;background:rgba(40,24,10,.5);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:xsjfade .15s ease-out}
@keyframes xsjfade{from{opacity:0}to{opacity:1}}
.xsj-quest{position:relative;width:100%;max-height:100%;overflow-y:auto;padding:22px 16px 14px;background:var(--paper,#fbf3e2);color:#3d2a16;border-radius:3px 3px 12px 5px;box-shadow:0 14px 34px rgba(0,0,0,.4),inset 0 0 22px rgba(150,100,40,.12);font-size:14px;line-height:1.7;animation:xsjpop .2s cubic-bezier(.2,1.3,.4,1)}
@keyframes xsjpop{from{transform:scale(.55) rotate(-4deg);opacity:.4}to{transform:none;opacity:1}}
.xsj-quest-pin{top:-7px;width:16px;height:16px;margin-left:-8px}
#${ROOT_ID} .xsj-quest-x{position:absolute;top:6px;right:8px;font-size:18px;padding:0 4px!important;color:#3d2a16!important;opacity:.45}
.xsj-quest-t b{display:block;font-size:16.5px;padding-right:18px}.xsj-quest-t small{font-size:11.5px;opacity:.6}
.xsj-quest>p{margin:8px 0}
.xsj-quest-meta{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;opacity:.85}
#${ROOT_ID} .xsj-quest-meta button{padding:0!important;color:#7a4a1c!important;text-decoration:underline;font-size:12px}
.xsj-quest-a{display:flex;justify-content:flex-end;align-items:center;gap:14px;margin-top:12px}
#${ROOT_ID} .xsj-quest-a button{font-size:12.5px;padding:0!important;color:#3d2a16!important;opacity:.65}
#${ROOT_ID} .xsj-quest-a .xsj-quest-ok{opacity:1;padding:5px 14px!important;border-radius:999px;background:#7a4a1c!important;color:#fbf3e2!important}
.xsj-quest.is-done .xsj-quest-t b{text-decoration:line-through;opacity:.7}
.xsj-quest-stamp{position:absolute;top:34px;right:14px;padding:2px 12px;border:2.5px solid #c0392b;border-radius:6px;color:#c0392b;font-weight:800;font-size:15px;letter-spacing:4px;transform:rotate(12deg);opacity:.8;animation:xsjstamp .25s ease-out}
@keyframes xsjstamp{from{transform:rotate(12deg) scale(2);opacity:0}to{transform:rotate(12deg) scale(1);opacity:.8}}
/* 🔮 占卜（深色神秘） */
#${ROOT_ID} .xsj-phone .xsj-screen.app-omen{background:radial-gradient(120% 60% at 50% 10%,#1f4d5e 0%,transparent 65%),linear-gradient(180deg,#0f2430,#081219)!important;color:#dceff2}
#${ROOT_ID} .xsj-screen.app-omen::before{display:none}
#${ROOT_ID} .app-omen :is(.xsj-status,.xsj-head,.xsj-hint,.xsj-sub){text-shadow:none!important;color:#dceff2}
#${ROOT_ID} .xsj-phone .xsj-screen.app-omen .xsj-head .xsj-exit{background:rgba(255,255,255,.08)!important;border:1px solid rgba(127,208,214,.4)!important;color:#7fd0d6!important;box-shadow:none!important}
#${ROOT_ID} .app-omen :is(.xsj-busy,.xsj-ask){background:rgba(8,18,25,.88)!important;color:#dceff2}
#${ROOT_ID} .app-omen .xsj-ask-card{background:#12303d!important;border:1px solid rgba(127,208,214,.4)!important;color:#dceff2}
#${ROOT_ID} .app-omen .xsj-drawing{color:#dceff2;background:rgba(127,208,214,.08);border-color:rgba(127,208,214,.35)}
#${ROOT_ID} .xsj-omen-draw{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;width:118px;height:118px;margin:14px auto 6px;border-radius:50%!important;background:radial-gradient(circle at 40% 35%,#2f7488,#0f2f3c)!important;border:1px solid rgba(127,208,214,.5)!important;color:#dceff2!important;font-size:14px;letter-spacing:2px;box-shadow:0 0 30px rgba(127,208,214,.25),inset 0 0 20px rgba(0,0,0,.4);animation:xsjglow 2.6s ease-in-out infinite alternate}
#${ROOT_ID} .xsj-omen-draw span{font-size:26px;letter-spacing:0}
#${ROOT_ID} .xsj-omen-draw:active{transform:scale(.95)}
@keyframes xsjglow{from{box-shadow:0 0 18px rgba(127,208,214,.18),inset 0 0 20px rgba(0,0,0,.4)}to{box-shadow:0 0 36px rgba(127,208,214,.38),inset 0 0 20px rgba(0,0,0,.4)}}
.xsj-omen-tip{text-align:center}
.xsj-closet-seg{display:flex;gap:6px;margin:2px 0 8px}
#${ROOT_ID} .xsj-closet-want{width:100%;box-sizing:border-box;margin:2px 0 8px;padding:6px 8px;border-radius:10px;border:1px solid rgba(196,89,138,.3);background:rgba(255,255,255,.8);color:#3d2b35;font:inherit;font-size:12.5px;resize:vertical}
#${ROOT_ID} .xsj-closet-seg button{flex:1;padding:6px 0!important;border-radius:999px!important;font-size:13px;background:rgba(255,255,255,.6)!important;color:#6b4a5a!important;border:1px solid rgba(196,89,138,.25)!important}
#${ROOT_ID} .xsj-closet-seg button.on{background:#c4598a!important;color:#fff!important;font-weight:600}
.xsj-closet-style{text-align:center;font-size:12.5px;color:#8a5a6a;margin:2px 0 8px}
.xsj-closet-cats{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:4px}
#${ROOT_ID} .xsj-closet-cats button{flex:none;padding:2px 10px!important;border-radius:999px!important;font-size:12px;background:rgba(255,255,255,.55)!important;color:#6b4a5a!important}
#${ROOT_ID} .xsj-closet-cats button.on{background:#f7c9d9!important;color:#8a2d5a!important;font-weight:600}
.xsj-closet-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.xsj-closet-item{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px 6px;border-radius:12px;background:rgba(255,255,255,.75);box-shadow:0 1px 3px rgba(80,40,60,.08);text-align:center;min-width:0}
.xsj-closet-item img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px}
.xsj-closet-e{font-size:30px;line-height:1.5}
.xsj-closet-item b{font-size:11.5px;line-height:1.35;color:#3d2b35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.xsj-closet-item small{font-size:10.5px;color:#9a7a88}
.xsj-closet-fav{position:absolute;top:4px;right:6px;font-style:normal;font-size:11px;color:#c4598a}
.xsj-closet-detail{text-align:center}
.xsj-closet-detail>img{display:block;width:100%;border-radius:10px;margin-bottom:8px}
.xsj-closet-big{font-size:52px;line-height:1.4}
.xsj-closet-detail>b{display:block;font-size:16px;margin-top:2px}
.xsj-closet-detail p{text-align:left;margin:6px 0}
.xsj-closet-tag{font-style:normal;font-size:10.5px;padding:0 5px;border-radius:6px;background:#f7c9d9;color:#8a2d5a}
.xsj-closet-when{font-size:12px;opacity:.75}
.xsj-closet-note{font-size:12.5px;color:#8a5a6a;font-family:"Kaiti SC","STKaiti","KaiTi",serif}
.xsj-closet-a{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:8px}
#${ROOT_ID} .xsj-closet-a button{font-size:12px;color:#c4598a!important;padding:0!important}
.xsj-omen{margin:10px 2px 12px;padding:12px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid color-mix(in srgb,var(--l) 55%,transparent);border:1px solid var(--l);text-align:center}
.xsj-omen-h{display:flex;justify-content:space-between;font-size:11px;opacity:.6;margin-bottom:6px}
.xsj-omen>img{display:block;width:100%;border-radius:10px;margin-bottom:8px}
.xsj-omen-sym{font-size:44px;line-height:1.3}
.xsj-omen>b{display:block;font-size:18px;letter-spacing:3px;font-family:"Songti SC","STSong","SimSun",serif}
.xsj-omen>em{display:inline-block;margin:4px 0;padding:0 10px;border-radius:999px;font-style:normal;font-size:12px;color:#081219;background:var(--l)}
.xsj-omen-v{margin:6px 0;font-size:13.5px;line-height:1.8;font-family:"Kaiti SC","STKaiti","KaiTi",serif;opacity:.95}
.xsj-omen-hint{margin:4px 0;font-size:12.5px;opacity:.8}
.xsj-omen:not(.is-big){text-align:left}.xsj-omen:not(.is-big) .xsj-omen-sym{display:none}.xsj-omen:not(.is-big)>img{max-height:120px;object-fit:cover}
.xsj-omen-a{display:flex;justify-content:center;gap:14px;margin-top:8px}
#${ROOT_ID} .xsj-omen-a button{font-size:11.5px;padding:0!important;color:#7fd0d6!important;opacity:.85}
/* 遗物书卷 */
.xsj-logmode{display:flex;gap:0;margin:0 0 12px;border:1px solid rgba(243,227,192,.45);border-radius:10px;overflow:hidden}
#${ROOT_ID} .xsj-logmode button{flex:1;padding:7px 0!important;font-size:12.5px;color:#f3e3c0!important;opacity:.6}
#${ROOT_ID} .xsj-logmode button.on{opacity:1;background:rgba(243,227,192,.18)!important;font-weight:700}
.xsj-relichead{text-align:center;margin:0 0 12px;font-family:"Kaiti SC","STKaiti","KaiTi",serif}
.xsj-relichead>b{display:block;font-size:19px;letter-spacing:2px}
.xsj-relichead>small{font-size:11.5px;opacity:.7}
.xsj-relichead>p{margin:6px 4px 8px;font-size:12.5px;line-height:1.6;opacity:.85}
.xsj-relicprog{font-size:11.5px;text-align:left}.xsj-relicprog span{opacity:.8}
.xsj-relicprog i{display:block;height:6px;border-radius:3px;background:rgba(243,227,192,.15);margin-top:5px;overflow:hidden}
.xsj-relicprog em{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#b98a4e,#f3d9a0)}
.xsj-relicvols{display:flex;gap:6px;overflow-x:auto;margin-bottom:12px;scrollbar-width:none}
#${ROOT_ID} .xsj-relicvols button{flex:none;display:flex;flex-direction:column;align-items:center;padding:5px 10px!important;border-radius:8px;border:1px solid rgba(243,227,192,.35)!important;color:#f3e3c0!important;font-family:"Kaiti SC","STKaiti","KaiTi",serif;font-size:13px;line-height:1.3}
#${ROOT_ID} .xsj-relicvols button small{font-size:10px;opacity:.6;font-family:monospace}
#${ROOT_ID} .xsj-relicvols button.on{background:#f3e3c0!important;color:#4a3520!important;border-color:#f3e3c0!important}
.xsj-scroll.is-unread{background:radial-gradient(130% 90% at 50% 50%,#e9d6ad 50%,#cfae74 100%)}
.xsj-scroll.is-unread .xsj-scroll-h span:last-child{color:#8a4b2a;font-weight:700}
.xsj-relicsym{font-style:italic;opacity:.85}
.xsj-relicuse{font-size:13px;color:#7a4a1c;margin:-2px 0 4px}
.xsj-relicsteps{margin:8px 0 4px;padding-left:20px;font-size:13.5px;line-height:1.75}
.xsj-relicherbs{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 2px}
.xsj-relicherbs>*{font-size:12px;padding:2px 9px!important;border-radius:999px;background:rgba(110,70,30,.12)!important;border:1px solid rgba(110,70,30,.25)!important;color:#4a3520!important}
.xsj-relicwhere{font-size:12px;margin-top:6px;display:flex;flex-wrap:wrap;align-items:center;gap:4px}
#${ROOT_ID} .xsj-relicwhere button{font-size:12px;padding:1px 8px!important;border-radius:999px;background:rgba(110,70,30,.12)!important;color:#4a3520!important;font-family:inherit}
.xsj-relictrace{margin-top:8px;font-size:12.5px;opacity:.75;border-left:2px solid rgba(110,70,30,.4);padding-left:8px}
.xsj-relicorig{margin-top:8px;font-size:11.5px;opacity:.65}.xsj-relicorig summary{cursor:pointer}
#${ROOT_ID} .xsj-relicbtn{display:block;margin:10px auto 0;padding:7px 16px!important;border-radius:999px;background:#7a4a1c!important;color:#f6e8c8!important;font-family:inherit}
.xsj-relic-empty>p{margin-bottom:4px}
`;
    D.head.appendChild(st);
  }

  // ---------- 启动 ----------
  injectStyle();
  close();
  makeBubble();
  try { replaceScriptButtons([{ name: BUTTON, visible: true }]); } catch (e) {}
  eventOn(getButtonEvent(BUTTON), open);
  eventOn(tavern_events.CHAT_CHANGED, () => {
    if (!syncChat()) return;
    if (D.getElementById(ROOT_ID)) { close(); open(); }
  });
  $(window).on('pagehide', () => {
    close();
    D.getElementById(BUBBLE_ID)?.remove();
    D.getElementById(STYLE_ID)?.remove();
    if (onResize) W.removeEventListener('resize', onResize);
    W.removeEventListener('resize', fitPhone);
    W.visualViewport?.removeEventListener('resize', fitPhone);
  });
})();

  // ---- 扩展自己的入口：魔棒菜单 + 扩展设置面板 + 悬浮📱开关 ----
  function applyBubble() {
    const show = extStore().ui.showBubble !== false;
    const b = document.getElementById('xsj-bubble');
    if (b) b.style.display = show ? '' : 'none';
  }
  function addMenu() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('xsj_wand')) return;
    const item = document.createElement('div');
    item.id = 'xsj_wand';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<div class="extensionsMenuExtensionButton">📱</div><span>小手机</span>';
    item.addEventListener('click', () => openPhone && openPhone());
    menu.appendChild(item);
  }
  function addPanel() {
    const host = document.getElementById('extensions_settings2');
    if (!host || document.getElementById('xsj_settings')) return;
    const wrap = document.createElement('div');
    wrap.id = 'xsj_settings';
    wrap.innerHTML = `
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header"><b>📱 小手机</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
        <div class="inline-drawer-content">
          <label class="checkbox_label"><input type="checkbox" id="xsj_show_bubble"> 显示悬浮的 📱（可以拖动）</label>
          <div class="menu_button" id="xsj_open_btn" style="margin-top:6px">打开小手机</div>
          <small>也可以从输入框左边的魔棒菜单打开。API、谁的手机在小手机的「设置」页里改，剧情日期在日历的设置里改。</small>
        </div>
      </div>`;
    host.appendChild(wrap);
    const cb = wrap.querySelector('#xsj_show_bubble');
    cb.checked = extStore().ui.showBubble !== false;
    cb.addEventListener('change', () => { extStore().ui.showBubble = cb.checked; ctx().saveSettingsDebounced(); applyBubble(); });
    wrap.querySelector('#xsj_open_btn').addEventListener('click', () => openPhone && openPhone());
  }
  addMenu();
  addPanel();
  applyBubble();
  // 酒馆界面有时比扩展晚生成，补一次
  setTimeout(() => { addMenu(); addPanel(); applyBubble(); }, 1500);
})();
