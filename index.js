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
      return { ...d, ...v, api: { ...d.api, ...(v.api || {}) } };
    } catch (e) { return defaultSettings(); }
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
  const view = { tab: 'cal', month: '', day: '', editing: null, busy: null, note: null, noteCat: '推荐', place: null, mapEdit: false, mapZoom: 1 };

  // ---------- 工具 ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const ym = (y, m) => `${y}-${pad(m)}`;
  const toast = (msg, kind = 'info') => { try { W.toastr?.[kind]?.(msg, '小手机'); } catch (e) {} };
  // 旧数据里 type 为“节日”的日程挪到 holidays
  const monthData = (key) => {
    const md = (chat.months[key] ||= { schedule: [], events: [], season: null, trends: [] });
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
      worldOnly ? `只根据上面的世界观设定来写，符合年代、地区与社会环境，不涉及主线剧情。` : `根据上面的人物设定、世界观与最近剧情来写，符合年代、地区与身份。`,
    ];
  }
  const WORLD_ONLY_PARTS = ['season', 'notes'];

  async function generate(parts, monthKey) {
    if (view.busy) return;
    // 生日和纪念日只在第一次生成日历时识别一次，之后固定
    if (!chat.birthdaysDone && (parts.includes('holidays') || parts.includes('schedule')) && !parts.includes('birthdays')) parts = [...parts, 'birthdays'];
    const [y, m] = monthKey.split('-').map(Number);
    const md = monthData(monthKey);
    const keepManual = md.schedule.filter((x) => x.manual).map((x) => `${x.date} ${x.time} ${x.title}`).join('；');
    const worldOnly = parts.every((p) => WORLD_ONLY_PARTS.includes(p));
    const instr = [
      ...baseInstr(y, m, worldOnly),
      keepManual && parts.includes('schedule') ? `下面这些是主人自己记的日程，不要重复也不要冲突：${keepManual}` : '',
      !worldOnly && parts.includes('notes') ? `注意：notes 只依据世界观设定来写，不要用最近剧情和主要角色。` : '',
      `JSON 结构（只包含这些字段）：\n{\n  ${parts.map((p) => PART_SPEC[p]).join(',\n  ')}\n}`,
    ].filter(Boolean).join('\n');
    const data = await callAI(instr, `正在生成${y}年${m}月…`, parts.some((p) => ['birthdays', 'holidays', 'notes'].includes(p)), worldOnly);
    if (!data) return;
    {
      if (parts.includes('season') && data.season) md.season = data.season;
      if (parts.includes('notes') && data.notes && Array.isArray(data.notes.items)) {
        md.notes = {
          platform: String(data.notes.platform || '本月热帖').trim(),
          items: data.notes.items.filter((x) => x && x.title).slice(0, 12).map((x) => ({
            id: uid(), cat: NOTE_CATS.includes(x.cat) ? x.cat : '生活', emoji: String(x.emoji || '').trim() || CAT_EMOJI[x.cat] || '✨',
            title: String(x.title).trim(), author: String(x.author || '匿名').trim(), likes: Math.max(0, Math.round(Number(x.likes) || 0)),
            text: String(x.text || '').trim(), tags: Array.isArray(x.tags) ? x.tags.map(String).slice(0, 4) : [], img: String(x.img || '').trim(), pic: '',
            comments: Array.isArray(x.comments) && x.comments.length
              ? x.comments.filter((c) => c && c.text).slice(0, 6).map((c) => ({ name: String(c.name || '匿名'), text: String(c.text), likes: Math.max(0, Math.round(Number(c.likes) || 0)) }))
              : null,
          })),
        };
        md.trends = [];
      }
      if (parts.includes('schedule') && Array.isArray(data.schedule)) {
        const ai = data.schedule
          .filter((x) => x && x.title && /^\d{3,4}-\d{1,2}-\d{1,2}$/.test(String(x.date || '').trim()))
          .map((x) => {
            const [a, b, c] = String(x.date).trim().split('-').map(Number);
            return { id: uid(), date: `${a}-${pad(b)}-${pad(c)}`, time: String(x.time || '').trim(), title: String(x.title).trim(), place: String(x.place || '').trim(), type: TYPES.includes(x.type) ? x.type : '工作' };
          });
        md.schedule = [...md.schedule.filter((x) => x.manual), ...ai];
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
        md.holidays = [...md.holidays.filter((x) => x.manual), ...hs];
      }
      if (parts.includes('birthdays') && Array.isArray(data.birthdays)) {
        const bs = data.birthdays
          .map((x) => ({ x, m: String(x?.date || '').trim().match(/(\d{1,2})\D+(\d{1,2})\D*$/) }))
          .filter(({ x, m }) => x && x.who && m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31)
          .map(({ x, m }) => ({ id: uid(), who: String(x.who).trim(), md: `${pad(m[1])}-${pad(m[2])}`, kind: x.kind === '纪念日' ? '纪念日' : '生日', note: String(x.note || '').trim() }));
        chat.birthdays = [...chat.birthdays.filter((x) => x.manual), ...bs];
        chat.birthdaysDone = true;
      }
      if (parts.includes('cart') && Array.isArray(data.cart)) {
        md.cart = [...md.cart.filter((x) => x.bought), ...data.cart.filter((x) => x && x.name).slice(0, 10).map((x) => ({ id: uid(), emoji: String(x.emoji || '🛍'), name: String(x.name).trim(), price: String(x.price || '').trim(), note: String(x.note || '').trim(), bought: false }))];
      }
      if (parts.includes('events') && Array.isArray(data.events)) {
        md.events = [...md.events.filter((x) => x.star), ...data.events.filter((x) => x && x.title).map((x) => ({ id: uid(), title: String(x.title), desc: String(x.desc || ''), date: String(x.date || ''), who: String(x.who || ''), used: false, star: false }))];
      }
      md.generatedAt = Date.now();
      saveChat();
      toast(`${m}月的内容已更新`, 'success');
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
    }, label);
    if (pic) { it.pic = pic; saveChat(); render(); }
    return !!pic;
  }
  async function drawNotePic(n, label) {
    const tags = cleanTags(n.img);
    const pic = await drawImage({ prompt: tags || 'no humans, aesthetic photo, soft lighting, detailed, full frame', nl: tags ? '' : `${n.title}。${n.text}`, size: 'portrait' }, label);
    if (pic) { n.pic = pic; saveChat(); render(); }
    return !!pic;
  }
  function cancelGen() {
    batchStop = true;
    try { if (genId) stopGenerationById(genId); } catch (e) {}
    try { imgAbort?.abort(); } catch (e) {}
    genId = null; view.busy = null; render();
  }

  // ---------- 出图：借柏宝绘（NovelAI）的公开接口，Key 和排队限流都由柏宝绘管 ----------
  let imgAbort = null;
  const IMG_PHASE = { queued: '排队中', generating: '正在画', 'queued-remote': '排队中', retrying: '被限流，重试中', saving: '正在保存' };
  // 成功返回图片地址（柏宝绘图库里的文件路径，存不了时退回 dataUrl）；失败或取消返回 ''
  async function drawImage({ prompt, nl = '', size = 'portrait' }, label) {
    if (view.busy) return '';
    const api = W.STBaiBaiImage;
    if (!api || typeof api.generate !== 'function') { toast('需要先启用「柏宝绘」扩展', 'warning'); return ''; }
    const st = api.getBackendStatus?.();
    if (st && !st.configured) { toast(`柏宝绘还没配好：${st.reason}`, 'warning'); return ''; }
    imgAbort = new AbortController();
    view.busy = label; render();
    try {
      const r = await api.generate(
        { prompt: String(prompt || '').trim() || 'scenery', nl: String(nl || '').trim(), size, save: true, character: charKey() },
        { signal: imgAbort.signal, onProgress: (p) => { if (view.busy) { view.busy = `${label}（${IMG_PHASE[p.phase] || p.phase}${p.attempt ? ` ${p.attempt}/${p.max}` : ''}）`; render(); } } },
      );
      return r.path || r.dataUrl || '';
    } catch (e) {
      if (e?.code !== 'aborted') toast(e?.code === 'rate_limited' ? '被 NovelAI 限流了，稍后再试' : `出图失败：${e?.message || e}`, 'error');
      return '';
    } finally {
      imgAbort = null; view.busy = null; render();
    }
  }

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

  // ---------- 渲染 ----------
  function statusBar() {
    const sd = storyDate();
    // 右边是手画的信号、Wi-Fi、电池图标（以前用文字符号拼的，在不同字体下会变形）
    const icons = `<span class="xsj-sicons">
      <svg width="17" height="11" viewBox="0 0 17 11"><rect x="0" y="7.5" width="3" height="3.5" rx=".9"/><rect x="4.6" y="5" width="3" height="6" rx=".9"/><rect x="9.2" y="2.5" width="3" height="8.5" rx=".9"/><rect x="13.8" y="0" width="3" height="11" rx=".9"/></svg>
      <svg width="15" height="11" viewBox="0 0 15 11"><path d="M7.5 10.6 9.8 8a3.3 3.3 0 0 0-4.6 0z"/><path d="M3 5.7a6.6 6.6 0 0 1 9 0l-1.4 1.6a4.5 4.5 0 0 0-6.2 0z"/><path d="M.3 2.7a10.5 10.5 0 0 1 14.4 0l-1.4 1.6a8.4 8.4 0 0 0-11.6 0z"/></svg>
      <svg width="25" height="12" viewBox="0 0 25 12"><rect x=".6" y=".6" width="21" height="10.8" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".45"/><rect x="2.3" y="2.3" width="15" height="7.4" rx="1.8"/><rect x="22.6" y="4" width="1.8" height="4" rx=".9" opacity=".45"/></svg>
    </span>`;
    return `<div class="xsj-status"><span class="xsj-sdate">${sd.m}月${sd.d}日</span>${icons}</div>`;
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
    const empty = !md.schedule.length ? `<div class="xsj-empty">这个月还没有日程<br><button data-act="gen" data-parts="schedule,holidays" class="xsj-primary">🗓 生成${m}月日程和节日</button><div class="xsj-hint">想一次生成所有页面，去「设置」</div></div>` : '';
    const selDate = view.day ? new Date(+view.day.slice(0, 4), +view.day.split('-')[1] - 1, +view.day.split('-')[2]) : null;
    const wk = selDate ? '周' + '日一二三四五六'[selDate.getDay()] : '';
    const items = list.map((it) => `<button class="xsj-item" data-item="${it.id}"><i style="background:${TYPE_COLOR[it.type] || '#999'}"></i><span class="xsj-time">${esc(it.time || '—')}</span><span class="xsj-title">${esc(it.title)}${it.place ? `<small>${esc(it.place)}</small>` : ''}</span><em>${esc(it.type)}${it.manual ? ' · 自记' : ''}</em></button>`).join('');
    return `
      <div class="xsj-cal">
        <div class="xsj-week">${'一二三四五六日'.split('').map((w, i) => `<span${i >= 5 ? ' class="is-wkd"' : ''}>${w}</span>`).join('')}</div>
        <div class="xsj-grid">${cells}</div>
      </div>
      <div class="xsj-daycard">
      <div class="xsj-dayhead"><span>${view.day ? `<b class="xsj-dbig">${+view.day.split('-')[2]}</b><span class="xsj-dsub">${+view.day.split('-')[1]}月 · ${wk}</span>` : ''}${dayHols.map((h) => `<button class="xsj-holpill${h.kind === VAC ? ' xsj-vacpill' : ''}" data-hol="${h.id}">${esc(h.name)}</button>`).join('')}${dayBds.map((b) => `<button class="xsj-holpill xsj-bdpill" data-bd="${b.id}">${b.kind === '纪念日' ? '💝' : '🎂'}${esc(b.who)}</button>`).join('')}</span><button data-act="add-item" title="添加">＋</button></div>
      ${dayBds.filter((b) => b.note).map((b) => `<div class="xsj-bdnote">${b.kind === '纪念日' ? '💝' : '🎂'} ${esc(b.who)}${b.kind === '纪念日' ? '' : '生日'}：${esc(b.note)}</div>`).join('')}
      ${form}
      ${items || (md.schedule.length ? '<div class="xsj-none">这天没有安排</div>' : '')}
      </div>
      ${empty}
      ${md.schedule.length ? `<button data-act="gen" data-parts="schedule,holidays" class="xsj-regen">↻ 重新生成本月日程和节日（保留自记）</button>` : ''}`;
  }

  function eventsView() {
    const md = monthData(view.month);
    const [, m] = view.month.split('-').map(Number);
    if (!md.events.length) return `<div class="xsj-empty">还没有${m}月的随机事件<br><button data-act="gen" data-parts="events" class="xsj-primary">🎲 生成随机事件</button></div>`;
    return md.events.map((e) => `
      <div class="xsj-card${e.used ? ' is-used' : ''}">
        <div class="xsj-card-top"><b>${esc(e.title)}</b><span><button data-act="star" data-id="${e.id}" title="收藏，重新生成时保留">${e.star ? '★' : '☆'}</button><button data-act="used" data-id="${e.id}" title="用过了">${e.used ? '↺' : '✓'}</button></span></div>
        <div>${esc(e.desc)}</div>
        ${e.date || e.who ? `<small>${esc([e.date, e.who].filter(Boolean).join(' · '))}</small>` : ''}
      </div>`).join('') + `<button data-act="gen" data-parts="events" class="xsj-regen">↻ 换一批（保留★）</button>`;
  }

  function monthView() {
    const md = monthData(view.month);
    const [, m] = view.month.split('-').map(Number);
    const nb = notesFor(md);
    if (!md.season && !nb.items.length) return `<div class="xsj-empty">还没有${m}月的季节和热帖<br><button data-act="gen" data-parts="season,notes" class="xsj-primary">📕 生成本月小红书</button></div>`;
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
        ${n.pic
          ? `<img class="xsj-cover xsj-cover-img" src="${esc(n.pic)}" style="height:${h + 30}px" alt="" loading="lazy">`
          : `<div class="xsj-cover" style="height:${h}px;background:linear-gradient(160deg,${g1},${g2})"><span>${esc(n.emoji)}</span></div>`}
        <div class="xsj-note-t">${esc(n.title)}</div>
        <div class="xsj-note-f"><i style="background:${g2}">${esc([...n.author][0] || '?')}</i><span>${esc(n.author)}</span><em>♡ ${fmtLikes(n.likes)}</em></div>
      </button>`;
    }).join('');
    return `
      <div class="xsj-xbar"><div class="xsj-plat" style="margin:0">🔥 ${esc(nb.platform)}</div>${nb.items.some((n) => !n.pic) ? '<button data-act="note-pic-all" class="xsj-mini">🖼 一键生图</button>' : ''}</div>
      ${season}
      ${nb.items.length ? `<div class="xsj-cats">${cats.map((c) => `<button data-cat="${c}" class="${c === cur ? 'on' : ''}">${c}</button>`).join('')}</div>
      <div class="xsj-flow">${cards}</div>` : `<div class="xsj-none">还没有热帖</div>`}
      <button data-act="gen" data-parts="season,notes" class="xsj-regen">↻ 重新生成本月</button>`;
  }

  function cartView() {
    const md = monthData(view.month);
    const [, m] = view.month.split('-').map(Number);
    if (!md.cart.length) return `<div class="xsj-empty">${m}月的购物车还是空的<br><button data-act="gen" data-parts="cart" class="xsj-primary">🛒 看看购物车</button></div>`;
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
        ${xl.items.some((x) => (x.media || x.img) && !x.pic) ? '<button data-act="x-pic-all">🖼 一键生图</button>' : ''}
        <button data-act="x-reveal">${reveal ? '🙈 全部打码' : '👁 全部显示'}</button>
        <button data-act="gen-x">↻ 刷新浏览记录</button>
      </div>` : '';
    const head = `
      <div class="xsj-xhead">
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
      <button data-act="gen-x" class="xsj-regen">↻ 刷新浏览记录</button>
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
    if (hide && (it.pic || it.media)) {
      media = `<div class="xsj-xwarn">${XI.eyeOff}<b>内容警告：成人内容</b><span>该帖子被标记为包含成人内容。</span><button data-xopen="${it.id}">显示</button></div>`;
    } else if (it.pic) {
      media = `<img class="xsj-xpic" src="${esc(it.pic)}" alt="" loading="lazy">`;
    } else if (it.media) {
      media = `<div class="xsj-xmedia">${esc(it.media)}</div>`;
    }
    const draw = (it.media || it.img) ? `<button class="xsj-xdraw" data-act="x-pic" data-id="${it.id}">${it.pic ? '↻ 重画' : '🖼 出图'}</button>` : '';
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
              <span class="xsj-xsm">${XI.share}</span>
            </div>
            ${it.note ? `<div class="xsj-xnote2">💭 ${esc(it.note)}</div>` : ''}
          </div>
        </div>
      </div>`;
  }

  async function generateX() {
    if (view.busy) return;
    const sd = storyDate();
    const instr = [
      ...baseInstr(sd.y, sd.m),
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
      asOf: `${sd.m}月${sd.d}日`,
      searches: (Array.isArray(g.searches) ? g.searches : []).map(String).slice(0, 8),
      items: [
        ...items.filter((x) => x && (x.text || x.media)).slice(0, 16).map((x) => ({
          id: uid(), time: String(x.time || ''), kind: X_KINDS[x.kind] ? x.kind : '浏览', author: String(x.author || '匿名'), handle: String(x.handle || ''),
          text: String(x.text || ''), media: String(x.media || ''), img: String(x.img || ''), pic: '', note: String(x.note || ''), nsfw: x.nsfw !== false, saved: x.kind === '收藏',
        })),
        // 以前收藏过的留着，沉在最下面
        ...old.filter((x) => x.saved).slice(0, 10).map((x) => ({ ...x, time: x.time.startsWith('更早') ? x.time : `更早 · ${x.time}` })),
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
      ${n.pic
        ? `<img class="xsj-cover xsj-cover-big xsj-cover-img" src="${esc(n.pic)}" alt="">`
        : `<div class="xsj-cover xsj-cover-big" style="background:linear-gradient(160deg,${g1},${g2})"><span>${esc(n.emoji)}</span></div>`}
      <button class="xsj-xdraw" data-act="note-pic">${n.pic ? '↻ 重画封面' : '🖼 生成封面'}</button>
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
    const a = settings.api;
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
        <div class="xsj-set-h">🎂 生日和纪念日 <small>每年固定显示</small></div>
        ${chat.birthdays.length
          ? chat.birthdays.slice().sort((a, b) => a.md.localeCompare(b.md)).map((b) => `<div class="xsj-fixed"><span>${b.kind === '纪念日' ? '💝' : '🎂'} ${esc(b.who)}</span><em>${+b.md.split('-')[0]}月${+b.md.split('-')[1]}日${b.manual ? ' · 自记' : ''}</em></div>`).join('')
          : `<small class="xsj-set-tip">${chat.birthdaysDone ? '设定里没找到写明日期的，可以在日历点「＋」选「生日」自己加' : '第一次生成日历时会找一次，之后固定'}</small>`}
        <button data-act="regen-bd" class="xsj-regen">↻ 重新从设定里找（保留自记）</button>
      </div>

      <div class="xsj-card xsj-set">
        <div class="xsj-set-h">🔌 生成用的 API</div>
        <label class="xsj-check"><input type="checkbox" data-set="useTavern" ${a.useTavern ? 'checked' : ''}> 用酒馆当前连接的 API</label>
        <div class="${a.useTavern ? 'xsj-off' : ''}">
          <div class="xsj-row2"><input data-set="url" placeholder="地址，如 https://xxx/v1" value="${esc(a.url)}" autocomplete="off" autocapitalize="off" spellcheck="false"><button data-act="paste" data-for="url" class="xsj-nowrap" title="粘贴">📋</button></div>
          <div class="xsj-row2"><input data-set="key" type="text" class="xsj-secret" placeholder="Key" value="${esc(a.key)}" autocomplete="off" autocapitalize="off" spellcheck="false"><button data-act="peek" class="xsj-nowrap" title="显示/隐藏">👁</button><button data-act="paste" data-for="key" class="xsj-nowrap" title="粘贴">📋</button></div>
          <div class="xsj-row2"><input data-set="model" list="xsj-models" placeholder="模型名" value="${esc(a.model)}"><button data-act="models" class="xsj-nowrap">获取模型</button></div>
          <datalist id="xsj-models"></datalist>
          <small class="xsj-set-tip">Key 只存在这台电脑的酒馆设置里，不会写进聊天。</small>
        </div>
      </div>
      <button data-act="save-set" class="xsj-primary xsj-block">保存设置</button>
      ${lastRaw ? `<details class="xsj-raw"><summary>上次没解析成功的 AI 返回（排查用）</summary><pre>${esc(lastRaw)}</pre></details>` : ''}`;
  }

  function render() {
    const root = D.getElementById(ROOT_ID);
    if (!root) return;
    const [y, m] = view.month.split('-').map(Number);
    const titles = { cal: '日程', map: '地图', ev: '随机事件', mon: '小红书', x: 'X', set: '设置' };
    const body = { cal: calView, map: mapView, ev: eventsView, mon: monthView, x: xView, set: settingsView }[view.tab]();
    const busy = view.busy ? `<div class="xsj-busy"><div class="xsj-spin"></div><div>${esc(view.busy)}</div><button data-act="cancel-gen">取消</button></div>` : '';
    const scr = root.querySelector('.xsj-screen');
    scr.classList.toggle('has-wp', !!settings.wallpaper);
    scr.classList.toggle('tone-dark', glassTone() === 'dark');
    // 小红书和 X 像真的 App 一样整屏实心底色，不透壁纸
    scr.classList.toggle('app-white', view.tab === 'x' || view.tab === 'mon');
    if (settings.wallpaper && !settings.wpTone) measureTone();
    if (settings.wallpaper) scr.style.setProperty('--xsj-wp', `url("${settings.wallpaper.replace(/"/g, '%22')}")`);
    else scr.style.removeProperty('--xsj-wp');
    const isMap = view.tab === 'map';
    const noNav = isMap || view.tab === 'x';
    const sub = isMap ? `${esc(currentMap()?.name || '还没有地图')} · ${esc(charKey())}`
      : view.tab === 'x' ? `${esc(charKey())} 的浏览记录`
      : `${y}年${m}月 · ${esc(ownerName())}`;
    const prevScroll = root.querySelector('.xsj-mapwrap');
    const keep = prevScroll ? [prevScroll.scrollLeft, prevScroll.scrollTop] : null;
    root.querySelector('.xsj-screen').innerHTML = `
      ${statusBar()}
      ${view.tab === 'x' && chat.xlog?.items?.length ? '' : `<div class="xsj-head">
        ${noNav ? '<span></span>' : '<button data-act="prev">‹</button>'}
        <div><b>${titles[view.tab]}</b><small>${sub}</small></div>
        ${noNav ? '<span></span>' : '<button data-act="next">›</button>'}
      </div>`}
      <div class="xsj-body${isMap ? ' xsj-body-map' : ''}${view.tab === 'x' ? ' xsj-body-x' : ''}">${body}</div>
      <nav class="xsj-tabs">${[['cal', '🗓', '日程'], ['map', '🗺', '地图'], ['ev', '🎲', '随机'], ['mon', '📕', '小红书'], ['x', '𝕏', 'X'], ['set', '⚙', '设置']].map(([k, i, t]) => `<button data-tab="${k}" class="${view.tab === k ? 'on' : ''}"><span>${i}</span>${t}</button>`).join('')}</nav>
      ${busy}`;
    const wrap = root.querySelector('.xsj-mapwrap');
    if (wrap && keep && isMap) { wrap.scrollLeft = keep[0]; wrap.scrollTop = keep[1]; }
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
    const mp = currentMap();
    if (!mp) return `<div class="xsj-empty">${esc(charKey())} 还没有地图<br><button data-act="gen-map" class="xsj-primary">🗺 生成地图</button><div class="xsj-hint">读打开的世界书和最近剧情，画出故事主要发生的那片地方。生成一次就固定，同一张卡的所有聊天共用。</div></div>`;
    const loc = detectLocation();
    const here = matchPlace(mp, loc);
    const zoom = view.mapZoom || 1;
    const regions = mp.regions.map((r, i) => `
      <g class="xsj-region">
        <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="5" fill="${esc(r.color || REGION_COLORS[i % REGION_COLORS.length])}" />
        <text x="${r.x + 2}" y="${r.y + 4.2}" class="xsj-rlabel">${esc(r.name)}</text>
      </g>`).join('');
    const pins = mp.places.map((p) => `
      <g class="xsj-pin${p.id === view.place ? ' is-sel' : ''}${here && p.id === here.id ? ' is-here' : ''}" data-place="${p.id}" transform="translate(${p.x} ${p.y})">
        ${here && p.id === here.id ? '<circle r="6.4" class="xsj-pulse" />' : ''}
        <circle r="4.3" class="xsj-pin-bg" />
        <text class="xsj-pin-e" y="1.5">${esc(p.emoji || '📍')}</text>
        <text class="xsj-pin-n" y="7.8">${esc(p.name)}</text>
      </g>`).join('');
    const sel = mp.places.find((p) => p.id === view.place);
    const locLine = loc
      ? (here ? `<div class="xsj-loc">📍 你在这：<b>${esc(here.name)}</b><small>${esc(loc)}</small></div>`
        : `<div class="xsj-loc">📍 剧情里的位置：<b>${esc(loc)}</b><small>地图上没有对上的地点</small>${view.mapEdit ? '' : '<button data-act="add-here" class="xsj-mini">加到地图</button>'}</div>`)
      : '<div class="xsj-loc xsj-loc-none">最近的回复里没找到地点</div>';
    return `
      ${locLine}
      <div class="xsj-maptools">
        <button data-act="zoom-out">－</button><button data-act="zoom-in">＋</button>
        <button data-act="map-edit" class="${view.mapEdit ? 'on' : ''}">${view.mapEdit ? '✓ 完成' : '✏️ 编辑'}</button>
      </div>
      ${view.mapEdit ? '<div class="xsj-hint">拖动图钉换位置；点空白处添加地点；点图钉修改。</div>' : ''}
      <div class="xsj-mapwrap"><svg class="xsj-map${view.mapEdit ? ' is-edit' : ''}" viewBox="0 0 100 100" style="width:${zoom * 100}%">
        <defs><pattern id="xsj-grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#efe6dc" stroke-width=".25"/></pattern></defs>
        <rect x="0" y="0" width="100" height="100" fill="#fbf7f1"/><rect x="0" y="0" width="100" height="100" fill="url(#xsj-grid)"/>
        ${regions}${pins}
      </svg></div>
      ${sel ? placeCard(sel, mp) : `<div class="xsj-hint">点图钉看地点详情。共 ${mp.regions.length} 个区域、${mp.places.length} 个地点。</div>`}
      <button data-act="gen-map" class="xsj-regen">↻ 重新生成地图（保留自己加的和挪过的）</button>`;
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
    const key = (s) => String(s || '');
    const md = monthData(view.month);
    const near = (txt) => key(txt).includes(p.name) || (p.name.length >= 2 && key(txt) && p.name.includes(key(txt)) && key(txt).length >= 2);
    const sch = md.schedule.filter((x) => near(x.place) || key(x.title).includes(p.name));
    const notes = notesFor(md).items.filter((n) => key(n.title).includes(p.name) || key(n.text).includes(p.name));
    const region = mp.regions.find((r) => r.name === p.region);
    return `
      <div class="xsj-place">
        <div class="xsj-place-top"><span class="xsj-place-e">${esc(p.emoji)}</span><div><b>${esc(p.name)}</b><small>${esc([p.type, region?.name || p.region].filter(Boolean).join(' · '))}</small></div><button data-act="place-close" class="xsj-x">×</button></div>
        ${p.desc ? `<div>${esc(p.desc)}</div>` : ''}
        ${p.vibe ? `<div class="xsj-place-v">✨ ${esc(p.vibe)}</div>` : ''}
        ${p.people ? `<div class="xsj-place-v">👥 ${esc(p.people)}</div>` : ''}
        ${region?.desc ? `<div class="xsj-place-v">🗺 ${esc(region.name)}：${esc(region.desc)}</div>` : ''}
        ${sch.length ? `<div class="xsj-sub">${+view.month.split('-')[1]}月在这里的安排</div>${sch.map((x) => `<div class="xsj-place-li">${esc(x.date.slice(5))} ${esc(x.time)} ${esc(x.title)}</div>`).join('')}` : ''}
        ${notes.length ? `<div class="xsj-sub">小红书提到</div>${notes.map((n) => `<button class="xsj-place-li xsj-linknote" data-gonote="${n.id}">${esc(n.emoji)} ${esc(n.title)}</button>`).join('')}` : ''}
      </div>`;
  }

  async function generateMap() {
    if (view.busy) return;
    const sd = storyDate();
    const old = currentMap();
    const keep = old ? old.places.filter((p) => p.manual || p.moved) : [];
    const instr = [
      ...baseInstr(sd.y, sd.m),
      `任务：画出故事主要发生的那片地方的简易地图（通常是一座城市或一个片区；如果世界很大，只画主线所在的城市）。`,
      `规则：地点优先来自世界书、角色卡和剧情里出现过的；可以补充少量符合世界观的日常地点（车站、便利店、医院等）。主要角色的住处、工作或学习的地方要有。区域之间尽量不重叠，地点坐标落在所属区域的方框里，彼此至少隔6个单位。`,
      keep.length ? `下面这些地点已经由用户放好，保留它们，不要重复：${keep.map((p) => p.name).join('、')}` : '',
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
      return { id: uid(), name: String(pick(r, 'name', '名称', '名字')).trim(), x, y, w: clamp(pick(r, 'w', 'width', '宽', '宽度'), 8, 100 - x), h: clamp(pick(r, 'h', 'height', '高', '高度'), 8, 100 - y), desc: String(pick(r, 'desc', '说明', '描述') || '').trim(), color: REGION_COLORS[i % REGION_COLORS.length] };
    });
    const names = new Set(keep.map((p) => p.name));
    const places = placeArr.filter(isPlace).filter((p) => !names.has(String(pick(p, 'name', '名称', '地点', '名字')).trim())).slice(0, 30).map((p) => {
      const type = pick(p, 'type', '类型');
      return {
        id: uid(), name: String(pick(p, 'name', '名称', '地点', '名字')).trim(), emoji: String(pick(p, 'emoji', '图标') || '📍').trim(), type: PLACE_TYPES.includes(type) ? type : '其他', region: String(pick(p, 'region', '区域', '所属区域') || '').trim(),
        _np: !Number.isFinite(num(pick(p, 'x', 'X', '横坐标'))) || !Number.isFinite(num(pick(p, 'y', 'Y', '纵坐标'))),
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
    saveMap({ name: String(pick(g, 'name', '名称', '地图名') || '地图').trim(), regions, places: [...keep, ...places], generatedAt: Date.now() });
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

  // ---------- 交互 ----------
  function shiftMonth(n) {
    let [y, m] = view.month.split('-').map(Number);
    m += n; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    view.month = ym(y, m); view.day = `${view.month}-01`; view.editing = null; view.note = null; render();
  }

  async function onClick(ev) {
    const t = ev.target.closest('button, [data-day], [data-item], [data-place], [data-xopen]');
    if (!t || !D.getElementById(ROOT_ID)?.contains(t)) return;
    const act = t.dataset.act;
    if (t.classList.contains('xsj-close')) return close();
    if (t.dataset.tab) { view.tab = t.dataset.tab; view.editing = null; view.note = null; view.place = null; view.mapEdit = false; return render(); }
    if (t.dataset.place) { if (!view.mapEdit) { view.place = t.dataset.place; render(); } return; }
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
        if (currentMap() && !(await ask('重新生成这张卡的地图？自己加的和挪过位置的地点会保留。', '重新生成'))) return;
        return generateMap();
      }
      case 'zoom-in': view.mapZoom = Math.min(3, (view.mapZoom || 1) + 0.5); return render();
      case 'zoom-out': view.mapZoom = Math.max(1, (view.mapZoom || 1) - 0.5); return render();
      case 'map-edit': view.mapEdit = !view.mapEdit; view.place = null; return render();
      case 'place-close': view.place = null; return render();
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
        if (chat.xlog?.items?.length && !(await ask('刷新浏览记录？收藏过的会留着。', '刷新'))) return;
        return generateX();
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
          if (await drawNotePic(n, `一键生图 ${i + 1}/${todo.length}`)) done++;
          else if (batchStop) break;
        }
        toast(batchStop ? `已取消，画好了 ${done} 张` : `画好了 ${done}/${todo.length} 张`, done ? 'success' : 'warning');
        batchStop = false;
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
          if (await drawXPic(it, `一键生图 ${i + 1}/${todo.length}`)) done++;
          else if (batchStop) break;
        }
        toast(batchStop ? `已取消，画好了 ${done} 张` : `画好了 ${done}/${todo.length} 张`, done ? 'success' : 'warning');
        batchStop = false;
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
        const has = (parts.includes('schedule') && md.schedule.some((x) => !x.manual)) || (parts.includes('events') && md.events.length) || (parts.includes('notes') && notesFor(md).items.length) || (parts.includes('cart') && md.cart.some((x) => !x.bought));
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
      case 'peek': {
        D.getElementById(ROOT_ID)?.querySelector('[data-set="key"]')?.classList.toggle('xsj-secret');
        return;
      }
      case 'paste': {
        const input = D.getElementById(ROOT_ID)?.querySelector(`[data-set="${t.dataset.for}"]`);
        if (!input) return;
        try {
          if (!W.navigator.clipboard?.readText) throw new Error('no clipboard');
          const text = (await W.navigator.clipboard.readText()).trim();
          if (!text) return toast('剪贴板是空的', 'warning');
          input.value = text;
          toast('已粘贴，记得点「保存设置」', 'success');
        } catch (e) {
          input.focus();
          toast('这个浏览器不让网页读剪贴板，请长按输入框粘贴（Key 框现在也能长按粘贴了）', 'warning');
        }
        return;
      }
      case 'models': {
        syncSettings();
        try {
          const list = await getModelList({ apiurl: settings.api.url, key: settings.api.key });
          D.getElementById('xsj-models').innerHTML = (list || []).map((x) => `<option value="${esc(x)}">`).join('');
          toast(`找到 ${list?.length || 0} 个模型`, 'success');
        } catch (e) { toast('获取失败：' + (e?.message || e), 'error'); }
        return;
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
    chat.dateOverride = get('dateOverride').value.trim();
    settings.api = { useTavern: get('useTavern').checked, url: get('url').value.trim(), key: get('key').value.trim(), model: get('model').value.trim() };
  }
  function onChange(ev) {
    if (ev.target.matches?.('[data-set="useTavern"]')) { syncSettings(); render(); }
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
    chat = loadChat(); settings = loadSettings();
    const sd = storyDate();
    view.month = ym(sd.y, sd.m); view.day = dateKey(sd); view.editing = null; view.note = null;
    const root = D.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `<div class="xsj-phone"><div class="xsj-notch"></div><button class="xsj-close" title="关闭">×</button><div class="xsj-resize" title="拖动调整大小（双击恢复默认大小）"><svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 1h5L4.3 2.7l7 7L13 8v5H8l1.7-1.7-7-7L1 6z"/></svg></div><div class="xsj-drag" title="拖动小手机（双击回到默认位置）"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 1 5.6 3.4h1.6V7.2H3.4V5.6L1 8l2.4 2.4V8.8h3.8v3.8H5.6L8 15l2.4-2.4H8.8V8.8h3.8v1.6L15 8l-2.4-2.4v1.6H8.8V3.4h1.6z"/></svg></div><div class="xsj-screen"></div></div>`;
    setupPhoneDrag(root);
    setupPhoneResize(root);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    D.body.appendChild(root);
    fitPhone();
    render();
  }
  function close() { D.getElementById(ROOT_ID)?.remove(); }

  // 按真实窗口大小算手机尺寸，不依赖 dvh、min() 这些较新的 CSS（旧浏览器、QQ/微信内置浏览器也能正常显示）
  function fitPhone() {
    const phone = D.querySelector(`#${ROOT_ID} .xsj-phone`);
    if (!phone) return;
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
    if (root && root.style.left) requestAnimationFrame(() => placePhone(root, { x: parseFloat(root.style.left), y: parseFloat(root.style.top) }));
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
.xsj-body{flex:1;overflow-y:auto;padding:4px 14px 12px}
.xsj-week,.xsj-grid{display:grid;grid-template-columns:repeat(7,1fr);text-align:center}
.xsj-week{font-size:11px;opacity:.45;margin-bottom:2px}
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
.xsj-maptools{display:flex;gap:6px;justify-content:flex-end;margin-bottom:6px}
.xsj-maptools button{min-width:30px;height:28px;border-radius:9px;background:#fff!important;box-shadow:0 1px 3px rgba(80,40,60,.1);font-size:13px;padding:0 8px!important}
.xsj-maptools button.on{background:#e86a95!important;color:#fff!important}
.xsj-mapwrap{width:100%;height:280px;aspect-ratio:1/1;overflow:auto;border-radius:16px;box-shadow:inset 0 0 0 1px #efe3d6;background:#fbf7f1;touch-action:pan-x pan-y}
.xsj-map{display:block;height:auto;user-select:none;-webkit-user-select:none}
.xsj-map.is-edit{touch-action:none;cursor:crosshair}
.xsj-region rect{stroke:#fff;stroke-width:.6;opacity:.95}
.xsj-rlabel{font-size:3px;font-weight:700;fill:#8a7a8c;letter-spacing:.1px}
.xsj-pin{cursor:pointer}.xsj-map.is-edit .xsj-pin{cursor:grab}
.xsj-pin-bg{fill:#fff;stroke:#e9c9d6;stroke-width:.5;filter:drop-shadow(0 .4px .6px rgba(0,0,0,.25))}
.xsj-pin-e{font-size:4.6px;text-anchor:middle;dominant-baseline:middle}
.xsj-pin-n{font-size:2.9px;text-anchor:middle;fill:#4a3f4d;font-weight:600;paint-order:stroke;stroke:#fbf7f1;stroke-width:.8px}
.xsj-pin.is-sel .xsj-pin-bg{stroke:#e86a95;stroke-width:.9}
.xsj-pin.is-here .xsj-pin-bg{stroke:#e0445e;stroke-width:1}
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
.xsj-spin{width:28px;height:28px;border:3px solid #f5c6d6;border-top-color:#e86a95;border-radius:50%;animation:xsjspin 1s linear infinite}
@keyframes xsjspin{to{transform:rotate(360deg)}}
.xsj-ask-card{background:#fff;border-radius:16px;padding:16px;width:80%;box-shadow:0 6px 20px rgba(0,0,0,.12);line-height:1.6}
.xsj-ask-row{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}.xsj-ask-row button{padding:6px 12px}
#xsj-bubble{position:fixed;z-index:29999;width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:34px;line-height:1;background:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35));cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;transition:transform .15s}
#xsj-bubble:hover{transform:scale(1.06)}
#xsj-bubble.is-drag{cursor:grabbing;transform:scale(1.12);opacity:.85;transition:none}
@media (max-width:600px){#${ROOT_ID}{right:50%;top:50%;transform:translate(50%,-50%)}}
@supports (aspect-ratio:1/1){.xsj-mapwrap{height:auto}}
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
    chat = loadChat();
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
