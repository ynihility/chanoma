// 部屋（/api/room 以下）の動作テスト。server.test.mjs と同じく、偽の API サーバーを立てて、本物の API にもクレジットにも触れずに確かめる。
// 実行: node --test
// このテストが確かめるのはサーバーの動作だけ。画面（app.js・index.html）や、ブラウザでの見え方は確かめない。
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { cleanPosts, NEXT_TOPICS, isNostalgic, MAX_POSTS } from '../safe.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
async function freePort() {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}
const FAKE_PORT = await freePort();
const APP_PORT = await freePort();
const FAKE_KEY = 'FAKE_TEST_KEY_NOT_A_REAL_KEY';
const ORIGIN = `http://127.0.0.1:${APP_PORT}`;

// 時計は、2026-11-05 の昼（JST 12:00）から数えさせる。日付の鍵は 2026-11-05、きのうは 2026-11-04
const FAKE_NOW = '2026-11-05T03:00:00Z';
const TODAY = '2026-11-05';
const YESTERDAY = '2026-11-04';
const shiftDay = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// 家族の投稿（検査を通る形）
const A = { id: 'a1', who: 'おばあちゃん', topic: 'ごはん', headline: 'おいしかった', text: 'きょうは煮物を作った' };
const B = { id: 'b1', who: 'まご', name: 'たろ', animal: 'ねこ', topic: 'そら', headline: 'びっくり', text: 'にじが見えた' };
const C = { id: 'c1', who: 'おかあさん', topic: 'みつけた', headline: 'なつかしい', text: '古いアルバムを見つけた' };
const D = { id: 'd1', who: 'まご', topic: 'なに食べたい', card: 'おすし' };
const FAMILY = [A, B, C, D];

// 送られた投稿に合う番組を作る（偽の Claude の返事）。どんな投稿の組でも、検査に通る形にしている
function newsFor(sent) {
  const next = sent.filter((p) => NEXT_TOPICS.includes(p.topic));
  const old = sent.filter((p) => !NEXT_TOPICS.includes(p.topic) && isNostalgic(p));
  const today = sent.filter((p) => !NEXT_TOPICS.includes(p.topic) && !isNostalgic(p));
  const segments = [
    ...today.map((p) => ({ corner: 'ひとこと', from: p.id, host: 'ひとことのコーナーです。' })),
    ...old.map((p) => ({ corner: 'むかし', from: p.id, host: 'むかし話のコーナーです。' })),
    ...next.map((p) => ({ corner: 'つぎ', from: p.id, host: 'つぎに会う日の希望です。' })),
  ];
  const lineup = [
    ...(today.length ? [{ corner: 'ひとこと', reason: 'きょうのことを集めました' }] : []),
    ...(old.length ? [{ corner: 'むかし', reason: '「なつかしい」をえらんだ投稿です' }] : []),
    ...(next.length ? [{ corner: 'つぎ', reason: 'つぎに会う日の希望を集めました' }] : []),
  ];
  return { feature: 'かぞくの一言特集', opening: 'こんばんは、テレ吉です。', segments, lineup, closing: 'また明日の夜7時にお会いしましょう。' };
}

