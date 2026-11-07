// スタンプ（kind: 'stamp'）の、サーバー（server.mjs）での検査のテスト。偽の API サーバーを立て、本物の API にもクレジットにも触れない。
// 確かめるのはサーバーの動作だけ（画面の見え方は確かめない）。実行: node --test
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STAMPS } from '../safe.js';

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stampPost = (over = {}) => ({ id: 's1', who: 'まご', animal: 'ねこ', kind: 'stamp', stamp: 'みかん', ...over });
const textPost = { id: 'p1', who: 'おばあちゃん', topic: 'ごはん', headline: 'おいしかった', text: 'きょうは煮物を作った' };

// 偽の Claude。スタンプの投稿には、名前を言う紹介を返す。mode が 'no-name' の1回目だけ、名前を言わない紹介を返す
let fakeMode = 'good';
let fakeSeq = 0;
const requests = [];
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const content = body.messages[0].content;
    requests.push(content);
    const sent = JSON.parse(content.slice(content.indexOf('<posts>\n') + 8, content.lastIndexOf('\n</posts>')));
    const nameless = fakeMode === 'no-name' && fakeSeq++ === 0;
    const news = {
      feature: 'かぞくの一言特集',
      opening: 'こんばんは、テレ吉です。',
      segments: sent.posts.map((p) => ({
        corner: 'ひとこと',
        from: p.id,
        host: p.kind === 'stamp' ? (nameless ? `${p.who}からのスタンプです。` : `${p.who}から、${p.stamp}のスタンプです。`) : `${p.who}のひとことです。`,
      })),
      lineup: [{ corner: 'ひとこと', reason: 'きょうのことを集めました' }],
      closing: 'また明日の夜7時にお会いしましょう。',
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(news) }], usage: { output_tokens: 10 } }));
  });
});

