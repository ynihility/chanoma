// 部屋（家族でつながるサーバーとのやりとり）の、端末側の部品。
// ブラウザの部品は、読み込んだだけでは触らない。通信・保存・乱数は、作る関数に渡せる形にしている（テストで差し替えるため）。
// 画面に出す文字は、ここでは作らない（app.js が textContent で入れる）。ここが返す文は、エラーの案内だけ。
import {
  isRoomCode, isDateKey, cleanPost, cleanPosts, checkNews, checkShelfProgram,
} from './safe.js';

export const DEVICE_KEY = 'chanoma.v1.device';
export const ROOM_KEY = 'chanoma.v1.room';
export const SHELF_KEY = 'chanoma.v1.shelf';
// 本棚の上限。60本・2MB（古いものから消す）
export const SHELF_MAX_ITEMS = 60;
export const SHELF_MAX_BYTES = 2 * 1024 * 1024;
// 差し出せる日付は、きょうから60日前まで（サーバーの決まりと同じ）
export const SHELF_DAYS = 60;
// サーバーが1回に返す本棚は10本まで
export const SHELF_FETCH = 10;
// 画面が見えているあいだ、部屋の新しい投稿を取りに行く間隔
export const SYNC_MS = 20_000;

const DAY_MS = 86_400_000;
// 投稿のIDの決まり（safe.js の ID_PATTERN と同じ）
const ID_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;
const KEY_PATTERN = /^[0-9a-f]{64}$/;
const MAX_ERROR_CHARS = 200;

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
const byteLength = (text) => new TextEncoder().encode(text).length;

// ---- 純粋な部品（ブラウザの部品なしで動く） ----

// 招待リンクの「#r=コード」を読む。コードの形が正しいときだけコードを返す（なければ空）
export function parseInvite(hash) {
  if (typeof hash !== 'string' || !hash.startsWith('#')) return '';
  const code = new URLSearchParams(hash.slice(1)).get('r');
  return isRoomCode(code) ? code : '';
}
// 「#r=」が付いているか（形が正しくなくても true。壊れたリンクを知らせるため）
export function hasInvite(hash) {
  return typeof hash === 'string' && hash.startsWith('#') && new URLSearchParams(hash.slice(1)).has('r');
}
// 家族に送る招待リンク
export const inviteLink = (origin, code) => `${origin}/#r=${code}`;

// 日付（YYYY-MM-DD）を n 日ずらす。端末の時計は使わず、文字の日付だけで数える
export const shiftDate = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// サーバーに差し出せる本棚の日付。きょうより前で、60日以内で、サーバーにまだない日付だけ（古い順）
export function datesToOffer(shelfDates, serverDates, today) {
  if (!isDateKey(today)) return [];
  const oldest = shiftDate(today, -SHELF_DAYS);
  return [...new Set(shelfDates)].filter((d) => isDateKey(d) && d < today && d >= oldest && !serverDates.includes(d)).sort();
}
// サーバーから受け取る日付。こちらの本棚にない、きょうより前の日付（新しい順）
export function datesToFetch(shelfDates, serverDates, today) {
  if (!isDateKey(today)) return [];
  return [...new Set(serverDates)].filter((d) => isDateKey(d) && d < today && !shelfDates.includes(d)).sort().reverse();
}
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// 本棚を上限に収める。新しい日付から残し、60本か2MBを超える分（古いもの）を捨てる。新しい順に返す
export function fitShelf(items, { maxItems = SHELF_MAX_ITEMS, maxBytes = SHELF_MAX_BYTES } = {}) {
  const sorted = [...items].sort((a, b) => (a.date === b.date ? b.madeAt - a.madeAt : a.date < b.date ? 1 : -1));
  const kept = [];
  // 包み（{"v":1,"items":[]}）の分の余裕を残す
  let bytes = 64;
  for (const item of sorted) {
    const size = byteLength(JSON.stringify(item)) + 1;
    if (kept.length >= maxItems || bytes + size > maxBytes) break;
    kept.push(item);
    bytes += size;
  }
  return kept;
}