// 偽 API。モードはテストごとに差し替える
let fakeMode = 'good';
let fakeCalls = 0;
let fakeClosedEarly = 0;
let lastSent = null;
const fake = http.createServer((req, res) => {
  fakeCalls++;
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const content = body.messages[0].content;
    lastSent = { raw: content, ...JSON.parse(content.slice(content.indexOf('<posts>\n') + 8, content.lastIndexOf('\n</posts>'))) };
    const news = newsFor(lastSent.posts);
    const reply = (n) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(n) }], usage: { output_tokens: 10 } }));
    };
    res.on('close', () => {
      if (!res.writableFinished) fakeClosedEarly++;
    });
    if (fakeMode === 'good') return reply(news);
    if (fakeMode === 'slow') return setTimeout(() => reply(news), 500);
    if (fakeMode === 'slower') return setTimeout(() => reply(news), 1200);
    if (fakeMode === 'bad-slow') return setTimeout(() => reply({ ...news, segments: [{ ...news.segments[0], from: 'zzz' }, ...news.segments.slice(1)] }), 300);
    // 投稿にない ID を使う返事。検査で毎回落ちる（作り直しの問い合わせも落ちる）
    if (fakeMode === 'bad') return reply({ ...news, segments: [{ ...news.segments[0], from: 'zzz' }, ...news.segments.slice(1)] });
  });
});
await new Promise((r) => fake.listen(FAKE_PORT, '127.0.0.1', r));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// いまのサーバーで、これまでに作れた部屋の数（201 が返った数）
let roomsCreated = 0;
function startApp(env) {
  roomsCreated = 0;
  const child = spawn('node', ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(APP_PORT), CHANOMA_API_BASE: `http://127.0.0.1:${FAKE_PORT}`, ANTHROPIC_API_KEY: FAKE_KEY, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const app = { child, log: '' };
  child.stdout.on('data', (d) => (app.log += d));
  child.stderr.on('data', (d) => (app.log += d));
  return app;
}
async function waitReady(timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${APP_PORT}/`);
      await res.arrayBuffer();
      return;
    } catch {
      await wait(100);
    }
  }
  throw new Error(`サーバーが ${timeoutMs}ms 以内に起動しませんでした`);
}
async function stopApp(app) {
  const child = app.child;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = new Promise((r) => child.once('exit', r));
  child.kill();
  await done;
}

// 端末の鍵のハッシュ（本物の画面は、ランダムな鍵の SHA-256 を送る）
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let deviceCount = 0;
const newDevice = () => sha(`test-device-${process.pid}-${deviceCount++}`);

// 通常の呼び出し。本文がある方法には JSON の種類を付ける。headers で足したり上書きしたりできる
async function call(method, path, body, headers = {}) {
  const hasBody = body !== undefined;
  const res = await fetch(`http://127.0.0.1:${APP_PORT}${path}`, {
    method,
    headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...headers },
    body: !hasBody ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (method === 'POST' && path === '/api/room' && res.status === 201) roomsCreated++;
  return { status: res.status, text, json };
}
// Host を自由に決められる呼び出し
const raw = (method, path, headers, body) =>
  new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: APP_PORT, method, path, headers, setHost: false }, (res) => {
      let t = '';
      res.on('data', (c) => (t += c));
      res.on('end', () => {
        if (method === 'POST' && path === '/api/room' && res.statusCode === 201) roomsCreated++;
        resolve({ status: res.statusCode, text: t });
      });
    });
    req.on('error', (e) => resolve({ status: 0, text: String(e.code) }));
    req.end(body);
  });

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`);
  ok ? pass++ : fail++;
}
const CODE_PATTERN = /^[A-Za-z0-9]{22}$/;
// エラーの返事に、内部の事情（環境変数名・ファイル・スタック）が出ていないこと
const noInternals = (text) => !/CHANOMA|ANTHROPIC|server\.mjs|node:|\bat .+\(|FAKE_TEST_KEY/.test(text);

const newRoom = async (headers) => {
  const r = await call('POST', '/api/room', {}, headers);
  if (r.status !== 201) throw new Error(`部屋を作れませんでした: ${r.status} ${r.text}`);
  return r.json.code;
};
const sendPost = (code, post, device) => call('POST', `/api/room/${code}/posts`, { post, device });
const getRoom = (code, query = '') => call('GET', `/api/room/${code}${query}`);
const pressNews = (code, body = {}) => call('POST', `/api/room/${code}/news`, body);
const shelfBody = (sent, patch = {}) => ({ news: newsFor(sent), posts: sent, madeAt: 1_800_000_000_000, ...patch });
const putShelf = (code, date, body) => call('PUT', `/api/room/${code}/shelf/${date}`, body);
const cleaned = (list) => cleanPosts({ posts: list }).posts;

// ======================================================================
// 1. ローカルの形（既定）: 部屋の基本の動き
// ======================================================================
let app = startApp({
  CHANOMA_FAKE_NOW: FAKE_NOW,
  CHANOMA_RATE_PER_MINUTE: '1000',
  CHANOMA_RATE_PER_DAY: '1000',
  CHANOMA_ROOMS_PER_IP_PER_DAY: '1000',
  CHANOMA_ROOM_READS_PER_MINUTE: '100000',
  CHANOMA_ROOM_WRITES_PER_MINUTE: '100000',
});
await waitReady();
const createdCodes = [];
let r;

// --- 部屋を作る ---
r = await call('POST', '/api/room', {});
check('作成: 201 でコードが返る（英数字22字）', r.status === 201 && CODE_PATTERN.test(r.json?.code ?? ''), `${r.status} ${r.text}`);
check('作成: 返事の項目は code だけ', JSON.stringify(Object.keys(r.json ?? {})) === '["code"]', r.text);
const room1 = r.json.code;
createdCodes.push(room1);
const codes = new Set([room1]);
for (let i = 0; i < 30; i++) codes.add(await newRoom());
createdCodes.push(...codes);
check('作成: 31個作ってもコードが重ならず、どれも22字の英数字', codes.size === 31 && [...codes].every((c) => CODE_PATTERN.test(c)), String(codes.size));
r = await call('POST', '/api/room', {}, { 'content-type': 'text/plain' });
check('作成: JSON でない種類は 415', r.status === 415, String(r.status));
r = await call('POST', '/api/room', {}, { origin: 'http://evil.example' });
check('作成: 他のサイトの Origin は 403', r.status === 403 && noInternals(r.text), `${r.status} ${r.text}`);
r = await call('POST', '/api/room', {}, { origin: ORIGIN });
check('作成: 自分の画面の Origin は 201', r.status === 201, String(r.status));
r = await call('POST', '/api/room', '{こわれた');
check('作成: 壊れた JSON は 400', r.status === 400, String(r.status));
r = await call('GET', '/api/room');
check('作成: GET /api/room は 405', r.status === 405, String(r.status));

// --- 部屋を読む ---
r = await getRoom(room1);
check('読む: 空の部屋は、投稿なし・番組の日付なし・きょうの番組なし', r.status === 200 && r.json.posts.length === 0 && r.json.ids.length === 0
  && r.json.dates.length === 0 && r.json.program === null, r.text);
check(`読む: サーバーが日付の鍵（${TODAY}）と今の時刻を返す`, r.json?.day === TODAY && Number.isInteger(r.json?.now), r.text);
r = await getRoom('A'.repeat(22));
check('読む: 知らないコード（形は正しい）は 404', r.status === 404 && noInternals(r.text), `${r.status} ${r.text}`);
for (const bad of ['short', 'A'.repeat(21), 'A'.repeat(23), `${'A'.repeat(21)}-`, '%E3%81%82'.repeat(8)]) {
  r = await getRoom(bad);
  check(`読む: コードの形が違う（${bad.slice(0, 12)}）は 400`, r.status === 400, `${r.status}`);
}
r = await getRoom(room1, '?since=abc');
check('読む: since が数字でなければ 400', r.status === 400, String(r.status));
r = await getRoom(room1, '?since=-1');
check('読む: since が負なら 400', r.status === 400, String(r.status));
r = await call('GET', `/api/room/${room1}`, undefined, { origin: 'http://evil.example' });
check('読む: 他のサイトの Origin は 403', r.status === 403, String(r.status));
r = await call('GET', `/api/room/${room1}/`);
check('読む: 末尾が / の道筋は 404', r.status === 404, String(r.status));
r = await call('GET', `/api/room/${room1}/nothing`);
check('読む: 知らない道筋は 404', r.status === 404, String(r.status));
r = await call('PUT', `/api/room/${room1}`, {});
check('読む: 方法が違えば 405（部屋のコードに PUT）', r.status === 405, String(r.status));

// --- 投稿 ---
const devA = newDevice();
const devB = newDevice();
const devC = newDevice();
r = await sendPost(room1, { ...A, extra: 'x', at: 5, device: 'zzz' }, devA);
const postedA = r.json?.post;
check('投稿: 200 で、サーバーが付けた at が返る（端末が送った at は使わない）', r.status === 200 && Number.isInteger(postedA?.at) && postedA.at > 1_000_000_000_000 && r.json.count === 1, r.text);
check('投稿: 決まった項目だけを持ち、端末の鍵は返さない', postedA && !('extra' in postedA) && !('device' in postedA) && !r.text.includes(devA), r.text);
r = await getRoom(room1);
check('読む: 投稿が1件入っていて、返事のどこにも端末の鍵のハッシュがない', r.json?.posts?.length === 1 && r.json.ids[0] === 'a1' && !r.text.includes(devA), r.text);
const atA = r.json.posts[0].at;
r = await sendPost(room1, B, devB);
const atB = r.json.post.at;
check('投稿: 次の投稿の at は前より大きい', atB > atA, `${atA} ${atB}`);
r = await getRoom(room1, `?since=${atA}`);
check('読む: since を渡すと、それより後の投稿だけ（ids は全部）', r.json.posts.length === 1 && r.json.posts[0].id === 'b1' && r.json.ids.length === 2, r.text);
r = await getRoom(room1, `?since=${atB}`);
check('読む: 最後の at を since にすると、新しい投稿は空', r.json.posts.length === 0 && r.json.ids.length === 2, r.text);
r = await sendPost(room1, A, devA);
check('投稿: 同じ端末が同じ ID を送り直すと、足さずに前のものを返す（200、at も同じ）', r.status === 200 && r.json.post.at === atA && r.json.count === 2, r.text);
r = await sendPost(room1, A, devC);
check('投稿: ちがう端末が同じ ID を送ると 409（束が壊れて番組が作れなくなるのを防ぐ）', r.status === 409, `${r.status} ${r.text}`);
r = await getRoom(room1);
check('投稿: 409 のあとも投稿は2件のまま', r.json.ids.length === 2, r.text);
r = await sendPost(room1, C, 'x'.repeat(64));
check('投稿: 鍵のハッシュの形が違えば 400', r.status === 400, r.text);
r = await call('POST', `/api/room/${room1}/posts`, { post: C });
check('投稿: 鍵のハッシュがなければ 400', r.status === 400, r.text);
r = await sendPost(room1, { ...C, who: '' }, devC);
check('投稿: 投稿の形が悪ければ 400', r.status === 400 && noInternals(r.text), r.text);
r = await sendPost(room1, { ...C, text: 'あ'.repeat(201) }, devC);
check('投稿: 200 文字を超える本文は 400', r.status === 400, r.text);
r = await call('POST', `/api/room/${room1}/posts`, { post: [C], device: devC });
check('投稿: 投稿が配列なら 400', r.status === 400, r.text);
r = await call('POST', `/api/room/${room1}/posts`, null);
check('投稿: 本文が null でも 400（500 にならない）', r.status === 400, `${r.status} ${r.text}`);
r = await call('POST', `/api/room/${room1}/posts`, 'x'.repeat(40 * 1024));
check('投稿: 32KB を超える本文は 413', r.status === 413, String(r.status));
r = await sendPost('B'.repeat(22), C, devC);
check('投稿: 知らない部屋は 404', r.status === 404, String(r.status));

// 禁止の言葉。止めるだけで、書き換えず、部屋にも入らない
for (const [text, reason] of [['また来てね', /催促/], ['もう病院へ行ったほうがいい', /助言/], ['元気になった', /健康/], ['健、康にいい', /健康/]]) {
  r = await sendPost(room1, { ...C, id: 'w1', text }, devC);
  check(`投稿: 禁止の言葉「${text}」は 422 で止める（理由つき）`, r.status === 422 && r.json?.error === 'この言葉は使えません。' && reason.test(r.json?.reason ?? ''), `${r.status} ${r.text}`);
}
r = await getRoom(room1);
check('投稿: 止めた投稿は部屋に入っていない', r.json.ids.length === 2, r.text);

// --- 消す ---
r = await call('DELETE', `/api/room/${room1}/posts/b1`, undefined, { 'x-chanoma-device': devC });
check('削除: ちがう端末の鍵では 403', r.status === 403, `${r.status} ${r.text}`);
r = await call('DELETE', `/api/room/${room1}/posts/b1`);
check('削除: 鍵がなければ 400', r.status === 400, String(r.status));
r = await call('DELETE', `/api/room/${room1}/posts/b1`, undefined, { 'x-chanoma-device': 'abc' });
check('削除: 鍵の形が違えば 400', r.status === 400, String(r.status));
r = await call('DELETE', `/api/room/${room1}/posts/zz9`, undefined, { 'x-chanoma-device': devB });
check('削除: ない投稿は 404', r.status === 404, String(r.status));
r = await call('DELETE', `/api/room/${room1}/posts/b1`, undefined, { 'x-chanoma-device': devB, origin: 'http://evil.example' });
check('削除: 他のサイトの Origin は 403', r.status === 403, String(r.status));
r = await getRoom(room1);
check('削除: ここまでの失敗では、投稿は消えていない', r.json.ids.length === 2, r.text);
r = await call('DELETE', `/api/room/${room1}/posts/b1`, undefined, { 'x-chanoma-device': devB });
check('削除: 送った端末の鍵なら 200', r.status === 200, `${r.status} ${r.text}`);
r = await getRoom(room1);
check('削除: ids から消え、残りは1件', r.json.ids.length === 1 && r.json.ids[0] === 'a1', r.text);
r = await sendPost(room1, B, devC);
check('削除: 消した ID は、ほかの端末が使える', r.status === 200, r.text);

// --- 1日30件・1端末の連投 ---
const room30 = await newRoom();
createdCodes.push(room30);
const devs = [newDevice(), newDevice(), newDevice(), newDevice()];
let ok30 = 0;
for (let i = 0; i < MAX_POSTS; i++) {
  r = await sendPost(room30, { id: `n${i}`, who: 'まご', topic: 'そら', text: `にじ${i}本` }, devs[i % 4]);
  if (r.status === 200) ok30++;
}
check(`上限: 1日 ${MAX_POSTS} 件まで入る`, ok30 === MAX_POSTS, String(ok30));
r = await sendPost(room30, { id: 'n99', who: 'まご', topic: 'そら' }, devs[0]);
check('上限: 31件目は 409「きょうは30件までです。」', r.status === 409 && r.json?.error === 'きょうは30件までです。', `${r.status} ${r.text}`);
r = await call('DELETE', `/api/room/${room30}/posts/n0`, undefined, { 'x-chanoma-device': devs[0] });
r = await sendPost(room30, { id: 'n99', who: 'まご', topic: 'そら' }, devs[0]);
check('上限: 1件消すと、また1件入る', r.status === 200, `${r.status} ${r.text}`);
const roomRate = await newRoom();
createdCodes.push(roomRate);
const fast = newDevice();
const rateCodes = [];
for (let i = 0; i < 11; i++) rateCodes.push((await sendPost(roomRate, { id: `r${i}`, who: 'まご', topic: 'そら' }, fast)).status);
check('連投: 1端末は1分に10件まで（11件目は 429）', rateCodes.slice(0, 10).every((x) => x === 200) && rateCodes[10] === 429, rateCodes.join(','));
r = await sendPost(roomRate, { id: 'r0', who: 'まご', topic: 'そら' }, fast);
check('連投: 上限のあとでも、同じ投稿の送り直しは 200（数えない）', r.status === 200, String(r.status));
r = await sendPost(roomRate, { id: 'rx', who: 'まご', topic: 'そら' }, newDevice());
check('連投: ほかの端末は、同じ部屋に送れる', r.status === 200, String(r.status));

// --- 番組: 二重に作らない ---
const roomN = await newRoom();
createdCodes.push(roomN);
const devN = [newDevice(), newDevice(), newDevice()];
for (const [i, p] of FAMILY.entries()) await sendPost(roomN, p, devN[i % 3]);
r = await pressNews(roomN, { nextDate: '2026-02-31' });
check('番組: つぎに会う日の形が悪ければ 400（Claude を呼ばない）', r.status === 400 && fakeCalls === 0, `${r.status} calls=${fakeCalls}`);
r = await call('POST', `/api/room/${roomN}/news`, []);
check('番組: 本文が配列なら 400', r.status === 400, String(r.status));
r = await call('POST', `/api/room/${roomN}/news`, {}, { 'content-type': 'text/plain' });
check('番組: JSON でない種類は 415', r.status === 415, String(r.status));
r = await call('POST', `/api/room/${roomN}/news`, {}, { origin: 'http://evil.example' });
check('番組: 他のサイトの Origin は 403（Claude を呼ばない）', r.status === 403 && fakeCalls === 0, `${r.status} calls=${fakeCalls}`);
r = await pressNews('C'.repeat(22));
check('番組: 知らない部屋は 404', r.status === 404, String(r.status));
const roomEmpty = await newRoom();
r = await pressNews(roomEmpty);
check('番組: きょうの投稿がなければ 400（Claude を呼ばない）', r.status === 400 && fakeCalls === 0, `${r.status} calls=${fakeCalls}`);

fakeMode = 'slow';
const before = fakeCalls;
const [n1, n2, n3] = await Promise.all([pressNews(roomN), pressNews(roomN), pressNews(roomN)]);
check('二重生成: 同時に3回押しても、Claude への問い合わせは1回だけ', fakeCalls - before === 1, `問い合わせ ${fakeCalls - before} 回`);
check('二重生成: 3つとも 200 で、同じ番組と同じ madeAt', [n1, n2, n3].every((x) => x.status === 200)
  && JSON.stringify(n1.json) === JSON.stringify(n2.json) && JSON.stringify(n2.json) === JSON.stringify(n3.json), `${n1.status}/${n2.status}/${n3.status}`);
const program = n1.json?.program;
check(`番組: 日付の鍵・作ったときの投稿の写し・番組が入っている（source は server）`, program?.date === TODAY && program?.source === 'server'
  && JSON.stringify(program?.posts) === JSON.stringify(cleaned(FAMILY)) && program?.news?.segments?.length === 4 && Number.isInteger(program?.madeAt), n1.text);
check('番組: 投稿の写しにも、返事のどこにも、端末の鍵や at がない', !n1.text.includes(devN[0]) && !n1.text.includes(devN[1]) && !('at' in (program?.posts?.[0] ?? {})), n1.text);
const sentIds = lastSent.posts.map((p) => p.id).join(',');
check('送信: Claude には、部屋のきょうの投稿だけが、決まった項目で渡る（at・鍵なし）', sentIds === 'a1,b1,c1,d1'
  && lastSent.posts.every((p) => !('at' in p) && !('key' in p) && !('device' in p)) && !lastSent.raw.includes(devN[0]), sentIds);
r = await pressNews(roomN);
check('二重生成: 4回目は作らずに返す（made:false、問い合わせは増えない）', r.status === 200 && r.json.made === false && fakeCalls - before === 1
  && JSON.stringify(r.json.program) === JSON.stringify(program), `${r.status} calls=${fakeCalls - before}`);
r = await getRoom(roomN);
check('読む: きょうの番組と、日付の一覧が返る', JSON.stringify(r.json.program) === JSON.stringify(program) && JSON.stringify(r.json.dates) === JSON.stringify([TODAY]), r.text);
// 番組のあとに届いた投稿は、部屋には入るが、番組には混ざらない
r = await sendPost(roomN, { id: 'e1', who: 'おとうさん', topic: 'そら', text: 'ほしがきれい' }, devN[0]);
check('番組のあと: 投稿は届く', r.status === 200, r.text);
r = await pressNews(roomN);
check('番組のあと: 押しても作り直さず、番組の写しは4件のまま', r.json.made === false && r.json.program.posts.length === 4 && fakeCalls - before === 1, r.text);
r = await getRoom(roomN);
check('番組のあと: 部屋の投稿は5件、番組の写しは4件', r.json.ids.length === 5 && r.json.program.posts.length === 4, r.text);

// つぎに会う日
const roomND = await newRoom();
createdCodes.push(roomND);
await sendPost(roomND, A, newDevice());
fakeMode = 'good';
r = await pressNews(roomND, { nextDate: '2026-11-20' });
check('番組: つぎに会う日を渡すと、番組と Claude への送り物に入る', r.status === 200 && r.json.program.nextDate === '2026-11-20' && lastSent.nextDate === '2026-11-20', r.text);

// 失敗は共有し、固まらない
const roomF = await newRoom();
createdCodes.push(roomF);
await sendPost(roomF, A, newDevice());
fakeMode = 'bad-slow';
const beforeBad = fakeCalls;
const [f1, f2] = await Promise.all([pressNews(roomF), pressNews(roomF)]);
check('失敗: 検査に落ち続けると、2人とも 502（1回の生成と、作り直し1回で、問い合わせは2回）', f1.status === 502 && f2.status === 502 && fakeCalls - beforeBad === 2 && noInternals(f1.text),
  `${f1.status}/${f2.status} calls=${fakeCalls - beforeBad} ${f1.text}`);
r = await getRoom(roomF);
check('失敗: 番組は部屋に入らない', r.json.program === null && r.json.dates.length === 0, r.text);
fakeMode = 'good';
r = await pressNews(roomF);
check('失敗: 失敗した約束は残らず、次に押すと作れる', r.status === 200 && r.json.made === true, `${r.status} ${r.text}`);

// 切断: 1人が切れても続け、全員が切れたら止める
const roomX = await newRoom();
createdCodes.push(roomX);
await sendPost(roomX, A, newDevice());
fakeMode = 'slower';
const closedBefore = fakeClosedEarly;
const ctl = new AbortController();
const leaver = fetch(`http://127.0.0.1:${APP_PORT}/api/room/${roomX}/news`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: ctl.signal }).catch(() => null);
await wait(100);
const stayer = pressNews(roomX);
await wait(100);
ctl.abort();
await leaver;
const stayed = await stayer;
check('切断: 待つ人が1人切れても生成は止まらず、残った人に番組が届く', stayed.status === 200 && fakeClosedEarly === closedBefore, `${stayed.status} 中断 ${fakeClosedEarly - closedBefore}`);
r = await getRoom(roomX);
check('切断: 作った番組は部屋に残る', r.json.program !== null, r.text);

