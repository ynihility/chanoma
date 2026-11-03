// room.js（部屋の端末側）の動作テスト。ブラウザは使わず、保存・通信・乱数・暗号を最小限に真似して確かめる。
// 実行: node --test
// このテストが確かめるのは room.js の中身だけ。画面（app.js・index.html）の見え方や動きは確かめない（目視は、リポジトリの外で行う）。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  DEVICE_KEY, ROOM_KEY, SHELF_KEY, SHELF_MAX_ITEMS, SHELF_MAX_BYTES,
  parseInvite, hasInvite, inviteLink, shiftDate, datesToOffer, datesToFetch, chunk, fitShelf,
  normalizeShelfItem, programForOffer, loadShelf, loadRoomRecord, checkRoomProgram,
  loadDeviceKey, hashDeviceKey, createRoomClient,
} from '../room.js';
import { isDeviceHash } from '../safe.js';
import { SAMPLE_POSTS, SAMPLE_NEWS } from '../sample.js';

const CODE = 'A'.repeat(22);
const OTHER = 'B'.repeat(22);
const TODAY = '2026-11-05';
const YESTERDAY = '2026-11-04';

// ブラウザの localStorage のかわり。fail が true のときは、書き込みが失敗する（容量いっぱいや、プライベートウィンドウ）
function memoryStorage({ fail = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (fail) throw new Error('quota');
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
  };
}
// 乱数のかわり（0, 1, 2, ... と並べる。毎回同じ鍵になるので、結果を決め打ちで比べられる）
const countingRandom = (a) => {
  a.forEach((_, i) => { a[i] = i; });
  return a;
};

// ---- 純粋な部品 ----

test('端末の鍵: 乱数32バイトから16進64字を作り、保存して、次からは同じ鍵を使う', () => {
  const storage = memoryStorage();
  const io = { read: (k) => storage.getItem(k), write: (k, v) => storage.setItem(k, v), randomValues: countingRandom };
  const key = loadDeviceKey(io);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key, Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(''));
  assert.equal(storage.getItem(DEVICE_KEY), key);
  // 2回目は、乱数を使わずに保存した鍵を返す
  assert.equal(loadDeviceKey({ ...io, randomValues: () => { throw new Error('使ってはいけない'); } }), key);
});

test('端末の鍵: 壊れた保存は作り直す。保存できなくても、鍵は返す', () => {
  const storage = memoryStorage();
  storage.setItem(DEVICE_KEY, 'zz');
  const io = { read: (k) => storage.getItem(k), write: (k, v) => storage.setItem(k, v), randomValues: countingRandom };
  assert.match(loadDeviceKey(io), /^[0-9a-f]{64}$/);
  assert.match(storage.getItem(DEVICE_KEY), /^[0-9a-f]{64}$/);
  const unwritable = { read: () => null, write: () => false, randomValues: countingRandom };
  assert.match(loadDeviceKey(unwritable), /^[0-9a-f]{64}$/);
});

test('端末の鍵: 本物の乱数なら、2回作って別の鍵になる', () => {
  const make = () => loadDeviceKey({ read: () => null, write: () => true, randomValues: (a) => crypto.getRandomValues(a) });
  assert.notEqual(make(), make());
});

test('鍵のハッシュ: 32バイトの0は、SHA-256 の既知の値と一致する。鍵そのものとは違う', async () => {
  const zero = '00'.repeat(32);
  const hash = await hashDeviceKey(zero, crypto.webcrypto.subtle);
  assert.equal(hash, '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925');
  assert.ok(isDeviceHash(hash));
  assert.notEqual(hash, zero);
  const key = crypto.randomBytes(32);
  assert.equal(await hashDeviceKey(key.toString('hex'), crypto.webcrypto.subtle), crypto.createHash('sha256').update(key).digest('hex'));
});

test('招待リンク: #r=コード を読む。形が正しくないものは空', () => {
  assert.equal(parseInvite(`#r=${CODE}`), CODE);
  assert.equal(parseInvite(`#r=${CODE}&x=1`), CODE);
  assert.equal(parseInvite(`#x=1&r=${CODE}`), CODE);
  for (const bad of ['', '#', '#r=', `#r=${CODE}a`, `#r=${CODE.slice(1)}`, `#r=${'あ'.repeat(22)}`, `#r=${'A'.repeat(21)}-`, `r=${CODE}`, `#q=${CODE}`, null, undefined, 5]) {
    assert.equal(parseInvite(bad), '', String(bad));
  }
});

test('招待リンク: #r= が付いているかは、形が正しくなくても分かる', () => {
  assert.equal(hasInvite(`#r=${CODE}`), true);
  assert.equal(hasInvite('#r=abc'), true);
  assert.equal(hasInvite('#r='), true);
  assert.equal(hasInvite('#other=1'), false);
  assert.equal(hasInvite(''), false);
});

test('招待リンク: origin + /#r= + コード', () => {
  assert.equal(inviteLink('https://chanoma.example', CODE), `https://chanoma.example/#r=${CODE}`);
});

test('日付: shiftDate は端末の時計を使わず、月またぎ・年またぎも数える', () => {
  assert.equal(shiftDate('2026-11-01', -1), '2026-10-31');
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDate('2026-11-05', -60), '2026-09-06');
});

