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

  // 从最近的聊天里找剧情日期：1996/11/9、2026-11-14、2026年11月14日
  function detectStoryDate() {
    try {
      const last = getLastMessageId();
      const from = Math.max(0, last - 15);
      const msgs = getChatMessages(`${from}-${last}`) || [];
      const re = /(\d{3,4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/;
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = String(msgs[i].message || '').match(re);
        if (m) {
          const y = +m[1], mo = +m[2], d = +m[3];
          if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { y, m: mo, d, from: 'chat' };
        }
      }
    } catch (e) {}
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), from: 'real' };
  }
  function storyDate() {
    const o = String(chat.dateOverride || '').match(/^(\d{3,4})-(\d{1,2})-(\d{1,2})$/);
    if (o) return { y: +o[1], m: +o[2], d: +o[3], from: 'manual' };
    return detectStoryDate();
  }
  const dateKey = (sd) => `${sd.y}-${pad(sd.m)}-${pad(sd.d)}`;
  // 世界观里的历法叫法：第一次生成日历时让 AI 起名（12 个月、7 天一周不变，只换名字）；普通世界留空就显示 11月、周三
  const calNames = () => (chat.calNames && Array.isArray(chat.calNames.months) && chat.calNames.months.length === 12 ? chat.calNames : null);
  const monthName = (m) => calNames()?.months[m - 1] || `${m}月`;
  // dow：0 = 周日（和 Date.getDay() 一样）
  const weekName = (dow) => { const w = calNames()?.weekdays; return Array.isArray(w) && w.length === 7 ? w[(dow + 6) % 7] : '周' + '日一二三四五六'[dow]; };
  const weekShort = (i) => { const w = calNames()?.weekdays; return Array.isArray(w) && w.length === 7 ? [...w[i]].slice(0, 2).join('') : '一二三四五六日'[i]; }; // i：0 = 周一
  const yearName = (y) => { const c = calNames(); return c?.era ? `${c.era}${c.yearOffset != null ? ` ${y + c.yearOffset}年` : ''}` : `${y}年`; };
  const dayLabel = (m, d) => `${monthName(m)}${d}日`;

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
    calnames: `"calnames": {"months": ["1月到12月在这个世界里的叫法，正好12个"], "weekdays": ["周一到周日的叫法，正好7个，每个2-3字"], "era": "纪年名，如“部落纪年”“天启”，没有就空字符串", "year": 故事当前这一年在这个纪年里是第几年，没有纪年就写 null}  // 按世界书来：这个世界有自己的月份、星期叫法（如“落叶月”“狩猎日”）就写出来；世界书没写就按世界观起贴切的名字。如果这个世界用的就是现实里的公历或农历（现代、普通古代），months 和 weekdays 都给空数组`,
    season: `"season": {"时令": "节气或季节名", "天气": "这个月典型的天气，一句话", "氛围": "这个月街上的气氛，一句话"}`,
    notes: `"notes": {"platform": "符合世界观的平台或栏目名（现代可以是种草App，星际可以叫星网热帖，没有网络的年代就用杂志或报纸专栏名）", "items": [{"cat": "${NOTE_CATS.join('|')}", "emoji": "一个最贴切的emoji", "title": "网友口吻的标题，不超过16字", "author": "路人网友的昵称", "likes": 点赞数字, "text": "正文80-150字，口语化，有具体的店名、品牌、地点、物件、价格或做法", "tags": ["话题1", "话题2"], "img": "封面画面，用英文 danbooru tag 写给 NovelAI 出图（食物、街景、物件、穿搭等，尽量 no humans）", "comments": [{"name": "路人昵称", "text": "评论，不超过40字", "likes": 点赞数字}]}]}  // 8-10篇。这是一个让人了解“这个世界此刻有什么”的生活平台：只依据世界观设定、年代、地区、季节与社会环境来写，不参考最近剧情，不写主要角色、{{user}}和他们的熟人，也不写他们经历过的事。题材在吃喝、穿搭、店铺品牌、地方去处、节庆习俗、流行文化、新科技或新玩意、社会新闻、职业圈子之间分散，应季的东西写成帖子；每篇都要有能拿来丰富剧情的具体东西（一家店、一样物件、一个去处、一种说法）。评论每篇3-4条，全是路人，口吻各不相同`,
    schedule: `"schedule": [{"date": "YYYY-MM-DD", "time": "HH:MM-HH:MM 或 全天", "title": "事项", "place": "地点", "type": "${TYPES.join('|')}"}]  // 覆盖整个月，15-30条；按此人的职业和身份安排工作，周末和节假日轻一些；剧情里已经约定的事要排进去；节日本身不要放进日程`,
    holidays: `"holidays": [{"date": "YYYY-MM-DD", "end": "YYYY-MM-DD，只有假期填，其余填空字符串", "kind": "节日|假期", "name": "不超过6个字"}]  // 本月的节日与假期。规则：年月和历法优先用世界书设定，没有就按现实日历；节日只写正日：现实背景用当地真实的节日，架空背景用世界书里的节庆，世界书没有就按世界观设计1-3个；假期单独一条写清起止（法定长假、寒暑假、世界书里的放假安排），节日附带的假期从正日起算；普通周末不用写；生日和个人纪念日不放这里；没有就给空数组`,
    birthdays: `"birthdays": [{"who": "人名", "date": "MM-DD", "kind": "生日|纪念日", "note": "手机主人对这天的态度或打算，10字左右"}]  // 每年固定的日子：{{char}}、{{user}}和重要配角的生日，以及两人或家人之间的纪念日。只写角色卡、人设、世界书或正文里明确写了日期的，没写明日期的一律不要编；没有就给空数组`,
    cart: `"cart": [{"emoji": "一个emoji", "name": "商品名", "price": "价格，用这个世界的货币", "note": "手机主人随手写的一句备注，10字左右"}]  // 6-8件，手机主人购物车里的东西：符合身份、经济状况、年代与季节；可以有一两件是给别人准备的`,
    events: `"events": [{"title": "事件", "desc": "不超过40字", "date": "YYYY-MM-DD 或 空字符串", "who": "涉及的人"}]  // 6-10条本月可能发生的随机事件：工作上的小麻烦、朋友来访、偶遇、天气意外、生活琐事都可以混搭；只写起因，不写结局`,
  };

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
  async function callAI(instr, busyLabel, fullBooks = false, noChat = false) {
    let books = null;
    if (fullBooks) {
      view.busy = '正在读世界书…'; render();
      books = await openWorldbooksText();
      if (books.skipped) toast(`世界书太长，有 ${books.skipped} 条没放进去`, 'warning');
    }
    const prompts = [
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
      cfg.custom_api = { apiurl: api.url, key: api.key, model: api.model, source: 'openai', max_tokens: 6000, temperature: 0.9 };
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

  function baseInstr(y, m, worldOnly = false) {
    const sd = storyDate();
    return [
      `你在为一个虚构故事里的人物整理手机里的内容。只输出一个 JSON 对象，不要任何解释、不要代码块。`,
      `手机主人：${ownerName()}${settings.owner === 'user' ? '（{{user}}本人）' : ''}`,
      `月份：${y}年${m}月。故事当前日期：${dateKey(sd)}。`,
      calNames() ? `这个世界的历法叫法（写内容时用这些叫法）：${calNames().months.map((x, i) => `${i + 1}月=${x}`).join('，')}${calNames().weekdays.length ? `；一周七天依次叫：${calNames().weekdays.join('、')}` : ''}${calNames().era ? `；纪年：${calNames().era}` : ''}。日期字段仍然按 YYYY-MM-DD 写。` : '',
      worldOnly ? `只根据上面的世界观设定来写，符合年代、地区与社会环境，不涉及主线剧情。` : `根据上面的人物设定、世界观与最近剧情来写，符合年代、地区与身份。`,
    ];
  }
  const WORLD_ONLY_PARTS = ['season', 'notes'];

  // add：只新增——日程和节日保留现有的，只补新的
  async function generate(parts, monthKey, add = false, opts = {}) {
    if (view.busy) return;
    // 生日和纪念日只在第一次生成日历时识别一次，之后固定
    if (!chat.birthdaysDone && (parts.includes('holidays') || parts.includes('schedule')) && !parts.includes('birthdays')) parts = [...parts, 'birthdays'];
    // 月份和星期的叫法也只在第一次生成日历时起一次
    if (!chat.calNamesDone && parts.includes('schedule') && !parts.includes('calnames')) parts = [...parts, 'calnames'];
    const [y, m] = monthKey.split('-').map(Number);
    const md = monthData(monthKey);
    const keepManual = md.schedule.filter((x) => x.manual).map((x) => `${x.date} ${x.time} ${x.title}`).join('；');
    const worldOnly = parts.every((p) => WORLD_ONLY_PARTS.includes(p));
    const instr = [
      ...baseInstr(y, m, worldOnly),
      keepManual && parts.includes('schedule') ? `下面这些是主人自己记的日程，不要重复也不要冲突：${keepManual}` : '',
      add && parts.includes('schedule') && md.schedule.some((x) => !x.manual) ? `这个月已经有这些日程，全部保留；这次只补充新的，不要重复、不要冲突：${md.schedule.filter((x) => !x.manual).map((x) => `${x.date} ${x.time} ${x.title}`).join('；')}` : '',
      parts.includes('events') && opts.newNpc != null ? (opts.newNpc
        ? `随机事件里可以出现 1-2 个新的 NPC：这个世界里有名有姓、符合世界观的新面孔，在 who 里写清是谁（名字+身份，如“阿岩（采石的少年）”），其余事件照常用已有人物。`
        : `随机事件只用已有的人物（角色卡、世界书${(codex().npc?.items || []).length ? `、人物志里的：${codex().npc.items.map((p) => p.name).slice(0, 30).join('、')}` : ''}），不要编新的有名有姓的人；路人可以出现，但不起名字。`) : '',
      add && parts.includes('events') && md.events.length ? `这个月已经有这些随机事件，全部保留；这次写新的，不要重复：${md.events.map((e) => e.title).join('；')}` : '',
      add && parts.includes('notes') && notesFor(md).items.length ? `已经有这些热帖，全部保留；这次写新的，不要重复：${notesFor(md).items.map((n) => n.title).join('；')}` : '',
      add && parts.includes('cart') && md.cart.length ? `购物车里已经有：${md.cart.map((c) => c.name).join('、')}，全部保留；这次再加几件别的。` : '',
      add && parts.includes('holidays') && md.holidays.length ? `已经有这些节日和假期，不用再写：${md.holidays.map((h) => `${h.date} ${h.name}`).join('；')}` : '',
      !worldOnly && parts.includes('notes') ? `注意：notes 只依据世界观设定来写，不要用最近剧情和主要角色。` : '',
      `JSON 结构（只包含这些字段）：\n{\n  ${parts.map((p) => PART_SPEC[p]).join(',\n  ')}\n}`,
    ].filter(Boolean).join('\n');
    const data = await callAI(instr, `正在生成${monthName(m)}…`, parts.some((p) => ['birthdays', 'holidays', 'notes', 'calnames'].includes(p)), worldOnly);
    if (!data) return;
    {
      if (parts.includes('calnames') && data.calnames && typeof data.calnames === 'object') {
        const c = data.calnames;
        const ms = Array.isArray(c.months) ? c.months.map((x) => String(x || '').trim()).filter(Boolean) : [];
        const ws = Array.isArray(c.weekdays) ? c.weekdays.map((x) => String(x || '').trim()).filter(Boolean) : [];
        const yr = Number(c.year);
        chat.calNames = ms.length === 12 ? { months: ms.map((x) => x.slice(0, 6)), weekdays: ws.length === 7 ? ws.map((x) => x.slice(0, 4)) : [], era: String(c.era || '').trim().slice(0, 8), yearOffset: Number.isFinite(yr) && yr > 0 ? Math.round(yr) - y : null } : null;
        chat.calNamesDone = true;
      }
      if (parts.includes('season') && data.season && !(add && md.season)) md.season = data.season;
      if (parts.includes('notes') && data.notes && Array.isArray(data.notes.items)) {
        const oldNotes = add ? notesFor(md).items : [];
        md.notes = {
          platform: oldNotes.length && md.notes?.platform ? md.notes.platform : String(data.notes.platform || '本月热帖').trim(),
          items: data.notes.items.filter((x) => x && x.title).slice(0, 12).map((x) => ({
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
          .filter((x) => x && x.title && /^\d{3,4}-\d{1,2}-\d{1,2}$/.test(String(x.date || '').trim()))
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
          .filter((x) => x && x.name && /^\d{3,4}-\d{1,2}-\d{1,2}$/.test(String(x.date || '').trim()))
          .map((x) => {
            const [a, b, c] = String(x.date).trim().split('-').map(Number);
            const kind = x.kind === VAC ? VAC : HOL;
            const e = String(x.end || '').trim().match(/^(\d{3,4})-(\d{1,2})-(\d{1,2})$/);
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
        md.cart = [...(add ? md.cart : md.cart.filter((x) => x.bought)), ...data.cart.filter((x) => x && x.name).slice(0, 10).map((x) => ({ id: uid(), emoji: String(x.emoji || '🛍'), name: String(x.name).trim(), price: String(x.price || '').trim(), note: String(x.note || '').trim(), bought: false }))];
      }
      if (parts.includes('events') && Array.isArray(data.events)) {
        md.events = [...(add ? md.events : md.events.filter((x) => x.star)), ...data.events.filter((x) => x && x.title).map((x) => ({ id: uid(), title: String(x.title), desc: String(x.desc || ''), date: String(x.date || ''), who: String(x.who || ''), used: false, star: false }))];
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
      ...baseInstr(y, m, true),
      `下面是「${platform}」上的一篇笔记，写出它底下的评论区。`,
      `标题：${note.title}\n作者：${note.author}\n正文：${note.text}`,
      `要求：3-5条评论，全是路人网友，口吻各不相同；只依据世界观和帖子本身，不参考最近剧情，不出现主要角色、{{user}}和他们的熟人。`,
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
    const pic = await drawImage({ prompt: tags || 'no humans, aesthetic photo, soft lighting, detailed, full frame', nl: tags ? '' : `${n.title}。${n.text}`, size: 'portrait' }, label, n.id);
    if (pic) { n.pic = pic; saveChat(); render(); }
    return !!pic;
  }
  // 地点实景图：默认无人风景，按类型给一点画面方向，描述交给柏宝绘的自然语言
  const PLACE_TAGS = { 家: 'apartment interior, cozy room, window light', 学校: 'school building, campus, hallway', 公司: 'office building, modern interior', 店铺: 'shop storefront, display window', 餐饮: 'cafe interior, restaurant, warm lighting', 景点: 'scenic view, landmark', 交通: 'train station, platform', 医院: 'hospital building, clean corridor', 机构: 'building exterior, entrance', 其他: 'street scene, city' };
  async function drawPlacePic(p, label) {
    const key = charKey();
    const pic = await drawImage({
      prompt: `no humans, scenery, ${PLACE_TAGS[p.type] || PLACE_TAGS['其他']}, detailed background, atmospheric lighting, full frame`,
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
  function cancelGen() {
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
  async function drawImage({ prompt, nl = '', size = 'portrait' }, label, inlineId = null) {
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
      const text = `${label}（${IMG_PHASE[p.phase] || p.phase}${p.attempt ? ` ${p.attempt}/${p.max}` : ''}）`;
      if (inlineId) {
        if (!view.drawing) return;
        view.drawing.label = text;
        // 只改那一行字，不重画整页
        D.getElementById(ROOT_ID)?.querySelectorAll('[data-drawlabel]').forEach((el) => { el.textContent = text; });
      } else if (view.busy) { view.busy = text; render(); }
    };
    try {
      const r = await api.generate(
        { prompt: String(prompt || '').trim() || 'scenery', nl: String(nl || '').trim(), size, save: true, character: charKey() },
        { signal: imgAbort.signal, onProgress: progress },
      );
      return r.path || r.dataUrl || '';
    } catch (e) {
      if (e?.code !== 'aborted') toast(e?.code === 'rate_limited' ? '被 NovelAI 限流了，稍后再试' : `出图失败：${e?.message || e}`, 'error');
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
      return { label: `事件 ·「${e.title}」`, text: [`最近可能发生的一件事：${e.title}`, e.desc, [e.date, e.who].filter(Boolean).join(' · ')].filter(Boolean).join('\n') };
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
    if (kind === 'relic') {
      const R = codex().log.relic;
      const p = R?.pages.find((o) => o.id === id); if (!p) return null;
      const where = `${R.owner ? R.owner + '留下的' : ''}「${R.name}」第${p.vol}卷${R.vols?.[p.vol - 1] ? `（${R.vols[p.vol - 1].name}）` : ''}第${p.no}页`;
      const truth = `「${p.title}」——${p.use}${p.recipe?.length ? `；做法：${p.recipe.join('，')}` : ''}${p.herbs?.length ? `；用到：${p.herbs.join('、')}` : ''}${p.where ? `；材料采自${p.where}` : ''}`;
      if (!p.read) {
        return {
          label: `${R.short} · 第${p.vol}卷第${p.no}页（未解读）`,
          text: `${where}，现在还没人读懂。\n页上画的：${p.sym}\n【只给你看的底】这一页实际记的是${truth}。如果剧情里有人在看这一页，让懂行的角色按自己的见识一点点读出来：可以读错、只读懂一半，不要一下子全部点破，也不要提到“底”。`,
        };
      }
      return { label: `${R.short} ·「${p.title}」`, text: `${where}，已经读懂：${truth}。${p.trace ? `\n页上还留着：${p.trace}` : ''}` };
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
    if (kind === 'quest') {
      const q = codex().quest.items.find((o) => o.id === id); if (!q) return null;
      return {
        label: `${appTitle('quest')} ·「${q.title}」`,
        text: `${q.giver ? `${q.giver}发出` : '有人发出'}的一条委托（剧情钩子）：${q.title}\n${q.desc}${q.where ? `\n地点：${q.where}` : ''}${q.reward ? `\n报酬：${q.reward}` : ''}${q.status === 'done' ? '\n这条委托已经完成了。' : '\n可以让委托人或旁人自然地提起；接不接、怎么做，交给剧情和角色自己决定。'}`,
      };
    }
    if (kind === 'omen') {
      const o = codex().omen.items.find((x) => x.id === id); if (!o) return null;
      return {
        label: `${appTitle('omen')} ·「${o.sign}」`,
        text: `${ownerName()}最近占的一卦（${o.method}）：${o.sign}（${o.luck}）\n${o.verse ? `判词：${o.verse}\n` : ''}暗示：${o.hint}\n不用让它明显应验；可以让它在剧情里轻轻出现、被人误读，或者干脆落空。`,
      };
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
        text: [`人物：${p.name}${p.role ? `（${p.role}）` : ''}${p.look ? `；${p.look}` : ''}`,
          knownF.length || knownL.length ? `{{user}}已经知道的：${[...knownF.map((f) => `${f.k}：${f.v}`), ...knownL.map((l) => `和${other(l)}：${l.label}`)].join('；')}` : '',
          hidF.length || hidL.length ? `【只给你看的底，{{user}}还不知道】${[...hidF.map((f) => `${f.k}：${f.v}`), ...hidL.map((l) => `和${other(l)}：${l.label}`)].join('；')}` : '',
          `写这个人时照着上面来，尤其「不会」的事不能让 ta 突然会、「擅长」以外的判断要谨慎。{{user}}还不知道的部分可以慢慢露出线索，不要一下子说破，也不要提到“底”。`].filter(Boolean).join('\n'),
      };
    }
    if (kind === 'log') {
      const e = codex().log.items.find((o) => o.id === id); if (!e) return null;
      return { label: `${appTitle('log')} ·「${e.title}」`, text: `${ownerName()}在${appTitle('log')}上写下的一页（${e.date}）：\n${e.title}\n${e.text}` };
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
  // 遗物书卷：AI 回复里说出了某页的药方名或关键词，这页就算读懂了
  function autoDecipher(text) {
    const pages = codex().log.relic?.pages || [];
    const plain = String(text || '').replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '').replace(/<[^>]+>/g, ' ');
    const hits = pages.filter((p) => !p.read && [p.title, ...(p.keys || [])].some((k) => txt(k).length >= 2 && plain.includes(k)));
    if (!hits.length) return [];
    for (const p of hits) readRelicPage(p, '剧情里读懂');
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
        const pages = autoDecipher(m.mes);
        const spots = autoRevealFog(m.mes);
        const wlds = autoRevealWorld(m.mes);
        if (wlds.length) try { W.toastr?.success?.(wlds.map((x) => `${esc(x.emoji || '🗺')} ${esc(x.name)}`).join('<br>'), '🌍 世界地图上点亮了', { escapeHtml: false, timeOut: 6000 }); } catch (e) {}
        if (wlds.length && D.getElementById(ROOT_ID)) render();
        const ppl = autoNpc(m.mes);
        if (ppl.met.length || ppl.facts.length) try { W.toastr?.success?.([...ppl.met.map((p) => `认识了 ${esc(p.emoji)} ${esc(p.name)}`), ...ppl.facts.map((s) => `知道了${esc(s)}`)].join('<br>'), `📇 ${esc(appTitle('npc'))}`, { escapeHtml: false, timeOut: 7000 }); } catch (e) {}
        if (spots.length) try { W.toastr?.success?.(spots.map((p) => `${esc(p.emoji)} ${esc(p.name)}`).join('<br>'), '🗺 发现新地点', { escapeHtml: false, timeOut: 6000 }); } catch (e) {}
        if (!hits.length && !pages.length) { if ((spots.length || ppl.met.length || ppl.facts.length) && D.getElementById(ROOT_ID)) render(); return; }
        const r = (x) => rar(x.rarity);
        try {
          if (hits.length) W.toastr?.success?.(hits.map((x) => `${esc(x.emoji)} ${esc(x.name)}　${'★'.repeat(rarN(x.rarity))} ${r(x).n}`).join('<br>'), `✦ ${esc(appTitle('dex'))}新发现`, { escapeHtml: false, timeOut: 6000 });
          if (pages.length) W.toastr?.success?.(pages.map((p) => `第${p.vol}卷 · ${esc(p.title)}`).join('<br>'), `📜 ${esc(codex().log.relic?.short || '遗物')}读懂了${pages.length > 1 ? ` ${pages.length} 页` : '一页'}`, { escapeHtml: false, timeOut: 7000 });
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
      const y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
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
      const label = i === 0 ? '今天' : i === 1 ? '明天' : `${dayLabel(m, dd)} ${weekName(d.getDay())}`;
      lines.push(`${label}：${parts.join('；')}`);
    }
    if (!lines.length) return '';
    return [`[${ownerName()} 接下来一周的安排（今天是 ${dayLabel(sd.m, sd.d)} ${weekName(start.getDay())}）]`, ...lines,
      '只在剧情自然走到相关的时间、地点或人物时参考，不要主动念日程，也不要反复提醒。'].join('\n');
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
  function askRegen(name, n, unit, resetNote = '现在的内容和画好的图都会删掉') {
    return new Promise((resolve) => {
      const box = D.createElement('div');
      box.className = 'xsj-ask';
      box.innerHTML = `<div class="xsj-ask-card xsj-regen-card"><div>「${esc(name)}」里已经有 ${n} ${esc(unit)}，这次要怎么生成？</div>
        <button data-v="add" class="xsj-primary">保留现在的，只新增</button>
        <button data-v="reset" class="xsj-regen-reset">全部重新生成<small>${esc(resetNote)}</small></button>
        <button data-v="" class="xsj-regen-cancel">取消</button></div>`;
      box.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; box.remove(); resolve(b.dataset.v || null); });
      D.getElementById(ROOT_ID)?.querySelector('.xsj-screen')?.appendChild(box);
    });
  }
  // 刷新蓝星online 前问：保留还是重来（有帖子时），以及这一批是梦向还是一般向
  function askDream(n) {
    return new Promise((resolve) => {
      let mode = 'add', dir = settings.dreamDir === 'general' ? 'general' : 'dream';
      const box = D.createElement('div');
      box.className = 'xsj-ask';
      const seg = (name, opts, cur) => `<div class="xsj-seg" data-seg="${name}">${opts.map(([v, label]) => `<button data-sv="${v}" class="${cur === v ? 'on' : ''}">${label}</button>`).join('')}</div>`;
      const draw = () => {
        box.innerHTML = `<div class="xsj-ask-card xsj-regen-card"><div>刷新蓝星online</div>
          ${n ? `<small class="xsj-seg-h">现在有 ${n} 条</small>${seg('mode', [['add', '保留，只新增'], ['reset', '全部重新生成']], mode)}` : ''}
          <small class="xsj-seg-h">这一批看什么</small>${seg('dir', [['dream', '💘 梦向'], ['general', '🎮 一般向']], dir)}
          <small class="xsj-seg-tip">${dir === 'dream' ? '把你当老婆、最宝贵的人：想你、吃醋、约稿、做周边、为你抽卡' : '普通玩家视角：聊剧情、考据、嗑 CP、吐槽官方、抽卡'}</small>
          <button data-go class="xsj-primary">刷新</button><button data-cancel class="xsj-regen-cancel">取消</button></div>`;
      };
      draw();
      box.addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        const sg = b.closest('[data-seg]');
        if (sg) { if (sg.dataset.seg === 'mode') mode = b.dataset.sv; else dir = b.dataset.sv; draw(); return; }
        box.remove();
        if (b.hasAttribute('data-go')) { settings.dreamDir = dir; saveSettings(settings); resolve({ add: mode === 'add', dir }); } else resolve(null);
      });
      D.getElementById(ROOT_ID)?.querySelector('.xsj-screen')?.appendChild(box);
    });
  }
  // 生成随机事件前问两件事：保留现在的还是全部重来（已有事件时才问），以及要不要出现新 NPC
  function askEvents(n) {
    return new Promise((resolve) => {
      let mode = 'add', npc = !!settings.evNewNpc;
      const box = D.createElement('div');
      box.className = 'xsj-ask';
      const seg = (name, opts, cur) => `<div class="xsj-seg" data-seg="${name}">${opts.map(([v, label]) => `<button data-sv="${v}" class="${String(cur) === v ? 'on' : ''}">${label}</button>`).join('')}</div>`;
      const draw = () => {
        box.innerHTML = `<div class="xsj-ask-card xsj-regen-card"><div>生成随机事件</div>
          ${n ? `<small class="xsj-seg-h">现在有 ${n} 条</small>${seg('mode', [['add', '保留，只新增'], ['reset', '全部重新生成']], mode)}${mode === 'reset' ? '<small class="xsj-seg-tip">★ 收藏的会留着</small>' : ''}` : ''}
          <small class="xsj-seg-h">新 NPC</small>${seg('npc', [['false', '只用已有的人'], ['true', '可以出现新面孔']], npc)}
          <small class="xsj-seg-tip">${npc ? '会编 1-2 个新的、有名有姓的人，写清是谁' : '只用角色卡、世界书和人物志里已有的人'}</small>
          <button data-go class="xsj-primary">生成</button><button data-cancel class="xsj-regen-cancel">取消</button></div>`;
      };
      draw();
      box.addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        const sg = b.closest('[data-seg]');
        if (sg) { if (sg.dataset.seg === 'mode') mode = b.dataset.sv; else npc = b.dataset.sv === 'true'; draw(); return; }
        box.remove();
        if (b.hasAttribute('data-go')) { settings.evNewNpc = npc; saveSettings(settings); resolve({ add: mode === 'add', npc }); } else resolve(null);
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
    'gen-log': { k: 'log', unit: '页', n: () => codex().log.items.length, get: () => codex().log.items, set: (v) => { codex().log.items = v; } },
    'gen-relic': { k: 'log', unit: '页', n: () => codex().log.relic?.pages?.length || 0, get: () => codex().log.relic || null, set: (v) => { codex().log.relic = v; } },
    'gen-quest': { k: 'quest', unit: '条委托', n: () => codex().quest.items.length, get: () => codex().quest.items, set: (v) => { codex().quest.items = v; view.questOpen = null; } },
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
    if (!R || !R.n()) return { go: true };
    const name = act === 'gen-relic' ? (codex().log.relic?.name || '遗物书卷') : appTitle(R.k);
    const v = await askRegen(name, R.n(), R.unit);
    if (!v) return { go: false };
    if (v === 'add') return { go: true };
    const snap = R.get();
    R.set(act === 'gen-dex' || act === 'gen-wiki' || act === 'gen-log' || act === 'gen-quest' || act === 'gen-dream' ? [] : null);
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

  function calView() {
    const [y, m] = view.month.split('-').map(Number);
    const md = monthData(view.month);
    const first = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
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
    const lead = (first + 6) % 7; // 周一开头
    for (let i = 0; i < lead; i++) cells += '<div></div>';
    for (let d = 1; d <= days; d++) {
      const weekend = (lead + d - 1) % 7 >= 5;
      const k = `${y}-${pad(m)}-${pad(d)}`;
      const dots = (byDay[k] || []).slice(0, 3).map((x) => `<i style="background:${TYPE_COLOR[x.type] || '#999'}"></i>`).join('');
      const hs = holByDay[k] || [], bs = bdByDay[k] || [];
      const labels = [
        ...bs.map((b) => `<small class="xsj-hol xsj-bd">${b.kind === '纪念日' ? '💝' : '🎂'}${esc(b.who)}</small>`),
        ...hs.filter((h) => h.first).map((h) => `<small class="xsj-hol${h.kind === VAC ? ' xsj-vac' : ''}">${esc(h.name)}</small>`),
      ].slice(0, 2).join('');
      const cls = [k === today && 'is-today', k === view.day && 'is-sel', weekend && 'is-wkd', hs.some((h) => h.kind !== VAC) && 'has-hol', hs.some((h) => h.kind === VAC) && 'is-off', bs.length && 'has-bd'].filter(Boolean).join(' ');
      cells += `<button class="xsj-day ${cls}" data-day="${k}"><span>${d}</span>${labels}<b>${dots}</b></button>`;
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
    const form = ed ? `
      <div class="xsj-form">
        ${fields}
        <div class="xsj-chips">${[...TYPES, HOL, VAC, ...FIXED].map((t) => `<button data-type="${t}" class="${ed.type === t ? 'on' : ''}" style="--c:${TYPE_COLOR[t]}">${t}</button>`).join('')}</div>
        <div class="xsj-row2">${ed.id ? '<button data-act="del-item" class="xsj-danger">删除</button>' : '<span></span>'}<span><button data-act="cancel-edit">取消</button><button data-act="save-item" class="xsj-primary">保存</button></span></div>
      </div>` : '';
    const empty = !md.schedule.length ? `<div class="xsj-empty">这个月还没有日程<br><button data-act="gen" data-parts="schedule,holidays" class="xsj-primary">🗓 生成${monthName(m)}日程和节日</button><div class="xsj-hint">想一次生成所有页面，去「设置」</div></div>` : '';
    const selDate = view.day ? new Date(+view.day.slice(0, 4), +view.day.split('-')[1] - 1, +view.day.split('-')[2]) : null;
    const wk = selDate ? weekName(selDate.getDay()) : '';
    const items = list.map((it) => `<button class="xsj-item" data-item="${it.id}"><i style="background:${TYPE_COLOR[it.type] || '#999'}"></i><span class="xsj-time">${esc(it.time || '—')}</span><span class="xsj-title">${esc(it.title)}${it.place ? `<small>${esc(it.place)}</small>` : ''}</span><em>${esc(it.type)}${it.manual ? ' · 自记' : ''}</em></button>`).join('');
    return `
      <div class="xsj-cal">
        <div class="xsj-calnav"><button data-act="prev">‹ 上月</button><b>${yearName(y)} ${monthName(m)}</b><button data-act="next">下月 ›</button></div>
        <div class="xsj-week">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<span${i >= 5 ? ' class="is-wkd"' : ''}>${esc(weekShort(i))}</span>`).join('')}</div>
        <div class="xsj-grid">${cells}</div>
      </div>
      <div class="xsj-daycard">
      <div class="xsj-dayhead"><span>${view.day ? `<b class="xsj-dbig">${+view.day.split('-')[2]}</b><span class="xsj-dsub">${esc(monthName(+view.day.split('-')[1]))} · ${esc(wk)}</span>` : ''}${dayHols.map((h) => `<button class="xsj-holpill${h.kind === VAC ? ' xsj-vacpill' : ''}" data-hol="${h.id}">${esc(h.name)}</button>`).join('')}${dayBds.map((b) => `<button class="xsj-holpill xsj-bdpill" data-bd="${b.id}">${b.kind === '纪念日' ? '💝' : '🎂'}${esc(b.who)}</button>`).join('')}</span><button data-act="add-item" title="添加">＋</button></div>
      ${dayBds.filter((b) => b.note).map((b) => `<div class="xsj-bdnote">${b.kind === '纪念日' ? '💝' : '🎂'} ${esc(b.who)}${b.kind === '纪念日' ? '' : '生日'}：${esc(b.note)}</div>`).join('')}
      ${form}
      ${items || (md.schedule.length ? '<div class="xsj-none">这天没有安排</div>' : '')}
      </div>
      ${empty}`;
  }

  function eventsView() {
    // 随机事件不分月份显示：永远是剧情当前这个月的
    { const sd = storyDate(); view.month = ym(sd.y, sd.m); }
    const md = monthData(view.month);
    if (!md.events.length) return `<div class="xsj-empty">还没有随机事件<br><button data-act="gen" data-parts="events" class="xsj-primary">🎲 生成随机事件</button></div>`;
    return md.events.map((e) => `
      <div class="xsj-card${e.used ? ' is-used' : ''}">
        <div class="xsj-card-top"><b>${esc(e.title)}</b><span><button data-act="star" data-id="${e.id}" title="收藏，重新生成时保留">${e.star ? '★' : '☆'}</button><button data-act="used" data-id="${e.id}" title="用过了">${e.used ? '↺' : '✓'}</button><button data-act="quote" data-kind="event" data-id="${e.id}" title="附带给下一次回复">📎</button></span></div>
        <div>${esc(e.desc)}</div>
        ${e.date || e.who ? `<small>${esc([e.date, e.who].filter(Boolean).join(' · '))}</small>` : ''}
      </div>`).join('');
  }

  function monthView() {
    // 小红书不分月份显示：永远是剧情当前这个月的
    { const sd = storyDate(); view.month = ym(sd.y, sd.m); }
    const md = monthData(view.month);
    const [, m] = view.month.split('-').map(Number);
    const nb = notesFor(md);
    if (!md.season && !nb.items.length) return `<div class="xsj-empty">还没有季节和热帖<br><button data-act="gen" data-parts="season,notes" class="xsj-primary">📕 生成小红书</button></div>`;
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
      <div class="xsj-flow">${cards}</div>` : `<div class="xsj-none">还没有热帖</div>`}`;
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
    if (!xl || !xl.items?.length) return `<div class="xsj-empty">还没偷看过 ${who} 的 X<br><button data-act="gen-x" class="xsj-primary">𝕏 看看浏览记录</button><div class="xsj-hint">按最近剧情生成 ${who} 私下刷 X 的记录，偏成人向。内容默认打码，点一下才显示。</div></div>`;
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
        ${(xl.searches || []).map((s) => `<div class="xsj-xsrow">${XI.clock}<span${reveal ? '' : ' class="is-blur"'}>${esc(s)}</span><em>×</em></div>`).join('') || '<div class="xsj-none">没有搜索记录</div>'}
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
      <div class="xsj-xpost2">
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
        ...items.filter((x) => x && (x.text || x.media)).slice(0, 16).map((x) => ({
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
      ? n.comments.map((c) => `<div class="xsj-cmt"><i>${esc([...c.name][0] || '?')}</i><div><small>${esc(c.name)}</small><div>${esc(c.text)}</div></div><em>♡ ${fmtLikes(c.likes)}</em></div>`).join('') +
        `<button data-act="comments" class="xsj-regen">↻ 换一批评论</button>`
      : `<button data-act="comments" class="xsj-primary xsj-block">💬 看看评论区</button>`;
    return `
      <button data-act="note-back" class="xsj-back">‹ 返回</button>
      ${view.drawing?.id === n.id ? drawingBox(n.id, 'xsj-drawing-cover xsj-drawing-big') : n.pic
        ? `<img class="xsj-cover xsj-cover-big xsj-cover-img" src="${esc(n.pic)}" alt="">`
        : `<div class="xsj-cover xsj-cover-big" style="background:linear-gradient(160deg,${g1},${g2})"><span>${esc(n.emoji)}</span></div>`}
      <div class="xsj-row2 xsj-note-acts">${view.drawing?.id === n.id ? '<span></span>' : `<button class="xsj-xdraw" data-act="note-pic">${n.pic ? '↻ 重画封面' : '🖼 生成封面'}</button>`}<button class="xsj-xdraw" data-act="quote" data-kind="note" data-id="${n.id}">📎 引用到回复</button></div>
      <div class="xsj-note-f xsj-note-author"><i style="background:${g2}">${esc([...n.author][0] || '?')}</i><span>${esc(n.author)}</span><em>${esc(n.cat)}</em></div>
      <h4 class="xsj-note-h">${esc(n.title)}</h4>
      <div class="xsj-note-text">${esc(n.text)}</div>
      ${n.tags.length ? `<div class="xsj-note-tags">${n.tags.map((t) => `#${esc(String(t).replace(/^#/, ''))}`).join(' ')}</div>` : ''}
      <div class="xsj-note-stat">♡ ${fmtLikes(n.likes)}　☆ ${fmtLikes(Math.round(n.likes / 3))}</div>
      <div class="xsj-sub">评论</div>
      ${comments}`;
  }

  function settingsView() {
    const sd = detectStoryDate();
    const profs = settings.apiProfiles, act = settings.apiActive;
    const ed = view.apiEdit != null && profs[view.apiEdit] ? { ...profs[view.apiEdit], ...(view.apiDraft || {}) } : null;
    const [gy, gm] = view.month.split('-').map(Number);
    const md = monthData(view.month);
    const filled = [md.schedule.length && '日程', md.events.length && '随机', (md.season || notesFor(md).items.length) && '小红书'].filter(Boolean);
    const chips = (attr, cur, list) => `<div class="xsj-seg">${list.map(([v, t]) => `<button data-${attr}="${v}" class="${cur === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    return `
      <div class="xsj-card xsj-set">
        <div class="xsj-set-h">✨ 一次生成</div>
        <div class="xsj-genall-in">
          <div><b>${gy}年${gm}月</b><small>${filled.length ? `已有：${filled.join('、')}` : '这个月还什么都没有'}</small></div>
          <button data-act="gen" data-parts="schedule,holidays,events,season,notes" class="xsj-primary">生成全部</button>
        </div>
        <small class="xsj-set-tip">日程、节日、随机、小红书一次请求；上方 ‹ › 换月份。X 在 X 页单独刷新。</small>
      </div>

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
        <div class="xsj-set-row"><span>剧情日期</span><small>${sd.from === 'chat' ? `${sd.y}-${pad(sd.m)}-${pad(sd.d)}（聊天里认出的）` : '没认出，用现实日期'}</small></div>
        <input data-set="dateOverride" placeholder="手动指定，如 1996-11-09，留空自动" value="${esc(chat.dateOverride)}">
      </div>

      <div class="xsj-card xsj-set">
        <div class="xsj-set-h">📅 历法叫法 <small>只换名字，还是 12 个月、一周 7 天</small></div>
        ${calNames()
          ? `<div class="xsj-set-tip">${esc(calNames().era ? yearName(storyDate().y) + ' · ' : '')}${calNames().months.map((x, i) => `${i + 1}月 ${esc(x)}`).join('　')}${calNames().weekdays.length ? `<br>一周：${calNames().weekdays.map(esc).join('、')}` : ''}</div>`
          : `<small class="xsj-set-tip">${chat.calNamesDone ? '这个世界用普通的月份和星期' : '第一次生成日历时，会按世界书起一次名字'}</small>`}
        <div class="xsj-row2"><button data-act="regen-calnames" class="xsj-regen">↻ 按世界书重新起名</button>${calNames() ? '<button data-act="plain-calnames" class="xsj-regen">用普通的 11月、周三</button>' : ''}</div>
      </div>

      <div class="xsj-card xsj-set">
        <div class="xsj-set-h">🎂 生日和纪念日 <small>每年固定显示</small></div>
        ${chat.birthdays.length
          ? chat.birthdays.slice().sort((a, b) => a.md.localeCompare(b.md)).map((b) => `<div class="xsj-fixed"><span>${b.kind === '纪念日' ? '💝' : '🎂'} ${esc(b.who)}</span><em>${esc(dayLabel(+b.md.split('-')[0], +b.md.split('-')[1]))}${b.manual ? ' · 自记' : b.fromNpc ? ' · 人物志' : ''}</em></div>`).join('')
          : `<small class="xsj-set-tip">${chat.birthdaysDone ? '设定里没找到写明日期的，可以在日历点「＋」选「生日」自己加' : '第一次生成日历时会找一次，之后固定'}</small>`}
        <button data-act="regen-bd" class="xsj-regen">↻ 重新从设定里找（保留自记）</button>
      </div>

      <div class="xsj-card xsj-set">
        <div class="xsj-set-h">📅 注入本周日程</div>
        <label class="xsj-check"><input type="checkbox" data-set="weekInject" ${settings.weekInject ? 'checked' : ''}> 回复时把接下来 7 天的安排悄悄给 AI</label>
        ${(() => {
          const wt = weekText();
          if (!wt) return '<small class="xsj-set-tip">接下来 7 天还没有安排，先去「日程」生成这个月的日程。</small>';
          return `<small class="xsj-set-tip">${settings.weekInject ? '现在每次回复都会附上：' : '打开后每次回复会附上：'}（约 ${wt.length} 字，不写进聊天记录）</small><pre class="xsj-weekpre">${esc(wt)}</pre><small class="xsj-set-tip">日期不对的话，在上面「剧情日期」手动填。</small>`;
        })()}
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
      <button data-act="save-set" class="xsj-primary xsj-block">保存设置</button>
      ${lastRaw ? `<details class="xsj-raw"><summary>上次没解析成功的 AI 返回（排查用）</summary><pre>${esc(lastRaw)}</pre></details>` : ''}`;
  }

  // 右上角按钮（小红书、百科、手记、委托、蓝星online）：有能一键生图的就放 🖼，再放 ↻ 生成/刷新；生图中变成 ⏹
  function headButtons() {
    const btn = (act, icon, title, extra = '') => `<button data-act="${act}"${extra} class="xsj-exit${icon === '↻' ? '' : ' xsj-headbtn'}" title="${title}">${icon}</button>`;
    const tabs = ['mon', 'wiki', 'log', 'quest', 'dream'];
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
    if (view.tab === 'log') {
      const L = codex().log;
      if (L.mode === 'relic') {
        if (!L.relic) return '';
        const vol = Math.min(Math.max(1, view.relicVol || 1), Math.max(1, L.relic.vols?.length || 1));
        const todo = (L.relic.pages || []).filter((p) => !p.pic && (!L.relic.vols?.length || p.vol === vol));
        return (todo.length ? btn('relic-pic-all', '🖼', '把这一卷的图案画出来') : '') + btn('gen-relic', '↻', '再找出几页');
      }
      if (!L.items.length) return '';
      return (L.items.some((e) => !e.pic) ? btn('log-pic-all', '🖼', '给还没配图的几页一键生图') : '') + btn('gen-log', '↻', '记下最近发生的事');
    }
    if (view.tab === 'quest') return view.questOpen ? '' : btn('gen-quest', '↻', '看看有什么新委托');
    if (view.tab === 'dream') {
      const D0 = codex().dream;
      if (view.dream || !D0.items.length) return '';
      return (D0.items.some((p) => (p.img || p.imgDesc) && !p.pic) ? btn('dream-pic-all', '🖼', '给带图的帖子一键生图') : '') + btn('gen-dream', '↻', '刷新');
    }
    return '';
  }
  // 一键生图的通用流程：先问，再一张张画，可以中途停
  async function batchDraw(todo, fn, what) {
    if (!todo.length) return;
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
    const titles = { cal: '日程', map: '地图', ev: '随机事件', mon: '小红书', x: 'X', set: '设置', dex: appTitle('dex'), wiki: appTitle('wiki'), log: appTitle('log'), quest: appTitle('quest'), omen: appTitle('omen'), dream: appTitle('dream'), npc: appTitle('npc') };
    const body = { home: homeView, cal: calView, map: mapView, ev: eventsView, mon: monthView, x: xView, set: settingsView, dex: dexView, wiki: wikiView, log: logView, quest: questView, omen: omenView, dream: dreamView, npc: npcView }[view.tab]();
    const busy = view.busy ? `<div class="xsj-busy"><div class="xsj-spin"></div><div>${esc(view.busy)}</div><button data-act="cancel-gen">取消</button></div>` : '';
    const scr = root.querySelector('.xsj-screen');
    scr.classList.toggle('has-wp', !!settings.wallpaper);
    scr.classList.toggle('tone-dark', glassTone() === 'dark');
    // 小红书和 X 像真的 App 一样整屏实心底色，不透壁纸
    scr.classList.toggle('app-white', view.tab === 'x' || view.tab === 'mon' || view.tab === 'dream' || view.tab === 'npc');
    // 图鉴是深色游戏界面，手记是皮革底上的卷轴
    scr.classList.toggle('app-dex', view.tab === 'dex');
    scr.classList.toggle('app-log', view.tab === 'log');
    scr.classList.toggle('app-omen', view.tab === 'omen');
    if (settings.wallpaper && !settings.wpTone) measureTone();
    if (settings.wallpaper) scr.style.setProperty('--xsj-wp', `url("${settings.wallpaper.replace(/"/g, '%22')}")`);
    else scr.style.removeProperty('--xsj-wp');
    const isMap = view.tab === 'map';
    const codexTab = ['dex', 'wiki', 'log', 'quest', 'omen', 'dream', 'npc'].includes(view.tab);
    // 人物志列表：右上角一键生图、从剧情更新
    const isWorld = isMap && view.mapLevel === 'world';
    const dexHead = view.tab === 'dex' && !view.dex && codex().dex.items.length
      ? (view.batch ? '<button data-act="cancel-gen" class="xsj-exit xsj-headbtn" title="停止生图">⏹</button>'
        : (codex().dex.items.some((x) => x.found && !x.pic) ? '<button data-act="dex-pic-all" class="xsj-exit xsj-headbtn" title="给已发现、还没图的一键生图">🖼</button>' : '') + '<button data-act="gen-dex" class="xsj-exit" title="从剧情更新">↻</button>')
      : '';
    const mapHead2 = isWorld ? !!currentWorld() : isMap && currentMap() && !view.mapEdit;
    const worldHead = isWorld && currentWorld() ? (view.drawing?.id === 'world-bg' ? '' : '<button data-act="world-pics" class="xsj-exit xsj-headbtn" title="画世界地图的大背景">🖼</button>') + '<button data-act="gen-world" class="xsj-exit" title="更新世界地图">↻</button>' : '';
    const npcHead = view.tab === 'npc' && !view.npc && npcData().items.length
      ? (view.batch ? `<button data-act="cancel-gen" class="xsj-exit xsj-headbtn" title="停止生图">⏹</button>`
        : `<button data-act="npc-pic-all" class="xsj-exit xsj-headbtn" title="给见过、还没画像的人一键生图">🖼</button><button data-act="gen-npc" class="xsj-exit" title="从剧情更新人物志">↻</button>`)
      : '';
    // 日程：上月/下月挪到日历上面，右上角是一键生成
    const isCal = view.tab === 'cal';
    const isEv = view.tab === 'ev';
    const noNav = isMap || view.tab === 'x' || codexTab || isCal || isEv || view.tab === 'mon';
    const appHead = headButtons();
    const evHead = isEv ? '<button data-act="gen" data-parts="events" class="xsj-exit" title="生成随机事件">↻</button>' : '';
    const calHead = isCal ? '<button data-act="gen" data-parts="schedule,holidays" class="xsj-exit" title="一键生成本月日程和节日">↻</button>' : '';
    const sub = isMap ? `${esc(isWorld ? currentWorld()?.name || '还没有世界地图' : currentMap()?.name || '还没有地图')} · ${esc(charKey())}`
      : view.tab === 'x' ? `${esc(charKey())} 的浏览记录`
      : codexTab || isEv || view.tab === 'mon' ? esc(ownerName())
      : `${esc(yearName(y))} ${esc(monthName(m))} · ${esc(ownerName())}`;
    // 同一页重画时保持滚动位置（保存、切方案、出图进度都会重画，不要跳回最上面）
    const pageKey = [view.tab, view.month, view.note || '', view.place || '', view.xTab || '', view.dex || '', view.wiki || '', view.dream || '', view.npc || '', view.npcTab || ''].join('|');
    const oldBody = root.querySelector('.xsj-body');
    const bodyTop = oldBody && root.dataset.page === pageKey ? oldBody.scrollTop : 0;
    const prevScroll = root.querySelector('.xsj-mapwrap');
    const keep = prevScroll ? [prevScroll.scrollLeft, prevScroll.scrollTop] : null;
    root.querySelector('.xsj-screen').innerHTML = `
      ${statusBar()}
      ${home || (view.tab === 'x' && chat.xlog?.items?.length) ? '' : `<div class="xsj-head${npcHead || mapHead2 || dexHead || appHead.includes('xsj-headbtn') ? ' xsj-head2' : ''}">
        <span class="xsj-headside"><button data-act="back" class="xsj-exit" title="返回上一层">‹</button>${noNav ? '' : '<button data-act="prev" class="xsj-mnav">上月</button>'}</span>
        <div><b>${titles[view.tab]}</b><small>${sub}</small></div>
        <span class="xsj-headside xsj-headr">${npcHead || dexHead || calHead || evHead || worldHead || appHead || (noNav ? (isMap && !isWorld && currentMap() && !view.mapEdit ? (view.batch || view.drawing?.id === 'map-bg' ? '' : '<button data-act="map-pics" class="xsj-exit xsj-headbtn" title="生图：整张地图背景、区域背景、地点图">🖼</button>') + '<button data-act="gen-map" class="xsj-exit" title="重新生成地图（保留自己加的和挪过的地点）">↻</button>' : '') : '<button data-act="next" class="xsj-mnav">下月</button>')}</span>
      </div>`}
      <div class="xsj-body${isMap ? ' xsj-body-map' : ''}${view.tab === 'x' ? ' xsj-body-x' : ''}${home ? ' xsj-body-home' : ''}">${body}</div>
      ${home ? '' : '<button class="xsj-homebar" data-act="home" title="回到桌面"><i></i></button>'}
      ${questModal()}
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

  function mapView() {
    if (view.mapLevel === 'world') return worldView();
    const mp = currentMap();
    if (!mp) return `${mapSwitch()}<div class="xsj-empty">${esc(charKey())} 还没有地图<br><button data-act="gen-map" class="xsj-primary">🗺 生成地图</button><div class="xsj-hint">读打开的世界书和最近剧情，画出故事主要发生的那片地方。生成一次就固定，同一张卡的所有聊天共用。</div></div>`;
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
      <g class="xsj-pin is-fog${p.id === view.place ? ' is-sel' : ''}" data-place="${p.id}" transform="translate(${p.x} ${p.y})">
        <circle r="5.6" class="xsj-fog-cloud" />
        <circle r="4.3" class="xsj-pin-bg" />
        <text class="xsj-pin-e xsj-fog-q" y="1.5">?</text>
        <text class="xsj-pin-n" y="7.8">？？？</text>
      </g>` : `
      <g class="xsj-pin${p.id === view.place ? ' is-sel' : ''}${here && p.id === here.id ? ' is-here' : ''}" data-place="${p.id}" transform="translate(${p.x} ${p.y})">
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
      ${view.mapEdit ? '' : `<div class="xsj-maptools">${view.batch ? `<button data-act="cancel-gen">⏹ 停止生图（${view.batch}）</button>` : '<button data-act="gen-fog">🧭 打听消息</button>'}</div>`}
      ${view.mapEdit ? '<div class="xsj-hint">拖动图钉换位置；点空白处添加地点；点图钉修改。</div>' : ''}
      <div class="xsj-mapframe${mp.pic ? ' has-bg' : ''}"><div class="xsj-mapwrap"><svg class="xsj-map${view.mapEdit ? ' is-edit' : ''}" viewBox="-3 -3 106 120" style="width:${zoom * 100}%">
        <defs><clipPath id="xsj-pinclip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath><pattern id="xsj-grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#efe6dc" stroke-width=".25"/></pattern></defs>
        <rect x="-3" y="-3" width="106" height="120" fill="#fbf7f1"/>${mp.pic && view.drawing?.id !== 'map-bg' ? `<image href="${esc(mp.pic)}" x="-3" y="-3" width="106" height="120" preserveAspectRatio="xMidYMid slice" />` : '<rect x="-3" y="-3" width="106" height="120" fill="url(#xsj-grid)"/>'}
        ${view.drawing?.id === 'map-bg' ? '<text x="50" y="50" class="xsj-pin-e">⏳</text>' : ''}
        ${regions}${pins}
      </svg></div>
      <div class="xsj-mapctl"><button data-act="zoom-out" aria-label="缩小">－</button><button data-act="zoom-in" aria-label="放大">＋</button><button data-act="map-edit" class="${view.mapEdit ? 'on' : ''}">${view.mapEdit ? '✓ 完成' : '✏️ 编辑'}</button></div></div>
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
      return `${sw}<div class="xsj-empty">🌍<br>${esc(charKey())} 还没有世界地图<br><button data-act="gen-world" class="xsj-primary">🌍 生成世界地图</button><div class="xsj-hint">按世界书画出整个世界：各片大陆、王国、荒野和海。只用这个世界自己的地名，不会出现现实里的地图。去过、听说过的地方是亮的，其余盖着迷雾，剧情里说到就会点亮。</div></div>`;
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
      <g class="xsj-pin${s.known ? '' : ' is-fog'}${view.wspot === s.id ? ' is-sel' : ''}${here && here.id === s.id ? ' is-here' : ''}" data-wspot="${s.id}" transform="translate(${s.x} ${s.y})">
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
      <div class="xsj-mapframe${w.pic ? ' has-bg' : ''}"><div class="xsj-mapwrap xsj-worldwrap"><svg class="xsj-map xsj-world" viewBox="-3 -3 106 120" style="width:${zoom * 100}%">
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
  async function generateWorld(add) {
    if (view.busy) return;
    const sd = storyDate();
    const old = currentWorld();
    const knownNames = old ? [...old.lands, ...old.spots].filter((x) => x.known).map((x) => x.name) : [];
    const instr = [
      ...baseInstr(sd.y, sd.m),
      `任务：画出这个故事所在世界的世界大地图：各片大陆、国度、荒野、海岛和重要地点。`,
      `硬性规则：只用世界书和设定里这个虚构世界自己的地理和地名；禁止出现、影射或照抄任何现实世界的地图——不要用现实里的国家、城市、大洲、海洋、山脉的名字，也不要照着现实的海岸线和版图来摆。设定里没写到的地方，按世界观编虚构的名字。如果故事本身发生在现实城市里，也只画这个故事里虚构出来的世界层面（比如异世界、势力范围），实在没有就编一个贴合世界观的虚构世界。`,
      `known：主角们已经去过、住过，或者这个世界里人人都知道的地方是 true；远方的、传说里的、还没人去过的是 false，并给一句不剧透的传闻 hint（如“商队说那边的沙子夜里会唱歌”）。剧情现在所在的地方一定是 known。`,
      `坐标：整张图左上角(0,0)，右下角(100,100)，四周留出海。陆地用中心点 x、y 和大小 w、h 表示，彼此尽量不要重叠，大小有差别；地点要落在所属陆地的范围里。`,
      add && old ? `已经有这些陆地：${old.lands.map((l) => l.name).join('、')}；地点：${old.spots.map((s) => s.name).join('、')}。全部保留，不要重复，这次只补充新的陆地和地点，放在空着的海上或已有陆地上。` : '',
      knownNames.length && !add ? `这些地方{{user}}已经去过或知道，名字保持一致、known 为 true：${knownNames.join('、')}` : '',
      `JSON 结构：{"name": "世界名", "lands": [{"name": "陆地或国度名", "terrain": "${Object.keys(TERRAINS).join('|')}", "x": 数字, "y": 数字, "w": 数字, "h": 数字, "desc": "一句话", "known": true, "hint": "没去过时的传闻，去过的留空"}], "spots": [{"name": "地点名", "emoji": "一个emoji", "land": "所属陆地名", "x": 数字, "y": 数字, "desc": "一句话", "known": false, "hint": "传闻"}]}  // ${add ? '新增 2-4 块陆地、4-10 个地点' : '5-9 块陆地，12-24 个地点'}`,
    ].filter(Boolean).join('\n');
    const data = await callAI(instr, add ? '正在打听更远的地方…' : '正在画世界地图…', true, false);
    if (!data) return;
    const num = (v, d) => { const n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : d; };
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const bool = (v) => v === true || v === 'true';
    const lands = (Array.isArray(data.lands) ? data.lands : []).filter((l) => l && txt(l.name)).slice(0, 14).map((l) => {
      const w0 = clamp(num(l.w, 24), 8, 60), h0 = clamp(num(l.h, 20), 8, 60);
      return { id: uid(), name: txt(l.name).slice(0, 20), terrain: TERRAINS[txt(l.terrain)] ? txt(l.terrain) : '平原', x: clamp(num(l.x, 50), w0 / 2 + 2, 98 - w0 / 2), y: clamp(num(l.y, 50), h0 / 2 + 2, 98 - h0 / 2), w: w0, h: h0, desc: txt(l.desc), known: bool(l.known), hint: txt(l.hint) };
    });
    const spots = (Array.isArray(data.spots) ? data.spots : []).filter((s) => s && txt(s.name)).slice(0, 40).map((s) => ({
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
      prompt: 'no humans, scenery, fantasy world, aerial view, from above, satellite view, vast landscape, continents, ocean, clouds, detailed, no text',
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
    for (const p of codex().log.relic?.pages || []) if (p.read && p.where && !onMap(p.where)) clues.push(`${codex().log.relic.short}·${p.title}：材料采自${p.where}`);
    const instr = [
      ...baseInstr(sd.y, sd.m),
      `任务：地图「${mp.name}」上已经有这些地方：${mp.places.map((p) => `${p.name}${p.region ? `（${p.region}）` : ''}`).join('、')}。给出 3-5 个这个世界里确实存在、但主角们还没去过的地方，作为“听说过、没去过”的传闻。`,
      clues.length ? `优先补上这些线索里提到、地图上却没有的地方：\n${clues.slice(0, 12).join('\n')}` : '',
      `规则：符合世界书设定和年代；不要和已有地点重名，也不要换个说法重复；要有让人想去的理由（资源、危险、秘密、人情）。`,
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
    for (const x of list.slice(0, 6)) {
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
      prompt: 'no humans, scenery, aerial view, from above, wide shot, detailed background, atmospheric lighting, full frame',
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
      prompt: 'no humans, scenery, aerial view, from above, bird\'s-eye view, wide landscape, whole area, detailed background, atmospheric lighting, full frame',
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

  async function generateMap(add = false) {
    if (view.busy) return;
    const sd = storyDate();
    const old = currentMap();
    // 只新增：所有地点和区域都留着，只补新的；重新画：只留自己加的、挪过的、迷雾地点
    const keep = old ? (add ? old.places : old.places.filter((p) => p.manual || p.moved || p.fog || p.revealed)) : [];
    const instr = [
      ...baseInstr(sd.y, sd.m),
      `任务：画出故事主要发生的那片地方的简易地图（通常是一座城市或一个片区；如果世界很大，只画主线所在的城市）。`,
      `规则：地点优先来自世界书、角色卡和剧情里出现过的；可以补充少量符合世界观的日常地点（车站、便利店、医院等）。主要角色的住处、工作或学习的地方要有。区域之间尽量不重叠，地点坐标落在所属区域的方框里，彼此至少隔6个单位。`,
      keep.length ? `下面这些地点已经由用户放好，保留它们，不要重复：${keep.map((p) => p.name).join('、')}` : '',
      add && old ? `这次只补充：地图上已有这些区域，保持不变：${old.regions.map((r) => `${r.name}(${r.x},${r.y},${r.w},${r.h})`).join('、')}；在这些区域里或空白处补 4-10 个新地点，可以加 0-2 个新区域（不要和已有区域重叠）。` : '',
      `坐标系：左上角(0,0)，右下角(100,100)。`,
      `JSON 结构：{"map": {"name": "地图名（城市或片区名）", "regions": [{"name": "区域名", "x": 数字, "y": 数字, "w": 宽, "h": 高, "desc": "一句话说明"}], "places": [{"name": "地点名", "emoji": "一个emoji", "type": "${PLACE_TYPES.join('|')}", "region": "所属区域名", "x": 数字, "y": 数字, "desc": "这里是什么，20-40字", "vibe": "氛围，一句话", "people": "常来这里的人，可以是故事里的人"}]}}  // 4-8个区域，12-25个地点`,
    ].filter(Boolean).join('\n');
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
    const places = placeArr.filter(isPlace).filter((p) => !names.has(String(pick(p, 'name', '名称', '地点', '名字')).trim())).slice(0, 30).map((p) => {
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
    { k: 'ev', i: '🎲', t: '随机', c: ['#ffd59e', '#f0a04b'] },
    { k: 'mon', i: '📕', t: '小红书', c: ['#ff8a8a', '#ff2e4d'] },
    { k: 'x', i: '𝕏', t: 'X', c: ['#4a4a4a', '#000000'] },
    { k: 'dex', i: '📖', t: '图鉴', c: ['#6a58a8', '#2c2350'] },
    { k: 'wiki', i: '🌿', t: '百科', c: ['#a8e0a0', '#4fa565'] },
    { k: 'log', i: '📜', t: '手记', c: ['#ecd3a2', '#b07f42'] },
    { k: 'quest', i: '📌', t: '委托', c: ['#e6c49a', '#9a6531'] },
    { k: 'omen', i: '🔮', t: '占卜', c: ['#7fd0d6', '#23506b'] },
    { k: 'dream', i: '🌏', t: '蓝星online', c: ['#8fd3ff', '#2f6fd6'] },
    { k: 'npc', i: '📇', t: '人物志', c: ['#c9b6e8', '#6b4f9e'] },
    { k: 'set', i: '⚙', t: '设置', c: ['#dcdce4', '#9a9aa8'] },
  ];
  // 桌面上的顺序：长按图标进入整理模式后拖动，存在设置里（同一台设备所有聊天共用）
  function appOrder() {
    const keys = APPS.map((a) => a.k);
    const saved = Array.isArray(settings.appOrder) ? settings.appOrder.filter((k) => keys.includes(k)) : [];
    return [...new Set([...saved, ...keys])].map((k) => APPS.find((a) => a.k === k));
  }
  // 图鉴 / 百科 / 手记：名字跟着世界观变（兽人世界里手记就叫兽皮卷），存在这串聊天里
  const APP_DEFAULT = { dex: '图鉴', wiki: '生活百科', log: '手记', quest: '委托', omen: '占卜', dream: '蓝星online', npc: '人物志' };
  function codex() {
    if (!chat.codex || typeof chat.codex !== 'object') chat.codex = {};
    for (const k of ['dex', 'wiki', 'log', 'quest', 'omen', 'dream', 'npc']) {
      const v = chat.codex[k];
      if (!v || typeof v !== 'object' || !Array.isArray(v.items)) chat.codex[k] = { title: '', items: [] };
    }
    return chat.codex;
  }
  function appTitle(k) {
    if (k === 'log' && codex().log.mode === 'relic' && codex().log.relic?.short) return codex().log.relic.short;
    if (APP_DEFAULT[k]) return codex()[k].title || APP_DEFAULT[k];
    return (APPS.find((a) => a.k === k) || {}).t || k;
  }
  function appIcon(a) {
    const fresh = a.k === 'dex' || a.k === 'npc' ? codex()[a.k].items.filter((x) => x.isNew).length : 0;
    return `<button class="xsj-app" data-tab="${a.k}"><i style="background:linear-gradient(145deg,${a.c[0]},${a.c[1]})">${a.i}</i>${fresh ? `<b class="xsj-badge">${fresh}</b>` : ''}<span>${esc(appTitle(a.k))}</span></button>`;
  }
  function homeView() {
    const sd = storyDate();
    const wd = weekName(new Date(sd.y, sd.m - 1, sd.d).getDay());
    const dex = codex().dex.items;
    const found = dex.filter((x) => x.found).length;
    return `${view.arrange ? '<button data-act="arrange-done" class="xsj-arrange-done">完成</button>' : ''}
      <div class="xsj-home-clock"><b>${esc(dayLabel(sd.m, sd.d))}</b><small>${esc(wd)} · ${esc(ownerName())}</small></div>
      <div class="xsj-appgrid${view.arrange ? ' is-arrange' : ''}">${appOrder().map((a) => appIcon(a)).join('')}</div>
      ${view.arrange ? '<div class="xsj-hint xsj-arrange-hint">拖动图标换位置，点「完成」或空白处结束</div>' : ''}
      ${dex.length && !view.arrange ? `<button class="xsj-widget" data-tab="dex"><span>📖 ${esc(appTitle('dex'))}</span><b>${found} / ${dex.length}</b><i><em style="width:${Math.round((found / dex.length) * 100)}%"></em></i></button>` : ''}`;
  }

  // 长按图标 0.45 秒进入整理模式（图标抖动），手指不松开就能直接拖；整理模式下按住即拖
  let appDrag = null; // { el, ghost, grid, timer, sx, sy, ox, oy, scale, live }
  let swallowClick = false;
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
    // 一层层往回：先关掉打开的详情/编辑，都关了才回桌面
    if (view.tab === 'quest' && view.questOpen) view.questOpen = null;
    else if (view.tab === 'dream' && view.dream) view.dream = null;
    else if (view.tab === 'dex' && view.dex) view.dex = null;
    else if (view.tab === 'wiki' && view.wiki) view.wiki = null;
    else if (view.tab === 'npc' && view.npc) view.npc = null;
    else if (view.tab === 'mon' && view.note) view.note = null;
    else if (view.tab === 'cal' && view.editing) view.editing = null;
    else if (view.tab === 'map' && view.mapEdit) { view.mapEdit = false; view.place = null; }
    else if (view.tab === 'map' && (view.place || view.region)) { view.place = null; view.region = null; }
    else { view.tab = 'home'; view.region = null; view.editing = null; view.note = null; view.place = null; view.mapEdit = false; view.dex = null; view.wiki = null; view.questOpen = null; view.dream = null; view.npc = null; }
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
    if (order.join() !== appOrder().map((a) => a.k).join()) { settings.appOrder = order; saveSettings(settings); }
    // 松手后再重画，补上「完成」按钮和提示（等这次松手带出的 click 过去）
    setTimeout(() => { if (view.tab === 'home') render(); }, 0);
  }

  // ---------- 📖 图鉴：像 RPG 游戏里那样，编号格子，遇到过的点亮，没遇到的是问号 ----------
  const RARITY = [null, { n: '普通', c: '#a3aab5' }, { n: '少见', c: '#5cc27e' }, { n: '稀有', c: '#4aa0f5' }, { n: '珍稀', c: '#b276f5' }, { n: '传说', c: '#f3c34a' }];
  const rarN = (r) => Math.min(5, Math.max(1, Math.round(Number(r) || 1)));
  const rar = (r) => RARITY[rarN(r)];
  const pad3 = (n) => String(n || 0).padStart(3, '0');
  const txt = (s) => String(s ?? '').trim();
  const DEX_ENTRY = `{"name": "名称", "emoji": "一个emoji", "cat": "分类，2-3字，如 野兽|植物|矿石|器物|食材|魔物", "rarity": 1到5的稀有度, "attrs": [{"k": "栖息地", "v": "不超过10字"}, {"k": "习性", "v": "不超过10字"}, {"k": "用途", "v": "不超过10字"}, {"k": "危险度", "v": "低|中|高"}], "desc": "图鉴说明，40-80字，客观、像游戏图鉴", "flavor": "这个世界里的人对它的一句说法或俗语，不超过25字", "where": "在剧情里哪里遇到的，10字以内", "img": "画它的英文 danbooru tag：主体外观、姿态与所处环境，不画人物"}`;
  function dexInfo(x) {
    return {
      emoji: txt(x.emoji) || '❔', cat: txt(x.cat) || '其他', rarity: rarN(x.rarity),
      attrs: Array.isArray(x.attrs) ? x.attrs.filter((a) => a && txt(a.k) && txt(a.v)).slice(0, 5).map((a) => ({ k: txt(a.k), v: txt(a.v) })) : [],
      desc: txt(x.desc), flavor: txt(x.flavor).replace(/^[“"「]|[”"」]$/g, ''), img: txt(x.img),
    };
  }
  // 图鉴 ↔ 地图：按「在哪遇到」和栖息地/产地这类属性，对上地图里的地点名（纯本地，不调 API）
  const WHERE_KEYS = /栖息|产地|生长|分布|出没|地点|来源|产自|发现/;
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
    const d = codex().dex;
    if (!d.items.length) {
      return `<div class="xsj-empty xsj-dex-empty"><div class="xsj-dex-big">📖</div>${esc(appTitle('dex'))}还是空的<br><button data-act="gen-dex" class="xsj-dexbtn">✦ 从剧情里收集</button><div class="xsj-hint">读世界书和最近剧情：剧情里遇到过的生物、植物、物件会点亮；世界里有、但还没遇到的先锁着，只给一句线索。</div></div>`;
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
    const nav = `<div class="xsj-dexnav"><button data-act="dex-back">‹ 返回</button><span><button data-act="dex-step" data-n="-1">◀</button><button data-act="dex-step" data-n="1">▶</button></span></div>`;
    if (!x.found) {
      return `${nav}<div class="xsj-dexcard is-locked"><div class="xsj-dexart"><span class="xsj-slot-q">?</span></div>
        <div class="xsj-dexname"><em>No.${pad3(x.no)}</em><b>？？？</b><small>${esc(x.cat)}</small></div>
        <div class="xsj-dexflavor">🔒 线索：${esc(x.hint || '尚未遇见')}</div>
        <div class="xsj-dexacts"><button data-act="dex-unlock" class="xsj-dexbtn">已经遇到了，解锁</button></div></div>`;
    }
    const r = rar(x.rarity);
    const drawing = view.drawing?.id === x.id;
    const art = drawing ? drawingBox(x.id, 'xsj-drawing-big') : x.pic ? `<img src="${esc(x.pic)}" alt="">` : `<span class="xsj-dexart-e">${esc(x.emoji)}</span>`;
    const n = rarN(x.rarity);
    return `${nav}<div class="xsj-dexcard" style="--r:${r.c}">
      <div class="xsj-dexart${drawing ? ' is-drawing' : ''}">${art}</div>
      <div class="xsj-dexname"><em>No.${pad3(x.no)}</em><b>${esc(x.name)}</b><small>${esc(x.emoji)} ${esc(x.cat)} · <i style="color:${r.c}">${'★'.repeat(n)}${'☆'.repeat(5 - n)} ${r.n}</i></small></div>
      ${x.attrs?.length ? `<div class="xsj-dexattrs">${x.attrs.map((a) => `<div><span>${esc(a.k)}</span>${esc(a.v)}</div>`).join('')}</div>` : ''}
      ${x.desc ? `<div class="xsj-dexdesc">${esc(x.desc)}</div>` : ''}
      ${x.flavor ? `<div class="xsj-dexflavor">“${esc(x.flavor)}”</div>` : ''}
      ${x.foundAt || x.foundNote ? `<div class="xsj-dexfound">首次发现 · ${esc([x.foundAt, x.foundNote].filter(Boolean).join(' · '))}</div>` : ''}
      ${(() => { const ps = placesForDex(x); return ps.length ? `<div class="xsj-dexplaces"><span>在地图上</span>${ps.map((p) => `<button data-goplace="${p.id}">📍 ${esc(p.name)}</button>`).join('')}</div>` : ''; })()}
      <div class="xsj-dexacts">
        ${x.desc ? '' : '<button data-act="dex-fill" class="xsj-dexbtn">✦ 补全说明</button>'}
        ${drawing ? '' : `<button data-act="dex-pic" class="xsj-dexbtn">${x.pic ? '↻ 重画' : '🖼 画出来'}</button>`}
        <button data-act="quote" data-kind="dex" data-id="${x.id}" class="xsj-dexbtn">📎 附带</button>
        <button data-act="dex-del" class="xsj-dexbtn xsj-dexdel">删除</button>
      </div></div>`;
  }
  async function generateDex() {
    if (view.busy) return;
    const d = codex().dex;
    const sd = storyDate();
    const known = d.items.map((x) => `${x.name}（${x.found ? '已发现' : '未发现'}）`).join('、');
    const instr = [
      ...baseInstr(sd.y, sd.m),
      `任务：为这个世界做一本像 RPG 游戏里那样的图鉴，收录故事世界里的生物、植物、矿石、器物、食材等，按世界观来定（奇幻可以有魔物和灵草，原始部落是野兽和草药，现代可以是街头的猫狗、招牌甜点、城市里的花）。不收录主要角色、{{user}}和有名有姓的人。`,
      `found：最近剧情里真实出现、被看到或用到过的（3-10个）；locked：世界书或世界观里有、但剧情里还没遇到的（4-10个），只给一句不剧透的线索。`,
      known ? `图鉴里已经有：${known}。已有的不要重复收录；如果某个“未发现”的这次在剧情里出现了，把它放进 found，名字保持一致。` : '',
      `title：符合世界观的图鉴名字，2-6字（如“部落百兽谱”“灵兽图录”“城市生物志”）。`,
      `JSON 结构：{"title": "图鉴名", "found": [${DEX_ENTRY}], "locked": [{"name": "名称", "emoji": "一个emoji", "cat": "分类", "rarity": 1到5, "hint": "不剧透的线索，20字以内"}]}  // attrs 3-4条，键名按物种换成合适的（器物可以写 材质、产地、用途、价值）`,
    ].filter(Boolean).join('\n');
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
    if (txt(data.title)) d.title = txt(data.title).slice(0, 10);
    saveChat();
    toast(added + unlocked + locked ? `新收录 ${added}，解锁 ${unlocked}，待发现 ${locked}` : '这次没有新东西', added + unlocked ? 'success' : 'info');
    render();
  }
  // 手动解锁、或者老条目没有说明时：单独补全一条
  async function fillDex(x) {
    if (view.busy) return;
    const sd = storyDate();
    const instr = [
      ...baseInstr(sd.y, sd.m),
      `为${appTitle('dex')}补全一条：「${x.name}」（${x.cat}）。依据世界书、人物设定与最近剧情来写；名字保持不变。`,
      `JSON 结构：${DEX_ENTRY}`,
    ].join('\n');
    const data = await callAI(instr, `正在补全「${x.name}」…`, true, false);
    if (!data) return;
    const info = dexInfo(data.entry || data);
    Object.assign(x, info, { emoji: info.emoji === '❔' ? x.emoji : info.emoji });
    if (!x.foundNote) x.foundNote = txt((data.entry || data).where);
    saveChat();
    render();
  }
  async function drawDexPic(x, label) {
    const tags = cleanTags(x.img);
    const pic = await drawImage({
      prompt: `${tags || 'no humans'}, solo focus, detailed background, atmospheric lighting, full frame`,
      nl: tags ? '' : [x.name, x.desc].filter(Boolean).join('。'),
      size: 'portrait',
    }, label, x.id);
    if (pic) { x.pic = pic; saveChat(); render(); }
    return !!pic;
  }

  // ---------- 🌿 生活百科：在这个世界怎么过日子 ----------
  function wikiView() {
    const w = codex().wiki;
    if (!w.items.length) {
      return `<div class="xsj-empty">🌿<br>${esc(appTitle('wiki'))}还是空的<br><button data-act="gen-wiki" class="xsj-primary">✦ 编写百科</button><div class="xsj-hint">读世界书和最近剧情，写给刚来到这个世界的人：吃什么、用什么、怎么做、有什么规矩。</div></div>`;
    }
    const sel = w.items.find((x) => x.id === view.wiki);
    if (sel) {
      const drawing = view.drawing?.id === sel.id;
      return `<button data-act="wiki-back" class="xsj-back">‹ 返回</button>
        <div class="xsj-card xsj-wikid">
          ${drawing ? drawingBox(sel.id, 'xsj-drawing-place') : sel.pic ? `<img class="xsj-place-pic" src="${esc(sel.pic)}" alt="">` : ''}
          <div class="xsj-place-top"><span class="xsj-place-e">${esc(sel.emoji)}</span><div><b>${esc(sel.title)}</b><small>${esc(sel.cat)}</small></div><button data-act="quote" data-kind="wiki" data-id="${sel.id}" class="xsj-x" title="附带给下一次回复">📎</button></div>
          ${sel.summary ? `<div class="xsj-wikisum">${esc(sel.summary)}</div>` : ''}
          ${sel.body ? `<div class="xsj-note-text">${esc(sel.body)}</div>` : ''}
          ${sel.steps?.length ? `<ol class="xsj-wikisteps">${sel.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
          ${sel.tip ? `<div class="xsj-wikitip">💡 ${esc(sel.tip)}</div>` : ''}
          <div class="xsj-row2" style="margin-top:8px"><button data-act="wiki-del" class="xsj-danger">删除</button>${drawing ? '' : `<button data-act="wiki-pic" class="xsj-xdraw">${sel.pic ? '↻ 重画' : '🖼 配图'}</button>`}</div>
        </div>`;
    }
    const cats = ['全部', ...new Set(w.items.map((x) => x.cat).filter(Boolean))];
    if (!cats.includes(view.wikiCat)) view.wikiCat = '全部';
    const list = w.items.filter((x) => view.wikiCat === '全部' || x.cat === view.wikiCat);
    return `${cats.length > 2 ? `<div class="xsj-cats">${cats.map((c) => `<button data-wikicat="${esc(c)}" class="${c === view.wikiCat ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>` : ''}
      ${list.map((x) => `<button class="xsj-wikirow" data-wiki="${x.id}">${x.pic ? `<img src="${esc(x.pic)}" alt="">` : `<i>${esc(x.emoji)}</i>`}<span><b>${esc(x.title)}</b><small>${esc(x.summary)}</small></span><em>${esc(x.cat)}</em></button>`).join('')}`;
  }
  async function generateWiki() {
    if (view.busy) return;
    const w = codex().wiki;
    const sd = storyDate();
    const instr = [
      ...baseInstr(sd.y, sd.m),
      `任务：写这个世界的生活百科，写给一个刚来到这里、什么都不懂的人：吃什么、怎么弄到、用什么工具、怎么做、有什么规矩和禁忌、怎么应付天气和危险、当地人的习俗和说法。优先写世界书和剧情里出现过的东西，每条都要具体、能照着做。`,
      w.items.length ? `已经写过：${w.items.map((x) => x.title).join('、')}。不要重复，写新的。` : '',
      w.title ? `百科名已经定为「${w.title}」，沿用。` : `title：符合世界观的百科名字，2-8字（如“部落生存指南”“修真日用杂记”“城市生活手册”）。`,
      `JSON 结构：{"title": "百科名", "items": [{"cat": "分类，2字，如 饮食|工具|技能|习俗|禁忌|医药|天气|出行，按世界观换", "emoji": "一个emoji", "title": "条目名，不超过12字", "summary": "一句话说明，20字以内", "body": "正文60-120字", "steps": ["做法步骤，每步不超过25字，不需要步骤就给空数组"], "tip": "一句当地人才知道的窍门，可为空", "img": "画这条讲的东西本身的英文 danbooru tag，不画人物"}]}  // 6-10条，分类分散`,
    ].filter(Boolean).join('\n');
    const data = await callAI(instr, `正在编写${appTitle('wiki')}…`, true, false);
    if (!data) return;
    const items = (Array.isArray(data.items) ? data.items : []).filter((x) => x && txt(x.title) && !w.items.some((o) => o.title === txt(x.title)));
    w.items.push(...items.slice(0, 12).map((x) => ({
      id: uid(), cat: txt(x.cat) || '其他', emoji: txt(x.emoji) || '📄', title: txt(x.title), summary: txt(x.summary), body: txt(x.body),
      steps: Array.isArray(x.steps) ? x.steps.map(txt).filter(Boolean).slice(0, 8) : [], tip: txt(x.tip), img: txt(x.img), pic: '',
    })));
    if (!w.title && txt(data.title)) w.title = txt(data.title).slice(0, 10);
    saveChat();
    toast(items.length ? `加了 ${items.length} 条` : '这次没有新条目', items.length ? 'success' : 'info');
    render();
  }
  async function drawWikiPic(x, label) {
    const tags = cleanTags(x.img);
    const pic = await drawImage({ prompt: `no humans, ${tags || 'still life'}, detailed background, atmospheric lighting, full frame`, nl: tags ? '' : `${x.title}。${x.body}`, size: 'landscape' }, label, x.id);
    if (pic) { x.pic = pic; saveChat(); render(); }
    return !!pic;
  }

  // ---------- 📜 手记：手机主人第一人称记下最近发生的事（兽人世界里就是兽皮卷） ----------
  // 手记有两种：随身手记（主人第一人称记事）和遗物书卷（设定里前人留下的书，比如亡母留下的药方卷），按聊天记住
  function logView() {
    const L = codex().log;
    const relic = L.mode === 'relic';
    const sw = `<div class="xsj-logmode"><button data-logmode="diary" class="${relic ? '' : 'on'}">✎ 随身手记</button><button data-logmode="relic" class="${relic ? 'on' : ''}">📜 遗物书卷</button></div>`;
    return sw + (relic ? relicView() : diaryView());
  }

  // ---------- 📜 遗物书卷：一页页解读前人留下的书（内容先由 AI 写好藏着，读懂了才显示） ----------
  function relicPages() { return codex().log.relic?.pages || []; }
  function relicView() {
    const R = codex().log.relic;
    if (!R) {
      return `<div class="xsj-scroll xsj-relic-empty"><b>还没有找到遗物</b><p>从世界书和人物设定里，找出前人留下的那件书卷：比如亡母留下的药方兽皮卷、师父的手札、祖传的图谱。没有文字的世界会照设定写成图画和符号，一页页慢慢读懂。</p><button data-act="gen-relic" class="xsj-relicbtn">✦ 从设定里找出这件遗物</button></div>`;
    }
    const pages = R.pages;
    const read = pages.filter((p) => p.read).length;
    const vols = R.vols?.length ? R.vols : [{ name: '全部' }];
    const vol = Math.min(Math.max(1, view.relicVol || 1), vols.length);
    const list = R.vols?.length ? pages.filter((p) => p.vol === vol) : pages;
    return `<div class="xsj-relichead">
        <b>${esc(R.name)}</b>
        ${R.owner ? `<small>${esc(R.owner)} 留下</small>` : ''}
        ${R.desc ? `<p>${esc(R.desc)}</p>` : ''}
        <div class="xsj-relicprog"><span>已解读 ${read} / ${pages.length}</span><i><em style="width:${pages.length ? Math.round((read / pages.length) * 100) : 0}%"></em></i></div>
      </div>
      ${vols.length > 1 ? `<div class="xsj-relicvols">${vols.map((v, i) => {
        const n = pages.filter((p) => p.vol === i + 1);
        return `<button data-relicvol="${i + 1}" class="${i + 1 === vol ? 'on' : ''}">${esc(v.name)}<small>${n.filter((p) => p.read).length}/${n.length}</small></button>`;
      }).join('')}</div>` : ''}
      ${list.map(relicPage).join('') || '<div class="xsj-hint xsj-loghint">这一卷还没有页。</div>'}
`;
  }
  function relicPage(p) {
    const drawing = view.drawing?.id === p.id;
    const art = drawing ? drawingBox(p.id, 'xsj-drawing-place') : p.pic ? `<img src="${esc(p.pic)}" alt="">` : '';
    const acts = (more) => `<div class="xsj-scroll-a">${more}<button data-act="quote" data-kind="relic" data-id="${p.id}">📎 带进剧情</button>${drawing ? '' : `<button data-act="relic-pic" data-id="${p.id}">${p.pic ? '↻ 重画' : '🖌 画图案'}</button>`}</div>`;
    if (!p.read) {
      return `<div class="xsj-scroll is-unread">
        <div class="xsj-scroll-h"><span>第 ${p.no} 页</span><span>未解读</span></div>
        <p class="xsj-relicsym">${esc(p.sym)}</p>
        ${art}
        ${acts(`<button data-act="relic-read" data-id="${p.id}">🔍 直接读懂</button>`)}
      </div>`;
    }
    const dex = codex().dex.items;
    const herb = (h) => {
      const x = dex.find((o) => o.found && o.name === h);
      return x ? `<button data-godex="${x.id}">${esc(x.emoji)} ${esc(h)}</button>` : `<span>${esc(h)}</span>`;
    };
    const mp = currentMap();
    const places = mp && p.where ? mp.places.filter((pl) => nameHit(pl.name, p.where)) : [];
    return `<div class="xsj-scroll">
      <div class="xsj-scroll-h"><span>第 ${p.no} 页</span><span>${esc(p.readHow || '已解读')}</span></div>
      <b>${esc(p.title)}</b>
      ${p.use ? `<div class="xsj-relicuse">${esc(p.use)}</div>` : ''}
      ${art}
      ${p.recipe?.length ? `<ol class="xsj-relicsteps">${p.recipe.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
      ${p.herbs?.length ? `<div class="xsj-relicherbs">${p.herbs.map(herb).join('')}</div>` : ''}
      ${p.where ? `<div class="xsj-relicwhere">采自：${places.length ? places.map((pl) => `<button data-goplace="${pl.id}">📍 ${esc(pl.name)}</button>`).join('') : esc(p.where)}</div>` : ''}
      ${p.trace ? `<div class="xsj-relictrace">${esc(p.trace)}</div>` : ''}
      <details class="xsj-relicorig"><summary>原来的图画</summary>${esc(p.sym)}</details>
      ${acts(p.readAt ? `<small class="xsj-relicat">${esc(p.readAt)}</small>` : '')}
    </div>`;
  }
  async function generateRelic() {
    if (view.busy) return;
    const L = codex().log;
    const R = L.relic;
    const sd = storyDate();
    const PAGE = `{"vol": 第几卷，从1开始, "sym": "这一页上画了什么：照设定的记录方式描述图画、符号和痕迹，不点破意思，30-60字", "img": "英文 danbooru tag：这页上画的图案本身（植物、器物、符号、手印等），不画人物", "title": "这一页真正记的内容名（药方名、草药名等），不超过8字", "use": "治什么、做什么用，20字以内", "recipe": ["做法步骤，每步不超过20字"], "herbs": ["用到的草药或材料名，用世界书里的叫法"], "where": "材料去哪里找，尽量用世界书或地图里的地名", "trace": "留下这件遗物的人在这页上留下的痕迹或心意，一句话，克制，不煽情", "keys": ["剧情里一提到就能认出这一页的词，1-3个，要具体，不要通用词"]}`;
    const instr = [
      ...baseInstr(sd.y, sd.m),
      R ? `任务：继续整理「${R.name}」（${R.owner} 留下）。已经有这些页：${R.pages.map((p) => `${p.title}（第${p.vol}卷）`).join('、')}。再写 4-8 页新的，不要和已有的重复，卷号沿用：${(R.vols || []).map((v, i) => `${i + 1}=${v.name}`).join('，')}。`
        : `任务：从世界书和人物设定里，找出{{user}}或${ownerName()}手里那件"前人留下的书卷类遗物"（比如亡母留下的药方兽皮卷、师父的手札、祖传的图谱）。设定里有多件就选最重要的；实在没有，就按世界观设计一件合理的。卷数、存放位置、记录方式都照设定来；设定里说没有文字的，就写成图画和符号。`,
      `每一页的真正内容先写好，会藏起来，等剧情里读懂了才给玩家看；sym 只写看得见的图画，不能泄露内容。内容要符合这个世界的草药和医术，不套用现代药名。`,
      R ? `JSON 结构：{"pages": [${PAGE}]}`
        : `JSON 结构：{"name": "遗物全名，如“母亲留下的药方卷”", "short": "在手机上显示的名字，2-5字", "owner": "谁留下的", "desc": "一句话：现在放在哪、什么样子", "vols": [{"name": "卷名，如“卷一·外伤”"}], "pages": [${PAGE}]}  // 卷数照设定；每卷 3-4 页`,
    ].join('\n');
    const data = await callAI(instr, R ? `正在翻找${R.short || '遗物'}…` : '正在从设定里找遗物…', true, false);
    if (!data) return;
    const raw = Array.isArray(data.pages) ? data.pages : [];
    if (!R) {
      if (!txt(data.name) || !raw.length) { lastRaw = JSON.stringify(data).slice(0, 4000); toast('AI 没找到遗物，再试一次（返回内容记在设置页最下面）', 'error'); return; }
      L.relic = { name: txt(data.name), short: txt(data.short).slice(0, 6) || txt(data.name).slice(0, 5), owner: txt(data.owner), desc: txt(data.desc), vols: Array.isArray(data.vols) ? data.vols.map((v) => ({ name: txt(v?.name || v) })).filter((v) => v.name).slice(0, 8) : [], pages: [] };
    }
    const RR = L.relic;
    const nv = Math.max(1, RR.vols.length);
    const have = new Set(RR.pages.map((p) => p.title));
    let added = 0;
    for (const x of raw) {
      const title = txt(x?.title);
      if (!title || have.has(title) || !txt(x.sym)) continue;
      const vol = Math.min(nv, Math.max(1, Math.round(Number(x.vol) || 1)));
      const no = RR.pages.filter((p) => p.vol === vol).length + 1;
      RR.pages.push({
        id: uid(), vol, no, sym: txt(x.sym), img: txt(x.img), pic: '', title, use: txt(x.use),
        recipe: Array.isArray(x.recipe) ? x.recipe.map(txt).filter(Boolean).slice(0, 8) : [],
        herbs: Array.isArray(x.herbs) ? x.herbs.map(txt).filter(Boolean).slice(0, 8) : [],
        where: txt(x.where), trace: txt(x.trace),
        keys: Array.isArray(x.keys) ? x.keys.map(txt).filter((k) => k.length >= 2).slice(0, 3) : [],
        read: false,
      });
      have.add(title); added++;
    }
    saveChat();
    toast(added ? `找到 ${added} 页，都还没读懂` : '这次没有新的页', added ? 'success' : 'info');
    render();
  }
  function readRelicPage(p, how) {
    p.read = true;
    p.readHow = how;
    p.readAt = dateKey(storyDate());
  }
  async function drawRelicPic(p, label) {
    const tags = cleanTags(p.img);
    const pic = await drawImage({
      prompt: `no humans, traditional media, cave painting, primitive art, pictogram, ochre pigment on animal hide, leather texture, ${tags || 'simple symbols'}, full frame`,
      nl: tags ? '' : p.sym,
      size: 'landscape',
    }, label, p.id);
    if (pic) { p.pic = pic; saveChat(); render(); }
    return !!pic;
  }

  function diaryView() {
    const L = codex().log;
    const head = '';
    if (!L.items.length) return `<button data-act="gen-log" class="xsj-logadd">✎ 记下最近发生的事</button><div class="xsj-hint xsj-loghint">${esc(ownerName())}会用自己的口吻，把最近剧情里发生的事记在随身的${esc(L.title || '本子')}上。载体跟着世界观变：部落里是兽皮卷，航海是航海日志，现代是手账。</div>`;
    const page = (e) => {
      const drawing = view.drawing?.id === e.id;
      return `<div class="xsj-scroll">
        <div class="xsj-scroll-h"><span>${esc(e.date)}</span><span>${esc(e.mood || '')}</span></div>
        <b>${esc(e.title)}</b>
        <p>${esc(e.text)}</p>
        ${drawing ? drawingBox(e.id, 'xsj-drawing-place') : e.pic ? `<img src="${esc(e.pic)}" alt="">` : ''}
        <div class="xsj-scroll-a"><button data-act="quote" data-kind="log" data-id="${e.id}">📎 附带</button>${drawing ? '' : `<button data-act="log-pic" data-id="${e.id}">${e.pic ? '↻ 重画插图' : '🖌 画插图'}</button>`}<button data-act="log-del" data-id="${e.id}">删除</button></div>
      </div>`;
    };
    return `${head}${L.items.slice().reverse().map(page).join('')}`;
  }
  async function generateLog() {
    if (view.busy) return;
    const L = codex().log;
    const sd = storyDate();
    const last = L.items[L.items.length - 1];
    const who = ownerName();
    const instr = [
      ...baseInstr(sd.y, sd.m),
      `任务：以${who}的第一人称，在ta随身带着的记事载体上，记下最近剧情里发生的事。载体按世界观和ta的身份来定（原始部落可以是兽皮卷，航海是航海日志，修仙是玉简，现代是手账或手机备忘录）。`,
      `写法：像真的私人手记，只写ta亲眼看到、亲手做过、心里想到的，不全知，不复述对话原文；可以简短、跳跃、口语化，带着ta自己的偏见和没说出口的话；120-250字。`,
      L.title ? `载体已经定为「${L.title}」，沿用。` : `title：这个载体的名字，2-5字。`,
      last ? `上一篇写的是「${last.title}」：${last.text.slice(0, 120)}……这一篇写那之后的事，不要重复。` : '',
      `JSON 结构：{"title": "载体名", "entry": {"date": "按这个世界的纪年或说法写的日期", "title": "小标题，不超过10字", "mood": "一个emoji", "text": "正文", "img": "这一页角落的小插画画什么，英文 danbooru tag，不画人物"}}`,
    ].filter(Boolean).join('\n');
    const data = await callAI(instr, `正在写${appTitle('log')}…`, false, false);
    if (!data) return;
    const e = data.entry && typeof data.entry === 'object' ? data.entry : data;
    if (!txt(e.text)) { lastRaw = JSON.stringify(data).slice(0, 4000); toast('AI 没写出正文，再试一次', 'error'); return; }
    L.items.push({ id: uid(), date: txt(e.date) || dateKey(sd), title: txt(e.title) || '无题', mood: txt(e.mood), text: txt(e.text), img: txt(e.img), pic: '' });
    if (!L.title && txt(data.title)) L.title = txt(data.title).slice(0, 8);
    saveChat();
    toast(`记在${appTitle('log')}上了`, 'success');
    render();
  }
  async function drawLogPic(e, label) {
    const tags = cleanTags(e.img);
    const pic = await drawImage({ prompt: `no humans, ${tags || 'scenery'}, detailed background, atmospheric lighting, full frame`, nl: tags ? '' : `${e.title}。${e.text}`, size: 'landscape' }, label, e.id);
    if (pic) { e.pic = pic; saveChat(); render(); }
    return !!pic;
  }

  // ---------- 📌 委托：世界里的人发来的请求，带进剧情当钩子，做完了自己点完成 ----------
  // 公告板：每条委托是一张小纸条钉在板上，点开才放大看全文
  const QNOTE_PAPER = ['#fbf3e2', '#fff4b8', '#e3f1ff', '#e6f6e1', '#ffe4ec'];
  const QNOTE_PIN = ['#e0453a', '#3a7be0', '#e0a33a', '#3aa86b', '#9a5ae0'];
  function questCard(q) {
    const mp = currentMap();
    const place = mp && q.where ? mp.places.find((p) => nameHit(p.name, q.where)) : null;
    return `<div class="xsj-quest${q.status === 'done' ? ' is-done' : ''}" style="--paper:${QNOTE_PAPER[hashN(q.id) % QNOTE_PAPER.length]}">
        <i class="xsj-quest-pin" style="--pin:${QNOTE_PIN[hashN(q.id + 'p') % QNOTE_PIN.length]}"></i>
        <button data-act="quest-close" class="xsj-quest-x" title="收起">×</button>
        ${q.status === 'done' ? '<span class="xsj-quest-stamp">完成</span>' : ''}
        <div class="xsj-quest-t"><b>${esc(q.emoji || '📌')} ${esc(q.title)}</b><small>${esc([q.giver && `委托人：${q.giver}`, q.postedAt && `${q.postedAt} 贴上`].filter(Boolean).join(' · '))}</small></div>
        <p>${esc(q.desc)}</p>
        <div class="xsj-quest-meta">
          ${q.where ? `<span>📍 ${place ? `<button data-goplace="${place.id}">${esc(place.fog ? '？？？（还没去过）' : place.name)}</button>` : esc(q.where)}</span>` : ''}
          ${q.reward ? `<span>🎁 ${esc(q.reward)}</span>` : ''}
          ${q.status === 'done' && q.doneAt ? `<span>✓ ${esc(q.doneAt)} 完成</span>` : ''}
        </div>
        <div class="xsj-quest-a">
          <button data-act="quote" data-kind="quest" data-id="${q.id}">📎 带进剧情</button>
          ${q.status === 'done' ? `<button data-act="quest-undo" data-id="${q.id}">撤回完成</button>` : `<button data-act="quest-drop" data-id="${q.id}">不接了</button><button data-act="quest-done" data-id="${q.id}" class="xsj-quest-ok">✓ 完成</button>`}
        </div>
      </div>`;
  }
  // 放大的那张：盖在整个手机屏幕上，点空白处或 × 收起
  function questModal() {
    if (view.tab !== 'quest' || !view.questOpen) return '';
    const q = codex().quest.items.find((o) => o.id === view.questOpen);
    if (!q) { view.questOpen = null; return ''; }
    return `<div class="xsj-qmodal" data-qbackdrop="1">${questCard(q)}</div>`;
  }
  function questView() {
    const Q = codex().quest;
    const tab = view.questTab === 'done' ? 'done' : 'open';
    const open = Q.items.filter((q) => q.status !== 'done');
    const done = Q.items.filter((q) => q.status === 'done');
    const list = tab === 'done' ? done : open;
    const note = (q) => {
      const h = hashN(q.id);
      const rot = ((h % 9) - 4) * 1.4;
      return `<button class="xsj-qnote${q.status === 'done' ? ' is-done' : ''}" data-questopen="${q.id}" style="--paper:${QNOTE_PAPER[h % QNOTE_PAPER.length]};--pin:${QNOTE_PIN[hashN(q.id + 'p') % QNOTE_PIN.length]};--rot:${rot}deg;--dy:${(h >> 3) % 10}px">
        <i class="xsj-qnote-pin"></i>
        ${q.urgent && q.status !== 'done' ? '<em class="xsj-qnote-urgent">急</em>' : ''}
        ${q.status === 'done' ? '<em class="xsj-qnote-done">完</em>' : ''}
        <span class="xsj-qnote-e">${esc(q.emoji || '📌')}</span>
        <b>${esc(q.title)}</b>
        <small>${esc(q.giver || '')}</small>
      </button>`;
    };
    return `<div class="xsj-board">
        <div class="xsj-board-plate">${esc(appTitle('quest'))}</div>
        ${Q.items.length ? `<div class="xsj-board-tabs"><button data-questtab="open" class="${tab === 'open' ? 'on' : ''}">进行中 ${open.length}</button><button data-questtab="done" class="${tab === 'done' ? 'on' : ''}">已完成 ${done.length}</button></div>` : ''}
        ${list.length ? `<div class="xsj-qnotes">${list.map(note).join('')}</div>`
          : `<div class="xsj-board-empty">${!Q.items.length ? '板子上还空着。<br>让这个世界里的人贴几张求助、托付、跑腿的纸条？带进剧情就是现成的钩子，做完了自己点「完成」。' : tab === 'done' ? '还没有完成的委托。' : '手上的委托都做完了。'}</div>`}
      </div>${Q.items.length ? '' : '<button data-act="gen-quest" class="xsj-board-gen">✦ 看看有什么委托</button>'}`;
  }
  async function generateQuest() {
    if (view.busy) return;
    const Q = codex().quest;
    const sd = storyDate();
    const mp = currentMap();
    // 能接上的线索：没去过的地方、图鉴里锁着的、读懂的兽皮卷要的材料
    const hooks = [
      ...(mp?.places || []).filter((p) => p.fog).map((p) => `没去过的地方：${p.name}（传闻：${p.rumor}）`),
      ...codex().dex.items.filter((x) => !x.found).map((x) => `图鉴里还没遇到的：${x.name}（${x.hint || x.cat}）`),
      ...(codex().log.relic?.pages || []).filter((p) => p.read && p.herbs?.length).map((p) => `${codex().log.relic.short}·${p.title}要用：${p.herbs.join('、')}${p.where ? `（采自${p.where}）` : ''}`),
    ].slice(0, 12);
    const instr = [
      ...baseInstr(sd.y, sd.m),
      `任务：这个世界里的人发出几条委托（求助、托付、交易、跑腿），3-5 条。委托人用世界书或剧情里已有的配角；内容符合他们的身份、处境和此刻的季节，有具体的东西、地点和理由，难度有大有小；不替主角做决定。`,
      Q.items.filter((q) => q.status !== 'done').length ? `已经有这些委托，不要重复：${Q.items.filter((q) => q.status !== 'done').map((q) => q.title).join('、')}` : '',
      hooks.length ? `可以自然地接上这些线索（不必全用）：\n${hooks.join('\n')}` : '',
      Q.title ? `板子的名字已经定为「${Q.title}」，沿用。` : `title：这个世界里贴委托的地方叫什么，2-5字（部落里可以是“委托石”，城里是“公告栏”，修仙界是“悬赏榜”）。`,
      `JSON 结构：{"title": "名字", "quests": [{"emoji": "一个emoji", "title": "委托名，不超过12字", "giver": "委托人", "desc": "委托人怎么说的、要做什么，40-80字，带一点委托人的口吻", "where": "要去的地方，尽量用地图上或传闻里的地名，没有就空", "reward": "报酬或回报，符合世界观，可以是人情", "urgency": "急|不急"}]}`,
    ].filter(Boolean).join('\n');
    const data = await callAI(instr, `正在看${appTitle('quest')}…`, true, false);
    if (!data) return;
    const list = (Array.isArray(data.quests) ? data.quests : []).filter((x) => x && txt(x.title) && !Q.items.some((q) => q.title === txt(x.title)));
    Q.items.unshift(...list.slice(0, 6).map((x) => ({
      id: uid(), emoji: txt(x.emoji) || '📌', title: txt(x.title), giver: txt(x.giver), desc: txt(x.desc), where: txt(x.where), reward: txt(x.reward),
      urgent: txt(x.urgency) === '急', status: 'open', postedAt: dateKey(sd),
    })));
    if (!Q.title && txt(data.title)) Q.title = txt(data.title).slice(0, 6);
    view.questTab = 'open';
    saveChat();
    toast(list.length ? `来了 ${list.length} 条委托` : '这次没有新委托', list.length ? 'success' : 'info');
    render();
  }

  // ---------- 🔮 占卜：按世界观换方式（兽骨、签筒、塔罗、星盘），得一句模糊的暗示 ----------
  const LUCK = { 大吉: '#f3c34a', 吉: '#8fd3a8', 平: '#bcd3e0', 凶: '#c79bd8', 大凶: '#e58b8b' };
  function omenCard(o, big) {
    const drawing = view.drawing?.id === o.id;
    return `<div class="xsj-omen${big ? ' is-big' : ''}" style="--l:${LUCK[o.luck] || '#bcd3e0'}">
      <div class="xsj-omen-h"><span>${esc(o.date)}</span><span>${esc(o.method || '')}</span></div>
      ${drawing ? drawingBox(o.id, 'xsj-drawing-place') : o.pic ? `<img src="${esc(o.pic)}" alt="">` : `<div class="xsj-omen-sym">${esc(o.symbol || '🔮')}</div>`}
      <b>${esc(o.sign)}</b>
      ${o.luck ? `<em>${esc(o.luck)}</em>` : ''}
      ${o.verse ? `<p class="xsj-omen-v">${esc(o.verse)}</p>` : ''}
      ${o.hint ? `<p class="xsj-omen-hint">${esc(o.hint)}</p>` : ''}
      <div class="xsj-omen-a"><button data-act="quote" data-kind="omen" data-id="${o.id}">📎 带进剧情</button>${drawing ? '' : `<button data-act="omen-pic" data-id="${o.id}">${o.pic ? '↻ 重画' : '🖌 画出来'}</button>`}<button data-act="omen-del" data-id="${o.id}">删除</button></div>
    </div>`;
  }
  function omenView() {
    const O = codex().omen;
    const [last, ...rest] = O.items;
    const today = dateKey(storyDate());
    return `<button data-act="gen-omen" class="xsj-omen-draw"><span>${esc(last?.symbol || '🔮')}</span>${last && last.day === today ? '再问一次' : '抽一签'}</button>
      <div class="xsj-hint xsj-omen-tip">${last ? '' : '按这个世界的方式占一卦：兽骨、签筒、塔罗、星盘……给一句模糊的暗示，带进剧情就是今天的小插曲。'}</div>
      ${last ? omenCard(last, true) : ''}
      ${rest.length ? `<div class="xsj-sub">以前的</div>${rest.map((o) => omenCard(o, false)).join('')}` : ''}`;
  }
  async function generateOmen() {
    if (view.busy) return;
    const O = codex().omen;
    const sd = storyDate();
    const instr = [
      ...baseInstr(sd.y, sd.m),
      `任务：用这个世界里的人真的会用的方式，替${ownerName()}占一次卜（原始部落可以是烧兽骨看裂纹，古代是摇签，西幻是塔罗或星盘，现代是塔罗、星座或抽签App）。`,
      O.method ? `占卜方式已经定为「${O.method}」，沿用。` : '',
      `结果要贴着最近剧情和人物处境，但只给模糊的暗示：说得出具体的意象（水边、旧物、一个迟到的人），不点名、不剧透、不替角色做决定；有吉有凶，不总是好事。`,
      O.items.length ? `上一次的结果是「${O.items[0].sign}」，这次不要重复。` : '',
      `JSON 结构：{"title": "这个 app 在这个世界里叫什么，2-5字（如“兽骨占卜”“灵签”“塔罗”）", "method": "占卜方式，2-6字", "sign": "签名、卦名或牌名", "symbol": "一个emoji", "luck": "大吉|吉|平|凶|大凶", "verse": "签文或判词，两句以内，有一点古意或神秘感", "hint": "白话解读：这几天可能会遇到什么，一句话", "img": "画这次占卜结果的英文 danbooru tag（裂纹兽骨、签、塔罗牌、星盘等），不画人物"}`,
    ].filter(Boolean).join('\n');
    const data = await callAI(instr, '正在占卜…', false, false);
    if (!data || !txt(data.sign)) { if (data) toast('这一卦没占出来，再试一次', 'error'); return; }
    if (!O.method && txt(data.method)) O.method = txt(data.method).slice(0, 8);
    if (!O.title && txt(data.title)) O.title = txt(data.title).slice(0, 6);
    O.items.unshift({
      id: uid(), day: dateKey(sd), date: dateKey(sd), method: O.method || txt(data.method), sign: txt(data.sign), symbol: txt(data.symbol) || '🔮',
      luck: Object.keys(LUCK).includes(txt(data.luck)) ? txt(data.luck) : '平', verse: txt(data.verse), hint: txt(data.hint), img: txt(data.img), pic: '',
    });
    O.items = O.items.slice(0, 30);
    saveChat();
    render();
  }
  async function drawOmenPic(o, label) {
    const tags = cleanTags(o.img);
    const pic = await drawImage({ prompt: `no humans, still life, mystical, ${tags || 'divination'}, dramatic lighting, detailed background, full frame`, nl: tags ? '' : `${o.method}：${o.sign}。${o.verse}`, size: 'portrait' }, label, o.id);
    if (pic) { o.pic = pic; saveChat(); render(); }
    return !!pic;
  }

  // ---------- 💘 你的梦男：这个世界里把 {{user}} 当梦角的男人们，在平台上晒糖、理讨、吵架 ----------
  const DREAM_CATS = ['吃糖', '理讨', '产粮', '抽卡', '剧情', '考据', '嗑CP', '吵架', '论坛体', '吐槽', '求助', '深夜'];
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
      return `<div class="xsj-empty">🌏<br>蓝星online 还没有动静<br><button data-act="gen-dream" class="xsj-primary">上线看看</button><div class="xsj-hint">蓝星是另一个和地球很像的世界。那里的网友追着你的故事，把你当梦角来爱：晒糖、理讨、吵架、拉踩。发帖的都是蓝星网友，不是你身边的人。</div></div>`;
    }
    const sel = D0.items.find((p) => p.id === view.dream);
    if (sel) {
      return `<button data-act="dream-back" class="xsj-back">‹ 返回</button>
        ${dreamPost(sel, true)}
        <div class="xsj-dm-acts"><button data-act="quote" data-kind="dream" data-id="${sel.id}">📎 带进剧情</button><button data-act="dream-del" class="xsj-danger">删帖</button></div>
        <div class="xsj-dm-replyhead">最相关的回复</div>
        ${(sel.replies || []).map((r) => `<div class="xsj-dm-reply">${dreamAvatar(r.author, r.handle, '')}<div><div class="xsj-dm-rt"><b>${esc(r.author)}</b><small>${esc(r.handle || '')}</small></div>${r.to ? `<small class="xsj-dm-to">回复 <span>${esc(r.to)}</span></small>` : ''}<div class="xsj-dm-text">${esc(r.text)}</div><small class="xsj-dm-rl">♡ ${fmtN(r.likes)}</small></div></div>`).join('') || '<div class="xsj-none">还没有回复</div>'}`;
    }
    const cats = ['全部', ...DREAM_CATS.filter((c) => D0.items.some((p) => p.cat === c))];
    if (!cats.includes(view.dreamCat)) view.dreamCat = '全部';
    const list = D0.items.filter((p) => view.dreamCat === '全部' || p.cat === view.dreamCat);
    return `<div class="xsj-dm-search"><span>🔍</span><b>${esc(D0.query || appTitle('dream'))}</b><small>${esc(D0.platform || '')}</small></div>
      <div class="xsj-cats">${cats.map((c) => `<button data-dreamcat="${esc(c)}" class="${c === view.dreamCat ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>
      ${list.map((p) => dreamPost(p, false)).join('')}`;
  }
  async function generateDream(opts = {}) {
    if (view.busy) return;
    const dir = opts.dir === 'general' ? 'general' : 'dream';
    const D0 = codex().dream;
    const sd = storyDate();
    const instr = [
      ...baseInstr(sd.y, sd.m),
      `任务：模拟「蓝星」的网络——蓝星是另一个和地球很像的世界（现代社会、手机、社交平台、网络用语都和地球差不多，但国家、城市、品牌、名人都是虚构的，不出现地球上真实存在的名字）。在蓝星网友眼里，{{user}}所在的故事是一个他们正在追的作品，叫「蓝星online」，像一款还在运营的剧情游戏：官方会更新剧情、出卡面和卡池、发 PV、办活动、出周边；{{user}}是里面的女主。写出他们讨论{{user}}的平台和上面的帖子。`,
      `重要：发帖和回复的全是蓝星网友，不是故事里的人；{{user}}身边的角色不会出现在这里发帖，网友提到他们时是当作「作品里的角色」来讨论。`,
      D0.platform && D0.kind === 'bluestar' ? `平台已经定为「${D0.platform}」，沿用。` : `平台是蓝星上的现代社交平台（类似地球的微博超话、论坛、X、小红书那种），起一个虚构的名字，不用地球上真实的平台名。`,
      dir === 'dream'
        ? `这一批是【梦向】：发帖的是把{{user}}当老婆、妻子、宝宝、世界上最宝贵的人的梦男（叫她“老婆”“宝宝”“我媳妇”，自称老公、正宫）。他们时刻关注她的动态，对她有很多情绪：心疼、想念、吃醋、患得患失、节日里想她想得睡不着、为她和同担吵架；也会给她约稿画师、买和做蓝星周边（吧唧、立牌、抱枕、谷子）、抽她的卡、给她写小作文，用这些来增加陪伴感。可以有一点「meta 感」：网友觉得她好像知道自己在蓝星online里，在隔着屏幕回应他们。`
        : `这一批是【一般向】：普通玩家和观众的讨论，不把{{user}}当恋人。聊剧情走向和伏笔、考据设定、嗑{{user}}和作品里角色的 CP、吐槽官方（更新慢、卡池、活动、文案）、抽卡出货、晒同人和周边、新人入坑问题、路人锐评。`,
      dir === 'dream'
        ? `帖子类型混搭：吃糖（“她今天看了我一眼”式自作多情）、理讨（如“理讨此女独有的 meta 感”）、产粮（约稿、周边、手作）、抽卡（为她氪金、十连出金）、吵架（同担拒否、拉踩、比谁付出得多）、论坛体（“如果她……”）、吐槽、求助（“情人节怎么熬过去”）。`
        : `帖子类型混搭：剧情讨论、考据、嗑 CP、吐槽官方、抽卡、产粮、求助、论坛体。`,
      `形式像截图里的楼中楼：一条主帖，底下的回复互相 @、接话、抬杠、跑题，有人只回一个“？”，有人一本正经科普；昵称、@账号有梗（乱码账号、带【 】的名字、抽象昵称都行），时间写成 21m、8h、09/17 这种。`,
      `发帖人：蓝星网友，有老粉、新入坑的、唯粉、CP 粉、黑粉路过，各有立场。`,
      `内容贴着{{user}}最近在剧情里做过的事、去过的地方、穿过的衣服、说过的话来写，像在讨论最新一期更新：截图、名场面、卡面、“今天更新的那段”。网友只知道作品里演出来的部分，会脑补、误读、互相纠正、为一点小事吵翻天。`,
      `语气：网感、口语、玩梗，可以用 emoji 和颜文字；有好笑的、有酸的、有一本正经的；不要真的侮辱{{user}}。`,
      dir === 'dream' ? `尺度：大约每 10 帖里有 1 帖可以露骨一点，归到「深夜」分类：成年梦男的性幻想、涩涩的脑补、荤话，写得直白也行；其余帖子保持日常。不写未成年，不写强迫。` : `一般向不写露骨内容。`,
      D0.items.length ? `上一批已经讨论过：${D0.items.slice(0, 8).map((p) => p.text.slice(0, 20)).join('｜')}。这次写新的话题。` : '',
      `JSON 结构：{"platform": "平台名", "query": "搜索框里的关键词，如“你的梦男”或带{{user}}名字的超话名", "posts": [{"author": "昵称", "handle": "@开头的英文账号", "avatar": "一个emoji", "time": "如 2h、昨天 17:39", "cat": "${(dir === 'dream' ? DREAM_CATS.filter((c) => !['剧情', '考据', '嗑CP'].includes(c)) : DREAM_CATS.filter((c) => !['吃糖', '深夜'].includes(c))).join('|')}", "text": "正文30-140字", "tags": ["话题"], "img": "有配图时写画面的英文 danbooru tag（物件、场景、截图里的东西，不画{{user}}本人），没有就空字符串", "imgDesc": "配图是什么，中文一句，没有就空字符串", "likes": 数字, "rts": 数字, "views": 数字, "cmts": 评论总数, "replies": [{"author": "昵称", "handle": "@账号", "to": "回复的是谁的 @账号", "text": "不超过60字", "likes": 数字}]}]}  // 6-8 帖，每帖 2-5 条回复，回复里也可以互相吵`,
    ].filter(Boolean).join('\n');
    const data = await callAI(instr, '正在刷帖…', false, false);
    if (!data) return;
    const posts = (Array.isArray(data.posts) ? data.posts : []).filter((p) => p && txt(p.text));
    if (!posts.length) { lastRaw = JSON.stringify(data).slice(0, 4000); toast('没刷出帖子，再试一次', 'error'); return; }
    // 改成蓝星online 以前生成的平台名（按故事世界起的）换掉一次
    if (D0.kind !== 'bluestar') { D0.platform = ''; D0.query = ''; D0.kind = 'bluestar'; }
    if (!D0.platform && txt(data.platform)) D0.platform = txt(data.platform).slice(0, 16);
    if (!D0.query && txt(data.query)) D0.query = txt(data.query).slice(0, 20);
    const num = (v) => Math.max(0, Math.round(Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0));
    D0.items.unshift(...posts.slice(0, 10).map((p) => ({
      id: uid(), author: txt(p.author) || '匿名账号', handle: txt(p.handle), avatar: txt(p.avatar), time: txt(p.time),
      cat: DREAM_CATS.includes(txt(p.cat)) ? txt(p.cat) : '吐槽', dir, text: txt(p.text), tags: Array.isArray(p.tags) ? p.tags.map(txt).filter(Boolean).slice(0, 4) : [],
      img: txt(p.img), imgDesc: txt(p.imgDesc), pic: '', likes: num(p.likes), rts: num(p.rts), views: num(p.views), cmts: num(p.cmts),
      replies: Array.isArray(p.replies) ? p.replies.filter((r) => r && txt(r.text)).slice(0, 8).map((r) => ({ author: txt(r.author) || '匿名账号', handle: txt(r.handle), to: txt(r.to), text: txt(r.text), likes: num(r.likes) })) : [],
    })));
    D0.items = D0.items.slice(0, 40);
    view.dreamCat = '全部';
    saveChat();
    toast(`刷到 ${posts.length} 条新帖`, 'success');
    render();
    D.querySelector(`#${ROOT_ID} .xsj-body`).scrollTop = 0;
  }
  async function drawDreamPic(p, label) {
    const tags = cleanTags(p.img);
    const pic = await drawImage({ prompt: `no humans, ${tags || 'still life'}, aesthetic photo, soft lighting, detailed, full frame`, nl: tags ? '' : p.imgDesc, size: 'portrait' }, label, p.id);
    if (pic) { p.pic = pic; saveChat(); render(); }
    return !!pic;
  }

  // ---------- 📇 人物志：每个人一张卡，没在剧情里了解到的栏位是「？」；关系网用同一份数据画出来 ----------
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
  const NPC_LINE = 'ta 对{{user}}说过、或者常挂在嘴边的一句话，15字以内，一听就是这个人，可以带点好笑或反差；只写{{user}}真的听过的';
  // 画像 tag 的写法：按这个世界来，普通世界就是普通人，非人类才写种族特征
  const NPC_IMG = '画这个人半身像的英文 danbooru tag，逗号分隔，8-15 个：先写 1boy 或 1girl，再写年龄感、发型发色、眼睛、体型、符合世界观和身份的衣着；只有非人类才写种族特征（如 wolf ears），普通人不写；不写名字和背景';
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
    if (!N.items.length) {
      return `<div class="xsj-empty">📇<br>${esc(appTitle('npc'))}还是空的<br><button data-act="gen-npc" class="xsj-primary">✦ 整理认识的人</button><div class="xsj-hint">读世界书和最近剧情，给每个人建一张卡。你在剧情里还不知道的事一律是「？」：剧情里说到了就自动填上，也可以自己点开。世界书里还没见过的人也会先列出来，只写名字和大家都知道的简介。</div></div>`;
    }
    const sel = N.items.find((p) => p.id === view.npc);
    if (sel) return npcDetail(sel);
    const tab = view.npcTab === 'web' ? 'web' : 'list';
    const met = N.items.filter((p) => p.met);
    const tabs = `<div class="xsj-np-tabs"><button data-npctab="list" class="${tab === 'list' ? 'on' : ''}">人物</button><button data-npctab="web" class="${tab === 'web' ? 'on' : ''}">关系网</button></div>`;
    const tools = view.batch ? `<div class="xsj-hint" style="text-align:center">正在一键生图 ${view.batch}</div>` : '';
    if (tab === 'web') return tabs + npcWeb() + tools;
    const card = (p) => {
      // 排版参考“表格”梗图：竖长方块，下面粗体名字，再下面一句 ta 的话（没有就写身份）
      if (!p.met) return `<button class="xsj-np-card is-locked" data-npc="${p.id}">${npcAvatar(p)}<b>${esc(p.name)}</b><small>${esc(p.role || p.hint || '')}</small><u>没见过</u></button>`;
      return `<button class="xsj-np-card${p.isNew ? ' is-new' : ''}" data-npc="${p.id}">${npcAvatar(p)}<b>${esc(p.name)}</b>${p.line ? `<small class="xsj-np-line">“${esc(npcT(p.line))}”</small>` : `<small>${esc(p.role || '')}</small>`}</button>`;
    };
    return `${tabs}<div class="xsj-np-sum">认识 ${met.length} 人${N.items.length > met.length ? ` · 还有 ${N.items.length - met.length} 人没见过` : ''}</div>
      <div class="xsj-np-grid">${[...met, ...N.items.filter((p) => !p.met)].map(card).join('')}</div>${tools}`;
  }
  function npcDetail(p) {
    const back = '<button data-act="npc-back" class="xsj-back">‹ 返回</button>';
    if (!p.met) {
      return `${back}<div class="xsj-np-detail is-locked">${npcAvatar(p, 'is-big')}<b class="xsj-np-name">${esc(p.name)}</b>
        ${p.role ? `<div class="xsj-np-role">${esc(p.role)}</div>` : ''}
        <div class="xsj-np-hint">${esc(p.hint || '还没见过')}</div>
        <div class="xsj-np-met">还没见过 · 见面后其他栏位才会出现</div>
        <div class="xsj-np-acts"><button data-act="npc-meet">已经见过了</button><button data-act="npc-del" class="xsj-danger">删除</button></div></div>`;
    }
    const drawing = view.drawing?.id === p.id;
    const facts = (p.facts || []).map((f, i) => f.known
      ? `<div class="xsj-np-fact"><span>${esc(npcT(f.k))}</span><p>${esc(npcT(f.v))}</p></div>`
      : `<button class="xsj-np-fact is-q" data-npcfact="${i}"><span>${esc(npcT(f.k))}</span><p>？</p></button>`).join('');
    const links = npcLinksOf(p).map((l, i) => {
      const other = npcLabel(l.a === p.name ? l.b : l.a);
      const otherP = npcByName(other);
      const hidden = otherP && !otherP.met;
      return l.known && !hidden
        ? `<div class="xsj-np-link"><b>${esc(other)}</b><span>${esc(l.label)}</span></div>`
        : `<button class="xsj-np-link is-q" data-npclink="${l.id}"><b>${esc(other)}</b><span>？</span></button>`;
    }).join('');
    return `${back}<div class="xsj-np-detail">
      ${drawing ? drawingBox(p.id, 'xsj-drawing-place') : p.pic ? `<img class="xsj-np-pic" src="${esc(p.pic)}" alt="">` : npcAvatar(p, 'is-big')}
      <b class="xsj-np-name">${esc(p.name)}</b>
      ${p.role ? `<div class="xsj-np-role">${esc(p.role)}</div>` : ''}
      ${p.look ? `<div class="xsj-np-look">${esc(p.look)}</div>` : ''}
      ${p.line ? `<div class="xsj-np-quote">“${esc(npcT(p.line))}”</div>` : ''}
      ${facts ? `<div class="xsj-np-facts">${facts}</div>` : `<div class="xsj-np-acts"><button data-act="npc-fill">✦ 补全这张卡</button></div><div class="xsj-hint">刚认识，栏位还没写。点一下补全（调一次 API），或者等下次「从剧情更新」一起补。</div>`}
      ${links ? `<div class="xsj-sub">关系</div><div class="xsj-np-links">${links}</div>` : ''}
      ${p.metAt ? `<div class="xsj-np-met">初次见面 · ${esc(p.metAt)}</div>` : ''}
      <div class="xsj-hint">「？」是你在剧情里还不知道的事：剧情里说到会自动填上，也可以点一下直接揭开。</div>
      <div class="xsj-np-acts"><button data-act="quote" data-kind="npc" data-id="${p.id}">📎 带进剧情</button>${drawing ? '' : `<button data-act="npc-pic">${p.pic ? '↻ 重画' : '🖼 画像'}</button>`}<button data-act="npc-del" class="xsj-danger">删除</button></div>
    </div>`;
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
  const npcFacts = (arr) => (Array.isArray(arr) ? arr : []).filter((f) => f && txt(f.k) && txt(f.v)).slice(0, 10).map((f) => {
    const o = { k: txt(f.k).slice(0, 16), v: txt(f.v), known: f.known === true || f.known === 'true', keys: (Array.isArray(f.keys) ? f.keys : []).map(txt).filter((k) => k.length >= 2).slice(0, 4) };
    if (o.k === '生日') { o.md = npcMd(f); if (!o.md) return null; }
    return o;
  }).filter(Boolean);
  // 已经知道的生日同步进日程（日历上显示 🎂），每人一条
  function npcSyncBirthdays() {
    if (!Array.isArray(chat.birthdays)) chat.birthdays = [];
    let n = 0;
    for (const p of npcData().items) {
      const f = (p.facts || []).find((o) => o.k === '生日' && o.known && o.md);
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
      ...baseInstr(sd.y, sd.m),
      `为{{user}}的人物志补全一张卡：「${p.name}」${p.role ? `（${p.role}）` : ''}。依据世界书、人物设定与最近剧情来写，名字不变。站在{{user}}的视角：只有{{user}}在剧情里亲眼看到、亲耳听到、被人告诉过的事才算 known。`,
      `facts 5-7 条，k 从「性格」「擅长」「不会」「喜好」「讨厌」「过去」「对{{user}}」「秘密」里挑，也可以按世界观加；「擅长」「不会」「对{{user}}」必须有。「生日」只在设定里写明了日期时才加，v 写“3月14日”，另给 "md": "03-14"；没写明的不要编。v 写具体的事，20-50字。keys：剧情里真说到这件事时一定会出现的 1-3 个词（不要用人名）。`,
      `links：这个人和别人、和{{user}}的关系（{{user}}写成 "{{user}}"），label 2-6字，known 同上。`,
      `JSON 结构：{"role": "身份", "look": "外貌，20字以内", "line": "${NPC_LINE}", "facts": [{"k": "栏位", "v": "内容", "known": false, "keys": ["词"]}], "links": [{"a": "${p.name}", "b": "人名或{{user}}", "label": "关系", "known": false, "keys": ["词"]}], "img": "${NPC_IMG}"}`,
    ].join('\n');
    const data = await callAI(instr, `正在补全「${p.name}」…`, true, false);
    if (!data) return;
    const facts = npcFacts(data.facts);
    if (!facts.length) { toast('没补出来，再试一次', 'error'); return; }
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
  async function generateNpc() {
    if (view.busy) return;
    const N = npcData();
    const sd = storyDate();
    const known = N.items.map((p) => `${p.name}（${p.met ? '见过' : '没见过'}${p.met && !(p.facts || []).length ? '，还没写栏位' : ''}${p.img ? '' : '，没有画像描述'}；已知：${(p.facts || []).filter((f) => f.known).map((f) => f.k).join('、') || '无'}；未知：${(p.facts || []).filter((f) => !f.known).map((f) => f.k).join('、') || '无'}）`).join('\n');
    const knownLinks = N.links.map((l) => `${npcLabel(l.a)}—${npcLabel(l.b)}（${l.known ? '已知' : '未知'}）`).join('、');
    const instr = [
      ...baseInstr(sd.y, sd.m),
      `任务：为{{user}}做一本人物志：把世界书和设定里所有有名有姓的人物都列出来，一个不漏（包括主要角色，不包括{{user}}本人），每人一张卡。站在{{user}}的视角：只有{{user}}在剧情里亲眼看到、亲耳听到、被人告诉过的事才算知道。`,
      `met：这个人在最近剧情里真的跟{{user}}见过面才是 true；世界书里有、但还没跟{{user}}见过的写 false：只写 name、emoji、role、img 和 hint（基本简介：这个世界里大家都知道的情况，一句话，30字以内，不剧透秘密），facts 给空数组，links 也先不写他。`,
      `facts（只给 met 为 true 的人写）：每人 5-7 条，k 从「性格」「擅长」「不会」「喜好」「讨厌」「过去」「对{{user}}」「秘密」里挑，也可以按世界观加（如「兽形」「修为」）；「擅长」「不会」「对{{user}}」必须有。「生日」只在世界书、设定或正文里写明了日期时才加，v 写“3月14日”这样的日期（可以带一句说明），另给 "md": "03-14"；没写明的不要编。v 写具体的事，20-50字。「不会」写这个人真的不会、做不到、不懂的事，剧情里要守住。known：{{user}}已经知道的才 true，不确定就 false；秘密几乎都是 false。keys：剧情里真说到这件事时一定会出现的 1-3 个词（不要用人名，不要用太常见的词）。`,
      `links：人物之间、人物和{{user}}之间的关系（{{user}}写成 "{{user}}"）。label 是关系，2-6字（如“亲兄弟”“欠他一条命”“暗恋”“师徒”）；known：{{user}}知道这层关系才 true；keys 同上。`,
      known ? `人物志里已经有：\n${known}\n已有的人不要再放进 people。如果剧情里有人这次见到了、或者某条未知的事这次在剧情里被说出来了，写进 update；见过了但还没写栏位的人，在 update 里给他补上 facts（写法同上）；没有画像描述的人，在 update 里补上 img；见过但没有 line 的人补上 line。` : '',
      knownLinks ? `已有的关系：${knownLinks}。不要重复；这次在剧情里被说破的写进 linkReveal。` : '',
      N.title ? `人物志名字已经定为「${N.title}」，沿用。` : `title：符合世界观的名字，2-6字（如“部落人物志”“同门录”“通讯录”）。`,
      `JSON 结构：{"title": "名字", "people": [{"name": "名字", "emoji": "一个emoji", "met": true, "role": "身份，一句话", "look": "外貌，一句话，20字以内", "line": "${NPC_LINE}（没见过的留空）","hint": "基本简介（没见过的人必写）", "facts": [{"k": "栏位", "v": "内容", "known": false, "keys": ["词"]}], "img": "${NPC_IMG}"}], "update": [{"name": "已有的人名", "met": true, "reveal": ["这次知道了的栏位名"], "facts": [], "img": "", "line": ""}], "links": [{"a": "人名", "b": "人名或{{user}}", "label": "关系", "known": false, "keys": ["词"]}], "linkReveal": [{"a": "人名", "b": "人名"}]}  // people 最多 40 人；没见过的人写得越短越好`,
    ].filter(Boolean).join('\n');
    const data = await callAI(instr, `正在整理${appTitle('npc')}…`, true, false);
    if (!data) return;
    const today = dateKey(sd);
    let added = 0, met = 0, learned = 0, linksN = 0;
    for (const x of (Array.isArray(data.people) ? data.people : []).slice(0, 40)) {
      const name = txt(x?.name);
      if (!name || npcSide(name) === NPC_USER || npcByName(name)) continue;
      const isMet = x.met === true || x.met === 'true';
      N.items.push({
        id: uid(), name, emoji: txt(x.emoji) || '👤', role: txt(x.role), look: txt(x.look), line: isMet ? txt(x.line).replace(/^[“"「]|[”"」]$/g, '') : '', hint: txt(x.hint), met: isMet, isNew: isMet, metAt: isMet ? today : '',
        facts: npcFacts(x.facts),
        img: txt(x.img), pic: '',
      });
      added++;
    }
    for (const u of Array.isArray(data.update) ? data.update : []) {
      const p = npcByName(txt(u?.name));
      if (!p) continue;
      if ((u.met === true || u.met === 'true') && !p.met) { Object.assign(p, { met: true, isNew: true, metAt: today }); met++; }
      if (!(p.facts || []).length && Array.isArray(u.facts) && u.facts.length) p.facts = npcFacts(u.facts);
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
    if (!N.title && txt(data.title)) N.title = txt(data.title).slice(0, 8);
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
  async function drawNpcPic(p, label) {
    const tags = cleanTags(p.img);
    // 没有 tag 的人：把卡上跟长相有关的都交给柏宝绘（种族、兽形只有卡上写了才会带上）
    const looks = (p.facts || []).filter((f) => /外貌|长相|样子|种族|兽形|原形|年龄|性别|体型|身材|穿着|打扮|衣着/.test(f.k)).map((f) => `${f.k}：${npcT(f.v)}`);
    const nl = [`${p.name}的证件照式头像：正脸，肩膀以上，纯白背景`, p.role, p.look, ...looks].filter(Boolean).join('。');
    // 证件照构图：正脸、肩膀以上、纯白底
    const pic = await drawImage({ prompt: `solo, portrait, head and shoulders, front view, facing viewer, looking at viewer, ${tags ? tags + ', ' : ''}simple background, white background, even lighting`, nl: tags ? '' : nl, size: 'portrait' }, label, p.id);
    if (!pic) return false;
    p.pic = pic; delete p.picRaw;
    saveChat(); render();
    return true;
  }

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
    // 委托放大时点空白处收起
    if (ev.target.dataset?.qbackdrop) { view.questOpen = null; return render(); }
    const t = ev.target.closest('button, [data-day], [data-item], [data-place], [data-region], [data-xopen], [data-dreamopen], [data-npc], [data-npclink], [data-wland], [data-wspot]');
    if (!t || !D.getElementById(ROOT_ID)?.contains(t)) return;
    const act = t.dataset.act;
    if (t.classList.contains('xsj-close')) return close();
    if (act === 'back') return goBack();
    // 生成前问：只新增，还是全部重新生成；全部重来但没生成出东西时，把原来的还回去
    if (REGEN[act] && !view.busy) {
      const c = await regenChoice(act);
      if (!c.go) return;
      if (c.undo) {
        render();
        const run = { 'gen-dex': generateDex, 'gen-wiki': generateWiki, 'gen-log': generateLog, 'gen-relic': generateRelic, 'gen-quest': generateQuest, 'gen-dream': generateDream, 'gen-npc': generateNpc }[act];
        await run();
        if (!REGEN[act].n()) { c.undo(); toast('这次没生成出来，原来的内容已经还原', 'warning'); render(); }
        return;
      }
    }
    if (t.dataset.tab || act === 'home') { view.tab = t.dataset.tab || 'home'; view.editing = null; view.note = null; view.place = null; view.region = null; view.mapEdit = false; view.dex = null; view.wiki = null; view.questOpen = null; view.dream = null; view.npc = null; return render(); }
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
    if (t.dataset.npctab) { view.npcTab = t.dataset.npctab; return render(); }
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
    if (t.dataset.questtab) { view.questTab = t.dataset.questtab; view.questOpen = null; return render(); }
    if (t.dataset.questopen) { view.questOpen = t.dataset.questopen; return render(); }
    if (t.dataset.logmode) { codex().log.mode = t.dataset.logmode === 'relic' ? 'relic' : 'diary'; saveChat(); return render(); }
    if (t.dataset.relicvol) { view.relicVol = Number(t.dataset.relicvol) || 1; render(); D.querySelector(`#${ROOT_ID} .xsj-body`).scrollTop = 0; return; }
    if (t.dataset.dexcat) { view.dexCat = t.dataset.dexcat; return render(); }
    if (t.dataset.wiki) { view.wiki = t.dataset.wiki; render(); D.querySelector(`#${ROOT_ID} .xsj-body`).scrollTop = 0; return; }
    if (t.dataset.wikicat) { view.wikiCat = t.dataset.wikicat; return render(); }
    if (t.dataset.place) { if (!view.mapEdit) { view.place = t.dataset.place; view.region = null; render(); } return; }
    if (t.dataset.region) { if (!view.mapEdit) { view.region = view.region === t.dataset.region ? null : t.dataset.region; view.place = null; render(); } return; }
    if (t.dataset.xtab) { view.xTab = t.dataset.xtab; view.xMenu = false; render(); D.querySelector(`#${ROOT_ID} .xsj-body`).scrollTop = 0; return; }
    if (act === 'x-menu') { view.xMenu = !view.xMenu; return render(); }
    if (['x-reveal', 'gen-x', 'x-pic-all'].includes(act)) view.xMenu = false;
    if (t.dataset.xopen) { view.xOpen = { ...(view.xOpen || {}), [t.dataset.xopen]: !view.xOpen?.[t.dataset.xopen] }; return render(); }
    if (t.dataset.gonote) { view.tab = 'mon'; view.note = t.dataset.gonote; return render(); }
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
    if (t.dataset.glass) { settings.glass = t.dataset.glass; saveSettings(settings); return render(); }
    if (t.dataset.owner) { settings.owner = t.dataset.owner; saveSettings(settings); return render(); }
    switch (act) {
      case 'prev': return shiftMonth(-1);
      case 'next': return shiftMonth(1);
      case 'add-item': view.editing = { id: '', date: view.day, time: '', title: '', place: '', end: '', note: '', type: '私事' }; return render();
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
          const m = String(e.end || '').trim().match(/^(\d{3,4})-(\d{1,2})-(\d{1,2})$/);
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
        if (!mpx) return generateMap(false);
        const v = await askRegen(mpx.name || '地图', mpx.places.filter((p) => !p.fog).length, '个地点', '重新画，自己加的、挪过的、迷雾地点会保留');
        if (v) return generateMap(v === 'add');
        return;
      }
      case 'zoom-in': view.mapZoom = Math.min(3, (view.mapZoom || 1) + 0.5); return render();
      case 'zoom-out': view.mapZoom = Math.max(1, (view.mapZoom || 1) - 0.5); return render();
      case 'map-edit': view.mapEdit = !view.mapEdit; view.place = null; return render();
      case 'place-close': view.place = null; return render();
      case 'region-close': view.region = null; return render();
      case 'gen-fog': return generateFog();
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
        if (!currentWorld()) return generateWorld(false);
        const v = await askChoice('世界地图要怎么更新？', [
          { v: 'add', label: '保留现在的，再打听更远的地方', primary: true },
          { v: 'reset', label: '全部重新画（去过的地方还是亮的）', danger: true },
        ]);
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
        if (!n) return generateX();
        const v = await askRegen('X 浏览记录', n, '条', '换一批，收藏过的会留着');
        if (v) return generateX(v === 'add');
        return;
      }
      case 'x-reveal': view.xReveal = !view.xReveal; return render();
      case 'wp-draw': {
        const desc = D.getElementById('xsj-wp-desc')?.value.trim() || '';
        const withChar = !!D.getElementById('xsj-wp-char')?.checked;
        let tag = '';
        if (withChar) {
          try {
            const list = W.STBaiBaiImage?.getCharacters?.().characters || [];
            const me = list.find((c) => c.name === charKey()) || list.find((c) => charKey().includes(c.name) || c.name.includes(charKey()));
            tag = me?.tag || '';
            if (!tag) toast(`柏宝绘角色库里没找到 ${charKey()} 的外貌，这次只画风景`, 'warning');
          } catch (e) {}
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
        if (!todo.length) return;
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
        if (!todo.length) return;
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
      case 'log-pic-all': return batchDraw(codex().log.items.filter((e) => !e.pic), drawLogPic, '页手记');
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
      case 'gen-log': return generateLog();
      case 'log-pic': {
        const e = codex().log.items.find((o) => o.id === t.dataset.id);
        if (e) await drawLogPic(e, '正在画');
        return;
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
      case 'gen-quest': view.questOpen = null; return generateQuest();
      case 'quest-close': view.questOpen = null; return render();
      case 'quest-done': case 'quest-undo': case 'quest-drop': {
        const Q = codex().quest;
        const q = Q.items.find((o) => o.id === t.dataset.id);
        if (!q) return;
        if (act === 'quest-drop') {
          if (!(await ask(`不接「${q.title}」了？会从板子上撕掉。`, '撕掉'))) return;
          Q.items = Q.items.filter((o) => o !== q); view.questOpen = null;
        } else if (act === 'quest-done') { q.status = 'done'; q.doneAt = dateKey(storyDate()); toast(`✓ 完成：${q.title}`, 'success'); }
        else { q.status = 'open'; q.doneAt = ''; }
        saveChat(); return render();
      }
      case 'gen-omen': return generateOmen();
      case 'omen-pic': {
        const o = codex().omen.items.find((x) => x.id === t.dataset.id);
        if (o) await drawOmenPic(o, '正在画');
        return;
      }
      case 'omen-del': {
        const O = codex().omen;
        if (!(await ask('删掉这一卦？', '删除'))) return;
        O.items = O.items.filter((x) => x.id !== t.dataset.id); saveChat(); return render();
      }
      case 'gen-relic': return generateRelic();
      case 'relic-read': {
        const p = relicPages().find((o) => o.id === t.dataset.id);
        if (!p || !(await ask('不等剧情，直接看懂这一页？（想让角色在剧情里帮忙读，就点「📎 带进剧情」）', '直接读懂'))) return;
        readRelicPage(p, '自己摸索读懂'); saveChat(); return render();
      }
      case 'relic-pic': {
        const p = relicPages().find((o) => o.id === t.dataset.id);
        if (p) await drawRelicPic(p, '正在画');
        return;
      }
      case 'relic-pic-all': {
        const R = codex().log.relic;
        const vol = Math.min(Math.max(1, view.relicVol || 1), Math.max(1, R?.vols?.length || 1));
        const todo = relicPages().filter((p) => !p.pic && (!R?.vols?.length || p.vol === vol));
        if (!todo.length) return;
        if (!(await ask(`把这一卷还没图的 ${todo.length} 页图案一张张画出来？中途可以取消。`, `画 ${todo.length} 张`))) return;
        batchStop = false;
        let done = 0;
        for (const [i, p] of todo.entries()) {
          if (batchStop) break;
          view.batch = `${i + 1}/${todo.length}`;
          if (await drawRelicPic(p, `画图案 ${i + 1}/${todo.length}`)) done++;
          else if (batchStop) break;
        }
        toast(batchStop ? `已取消，画好了 ${done} 张` : `画好了 ${done}/${todo.length} 张`, done ? 'success' : 'warning');
        batchStop = false; view.batch = null; render();
        return;
      }
      case 'log-del': {
        const L = codex().log;
        const e = L.items.find((o) => o.id === t.dataset.id);
        if (!e || !(await ask(`撕掉「${e.title}」这一页？`, '删除'))) return;
        L.items = L.items.filter((o) => o !== e); saveChat(); return render();
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
          if (!n) return generate(parts, view.month);
          const v = await askRegen(`${monthName(+view.month.split('-')[1])}日程`, n, '条', '换掉 AI 生成的日程和节日，自己记的会保留');
          if (!v) return;
          return generate(parts, view.month, v === 'add');
        }
        if (parts.join() === 'events') {
          const c = await askEvents(md.events.length);
          if (!c) return;
          return generate(parts, view.month, c.add && md.events.length > 0, { newNpc: c.npc });
        }
        const cnt = (parts.includes('schedule') ? md.schedule.filter((x) => !x.manual).length : 0) + (parts.includes('events') ? md.events.length : 0) + (parts.includes('notes') ? notesFor(md).items.length : 0) + (parts.includes('cart') ? md.cart.length : 0);
        const mName = monthName(+view.month.split('-')[1]);
        const what = parts.length > 2 ? `${mName}的内容` : parts.includes('events') ? `${mName}随机事件` : parts.includes('notes') ? `${mName}小红书` : parts.includes('cart') ? `${mName}购物车` : `${mName}的内容`;
        if (cnt) {
          const v = await askRegen(what, cnt, '条', '换掉 AI 生成的，自己记的、★事件、已买的会保留');
          if (!v) return;
          return generate(parts, view.month, v === 'add');
        }
        const has = false && (parts.includes('cart') && md.cart.some((x) => !x.bought));
        if (has && !(await ask('会替换这部分已生成的内容（自己记的、★事件、已买的会保留），继续吗？', '重新生成'))) return;
        return generate(parts, view.month);
      }
      case 'cancel-gen': return cancelGen();
      case 'regen-calnames': chat.calNamesDone = false; return generate(['calnames'], view.month);
      case 'plain-calnames': chat.calNames = null; chat.calNamesDone = true; saveChat(); return render();
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
    const root = D.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `<div class="xsj-phone"><div class="xsj-notch"></div><button class="xsj-close" title="关闭">×</button><div class="xsj-resize" title="拖动调整大小（双击恢复默认大小）"><svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 1h5L4.3 2.7l7 7L13 8v5H8l1.7-1.7-7-7L1 6z"/></svg></div><div class="xsj-drag" title="拖动小手机（双击回到默认位置）"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 1 5.6 3.4h1.6V7.2H3.4V5.6L1 8l2.4 2.4V8.8h3.8v3.8H5.6L8 15l2.4-2.4H8.8V8.8h3.8v1.6L15 8l-2.4-2.4v1.6H8.8V3.4h1.6z"/></svg></div><div class="xsj-screen"></div></div>`;
    setupPhoneDrag(root);
    setupPhoneResize(root);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', (ev) => {
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
.xsj-phone{position:relative;width:340px;max-width:calc(100vw - 32px);height:680px;max-height:calc(100vh - 90px);max-height:calc(100dvh - 90px);background:#1d1a20;border-radius:42px;padding:10px;box-shadow:0 18px 50px rgba(0,0,0,.35)}
.xsj-notch{position:absolute;top:16px;left:50%;transform:translateX(-50%);width:84px;height:22px;border-radius:12px;background:#1d1a20;z-index:3}
.xsj-close{position:absolute!important;top:-10px;right:-10px;width:30px;height:30px;border-radius:50%;background:#fff!important;box-shadow:0 2px 8px rgba(0,0,0,.25);font-size:18px;z-index:4}
.xsj-screen{position:relative;height:100%;border-radius:34px;overflow:hidden;background:linear-gradient(180deg,#fff7f9 0%,#fbf8ff 100%);display:flex;flex-direction:column}
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
.xsj-wlabel{font-size:3.1px;font-weight:700;text-anchor:middle;fill:#4a3b30;paint-order:stroke;stroke:rgba(255,255,255,.75);stroke-width:.7px}
.xsj-wland.is-fog .xsj-wlabel{fill:#6d7780}
.xsj-mapctl{position:absolute;left:8px;bottom:8px;display:flex;gap:5px;z-index:2}
#${ROOT_ID} .xsj-mapctl button{min-width:30px;height:28px;padding:0 8px!important;border-radius:9px;font-size:13px;background:rgba(255,255,255,.88)!important;border:1px solid rgba(0,0,0,.06)!important;box-shadow:0 2px 6px rgba(80,40,60,.15)!important;color:#5a4650!important}
#${ROOT_ID} .xsj-mapctl button.on{background:#e86a95!important;color:#fff!important}
.xsj-mapframe.has-bg .xsj-region>rect:first-child{fill-opacity:.28}
.xsj-map{display:block;height:auto;user-select:none;-webkit-user-select:none}
.xsj-map.is-edit{touch-action:none;cursor:crosshair}
.xsj-region rect{stroke:#fff;stroke-width:.6;opacity:.95}
.xsj-rlabel{font-size:3px;font-weight:700;fill:#8a7a8c;letter-spacing:.1px}
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
@media (max-height:560px){.xsj-close{top:4px!important;right:4px!important;width:26px!important;height:26px!important;font-size:16px!important}.xsj-drag{left:4px!important;bottom:4px!important;width:26px!important;height:26px!important}.xsj-resize{left:4px!important;top:4px!important;width:26px!important;height:26px!important}.xsj-phone{border-radius:28px;padding:6px}.xsj-screen{border-radius:22px!important}.xsj-notch{display:none}.xsj-status{padding-top:8px!important}}

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
#${ROOT_ID} .xsj-screen:not(.has-wp):not(.tone-dark) .xsj-day.is-sel{background:#fff!important;box-shadow:0 2px 10px rgba(232,106,149,.22)}
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
.xsj-home-clock{text-align:center;margin:18px 0 22px;text-shadow:0 1px 8px rgba(255,255,255,.9)}
.xsj-home-clock b{display:block;font-size:32px;font-weight:300;letter-spacing:1px}.xsj-home-clock small{font-size:12px;opacity:.7}
.xsj-appgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px 4px}
#${ROOT_ID} .xsj-app{position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;padding:0!important;font-size:11px;min-width:0}
#${ROOT_ID} .xsj-app>i{width:54px;height:54px;border-radius:15px;display:flex;align-items:center;justify-content:center;font-style:normal;font-size:27px;line-height:1;color:#fff;box-shadow:0 4px 12px rgba(40,20,40,.18),inset 0 1px 0 rgba(255,255,255,.35)}
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
#${ROOT_ID} .tone-dark :is(.xsj-home-clock,.xsj-app>span){text-shadow:0 1px 6px rgba(0,0,0,.7)}
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
/* 📇 人物志 */
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
          <small>也可以从输入框左边的魔棒菜单打开。API、谁的手机、剧情日期在小手机的「设置」页里改。</small>
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