const roomY = await newRoom();
createdCodes.push(roomY);
await sendPost(roomY, A, newDevice());
const ctl2 = new AbortController();
const lone = fetch(`http://127.0.0.1:${APP_PORT}/api/room/${roomY}/news`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: ctl2.signal }).catch(() => null);
await wait(200);
ctl2.abort();
await lone;
await wait(400);
check('切断: 待つ人が全員いなくなったら、Claude への問い合わせを止める', fakeClosedEarly === closedBefore + 1, `中断 ${fakeClosedEarly - closedBefore}`);
r = await getRoom(roomY);
check('切断: 止めた分の番組は部屋に入らない', r.json.program === null, r.text);
await wait(900);
fakeMode = 'good';
r = await pressNews(roomY);
check('切断: そのあと押し直すと作れる（約束が残っていない）', r.status === 200 && r.json.made === true, `${r.status} ${r.text}`);

// --- 本棚 ---
fakeMode = 'good';
const roomS = await newRoom();
createdCodes.push(roomS);
const shelfBefore = fakeCalls;
const okBody = shelfBody(cleaned(FAMILY));
r = await putShelf(roomS, YESTERDAY, okBody);
check('本棚: きのうの番組を差し出すと 200（Claude は呼ばない）', r.status === 200 && fakeCalls === shelfBefore, `${r.status} ${r.text}`);
r = await call('GET', `/api/room/${roomS}/shelf?dates=${YESTERDAY},2020-01-01`);
check('本棚: 取ると、あるものだけが返る（source は device、中身は検査後の形）', r.status === 200 && r.json.programs.length === 1 && r.json.programs[0].date === YESTERDAY
  && r.json.programs[0].source === 'device' && isDeepStrictEqual(r.json.programs[0].news, newsFor(cleaned(FAMILY)))
  && JSON.stringify(r.json.programs[0].posts) === JSON.stringify(cleaned(FAMILY)), r.text);