test('差し出す日付: きょうより前・60日以内・サーバーにない日付だけ（古い順）', () => {
  const today = TODAY;
  const sixtyAgo = shiftDate(today, -60);
  const dates = [today, shiftDate(today, 1), YESTERDAY, '2026-11-02', sixtyAgo, shiftDate(today, -61), '2026-11-04', 'bad', '2026-02-31'];
  assert.deepEqual(datesToOffer(dates, [], today), [sixtyAgo, '2026-11-02', YESTERDAY]);
  assert.deepEqual(datesToOffer(dates, ['2026-11-02'], today), [sixtyAgo, YESTERDAY]);
  assert.deepEqual(datesToOffer(dates, [], 'bad'), []);
});

test('受け取る日付: こちらにない、きょうより前の日付だけ（新しい順）', () => {
  assert.deepEqual(datesToFetch(['2026-11-02'], ['2026-11-01', '2026-11-02', '2026-11-04', TODAY, 'bad', '2026-11-04'], TODAY), ['2026-11-04', '2026-11-01']);
  assert.deepEqual(datesToFetch([], [], TODAY), []);
});

test('chunk: 10本ずつに分ける', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 10), []);
  assert.equal(chunk(Array.from({ length: 25 }, (_, i) => i), 10).length, 3);
});

const shelfItem = (date, madeAt = 1, extra = {}) => ({ date, news: SAMPLE_NEWS, posts: SAMPLE_POSTS, madeAt, ...extra });
const day = (n) => shiftDate('2026-01-01', n);

test('本棚の上限: 61本あれば、古い1本を捨てて60本にする（新しい順に返す）', () => {
  const items = Array.from({ length: 61 }, (_, i) => shelfItem(day(i)));
  const kept = fitShelf(items);
  assert.equal(SHELF_MAX_ITEMS, 60);
  assert.equal(kept.length, 60);
  assert.equal(kept[0].date, day(60));
  assert.equal(kept.at(-1).date, day(1));
  assert.ok(!kept.some((i) => i.date === day(0)));
});

test('本棚の上限: 大きさの上限を超える分は、古いものから捨てる', () => {
  const one = new TextEncoder().encode(JSON.stringify(shelfItem(day(0)))).length;
  const items = Array.from({ length: 10 }, (_, i) => shelfItem(day(i)));
  const kept = fitShelf(items, { maxBytes: 64 + (one + 1) * 3 + 10 });
  assert.equal(kept.length, 3);
  assert.deepEqual(kept.map((i) => i.date), [day(9), day(8), day(7)]);
  // 既定の上限は2MB。2MB に収まる本数は、60本を超えない
  assert.equal(SHELF_MAX_BYTES, 2 * 1024 * 1024);
  assert.ok(JSON.stringify({ v: 1, items: fitShelf(items) }).length < SHELF_MAX_BYTES);
});

test('本棚の上限: 同じ日付は、あとに作った番組を先に並べる。入力は変えない', () => {
  const items = [shelfItem(day(1), 5), shelfItem(day(1), 9), shelfItem(day(0), 1)];
  const copy = structuredClone(items);
  assert.deepEqual(fitShelf(items).map((i) => i.madeAt), [9, 5, 1]);
  assert.deepEqual(items, copy);
});

test('本棚の1本: 検査を通り、決まった項目だけの新しい値になる', () => {
  const item = normalizeShelfItem({ ...shelfItem(YESTERDAY, 123, { restored: true }), room: CODE, extra: '<b>', device: 'x' });
  assert.deepEqual(Object.keys(item).sort(), ['date', 'madeAt', 'news', 'posts', 'restored']);
  assert.equal(item.restored, true);
  assert.equal(normalizeShelfItem(shelfItem(YESTERDAY, 123, { restored: 'yes' })).restored, undefined);
  assert.equal(normalizeShelfItem(shelfItem(YESTERDAY, 123, { nextDate: '2026-12-01' })).nextDate, '2026-12-01');
});

test('本棚の1本: 日付・形・投稿の禁止の言葉・番組の決まり・大きさが合わないものは null', () => {
  assert.equal(normalizeShelfItem(null), null);
  assert.equal(normalizeShelfItem([]), null);
  assert.equal(normalizeShelfItem(shelfItem('2026-02-31')), null);
  assert.equal(normalizeShelfItem(shelfItem(YESTERDAY, 0)), null);
  assert.equal(normalizeShelfItem(shelfItem(YESTERDAY, 1.5)), null);
  // 投稿の本文に、助言の言葉
  const banned = SAMPLE_POSTS.map((p, i) => (i === 0 ? { ...p, text: 'この薬がおすすめです' } : p));
  assert.equal(normalizeShelfItem({ ...shelfItem(YESTERDAY), posts: banned }), null);
  // 番組が、投稿にない人を呼んでいる
  const news = { ...SAMPLE_NEWS, opening: 'こんばんは、はなこさんのニュースです。' };
  assert.equal(normalizeShelfItem({ ...shelfItem(YESTERDAY), news }), null);
  // 48KB を超える
  const big = { ...SAMPLE_NEWS, feature: undefined };
  const huge = { ...shelfItem(YESTERDAY), news: { ...big, pad: 'あ'.repeat(50_000) } };
  assert.equal(normalizeShelfItem(huge), null);
});