let app = null;
before(async () => {
  await new Promise((r) => fake.listen(FAKE_PORT, '127.0.0.1', r));
  const child = spawn('node', ['server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(APP_PORT), CHANOMA_API_BASE: `http://127.0.0.1:${FAKE_PORT}`, ANTHROPIC_API_KEY: FAKE_KEY,
      CHANOMA_RATE_PER_MINUTE: '1000', CHANOMA_RATE_PER_DAY: '1000', CHANOMA_ROOMS_PER_IP_PER_DAY: '1000', CHANOMA_ROOM_WRITES_PER_MINUTE: '100000', CHANOMA_ROOM_READS_PER_MINUTE: '100000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app = { child, log: '' };
  child.stdout.on('data', (d) => (app.log += d));
  child.stderr.on('data', (d) => (app.log += d));
  // 「待ち受けています」が出るまで待つ。先に止まったら、出力を付けて止める
  const until = Date.now() + 10_000;
  while (!app.log.includes('待ち受けています')) {
    if (child.exitCode !== null) throw new Error(`サーバーが起動の前に止まりました: ${app.log.slice(-300)}`);
    if (Date.now() > until) throw new Error(`サーバーが起動しませんでした: ${app.log.slice(-300)}`);
    await wait(50);
  }
});
after(async () => {
  if (app && app.child.exitCode === null) {
    const done = new Promise((r) => app.child.once('exit', r));
    app.child.kill();
    await done;
  }
  await new Promise((r) => fake.close(r));
});

async function call(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${APP_PORT}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}
const device = () => crypto.createHash('sha256').update(`stamp-test-${Math.random()}`).digest('hex');
const newRoom = async () => (await call('POST', '/api/room', {})).json.code;
const postTo = (code, post) => call('POST', `/api/room/${code}/posts`, { post, device: device() });

test('部屋への投稿: 6 種のスタンプは、どれも 200 で入り、読むと kind と stamp がそのまま返る', async () => {
  const code = await newRoom();
  for (const [i, name] of STAMPS.entries()) {
    const r = await postTo(code, stampPost({ id: `s${i}`, stamp: name }));
    assert.equal(r.status, 200, `${name}: ${r.text}`);
    assert.equal(r.json.post.kind, 'stamp');
    assert.equal(r.json.post.stamp, name);
    assert.equal('text' in r.json.post, false);
  }
  const room = await call('GET', `/api/room/${code}`);
  assert.deepEqual(room.json.posts.map((p) => p.stamp), STAMPS);
});

test('部屋への投稿: 弾く - 一覧にない名前・名前なし・文字でない名前・別の kind は 400（内部の事情は出さない）', async () => {
  const code = await newRoom();
  const bad = [
    stampPost({ stamp: 'ばなな' }),
    stampPost({ stamp: undefined }),
    stampPost({ stamp: 3 }),
    stampPost({ stamp: { name: 'みかん' } }),
    stampPost({ kind: 'text' }),
    stampPost({ kind: undefined }),
  ];
  for (const post of bad) {
    const r = await postTo(code, post);
    assert.equal(r.status, 400, JSON.stringify(post));
    assert.ok(!/server\.mjs|node:|ANTHROPIC|FAKE_TEST_KEY/.test(r.text), r.text);
  }
  const room = await call('GET', `/api/room/${code}`);
  assert.equal(room.json.posts.length, 0, '弾いた投稿が部屋に入っている');
});

test('部屋への投稿: 弾く - スタンプにお題・札・見出し・ひとこと・会いたい日が混ざっていれば 400', async () => {
  const code = await newRoom();
  for (const extra of [{ topic: 'ごはん' }, { card: 'パン' }, { headline: 'びっくり' }, { text: 'おいしい' }, { wishDate: '2026-11-20' }]) {
    const r = await postTo(code, stampPost(extra));
    assert.equal(r.status, 400, JSON.stringify(extra));
  }
});

test('部屋への投稿: スタンプも、1日の上限（30件）に数える', async () => {
  const code = await newRoom();
  // 1端末あたり 1 分に 10 件までの上限があるので、端末を替えて 30 件入れる
  for (let i = 0; i < 30; i++) {
    const r = await postTo(code, stampPost({ id: `m${i}` }));
    assert.equal(r.status, 200, `${i}: ${r.text}`);
  }
  const over = await postTo(code, stampPost({ id: 'over' }));
  assert.equal(over.status, 409);
});

test('/api/news: スタンプ入りの投稿は、kind と stamp のまま Claude に渡り、名前を言う紹介が通る', async () => {
  fakeMode = 'good';
  requests.length = 0;
  const r = await call('POST', '/api/news', { posts: [textPost, stampPost()] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.segments[1].host, 'まごから、みかんのスタンプです。');
  assert.ok(requests[0].includes('"kind":"stamp"') && requests[0].includes('"stamp":"みかん"'));
  // 投稿の囲みの中に、スタンプの投稿がある
  assert.ok(requests[0].indexOf('"kind":"stamp"') > requests[0].indexOf('<posts>'));
});

test('/api/news: 紹介にスタンプの名前がなければ弾いて、スタンプ用の決まった頼み方で1回だけ作り直す', async () => {
  fakeMode = 'no-name';
  fakeSeq = 0;
  requests.length = 0;
  const r = await call('POST', '/api/news', { posts: [textPost, stampPost()] });
  assert.equal(r.status, 200, r.text);
  assert.equal(requests.length, 2);
  assert.ok(requests[1].includes('スタンプの投稿は、ひとこと のコーナーに入れて'), requests[1]);
  assert.equal(r.json.segments[1].host, 'まごから、みかんのスタンプです。');
  fakeMode = 'good';
});

test('/api/news: スタンプが不正な投稿は、Claude を呼ぶ前に 400', async () => {
  requests.length = 0;
  const r = await call('POST', '/api/news', { posts: [stampPost({ stamp: 'ばなな' })] });
  assert.equal(r.status, 400);
  assert.equal(requests.length, 0);
});

test('部屋の番組: スタンプだけの部屋でも、番組ができる', async () => {
  fakeMode = 'good';
  const code = await newRoom();
  assert.equal((await postTo(code, stampPost({ id: 'a1', who: 'おばあちゃん', stamp: 'ほし' }))).status, 200);
  assert.equal((await postTo(code, stampPost({ id: 'b1', stamp: 'おにぎり' }))).status, 200);
  const r = await call('POST', `/api/room/${code}/news`, {});
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.program.news.segments.map((s) => s.from), ['a1', 'b1']);
});