r = await getRoom(roomS);
check('本棚: 部屋の日付の一覧にも出る（きょうの番組はまだない）', JSON.stringify(r.json.dates) === JSON.stringify([YESTERDAY]) && r.json.program === null, r.text);
r = await putShelf(roomS, YESTERDAY, shelfBody(cleaned([{ ...A, id: 'z1', text: 'べつの話' }])));
check('本棚: 同じ日付への上書きは 409', r.status === 409, `${r.status} ${r.text}`);
r = await call('GET', `/api/room/${roomS}/shelf?dates=${YESTERDAY}`);
check('本棚: 上書きされず、最初の番組のまま', JSON.stringify(r.json.programs[0].posts) === JSON.stringify(cleaned(FAMILY)), r.text);
// 日付の範囲
for (const [label, date, status] of [
  ['きょう', TODAY, 400], ['あした', shiftDay(TODAY, 1), 400], ['来年', '2027-11-05', 400],
  ['60日前（ぎりぎり）', shiftDay(TODAY, -60), 200], ['61日前', shiftDay(TODAY, -61), 400],
]) {
  r = await putShelf(roomS, date, shelfBody(cleaned(FAMILY)));
  check(`本棚: ${label}（${date}）は ${status}`, r.status === status, `${r.status} ${r.text}`);
}
for (const bad of ['abc', '2026-02-31', '2026-11-4', '20261104', '2026-13-01']) {
  r = await putShelf(roomS, bad, okBody);
  check(`本棚: 日付の形が悪い（${bad}）は 400`, r.status === 400, `${r.status}`);
}
r = await getRoom(roomS);
check('本棚: 拒否したものは入っていない（きのうと60日前の2本だけ）', r.json.dates.length === 2, r.text);
// 検査に落ちるもの
const evilHost = shelfBody(cleaned(FAMILY));
evilHost.news.segments[0].host = 'はなこさんのひとことです。';
const unknownId = shelfBody(cleaned(FAMILY));
unknownId.news.segments[0].from = 'zzz';
const bannedPost = shelfBody(cleaned(FAMILY));
bannedPost.posts[0].text = 'また来てね';
const injected = shelfBody(cleaned(FAMILY));
injected.news.segments[0].host = '<script>alert(1)</script>';
const noPosts = shelfBody([]);
const badMadeAt = shelfBody(cleaned(FAMILY), { madeAt: 'いま' });
const day = (n) => shiftDay(TODAY, -n);
for (const [label, body, status] of [
  ['投稿にない名前', evilHost, 422], ['投稿にない ID', unknownId, 422], ['投稿の本文に禁止の言葉', bannedPost, 422],
  ['HTML を含む司会の文', injected, 422], ['投稿が空', noPosts, 422], ['madeAt が数字でない', badMadeAt, 422],
  ['入力が配列', [], 422], ['入力が null', null, 422],
]) {
  r = await putShelf(roomS, day(2), body);
  check(`本棚: 検査に落ちる（${label}）は ${status}で、内部情報なし`, r.status === status && noInternals(r.text), `${r.status} ${r.text}`);
}
r = await call('GET', `/api/room/${roomS}/shelf?dates=${day(2)}`);
check('本棚: 検査に落ちたものは1本も入っていない', r.json.programs.length === 0, r.text);
const junky = shelfBody(cleaned(FAMILY));
junky.news.junk = '<b>x</b>';
junky.news.segments[0].html = '<i>';
junky.posts[0].device = devA;
junky.foo = 'bar';
r = await putShelf(roomS, day(3), junky);
check('本棚: 余計な項目つきでも、決まった項目だけにして受け取る', r.status === 200, r.text);
r = await call('GET', `/api/room/${roomS}/shelf?dates=${day(3)}`);
check('本棚: 余計な項目は保存されていない', r.json.programs[0] && !r.text.includes('junk') && !r.text.includes('<b>') && !r.text.includes(devA) && !r.text.includes('bar'), r.text);
r = await putShelf(roomS, day(4), { ...okBody, junk: 'x'.repeat(50 * 1024) });
check('本棚: 48KB を超える番組は 422（大きすぎる）', r.status === 422 && /大きすぎ/.test(r.json?.error ?? ''), `${r.status} ${r.text.slice(0, 80)}`);
r = await putShelf(roomS, day(4), { ...okBody, junk: 'x'.repeat(70 * 1024) });
check('本棚: 70KB の本文は、読み切る前に 413', r.status === 413, String(r.status));
r = await call('PUT', `/api/room/${roomS}/shelf/${day(4)}`, JSON.stringify(okBody), { 'content-type': 'text/plain' });
check('本棚: JSON でない種類は 415', r.status === 415, String(r.status));
r = await call('PUT', `/api/room/${roomS}/shelf/${day(4)}`, okBody, { origin: 'http://evil.example' });
check('本棚: 他のサイトの Origin は 403', r.status === 403, String(r.status));
r = await putShelf('D'.repeat(22), day(4), okBody);
check('本棚: 知らない部屋は 404（コードを知らずには差し出せない）', r.status === 404, String(r.status));
r = await putShelf('short', day(4), okBody);
check('本棚: コードの形が違えば 400', r.status === 400, String(r.status));
// 取る側
r = await call('GET', `/api/room/${roomS}/shelf`);
check('本棚: dates がなければ 400', r.status === 400, String(r.status));
r = await call('GET', `/api/room/${roomS}/shelf?dates=abc`);
check('本棚: 日付の形が悪ければ 400', r.status === 400, String(r.status));
const ten = Array.from({ length: 10 }, (_, i) => day(i + 1)).join(',');
const eleven = Array.from({ length: 11 }, (_, i) => day(i + 1)).join(',');
r = await call('GET', `/api/room/${roomS}/shelf?dates=${ten}`);
check('本棚: 10本までは取れる', r.status === 200, String(r.status));
r = await call('GET', `/api/room/${roomS}/shelf?dates=${eleven}`);
check('本棚: 11本は 400（1回10本まで）', r.status === 400, String(r.status));
r = await call('GET', `/api/room/${roomS}/shelf?dates=${YESTERDAY},${YESTERDAY}`);
check('本棚: 同じ日付を重ねても、1本だけ返る', r.status === 200 && r.json.programs.length === 1, r.text);