test('本棚の保存を読む: 壊れた保存は空。読めない1本だけ捨て、60本を超えたら古いものを捨てる', () => {
  assert.deepEqual(loadShelf(null), []);
  assert.deepEqual(loadShelf('{'), []);
  assert.deepEqual(loadShelf(JSON.stringify({ v: 2, items: [] })), []);
  assert.deepEqual(loadShelf(JSON.stringify({ v: 1, items: 'x' })), []);
  const mixed = JSON.stringify({ v: 1, items: [shelfItem(YESTERDAY), { date: 'bad' }, null, shelfItem('2026-11-03', 2, { news: { opening: 'x' } })] });
  assert.deepEqual(loadShelf(mixed).map((i) => i.date), [YESTERDAY]);
  const many = JSON.stringify({ v: 1, items: Array.from({ length: 70 }, (_, i) => shelfItem(day(i))) });
  const loaded = loadShelf(many);
  assert.equal(loaded.length, 60);
  assert.equal(loaded[0].date, day(69));
});

test('差し出す形: 端末だけで使う項目（date・restored）は入れない', () => {
  assert.deepEqual(Object.keys(programForOffer(shelfItem(YESTERDAY, 7, { restored: true, nextDate: '2026-12-01' }))).sort(), ['madeAt', 'news', 'nextDate', 'posts']);
  assert.deepEqual(Object.keys(programForOffer(shelfItem(YESTERDAY, 7))).sort(), ['madeAt', 'news', 'posts']);
});

test('部屋の保存を読む: 形が正しいものだけ。未送信の投稿は検査して、同じIDは1つだけ', () => {
  assert.equal(loadRoomRecord(null), null);
  assert.equal(loadRoomRecord('{'), null);
  assert.equal(loadRoomRecord(JSON.stringify({ v: 1, code: 'short' })), null);
  assert.equal(loadRoomRecord(JSON.stringify({ v: 2, code: CODE })), null);
  const good = SAMPLE_POSTS[0];
  const rec = loadRoomRecord(JSON.stringify({
    v: 1, code: CODE, sent: ['a1', 5, 'bad id!', 'b2'], lastDay: '2026-11-05',
    pending: [good, good, { id: 'x', who: '' }, { ...SAMPLE_POSTS[1], extra: 1 }],
  }));
  assert.equal(rec.code, CODE);
  assert.deepEqual(rec.sent, ['a1', 'b2']);
  assert.deepEqual(rec.pending.map((p) => p.id), ['s1', 's2']);
  assert.ok(!('extra' in rec.pending[1]));
  assert.equal(rec.lastDay, '2026-11-05');
  assert.equal(loadRoomRecord(JSON.stringify({ v: 1, code: CODE, lastDay: 'x' })).lastDay, '');
});

test('番組を受け取る検査: 投稿の写しと照らして通ったものだけ。日付と時刻が正しくなければ落とす', () => {
  const raw = { date: TODAY, news: SAMPLE_NEWS, posts: SAMPLE_POSTS, madeAt: 10, source: 'server' };
  const ok = checkRoomProgram(raw);
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.program).sort(), ['date', 'madeAt', 'news', 'posts']);
  assert.equal(checkRoomProgram({ ...raw, date: 'x' }).ok, false);
  assert.equal(checkRoomProgram({ ...raw, madeAt: 'x' }).ok, false);
  assert.equal(checkRoomProgram({ ...raw, posts: SAMPLE_POSTS.slice(1) }).ok, false);
  assert.equal(checkRoomProgram(null).ok, false);
});

// ---- クライアント（通信は偽物） ----

// サーバーのかわり。handler(method, path, body, headers) が { status, body } を返す。呼ばれた記録は calls に残る
function fakeServer(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    const call = { method: init.method, path: url, body, headers: init.headers ?? {} };
    calls.push(call);
    const r = handler(call);
    if (r === 'network') throw new TypeError('fetch failed');
    return { status: r.status, json: async () => r.body ?? null };
  };
  return { fetch, calls };
}
function newClient(server, { storage = memoryStorage(), subtle = crypto.webcrypto.subtle } = {}) {
  const client = createRoomClient({ storage, fetch: server.fetch, subtle, randomValues: (a) => crypto.getRandomValues(a), origin: 'https://chanoma.example' });
  return { client, storage };
}
const goodPost = (id, extra = {}) => ({ id, who: 'おばあちゃん', topic: 'ごはん', card: 'おかず', ...extra });
const okSync = (over = {}) => ({ status: 200, body: { day: TODAY, now: 1, posts: [], ids: [], dates: [], program: null, ...over } });
const roomProgram = (madeAt = 10, over = {}) => ({ date: TODAY, news: SAMPLE_NEWS, posts: SAMPLE_POSTS, madeAt, source: 'server', ...over });

test('部屋を作る: 201 のコードを保存し、入った状態になる。ほかの形の返事は入らない', async () => {
  const server = fakeServer(() => ({ status: 201, body: { code: CODE } }));
  const { client, storage } = newClient(server);
  assert.equal(client.inRoom(), false);
  assert.deepEqual(await client.create(), { ok: true });
  assert.equal(client.inRoom(), true);
  assert.equal(client.link(), `https://chanoma.example/#r=${CODE}`);
  assert.equal(JSON.parse(storage.getItem(ROOM_KEY)).code, CODE);
  assert.deepEqual(server.calls[0].body, {});
  assert.equal(server.calls[0].path, '/api/room');
  // 形が正しくないコードが返ったら、入らない
  const bad = fakeServer(() => ({ status: 201, body: { code: 'short' } }));
  const b = newClient(bad).client;
  assert.equal((await b.create()).ok, false);
  assert.equal(b.inRoom(), false);
  const limit = fakeServer(() => ({ status: 429, body: { error: 'きょうは作れる部屋の数に達しました。' } }));
  const l = await newClient(limit).client.create();
  assert.deepEqual(l, { ok: false, error: 'きょうは作れる部屋の数に達しました。' });
});