// 本棚の1本を検査して、決まった項目だけの新しい値にする。端末の保存からも、他人の端末から戻ったものからも、同じ検査を通す。
// room は、その番組を置いた部屋のコード。コードがない（古い保存データなど）ものは「部屋なし」として残し、見せず、交換にも使わない。
// 通らなければ null
export function normalizeShelfItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !isDateKey(raw.date)) return null;
  const checked = checkShelfProgram({ news: raw.news, posts: raw.posts, nextDate: raw.nextDate, madeAt: raw.madeAt });
  if (!checked.ok) return null;
  const { news, posts, nextDate, madeAt } = checked.program;
  return {
    date: raw.date, news, posts, ...(nextDate ? { nextDate } : {}), madeAt,
    ...(isRoomCode(raw.room) ? { room: raw.room } : {}), ...(raw.restored === true ? { restored: true } : {}),
  };
}
// サーバーに差し出す形。端末だけで使う項目（date・room・restored）は入れない（検査が、入力全体の大きさを数えるため）
export const programForOffer = (item) => ({
  news: item.news, posts: item.posts, madeAt: item.madeAt, ...(item.nextDate ? { nextDate: item.nextDate } : {}),
});

// 本棚の保存データを読む。壊れたものは捨てて、読めたものだけ返す
export function loadShelf(raw) {
  if (typeof raw !== 'string' || raw.length > SHELF_MAX_BYTES * 2) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!data || data.v !== 1 || !Array.isArray(data.items)) return [];
  return fitShelf(data.items.slice(0, SHELF_MAX_ITEMS * 2).map(normalizeShelfItem).filter(Boolean));
}

// 部屋の保存データ（入っている部屋のコード、この端末が送った投稿のID、まだ送れていない投稿）を読む。壊れていれば null
export function loadRoomRecord(raw) {
  if (typeof raw !== 'string' || raw.length > 64 * 1024) return null;
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!d || d.v !== 1 || !isRoomCode(d.code)) return null;
  const sent = Array.isArray(d.sent) ? d.sent.filter((id) => typeof id === 'string' && ID_PATTERN.test(id)).slice(-100) : [];
  const seen = new Set();
  const pending = [];
  for (const p of Array.isArray(d.pending) ? d.pending.slice(0, 30) : []) {
    const r = cleanPost(p);
    if (r.ok && !seen.has(r.post.id)) {
      seen.add(r.post.id);
      pending.push(r.post);
    }
  }
  return { code: d.code, sent, pending, lastDay: isDateKey(d.lastDay) ? d.lastDay : '' };
}

// サーバーから届いた番組（きょうの分）を検査する。本文は投稿の写しから取り、検査も表示もその写しで行う。
// 成功なら { ok:true, program:{ date, news, posts, nextDate?, madeAt } }
export function checkRoomProgram(raw) {
  if (!raw || typeof raw !== 'object' || !isDateKey(raw.date)) return { ok: false };
  if (!Number.isSafeInteger(raw.madeAt) || raw.madeAt <= 0) return { ok: false };
  const cleaned = cleanPosts({ posts: raw.posts, nextDate: raw.nextDate });
  if (!cleaned.ok) return { ok: false };
  const checked = checkNews(raw.news, cleaned.posts);
  if (!checked.ok) return { ok: false };
  return {
    ok: true,
    program: {
      date: raw.date, news: checked.news, posts: cleaned.posts, ...(cleaned.nextDate ? { nextDate: cleaned.nextDate } : {}), madeAt: raw.madeAt,
    },
  };
}

// 端末の鍵を読む（なければ、乱数32バイトを作って保存する）。保存できないときも、この画面を開いているあいだは同じ鍵を使う。
// 返すのは16進64字
export function loadDeviceKey({ read, write, randomValues }) {
  const saved = read(DEVICE_KEY);
  if (typeof saved === 'string' && KEY_PATTERN.test(saved)) return saved;
  const key = toHex(randomValues(new Uint8Array(32)));
  write(DEVICE_KEY, key);
  return key;
}
// 鍵の SHA-256 を、小文字の16進64字にする。サーバーに送るのはこれだけで、鍵そのものは送らない
export async function hashDeviceKey(key, subtle) {
  return toHex(new Uint8Array(await subtle.digest('SHA-256', fromHex(key))));
}

// ---- 部屋のクライアント ----