// 部屋の本棚は30本まで。いっぱいでも、きょうの番組は作れる（いちばん古い日付を捨てる）
const roomFull = await newRoom();
createdCodes.push(roomFull);
let putOk = 0;
for (let i = 1; i <= 30; i++) if ((await putShelf(roomFull, day(i), okBody)).status === 200) putOk++;
check('本棚: 部屋ごとに30本まで入る', putOk === 30, String(putOk));
r = await putShelf(roomFull, day(31), okBody);
check('本棚: 31本目は 409', r.status === 409, `${r.status} ${r.text}`);
await sendPost(roomFull, A, newDevice());
r = await pressNews(roomFull);
check('本棚がいっぱいでも、きょうの番組は作れる', r.status === 200 && r.json.made === true, `${r.status} ${r.text}`);
r = await getRoom(roomFull);
check('本棚がいっぱい: 30本のまま、きょうが入り、いちばん古い日付が消えている', r.json.dates.length === 30 && r.json.dates.includes(TODAY) && !r.json.dates.includes(day(30)) && r.json.dates.includes(day(29)), r.text);

// --- ログ・エラーの確かめ ---
check('記録: 部屋のコードの全部も、投稿の本文も、端末の鍵も、ログに出ていない', createdCodes.every((c) => !app.log.includes(c)) && !/煮物|にじ|アルバム/.test(app.log) && !app.log.includes(devA) && !app.log.includes(FAKE_KEY), app.log.slice(0, 300));
check('記録: コードの先頭4字だけが記録にある', app.log.includes(`${room1.slice(0, 4)}…`) || createdCodes.some((c) => app.log.includes(`${c.slice(0, 4)}…`)), app.log.slice(0, 300));
check('記録: 禁止の言葉の理由や、拒否した番組の記録に、断片が残っていない', !/はなこ|script|alert/.test(app.log), app.log.slice(-400));