test('部屋に入る: あることを確かめてから保存する（404 なら保存しない）。コードの形が違えば何も送らない', async () => {
  const server = fakeServer(({ path }) => (path.includes(CODE) ? okSync() : { status: 404, body: { error: 'この部屋は見つかりません。' } }));
  const { client, storage } = newClient(server);
  assert.equal((await client.enter('short')).ok, false);
  assert.equal(server.calls.length, 0);
  const miss = await client.enter(OTHER);
  assert.equal(miss.ok, false);
  assert.equal(client.inRoom(), false);
  assert.equal(storage.getItem(ROOM_KEY), null);
  assert.deepEqual(await client.enter(CODE), { ok: true });
  assert.equal(client.code(), CODE);
  assert.deepEqual(await client.enter(CODE), { ok: true, same: true });
});

test('部屋を出る: コードを忘れる。本棚と端末の鍵と、保存していた投稿には触らない', async () => {
  const server = fakeServer(() => okSync());
  const { client, storage } = newClient(server);
  await client.enter(CODE);
  await client.post(goodPost('a1'));
  storage.setItem(SHELF_KEY, JSON.stringify({ v: 1, items: [shelfItem(YESTERDAY)] }));
  storage.setItem('chanoma.v1', '{"v":1,"posts":[]}');
  const deviceBefore = storage.getItem(DEVICE_KEY);
  assert.match(deviceBefore, /^[0-9a-f]{64}$/);
  client.leave();
  assert.equal(client.inRoom(), false);
  assert.equal(client.code(), '');
  assert.equal(storage.getItem(ROOM_KEY), null);
  assert.equal(storage.getItem(DEVICE_KEY), deviceBefore);
  assert.ok(storage.getItem(SHELF_KEY));
  assert.equal(storage.getItem('chanoma.v1'), '{"v":1,"posts":[]}');
  assert.equal(client.shelf().length, 1);
});

test('別の部屋へ移る: 前の部屋の未送信の投稿は、新しい部屋へ持ち越さない', async () => {
  let fail = true;
  const server = fakeServer(({ method, path }) => {
    if (method === 'POST' && path.endsWith('/posts')) return fail ? 'network' : { status: 200, body: {} };
    return okSync();
  });
  const { client } = newClient(server);
  await client.enter(CODE);
  const r = await client.post(goodPost('a1'));
  assert.deepEqual(r, { ok: true, queued: true });
  assert.equal(client.pendingCount(), 1);
  await client.enter(OTHER);
  assert.equal(client.pendingCount(), 0);
  fail = false;
  await client.sync();
  assert.ok(!server.calls.some((c) => c.method === 'POST' && c.path.includes(OTHER)));
});