const OFFLINE = 'つながりませんでした。つながっているか確かめて、もう一度お試しください。';
const GENERIC = 'うまく動きませんでした。もう一度お試しください。';
const LOST = 'この部屋は、サーバーに見つかりません。しばらく使われなかったか、サーバーが入れ替わったようです。新しい部屋を作って、招待を送り直してください。投稿と本棚は、この端末に残っています。';
// 送り直してよい失敗（通信の失敗・混み合い・サーバーの不調）。それ以外の断りは、送り直しても同じなので、理由を出して止める
const isRetryable = (status) => status === 0 || status === 429 || status >= 500;

export function createRoomClient(env = {}) {
  const g = globalThis;
  let storage = null;
  try {
    storage = env.storage === undefined ? g.localStorage : env.storage;
  } catch {
    storage = null;
  }
  const doFetch = env.fetch ?? ((...args) => g.fetch(...args));
  const base = env.base ?? '';
  const origin = env.origin ?? g.location?.origin ?? '';
  const subtle = env.subtle === undefined ? g.crypto?.subtle : env.subtle;
  const randomValues = env.randomValues ?? ((a) => g.crypto.getRandomValues(a));

  // 保存は、使えない環境（プライベートウィンドウなど）でも壊れないようにする
  const read = (key) => {
    try {
      return storage ? storage.getItem(key) : null;
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };
  const forget = (key) => {
    try {
      storage?.removeItem(key);
    } catch {
      // 消せなくても、画面は動かす
    }
  };

  // 鍵のハッシュは、https か localhost でしか作れない（crypto.subtle）。作れないときは、部屋の機能を止める
  const unsupported = () => (subtle && typeof subtle.digest === 'function'
    ? ''
    : 'この開き方では、部屋を使えません。https か localhost のアドレスで開いてください。');

  let deviceHashPromise = null;
  function deviceHash() {
    deviceHashPromise ??= hashDeviceKey(loadDeviceKey({ read, write, randomValues }), subtle);
    return deviceHashPromise;
  }

  // 入っている部屋。{ code, sent: [投稿のID], pending: [未送信の投稿], lastDay }。入っていなければ null
  let rec = loadRoomRecord(read(ROOM_KEY));
  // 部屋のあちこちの状態（画面を開いているあいだだけ持つ）
  let today = '';
  let serverDates = [];
  let since = 0;
  const roomPosts = new Map();
  let todayProgram = null;
  let lost = false;
  let syncing = null;
  let exchanged = false;

  function persist() {
    if (!rec) {
      forget(ROOM_KEY);
      return;
    }
    write(ROOM_KEY, JSON.stringify({ v: 1, code: rec.code, sent: rec.sent, pending: rec.pending, lastDay: rec.lastDay }));
  }
  function resetRoomState() {
    today = '';
    serverDates = [];
    since = 0;
    roomPosts.clear();
    todayProgram = null;
    lost = false;
    exchanged = false;
  }
  function setRoom(code) {
    // 別の部屋へ切り替えるときは、前の部屋の未送信の投稿を持ち越さない（別の家族の部屋へ、ことばを送ってしまわないため）。
    // 投稿そのものは、この端末の保存に残っている
    rec = { code, sent: [], pending: [], lastDay: '' };
    resetRoomState();
    persist();
  }

  // ---- 通信 ----
  async function call(method, path, { body, headers, timeoutMs = 15_000 } = {}) {
    try {
      const res = await doFetch(base + path, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    } catch {
      return { status: 0, data: null };
    }
  }
  // 失敗の文。サーバーが返した文は、短いときだけ使う（画面には textContent で入れる）
  function errorOf(r) {
    if (r.status === 0) return OFFLINE;
    const text = r.data?.error;
    return typeof text === 'string' && text.length > 0 && text.length <= MAX_ERROR_CHARS ? text : GENERIC;
  }

  // ---- 本棚 ----
  // 本棚は、端末全体で1つ（60本・2MBの上限も端末全体で数える）。番組には部屋のコードが付く。
  // 画面に出すのも、サーバーとやりとりするのも、いまの部屋のコードと同じものだけ。別の部屋の番組と、部屋なしの番組は、端末に残すだけ
  let shelfItems = null;
  const allShelf = () => {
    shelfItems ??= loadShelf(read(SHELF_KEY));
    return shelfItems;
  };
  const shelf = () => (rec ? allShelf().filter((i) => i.room === rec.code) : []);
  function saveShelf() {
    write(SHELF_KEY, JSON.stringify({ v: 1, items: shelfItems }));
  }
  // 同じ部屋の同じ日付があれば置き換える（別の部屋の同じ日付は、そのまま残す）。上限を超えた古いものは捨てる
  function addToShelf(item) {
    shelfItems = fitShelf([...allShelf().filter((i) => !(i.date === item.date && i.room === item.room)), item]);
    saveShelf();
  }
  // きょうの番組を、いまの部屋の本棚に置く（同じ番組がすでにあれば何もしない）
  function shelveToday(program) {
    if (!rec || shelf().some((i) => i.date === program.date && i.madeAt === program.madeAt)) return;
    const item = normalizeShelfItem({ ...program, room: rec.code });
    if (item) addToShelf(item);
  }

  // きょうの番組を受け取る。検査に通らなければ捨てる（通れば本棚にも置く）
  function takeProgram(raw) {
    const checked = checkRoomProgram(raw);
    if (!checked.ok) return null;
    if (!todayProgram || todayProgram.madeAt !== checked.program.madeAt) {
      todayProgram = checked.program;
      if (!lost) shelveToday(checked.program);
    }
    return todayProgram;
  }

  // 番組のあとに届いた一言（きょうの投稿のうち、番組の写しにないもの。届いた順）
  function latePosts() {
    if (!todayProgram) return [];
    const inProgram = new Set(todayProgram.posts.map((p) => p.id));
    return [...roomPosts.values()].filter((e) => !inProgram.has(e.post.id)).sort((a, b) => a.at - b.at).map((e) => e.post);
  }

  // ---- 投稿 ----
  // 投稿を1件送る。結果は 'sent'（届いた）・'retry'（あとで送り直す）・'rejected'（断られた。error と reason を添える）
  async function sendPost(post) {
    const device = await deviceHash();
    const r = await call('POST', `/api/room/${rec.code}/posts`, { body: { post, device } });
    if (r.status === 200) return { kind: 'sent' };
    if (isRetryable(r.status)) return { kind: 'retry' };
    if (r.status === 404) {
      lost = true;
      return { kind: 'rejected', error: LOST };
    }
    return { kind: 'rejected', error: errorOf(r), ...(typeof r.data?.reason === 'string' ? { reason: r.data.reason } : {}) };
  }
  const rememberSent = (id) => {
    rec.sent = [...rec.sent.filter((x) => x !== id), id].slice(-100);
  };

  // 未送信の投稿を、古い順に送る。送れなかったら、そこで止める（順番を守る）。断られたものは捨てて、dropped に入れる
  async function flushPending() {
    const dropped = [];
    while (rec && rec.pending.length > 0) {
      const post = rec.pending[0];
      const result = await sendPost(post);
      if (result.kind === 'retry') break;
      rec.pending = rec.pending.slice(1);
      if (result.kind === 'sent') rememberSent(post.id);
      else dropped.push({ id: post.id, error: result.error });
      persist();
      if (lost) break;
    }
    return dropped;
  }

  const api = {
    // 部屋を使えない理由（使えるなら空）
    unsupported,
    code: () => rec?.code ?? '',
    inRoom: () => rec !== null,
    isLost: () => lost,
    today: () => today,
    // いま部屋に入っていることを前提に、この端末が送った投稿か（まだ送れていないものも含む）
    isMine: (id) => Boolean(rec && (rec.sent.includes(id) || rec.pending.some((p) => p.id === id))),
    isPending: (id) => Boolean(rec && rec.pending.some((p) => p.id === id)),
    pendingCount: () => rec?.pending.length ?? 0,
    link: () => (rec ? inviteLink(origin, rec.code) : ''),
    shelf: () => [...shelf()],
    todayProgram: () => todayProgram,
    latePosts,

    // 新しい部屋を作って、入る
    async create() {
      const reason = unsupported();
      if (reason) return { ok: false, error: reason };
      const r = await call('POST', '/api/room', { body: {} });
      if (r.status === 201 && isRoomCode(r.data?.code)) {
        setRoom(r.data.code);
        return { ok: true };
      }
      return { ok: false, error: errorOf(r) };
    },
    // コードの部屋に入る。あるかどうかを、読むだけの問い合わせで確かめてから入る
    async enter(code) {
      const reason = unsupported();
      if (reason) return { ok: false, error: reason };
      if (!isRoomCode(code)) return { ok: false, error: '部屋のコードの形が正しくありません。もう一度、確かめてください。' };
      if (rec?.code === code) return { ok: true, same: true };
      const r = await call('GET', `/api/room/${code}?since=0`);
      if (r.status === 200) {
        setRoom(code);
        return { ok: true };
      }
      return { ok: false, error: r.status === 404 ? 'この部屋は見つかりません。コードを確かめてください。' : errorOf(r) };
    },
    // 部屋を出る（コードを忘れる）。投稿と本棚は、この端末に残す
    leave() {
      rec = null;
      resetRoomState();
      persist();
    },

    // 投稿を部屋に送る。圏外などで送れなかったときは、端末に持って、次に送る（queued）。
    // 断られたとき（禁止の言葉、きょうの上限など）は、持たずに理由を返す
    async post(post) {
      if (!rec) return { ok: false, error: '部屋に入っていません。' };
      const reason = unsupported();
      if (reason) return { ok: false, error: reason };
      const cleaned = cleanPost(post);
      if (!cleaned.ok) return { ok: false, error: cleaned.error };
      const result = await sendPost(cleaned.post);
      if (result.kind === 'rejected') return { ok: false, error: result.error, ...(result.reason ? { reason: result.reason } : {}), ...(lost ? { lost: true } : {}) };
      if (result.kind === 'sent') {
        rememberSent(cleaned.post.id);
        persist();
        return { ok: true, queued: false };
      }
      rec.pending = [...rec.pending, cleaned.post].slice(0, 30);
      persist();
      return { ok: true, queued: true };
    },
    // 自分の投稿を消す。まだ送れていないものは、端末の控えだけ消す
    async remove(id) {
      if (!rec) return { ok: false, error: '部屋に入っていません。' };
      if (rec.pending.some((p) => p.id === id)) {
        rec.pending = rec.pending.filter((p) => p.id !== id);
        persist();
        return { ok: true };
      }
      const reason = unsupported();
      if (reason) return { ok: false, error: reason };
      const r = await call('DELETE', `/api/room/${rec.code}/posts/${encodeURIComponent(id)}`, { headers: { 'X-Chanoma-Device': await deviceHash() } });
      // 404 は、すでに無い（翌朝に消えた、ほかで消えた）ので、消せたものとして扱う
      if (r.status === 200 || r.status === 404) {
        rec.sent = rec.sent.filter((x) => x !== id);
        persist();
        return { ok: true };
      }
      return { ok: false, error: errorOf(r) };
    },

    // 部屋の新しい投稿と、番組のようすを取りに行く。重なって呼ばれたら、動いているものの結果を待つ
    sync() {
      if (!rec) return Promise.resolve({ ok: false });
      syncing ??= (async () => {
        const reason = unsupported();
        if (reason) return { ok: false, error: reason };
        const dropped = await flushPending();
        if (lost) return { ok: false, lost: true, error: LOST, dropped };
        const r = await call('GET', `/api/room/${rec.code}?since=${since}`);
        if (r.status === 404) {
          lost = true;
          return { ok: false, lost: true, error: LOST, dropped };
        }
        const d = r.data;
        const shapeOk = r.status === 200 && d && isDateKey(d.day) && Array.isArray(d.posts) && Array.isArray(d.ids) && Array.isArray(d.dates);
        if (!shapeOk) return { ok: false, offline: isRetryable(r.status), error: errorOf(r), dropped };

        // 日が変わったら、きのうの分を片づける（きのうの番組は、本棚に残っている）
        const goneIds = [];
        if (rec.lastDay && rec.lastDay !== d.day) {
          const ids = new Set(d.ids);
          goneIds.push(...rec.sent.filter((id) => !ids.has(id)));
          rec.sent = rec.sent.filter((id) => ids.has(id));
          roomPosts.clear();
          since = 0;
          todayProgram = null;
        }
        today = d.day;
        rec.lastDay = d.day;
        persist();
        // 新しく届いた投稿は、検査してから覚える。サーバーが消した投稿（ids にないもの）は忘れる
        for (const raw of d.posts) {
          const c = cleanPost(raw);
          if (c.ok && Number.isSafeInteger(raw?.at)) {
            roomPosts.set(c.post.id, { post: c.post, at: raw.at });
            since = Math.max(since, raw.at);
          }
        }
        const live = new Set(d.ids.filter((id) => typeof id === 'string'));
        for (const id of [...roomPosts.keys()]) if (!live.has(id)) roomPosts.delete(id);
        serverDates = d.dates.filter(isDateKey);
        // 届いた番組が検査に通らなかったときは、使わず、知らせるだけにする
        const badProgram = Boolean(d.program) && !takeProgram(d.program);
        return { ok: true, day: d.day, count: live.size + rec.pending.length, program: todayProgram, badProgram, late: latePosts(), dates: serverDates, dropped, goneIds };
      })().finally(() => {
        syncing = null;
      });
      return syncing;
    },

    // 夜7時: きょうの番組を取る。すでにあればそれを返し（made:false）、なければサーバーに作ってもらう。
    // 番組は、検査を通ったものだけを返す
    async makeNews(nextDate) {
      if (!rec) return { ok: false, error: '部屋に入っていません。' };
      if (todayProgram && todayProgram.date === today) return { ok: true, made: false, program: todayProgram };
      const reason = unsupported();
      if (reason) return { ok: false, error: reason };
      // 未送信の投稿を先に送る（番組に入れるため）
      await flushPending();
      if (lost) return { ok: false, lost: true, error: LOST };
      // 画面が番組を待つのは最大100秒（サーバーの待ち時間と同じ）
      const r = await call('POST', `/api/room/${rec.code}/news`, { body: nextDate ? { nextDate } : {}, timeoutMs: 100_000 });
      if (r.status === 404) {
        lost = true;
        return { ok: false, lost: true, error: LOST };
      }
      if (r.status !== 200 || !r.data) return { ok: false, error: errorOf(r) };
      const program = takeProgram(r.data.program);
      if (!program) return { ok: false, error: '番組をうまく組み立てられませんでした。もう一度お試しください。' };
      today ||= program.date;
      return { ok: true, made: r.data.made === true, program };
    },

    // 本棚の持ち寄り。サーバーにない日付を差し出し、こちらにない日付を受け取る。1回の画面で1度だけ（部屋に入るたび）
    async exchange() {
      if (!rec || lost || exchanged || !today || unsupported()) return { ok: false };
      exchanged = true;
      const result = { ok: true, offered: 0, received: 0, rejected: 0 };
      // 差し出す。同じ日付がもうある（409）は済みとして進み、本棚がいっぱいのときだけやめる
      for (const date of datesToOffer(shelf().map((i) => i.date), serverDates, today)) {
        const item = shelf().find((i) => i.date === date);
        const r = await call('PUT', `/api/room/${rec.code}/shelf/${date}`, { body: programForOffer(item) });
        if (r.status === 200) result.offered++;
        else if (isRetryable(r.status) || (r.status === 409 && String(r.data?.error).includes('いっぱい'))) break;
      }
      // 受け取る。他人の端末から来たものなので、1本ずつ検査して、通ったものだけ本棚に置く
      const have = shelf().map((i) => i.date);
      for (const dates of chunk(datesToFetch(have, serverDates, today), SHELF_FETCH)) {
        const r = await call('GET', `/api/room/${rec.code}/shelf?dates=${dates.join(',')}`);
        if (r.status !== 200 || !Array.isArray(r.data?.programs)) break;
        for (const p of r.data.programs) {
          // 部屋のコードは、受け取った中身ではなく、いま入っている部屋のものを付ける
          const item = p && dates.includes(p.date) ? normalizeShelfItem({ ...p, room: rec.code, restored: p.source === 'device' }) : null;
          if (item) {
            addToShelf(item);
            result.received++;
          } else {
            result.rejected++;
          }
        }
      }
      return result;
    },
  };
  return api;
}