// --- 既存の入口は、ローカルでは今までどおり ---
r = await call('POST', '/api/news', { posts: FAMILY });
check('ローカル: POST /api/news は今までどおり 200', r.status === 200 && r.json?.segments?.length === 4, `${r.status} ${r.text}`);
await stopApp(app);

// ======================================================================
// 2. ローカルの形（上限は既定のまま）
// ======================================================================
app = startApp({ CHANOMA_FAKE_NOW: FAKE_NOW });
await waitReady();
const ipCodes = [];
for (let i = 0; i < 6; i++) ipCodes.push((await call('POST', '/api/room', {}, { 'x-forwarded-for': `203.0.113.${i + 1}` })).status);
check('上限: 1つの IP から1日に作れる部屋は5つ（6つ目は 429）。ローカルでは X-Forwarded-For を信じない', ipCodes.join(',') === '201,201,201,201,201,429', ipCodes.join(','));
r = await call('POST', '/api/room', {});
check('上限: 部屋を作れない返事は固定文で、内部情報を含まない', r.status === 429 && r.json?.error?.includes('きょうは作れる部屋の数に達しました') && noInternals(r.text), r.text);
const unknown = 'E'.repeat(22);
const reads = [];
for (let i = 0; i < 62; i++) reads.push((await call('GET', `/api/room/${unknown}`)).status);
check('上限: 読みは1分に60回まで（知らないコードを探す総当たりも数える。61回目から 429）',
  reads.slice(0, 60).every((x) => x === 404) && reads[60] === 429 && reads[61] === 429, `${reads.slice(58, 62).join(',')}`);
r = await call('GET', '/');
check('上限: 画面のファイルの配信は、読みの上限の対象外', r.status === 200, String(r.status));
await stopApp(app);

// ======================================================================
// 3. 公開の形: /api/news なし・Origin の許可・IP・3台の通し・部屋100の上限
// ======================================================================
app = startApp({ CHANOMA_PUBLIC: '1', CHANOMA_ORIGIN: `${ORIGIN}, https://family.example/` });
await waitReady();
check('公開: 起動の表示で、公開の形と /api/news を出さないことが分かる', app.log.includes('公開の形') && app.log.includes('/api/news は出しません'), app.log);
const pub = (ip, extra = {}) => ({ 'x-forwarded-for': ip, origin: ORIGIN, ...extra });
const callsBeforePublicNews = fakeCalls;
r = await call('POST', '/api/news', { posts: FAMILY }, pub('198.51.100.1'));
check('公開: POST /api/news は 404（Claude も呼ばない）', r.status === 404 && fakeCalls === callsBeforePublicNews, `${r.status} ${r.text}`);
r = await call('GET', '/api/news', undefined, pub('198.51.100.1'));
check('公開: GET /api/news も 404（405 ではない）', r.status === 404, String(r.status));
r = await call('PUT', '/api/news', {}, pub('198.51.100.1'));
check('公開: PUT /api/news も 404', r.status === 404, String(r.status));
r = await call('GET', '/', undefined, pub('198.51.100.1'));
check('公開: 画面のファイルは配る', r.status === 200, String(r.status));
r = await call('POST', '/api/room', {}, pub('198.51.100.1', { origin: 'https://evil.example' }));
check('公開: 許可にない Origin は 403', r.status === 403, String(r.status));
r = await call('POST', '/api/room', {}, pub('198.51.100.1', { origin: `http://localhost:${APP_PORT}` }));
check('公開: ローカルの Origin は許可しない（CHANOMA_ORIGIN にあるものだけ）', r.status === 403, String(r.status));
r = await call('POST', '/api/room', {}, pub('198.51.100.1', { origin: 'https://family.example' }));
check('公開: CHANOMA_ORIGIN の2つ目（カンマ区切り、末尾の / つき）も許可', r.status === 201, `${r.status} ${r.text}`);
const goodHost = { 'content-type': 'application/json', host: `127.0.0.1:${APP_PORT}`, origin: ORIGIN, 'x-forwarded-for': '198.51.100.2' };
r = await raw('POST', '/api/room', { ...goodHost, host: 'evil.example' }, '{}');
check('公開: Host が許可にない名前なら 403', r.status === 403, String(r.status));
r = await raw('POST', '/api/room', { ...goodHost, host: 'family.example' }, '{}');
check('公開: Host が CHANOMA_ORIGIN の名前なら通る', r.status === 201, `${r.status} ${r.text}`);
r = await raw('POST', '/api/room', { ...goodHost, host: `localhost:${APP_PORT}` }, '{}');
check('公開: Host が localhost なら 403（CHANOMA_ORIGIN にない）', r.status === 403, String(r.status));
r = await call('POST', '/api/room', {}, pub('198.51.100.1'));
check('公開: 許可した Origin からは作れる', r.status === 201, String(r.status));