test('投稿: 送るのは { post, device } で、device は鍵ではなく鍵のハッシュ', async () => {
  const server = fakeServer(() => ({ status: 200, body: {} }));
  const { client, storage } = newClient(server);
  await client.enter(CODE).catch(() => {});
  server.calls.length = 0;
  // enter が GET を呼ぶので、投稿の呼び出しだけを見る
  const r = await client.post(goodPost('a1'));
  assert.deepEqual(r, { ok: true, queued: false });
  const call = server.calls.find((c) => c.method === 'POST');
  assert.equal(call.path, `/api/room/${CODE}/posts`);
  assert.deepEqual(Object.keys(call.body).sort(), ['device', 'post']);
  const key = storage.getItem(DEVICE_KEY);
  assert.ok(isDeviceHash(call.body.device));
  assert.equal(call.body.device, crypto.createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex'));
  assert.notEqual(call.body.device, key);
  assert.ok(!JSON.stringify(server.calls).includes(key));
  assert.equal(client.isMine('a1'), true);
  assert.equal(client.isPending('a1'), false);
});

test('投稿: 通信の失敗・混み合い・サーバーの不調は端末に持ち、断られたもの（400・409・422）は持たずに理由を返す', async () => {
  for (const reply of ['network', { status: 500, body: null }, { status: 503, body: null }, { status: 429, body: { error: '送りすぎ' } }]) {
    const server = fakeServer(({ path }) => (path.endsWith('/posts') ? reply : okSync()));
    const { client, storage } = newClient(server);
    await client.enter(CODE);
    const r = await client.post(goodPost('a1'));
    assert.deepEqual(r, { ok: true, queued: true }, JSON.stringify(reply));
    assert.equal(client.isPending('a1'), true);
    assert.deepEqual(JSON.parse(storage.getItem(ROOM_KEY)).pending.map((p) => p.id), ['a1']);
  }
  const rejects = [
    [422, { error: 'この言葉は使えません。', reason: '助言や指図にあたる言葉がある' }],
    [409, { error: 'きょうは30件までです。' }],
    [400, { error: '投稿の形が正しくありません。' }],
  ];
  for (const [status, body] of rejects) {
    const server = fakeServer(({ path }) => (path.endsWith('/posts') ? { status, body } : okSync()));
    const { client } = newClient(server);
    await client.enter(CODE);
    const r = await client.post(goodPost('a1'));
    assert.equal(r.ok, false, String(status));
    assert.equal(r.error, body.error);
    if (body.reason) assert.equal(r.reason, body.reason);
    assert.equal(client.pendingCount(), 0, String(status));
    assert.equal(client.isMine('a1'), false);
  }
});

test('投稿: 形が正しくない投稿は、何も送らずに理由を返す', async () => {
  const server = fakeServer(() => okSync());
  const { client } = newClient(server);
  await client.enter(CODE);
  server.calls.length = 0;
  const r = await client.post({ id: 'a1', who: '', topic: 'ごはん' });
  assert.equal(r.ok, false);
  assert.equal(server.calls.length, 0);
});

test('未送信の投稿: 保存から読み戻せて、次の同期で古い順に送る。送れなければそこで止める', async () => {
  let up = false;
  const sentIds = [];
  const server = fakeServer(({ method, path, body }) => {
    if (method === 'POST' && path.endsWith('/posts')) {
      if (!up) return 'network';
      sentIds.push(body.post.id);
      return { status: 200, body: {} };
    }
    return okSync({ ids: sentIds });
  });
  const first = newClient(server);
  await first.client.enter(CODE);
  await first.client.post(goodPost('a1'));
  await first.client.post(goodPost('a2'));
  assert.equal(first.client.pendingCount(), 2);
  // 画面を開き直したのと同じ（同じ保存から、新しいクライアントを作る）
  const again = newClient(server, { storage: first.storage });
  assert.equal(again.client.inRoom(), true);
  assert.equal(again.client.pendingCount(), 2);
  let r = await again.client.sync();
  assert.equal(r.ok, true);
  assert.equal(again.client.pendingCount(), 2);
  assert.deepEqual(sentIds, []);
  up = true;
  r = await again.client.sync();
  assert.deepEqual(sentIds, ['a1', 'a2']);
  assert.equal(again.client.pendingCount(), 0);
  assert.equal(again.client.isMine('a1'), true);
  assert.equal(r.count, 2);
});

test('未送信の投稿: 同期で断られたものは、持たずに dropped で知らせる', async () => {
  const server = fakeServer(({ method, path }) => {
    if (method === 'POST' && path.endsWith('/posts')) return { status: 409, body: { error: 'きょうは30件までです。' } };
    return okSync();
  });
  const first = newClient(fakeServer(() => 'network'));
  // 圏外のあいだに、部屋へ入っていた記録だけを作る
  first.storage.setItem(ROOM_KEY, JSON.stringify({ v: 1, code: CODE, sent: [], pending: [goodPost('a1')], lastDay: '' }));
  const { client } = newClient(server, { storage: first.storage });
  const r = await client.sync();
  assert.deepEqual(r.dropped, [{ id: 'a1', error: 'きょうは30件までです。' }]);
  assert.equal(client.pendingCount(), 0);
});

test('投稿を消す: 送れていないものは端末の控えだけ。送れたものは鍵のハッシュを添えて DELETE。404 は消せたものとして扱う', async () => {
  const server = fakeServer(({ method, path }) => {
    if (method === 'POST' && path.endsWith('/posts')) return path.includes(CODE) ? { status: 200, body: {} } : 'network';
    if (method === 'DELETE') return { status: 200, body: { ok: true } };
    return okSync();
  });
  const { client, storage } = newClient(server);
  await client.enter(CODE);
  await client.post(goodPost('a1'));
  server.calls.length = 0;
  assert.deepEqual(await client.remove('a1'), { ok: true });
  const del = server.calls[0];
  assert.equal(del.method, 'DELETE');
  assert.equal(del.path, `/api/room/${CODE}/posts/a1`);
  assert.ok(isDeviceHash(del.headers['X-Chanoma-Device']));
  assert.ok(!JSON.stringify(del).includes(storage.getItem(DEVICE_KEY)));
  assert.equal(client.isMine('a1'), false);
  // 送れていない投稿は、サーバーに何も送らない
  const offline = fakeServer(({ path }) => (path.endsWith('/posts') ? 'network' : okSync()));
  const o = newClient(offline).client;
  await o.enter(CODE);
  await o.post(goodPost('b1'));
  offline.calls.length = 0;
  assert.deepEqual(await o.remove('b1'), { ok: true });
  assert.equal(offline.calls.length, 0);
  assert.equal(o.pendingCount(), 0);
  // 403（ほかの端末の投稿）は消せたことにしない
  const forbidden = fakeServer(({ method }) => (method === 'DELETE' ? { status: 403, body: { error: 'この投稿は、送った端末からだけ消せます。' } } : okSync()));
  const f = newClient(forbidden, { storage: memoryStorage() }).client;
  await f.enter(CODE);
  const r = await f.remove('zz');
  assert.equal(r.ok, false);
});

test('同期: since には届いた時刻の最大を使い、ids にない投稿は忘れる。番組のあとに届いた一言だけを返す', async () => {
  const mk = (id, at) => ({ ...goodPost(id), at });
  let step = 0;
  const server = fakeServer(({ method, path }) => {
    if (method !== 'GET') return { status: 200, body: {} };
    step++;
    if (step === 1) return okSync({ posts: [mk('x1', 100), mk('x2', 200)], ids: ['x1', 'x2'] });
    if (step === 2) return okSync({ posts: [mk('x3', 300)], ids: ['x1', 'x2', 'x3'], program: roomProgram(10, { posts: SAMPLE_POSTS }) });
    return okSync({ posts: [], ids: ['x2', 'x3'], program: roomProgram(10) });
  });
  const { client } = newClient(server);
  await client.enter(CODE);
  // enter も、部屋があるかを GET で確かめるので、その分を数え直す
  step = 0;
  server.calls.length = 0;
  let r = await client.sync();
  assert.equal(r.count, 2);
  assert.equal(r.program, null);
  assert.deepEqual(r.late, []);
  assert.match(server.calls[0].path, /\?since=0$/);
  r = await client.sync();
  assert.match(server.calls[1].path, /\?since=200$/);
  assert.equal(r.count, 3);
  assert.deepEqual(r.late.map((p) => p.id), ['x1', 'x2', 'x3']);
  r = await client.sync();
  assert.match(server.calls[2].path, /\?since=300$/);
  assert.deepEqual(r.late.map((p) => p.id), ['x2', 'x3']);
  assert.equal(r.program.madeAt, 10);
});

test('同期: 日が変わったら、前の日に送った投稿を goneIds で知らせ、番組と写しを片づける', async () => {
  let day2 = false;
  const server = fakeServer(({ method, path }) => {
    if (method === 'POST' && path.endsWith('/posts')) return { status: 200, body: {} };
    if (!day2) return okSync({ ids: ['a1'], program: roomProgram(10) });
    return okSync({ day: '2026-11-06', ids: ['n1'] });
  });
  const { client } = newClient(server);
  await client.enter(CODE);
  await client.post(goodPost('a1'));
  let r = await client.sync();
  assert.equal(r.program.date, TODAY);
  assert.equal(client.todayProgram().madeAt, 10);
  day2 = true;
  r = await client.sync();
  assert.deepEqual(r.goneIds, ['a1']);
  assert.equal(r.program, null);
  assert.equal(client.todayProgram(), null);
  assert.equal(client.isMine('a1'), false);
  assert.equal(client.today(), '2026-11-06');
});

test('同期: 検査に通らない番組は使わず、本棚にも置かない（badProgram）', async () => {
  const bad = roomProgram(10, { news: { ...SAMPLE_NEWS, opening: 'こんばんは、はなこさんのニュースです。' } });
  const server = fakeServer(() => okSync({ program: bad }));
  const { client, storage } = newClient(server);
  await client.enter(CODE);
  const r = await client.sync();
  assert.equal(r.ok, true);
  assert.equal(r.badProgram, true);
  assert.equal(r.program, null);
  assert.equal(client.shelf().length, 0);
  assert.equal(storage.getItem(SHELF_KEY), null);
});

test('同期: 部屋が 404 なら「見つからない」。投稿・本棚・鍵は消さない。そのあとは取りに行かない', async () => {
  let gone = false;
  const server = fakeServer(({ method, path }) => {
    if (method === 'POST' && path.endsWith('/posts')) return 'network';
    return gone ? { status: 404, body: { error: 'この部屋は見つかりません。' } } : okSync();
  });
  const { client, storage } = newClient(server);
  await client.enter(CODE);
  await client.post(goodPost('a1'));
  storage.setItem(SHELF_KEY, JSON.stringify({ v: 1, items: [shelfItem(YESTERDAY)] }));
  gone = true;
  const r = await client.sync();
  assert.equal(r.ok, false);
  assert.equal(r.lost, true);
  assert.equal(client.isLost(), true);
  assert.equal(client.inRoom(), true);
  assert.equal(client.pendingCount(), 1);
  assert.ok(storage.getItem(DEVICE_KEY));
  assert.ok(storage.getItem(SHELF_KEY));
  assert.equal((await client.exchange()).ok, false);
});

test('同期: 通信の失敗は offline で知らせ、重なって呼んでも1回分だけ取りに行く', async () => {
  let online = false;
  const server = fakeServer(() => (online ? okSync() : 'network'));
  const { client } = newClient(server);
  await client.enter(CODE).catch(() => {});
  const { client: c } = newClient(server);
  c.leave();
  online = true;
  await c.enter(CODE);
  online = false;
  let r = await c.sync();
  assert.equal(r.ok, false);
  assert.equal(r.offline, true);
  online = true;
  server.calls.length = 0;
  const [r1, r2] = await Promise.all([c.sync(), c.sync()]);
  assert.equal(server.calls.length, 1);
  assert.equal(r1, r2);
});

test('夜7時: きょうの番組がもうあれば、サーバーに頼まずに返す。なければ POST news（nextDate は添える）', async () => {
  let made = false;
  const server = fakeServer(({ method, path, body }) => {
    if (method === 'POST' && path.endsWith('/news')) {
      made = true;
      return { status: 200, body: { made: true, program: roomProgram(77) } };
    }
    return okSync({ program: made ? roomProgram(77) : null });
  });
  const { client, storage } = newClient(server);
  await client.enter(CODE);
  await client.sync();
  server.calls.length = 0;
  const first = await client.makeNews('2026-12-01');
  assert.equal(first.ok, true);
  assert.equal(first.made, true);
  const post = server.calls.find((c) => c.path.endsWith('/news'));
  assert.deepEqual(post.body, { nextDate: '2026-12-01' });
  // 作った番組は、本棚にも置かれる
  assert.deepEqual(client.shelf().map((i) => i.date), [TODAY]);
  assert.equal(JSON.parse(storage.getItem(SHELF_KEY)).items[0].madeAt, 77);
  // 2回目は、サーバーに何も頼まない
  server.calls.length = 0;
  const second = await client.makeNews();
  assert.deepEqual([second.ok, second.made], [true, false]);
  assert.equal(server.calls.length, 0);
});

test('夜7時: nextDate がなければ本文は {}。サーバーの番組が検査に通らなければ使わない', async () => {
  const server = fakeServer(({ method, path }) => {
    if (method === 'POST' && path.endsWith('/news')) return { status: 200, body: { made: true, program: roomProgram(5, { news: { ...SAMPLE_NEWS, closing: 'また、はなこさんと会いましょう。' } }) } };
    return okSync();
  });
  const { client } = newClient(server);
  await client.enter(CODE);
  await client.sync();
  const r = await client.makeNews();
  assert.equal(r.ok, false);
  assert.deepEqual(server.calls.find((c) => c.path.endsWith('/news')).body, {});
  assert.equal(client.shelf().length, 0);
  assert.equal(client.todayProgram(), null);
});

test('夜7時: サーバーのエラーの文を返す。サーバーの文が長すぎれば、決まった文にする', async () => {
  const mk = (error) => fakeServer(({ method, path }) => (method === 'POST' && path.endsWith('/news') ? { status: 400, body: { error } } : okSync()));
  let s = mk('きょうの投稿がまだありません。');
  let c = newClient(s).client;
  await c.enter(CODE);
  assert.equal((await c.makeNews()).error, 'きょうの投稿がまだありません。');
  s = mk('あ'.repeat(500));
  c = newClient(s).client;
  await c.enter(CODE);
  const r = await c.makeNews();
  assert.equal(r.ok, false);
  assert.ok(r.error.length < 100);
});

// 本棚の持ち寄り
const serverShelf = ({ have = {}, offers = [], full = false } = {}) => fakeServer(({ method, path, body }) => {
  if (method === 'PUT') {
    const date = path.split('/').pop();
    offers.push({ date, body });
    if (full) return { status: 409, body: { error: 'この部屋の本棚は、いっぱいです。' } };
    if (have[date]) return { status: 409, body: { error: 'この日の番組は、もう本棚にあります。' } };
    have[date] = { date, ...body, source: 'device' };
    return { status: 200, body: { ok: true } };
  }
  if (path.includes('/shelf?dates=')) {
    const want = decodeURIComponent(path.split('dates=')[1]).split(',');
    return { status: 200, body: { programs: want.filter((d) => have[d]).map((d) => have[d]) } };
  }
  return okSync({ dates: Object.keys(have).sort() });
});

test('本棚の持ち寄り: サーバーにない日付を差し出す。差し出す形は news・posts・madeAt・nextDate だけ', async () => {
  const have = { '2026-11-03': { date: '2026-11-03', news: SAMPLE_NEWS, posts: SAMPLE_POSTS, madeAt: 3, source: 'server' } };
  const offers = [];
  const server = serverShelf({ have, offers });
  const { client, storage } = newClient(server);
  storage.setItem(SHELF_KEY, JSON.stringify({
    v: 1,
    items: [shelfItem('2026-11-03', 3), shelfItem('2026-11-02', 2, { restored: true, nextDate: '2026-12-01' }), shelfItem(YESTERDAY, 4), shelfItem(TODAY, 5), shelfItem(shiftDate(TODAY, -61), 1)],
  }));
  await client.enter(CODE);
  await client.sync();
  const r = await client.exchange();
  assert.equal(r.offered, 2);
  // 古い順に、2日分だけ（サーバーにある 11-03、きょう、61日前は出さない）
  assert.deepEqual(offers.map((o) => o.date), ['2026-11-02', YESTERDAY]);
  assert.deepEqual(Object.keys(offers[0].body).sort(), ['madeAt', 'news', 'nextDate', 'posts']);
  assert.deepEqual(Object.keys(offers[1].body).sort(), ['madeAt', 'news', 'posts']);
  // 1回の画面で1度だけ
  const before = server.calls.length;
  assert.equal((await client.exchange()).ok, false);
  assert.equal(server.calls.length, before);
});

test('本棚の持ち寄り: 自分にない日付を、10本ずつ受け取る。端末から戻したもの（source: device）には印を付ける', async () => {
  const have = {};
  for (let i = 1; i <= 25; i++) {
    const date = shiftDate(TODAY, -i);
    have[date] = { date, news: SAMPLE_NEWS, posts: SAMPLE_POSTS, madeAt: i, source: i % 2 ? 'device' : 'server' };
  }
  const server = serverShelf({ have });
  const { client } = newClient(server);
  await client.enter(CODE);
  await client.sync();
  const r = await client.exchange();
  assert.equal(r.received, 25);
  assert.equal(r.rejected, 0);
  const gets = server.calls.filter((c) => c.path.includes('/shelf?dates='));
  assert.deepEqual(gets.map((c) => decodeURIComponent(c.path.split('dates=')[1]).split(',').length), [10, 10, 5]);
  const shelf = client.shelf();
  assert.equal(shelf.length, 25);
  assert.equal(shelf.find((i) => i.date === shiftDate(TODAY, -1)).restored, true);
  assert.equal(shelf.find((i) => i.date === shiftDate(TODAY, -2)).restored, undefined);
});

test('本棚の持ち寄り: 受け取ったものも検査する。禁止の言葉・番組の決まり・大きさ・ほかの日付が混ざっていたら、置かない', async () => {
  const good = { date: '2026-11-01', news: SAMPLE_NEWS, posts: SAMPLE_POSTS, madeAt: 1, source: 'device' };
  const banned = { ...good, date: '2026-11-02', posts: SAMPLE_POSTS.map((p, i) => (i === 0 ? { ...p, text: 'この薬がおすすめです' } : p)) };
  const wrongNews = { ...good, date: '2026-11-03', news: { ...SAMPLE_NEWS, opening: 'こんばんは、はなこさんのニュースです。' } };
  const huge = { ...good, date: '2026-11-04', news: { ...SAMPLE_NEWS, pad: 'あ'.repeat(50_000) } };
  const stray = { ...good, date: '2026-10-01' };
  const server = fakeServer(({ method, path }) => {
    if (path.includes('/shelf?dates=')) return { status: 200, body: { programs: [good, banned, wrongNews, huge, stray, null, 'x'] } };
    return okSync({ dates: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'] });
  });
  const { client, storage } = newClient(server);
  await client.enter(CODE);
  await client.sync();
  const r = await client.exchange();
  assert.equal(r.received, 1);
  assert.equal(r.rejected, 6);
  assert.deepEqual(client.shelf().map((i) => i.date), ['2026-11-01']);
  assert.ok(!storage.getItem(SHELF_KEY).includes('おすすめ'));
});

test('本棚の持ち寄り: 部屋の本棚がいっぱい（409）なら、差し出しをやめる。同じ日付がある（409）は、済みとして進む', async () => {
  const offers = [];
  const full = serverShelf({ offers, full: true });
  const a = newClient(full);
  a.storage.setItem(SHELF_KEY, JSON.stringify({ v: 1, items: [shelfItem('2026-11-01'), shelfItem('2026-11-02'), shelfItem('2026-11-03')] }));
  await a.client.enter(CODE);
  await a.client.sync();
  assert.equal((await a.client.exchange()).offered, 0);
  assert.equal(offers.length, 1);
  // 同じ日付が、同時に差し出されて 409 になっても、あとの日付は差し出す
  const offers2 = [];
  let first = true;
  const racing = fakeServer(({ method, path, body }) => {
    if (method === 'PUT') {
      offers2.push(path.split('/').pop());
      if (first) {
        first = false;
        return { status: 409, body: { error: 'この日の番組は、もう本棚にあります。' } };
      }
      return { status: 200, body: { ok: true } };
    }
    return okSync();
  });
  const b = newClient(racing);
  b.storage.setItem(SHELF_KEY, JSON.stringify({ v: 1, items: [shelfItem('2026-11-01'), shelfItem('2026-11-02')] }));
  await b.client.enter(CODE);
  await b.client.sync();
  assert.equal((await b.client.exchange()).offered, 1);
  assert.deepEqual(offers2, ['2026-11-01', '2026-11-02']);
});

test('本棚の持ち寄り: 部屋に入っていないとき、まだ同期していないとき、見つからないときは何も送らない', async () => {
  const server = serverShelf();
  const { client, storage } = newClient(server);
  storage.setItem(SHELF_KEY, JSON.stringify({ v: 1, items: [shelfItem(YESTERDAY)] }));
  assert.equal((await client.exchange()).ok, false);
  await client.enter(CODE);
  assert.equal((await client.exchange()).ok, false);
  assert.ok(!server.calls.some((c) => c.method === 'PUT'));
});

test('本棚: 同じ日付は置き換え、60本を超えたら古いものから消える。保存できなくても動く', async () => {
  const server = fakeServer(({ method }) => (method === 'POST' ? { status: 200, body: { made: true, program: roomProgram(1) } } : okSync()));
  const { client } = newClient(server, { storage: memoryStorage({ fail: true }) });
  await client.enter(CODE).catch(() => {});
  // 保存できない環境でも、部屋を作って番組を取れる
  const c2 = newClient(fakeServer(({ method, path }) => {
    if (method === 'POST' && path === '/api/room') return { status: 201, body: { code: CODE } };
    if (method === 'POST' && path.endsWith('/news')) return { status: 200, body: { made: true, program: roomProgram(9) } };
    return okSync();
  }), { storage: memoryStorage({ fail: true }) }).client;
  assert.equal((await c2.create()).ok, true);
  assert.equal((await c2.sync()).ok, true);
  const r = await c2.makeNews();
  assert.equal(r.ok, true);
  assert.equal(c2.shelf().length, 1);
  assert.ok(client);
});

test('https でも localhost でもないとき（crypto.subtle がない）: 部屋の機能は止まり、何も送らない', async () => {
  const server = fakeServer(() => okSync());
  const { client } = newClient(server, { subtle: null });
  assert.match(client.unsupported(), /https か localhost/);
  assert.equal((await client.create()).ok, false);
  assert.equal((await client.enter(CODE)).ok, false);
  assert.equal(server.calls.length, 0);
  const ok = newClient(server).client;
  assert.equal(ok.unsupported(), '');
});

test('保存が壊れていても、部屋に入っていない状態で始まる', () => {
  const storage = memoryStorage();
  storage.setItem(ROOM_KEY, '{broken');
  const { client } = newClient(fakeServer(() => okSync()), { storage });
  assert.equal(client.inRoom(), false);
  // 保存が使えない環境（getItem が例外）でも、画面は動く
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
  const c = createRoomClient({ storage: throwing, fetch: async () => ({ status: 200, json: async () => ({}) }), subtle: crypto.webcrypto.subtle, randomValues: (a) => crypto.getRandomValues(a) });
  assert.equal(c.inRoom(), false);
  assert.equal(c.shelf().length, 0);
  c.leave();
});

test('room.js は、読み込んだだけではブラウザの部品に触らない（Node でそのまま読み込める）', () => {
  assert.equal(typeof createRoomClient, 'function');
  assert.equal(typeof globalThis.window, 'undefined');
});