// IP: X-Forwarded-For の先頭を使う（2つ目以降を変えても、同じ送り元）
const xffCodes = [];
for (let i = 0; i < 6; i++) xffCodes.push((await call('POST', '/api/room', {}, pub(`198.51.100.77, 10.0.0.${i}`))).status);
check('公開: 送り元は X-Forwarded-For の先頭。先頭が同じなら、2つ目を変えても5部屋まで（6つ目は 429）', xffCodes.join(',') === '201,201,201,201,201,429', xffCodes.join(','));
r = await call('POST', '/api/room', {}, pub('198.51.100.78, 198.51.100.77'));
check('公開: 先頭がちがう送り元なら、作れる', r.status === 201, String(r.status));

// 3台（3つの鍵）が、同じ部屋で同じ番組を見る
const ipA = '192.0.2.10';
const ipB = '192.0.2.11';
const ipC = '192.0.2.12';
const roomP = await newRoom(pub('192.0.2.9'));
const keyGrand = newDevice();
const keyMama = newDevice();
const keyKid = newDevice();
const postAs = (ip, key, p) => call('POST', `/api/room/${roomP}/posts`, { post: p, device: key }, pub(ip));
const results = await Promise.all([postAs(ipA, keyGrand, A), postAs(ipB, keyMama, C), postAs(ipC, keyKid, B)]);
check('通し: 3台がそれぞれ投稿できる', results.every((x) => x.status === 200), results.map((x) => x.status).join(','));
r = await postAs(ipC, keyKid, D);
check('通し: 4つ目の投稿（つぎに会う日の希望）も入る', r.status === 200, r.text);
const viewA = await call('GET', `/api/room/${roomP}`, undefined, pub(ipA));
const viewB = await call('GET', `/api/room/${roomP}`, undefined, pub(ipB));
check('通し: 3台とも、同じ4件の投稿が見える（鍵は見えない）', viewA.json.ids.length === 4 && JSON.stringify(viewA.json.ids) === JSON.stringify(viewB.json.ids)
  && ![keyGrand, keyMama, keyKid].some((k) => viewA.text.includes(k)), viewA.text);
r = await call('DELETE', `/api/room/${roomP}/posts/a1`, undefined, pub(ipB, { 'x-chanoma-device': keyMama }));
check('通し: ほかの人の投稿は、自分の鍵では消せない（403）', r.status === 403, String(r.status));
fakeMode = 'slow';
const callsBeforePublic = fakeCalls;
const press = [ipA, ipB, ipC].map((ip) => call('POST', `/api/room/${roomP}/news`, {}, pub(ip)));
const [pa, pb, pc] = await Promise.all(press);
check('通し: 3台が同時に「夜7時」を押しても、Claude への問い合わせは1回', fakeCalls - callsBeforePublic === 1, `問い合わせ ${fakeCalls - callsBeforePublic} 回`);
check('通し: 3台とも、同じ番組・同じ投稿の写し・同じ madeAt を受け取る', [pa, pb, pc].every((x) => x.status === 200)
  && JSON.stringify(pa.json.program) === JSON.stringify(pb.json.program) && JSON.stringify(pb.json.program) === JSON.stringify(pc.json.program)
  && pa.json.program.news.segments.length === 4 && pa.json.program.posts.length === 4, `${pa.status}/${pb.status}/${pc.status}`);
const afterA = await call('GET', `/api/room/${roomP}`, undefined, pub(ipA));
const afterC = await call('GET', `/api/room/${roomP}`, undefined, pub(ipC));
check('通し: あとから読んでも、3台が同じ番組を取れる', JSON.stringify(afterA.json.program) === JSON.stringify(pa.json.program) && JSON.stringify(afterC.json.program) === JSON.stringify(pa.json.program), afterA.text);
// 本棚の持ち寄り: 端末A が差し出し、端末B が受け取る
const shelfBodyA = shelfBody(cleaned(FAMILY));
r = await call('PUT', `/api/room/${roomP}/shelf/2020-01-01`, shelfBodyA, pub(ipA));
check('通し: 2020年の日付は60日より前なので差し出せない（400）', r.status === 400, String(r.status));
const realYesterday = shiftDay(afterA.json.day, -1);
r = await call('PUT', `/api/room/${roomP}/shelf/${realYesterday}`, shelfBodyA, pub(ipA));
check('通し: 端末A が、きのうの番組を差し出せる', r.status === 200, `${r.status} ${r.text}`);
r = await call('GET', `/api/room/${roomP}/shelf?dates=${realYesterday}`, undefined, pub(ipB));
check('通し: 端末B が、それを本棚から受け取れる', r.status === 200 && r.json.programs.length === 1 && r.json.programs[0].date === realYesterday, r.text);
check('公開: Claude を呼んだのは、部屋の番組の1回だけ（/api/news は呼ばれない）', fakeCalls - callsBeforePublicNews === 1, String(fakeCalls - callsBeforePublicNews));

// 部屋は100まで。送り元を変えて作り続け、100室で 429 になることを確かめる（3日さわられていない部屋はないので、消えない）
let capStatus = 201;
for (let ip = 1; ip <= 60 && capStatus === 201; ip++) {
  for (let k = 0; k < 5 && capStatus === 201; k++) capStatus = (await call('POST', '/api/room', {}, pub(`100.64.0.${ip}`))).status;
}
check('部屋の上限: 部屋が100室になったところで、新しい部屋は 429（内部情報なし）', capStatus === 429 && roomsCreated === 100, `status=${capStatus} 作れた数=${roomsCreated}`);
r = await call('POST', '/api/room', {}, pub('100.64.9.9'));
check('部屋の上限: 送り元がちがっても、100室なら 429', r.status === 429 && noInternals(r.text), `${r.status} ${r.text}`);
r = await call('GET', `/api/room/${roomP}`, undefined, pub(ipA));
check('部屋の上限: 上限に達しても、既存の部屋は読める', r.status === 200, String(r.status));
check('記録: 公開でも、部屋のコードの全部や投稿の本文は、ログに出ていない', !app.log.includes(roomP) && !/煮物|にじ|アルバム/.test(app.log) && !app.log.includes(keyGrand), app.log.slice(0, 300));
await stopApp(app);

// 公開で CHANOMA_ORIGIN がないと、止まる（許可の書き忘れで、だれからでも呼べる状態にしない）
for (const [label, env] of [['未設定', {}], ['空', { CHANOMA_ORIGIN: ' , ' }], ['URL でない', { CHANOMA_ORIGIN: 'これはURLではない' }], ['http/https でない', { CHANOMA_ORIGIN: 'ftp://x.example' }]]) {
  const bad = startApp({ CHANOMA_PUBLIC: '1', CHANOMA_ORIGIN: '', ...env });
  const code = await new Promise((resolve) => {
    bad.child.once('close', resolve);
    setTimeout(() => resolve('動いたまま'), 4000);
  });
  check(`公開: CHANOMA_ORIGIN が${label}なら、起動せずに止まる`, code !== '動いたまま' && code !== 0 && /CHANOMA_ORIGIN/.test(bad.log), `${code} ${bad.log.slice(0, 120)}`);
  await stopApp(bad);
}

// ======================================================================
// 4. 時計を進めて確かめる: 翌朝 4:00 の掃除と、3日さわられていない部屋の扱い
//    （CHANOMA_FAKE_NOW / CHANOMA_FAKE_SPEED は、テスト用。公開の形では無視される）
// ======================================================================
// 4-1. JST 02:30 から、1秒で30分進む。3秒たつと 4:00 を越えて、日付の鍵が変わる
app = startApp({
  CHANOMA_FAKE_NOW: '2026-11-04T17:30:00Z', CHANOMA_FAKE_SPEED: '1800', CHANOMA_SWEEP_MS: '200',
  CHANOMA_RATE_PER_MINUTE: '1000', CHANOMA_RATE_PER_DAY: '1000',
});
await waitReady();
fakeMode = 'good';
const roomR = await newRoom();
const keyR = newDevice();
r = await sendPost(roomR, A, keyR);
const dayBefore = (await getRoom(roomR)).json.day;
check('翌朝: 夜中の 2:30（JST）は、まだ前の日の日付の鍵（2026-11-04）', dayBefore === '2026-11-04' && r.status === 200, `${dayBefore} ${r.status}`);
const callsR = fakeCalls;
r = await pressNews(roomR);
check('翌朝: 前の日の番組を作る', r.status === 200 && r.json.program.date === '2026-11-04', `${r.status} ${r.text}`);
let rolled = null;
for (let i = 0; i < 60 && !rolled; i++) {
  await wait(200);
  const g = await getRoom(roomR);
  if (g.json.day === '2026-11-05') rolled = g;
}
check('翌朝: 4:00 を越えると、日付の鍵が変わる（2026-11-05）', rolled !== null, 'まだ変わらない');
check('翌朝: きょうの投稿・きょうの番組は空になり、前の日の番組は日付の一覧に残る', rolled?.json?.posts?.length === 0 && rolled?.json?.ids?.length === 0
  && rolled?.json?.program === null && JSON.stringify(rolled?.json?.dates) === '["2026-11-04"]', rolled?.text);
await wait(500);
check('翌朝: 掃除が、前の日の投稿1件を消した（ログ）', /掃除: 前の日の投稿 1 件/.test(app.log), app.log.slice(-300));
r = await sendPost(roomR, A, keyR);
check('翌朝: 前の日と同じ ID の投稿を、新しい日に送れる', r.status === 200 && r.json.count === 1, r.text);
r = await pressNews(roomR);
check('翌朝: 新しい日の番組は、新しく作る（問い合わせが増える）', r.status === 200 && r.json.made === true && r.json.program.date === '2026-11-05' && fakeCalls - callsR === 2, `${r.status} calls=${fakeCalls - callsR}`);
const yesterdayShelf = await call('GET', `/api/room/${roomR}/shelf?dates=2026-11-04`);
check('翌朝: 前の日の番組は、本棚として取れる', yesterdayShelf.json?.programs?.length === 1 && yesterdayShelf.json.programs[0].date === '2026-11-04', yesterdayShelf.text);
await stopApp(app);

// 4-2. 1秒で1日進む。掃除のタイマーは止めて、部屋を作るときの「古い部屋を消す」道だけを確かめる
app = startApp({
  CHANOMA_FAKE_NOW: FAKE_NOW, CHANOMA_FAKE_SPEED: '86400', CHANOMA_SWEEP_MS: '3600000000',
  CHANOMA_ROOMS_PER_IP_PER_DAY: '1000', CHANOMA_ROOM_READS_PER_MINUTE: '100000', CHANOMA_ROOM_WRITES_PER_MINUTE: '100000',
});
await waitReady();
const startedAt = Date.now();
const many = [];
let lastStatus = 201;
for (let i = 0; i < 100 && lastStatus === 201; i++) {
  const x = await call('POST', '/api/room', {});
  lastStatus = x.status;
  if (x.status === 201) many.push(x.json.code);
}
r = await call('POST', '/api/room', {});
check('古い部屋: 100室を作ると、101室目は 429（まだ3日たっていない）', many.length === 100 && r.status === 429, `${many.length}室 ${r.status} 経過 ${Date.now() - startedAt}ms`);
check('古い部屋: ここまでが3日（約3秒）より短い時間で終わっている', Date.now() - startedAt < 2500, `${Date.now() - startedAt}ms`);
await wait(3400 - (Date.now() - startedAt));
r = await call('POST', '/api/room', {});
check('古い部屋: 3日さわられていない部屋があれば、それを消して、新しい部屋を作れる', r.status === 201, `${r.status} ${r.text}`);
r = await getRoom(many[0]);
check('古い部屋: 消された部屋は 404', r.status === 404, String(r.status));
await stopApp(app);

// 4-3. 掃除のタイマーが、3日さわられていない部屋を消す。さわり続けた部屋は残る
app = startApp({
  CHANOMA_FAKE_NOW: FAKE_NOW, CHANOMA_FAKE_SPEED: '86400', CHANOMA_SWEEP_MS: '200',
  CHANOMA_ROOM_READS_PER_MINUTE: '100000', CHANOMA_ROOM_WRITES_PER_MINUTE: '100000',
});
await waitReady();
const roomIdle = await newRoom();
const roomBusy = await newRoom();
const t0 = Date.now();
while (Date.now() - t0 < 4200) {
  await getRoom(roomBusy);
  await wait(300);
}
r = await getRoom(roomIdle);
check('掃除: 3日さわられていない部屋は、タイマーが消す（404）', r.status === 404, String(r.status));
r = await getRoom(roomBusy);
check('掃除: さわり続けた部屋は残る（200）', r.status === 200, String(r.status));
check('掃除: 消した部屋の数がログに出る', /使われていない部屋 [1-9]\d* 室/.test(app.log), app.log.slice(-300));
await stopApp(app);

fake.close();
console.log(`\n結果: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
