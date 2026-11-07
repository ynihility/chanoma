// スタンプ（kind: 'stamp'）の、safe.js での扱いのテスト。実行: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  STAMPS, isStamp, cleanPost, cleanPosts, checkNews, checkPostWords, checkShelfProgram, loadState, serializeState,
} from '../safe.js';
import { SPRITES } from '../sprites.js';

const stamp = (over = {}) => ({ id: 's1', who: 'まご', animal: 'ねこ', kind: 'stamp', stamp: 'みかん', ...over });
const text = { id: 'p1', who: 'おばあちゃん', topic: 'ごはん', headline: 'おいしかった', text: 'きょうは煮物を作った' };

test('STAMPS: 6 種で、どれも sprites.js に「スタンプ:名前」の絵があり、prompt.txt にも書いてある', () => {
  assert.deepEqual(STAMPS, ['ゆのみ', 'みかん', 'おにぎり', 'はな', 'ほし', 'ふとん']);
  const prompt = readFileSync(fileURLToPath(new URL('../prompt.txt', import.meta.url)), 'utf8');
  for (const name of STAMPS) {
    assert.ok(SPRITES[`スタンプ:${name}`], `${name} の絵がない`);
    assert.ok(prompt.includes(name), `prompt.txt に ${name} がない`);
  }
  assert.ok(prompt.includes('kind') && prompt.includes('stamp'));
});

test('cleanPost: スタンプの投稿を通し、決まった項目だけにする（空の項目は消える）', () => {
  const r = cleanPost({ ...stamp({ name: '', text: '', card: null, topic: undefined }), extra: 'x', __proto__: { a: 1 } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.post, { id: 's1', who: 'まご', animal: 'ねこ', kind: 'stamp', stamp: 'みかん' });
  assert.equal(isStamp(r.post), true);
  assert.equal(isStamp(text), false);
});

test('cleanPost: 6 種のスタンプは、どれも通る', () => {
  for (const name of STAMPS) assert.equal(cleanPost(stamp({ stamp: name })).ok, true, name);
});

const ng = (name, input) =>
  test(`cleanPost: 弾く - ${name}`, () => {
    const r = cleanPost(input);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
  });
ng('スタンプの名前が一覧にない', stamp({ stamp: 'ばなな' }));
ng('スタンプの名前がない', stamp({ stamp: undefined }));
ng('スタンプの名前が空', stamp({ stamp: '' }));
ng('スタンプの名前が文字でない', stamp({ stamp: 5 }));
ng('スタンプの名前が配列', stamp({ stamp: ['みかん'] }));
ng('kind が stamp 以外', stamp({ kind: 'text' }));
ng('kind が文字でない', stamp({ kind: true }));
ng('スタンプにお題がある', stamp({ topic: 'ごはん' }));
ng('スタンプに札がある', stamp({ card: 'パン' }));
ng('スタンプに見出しがある', stamp({ headline: 'びっくり' }));
ng('スタンプにひとことがある', stamp({ text: 'おいしい' }));
ng('スタンプに会いたい日がある', stamp({ wishDate: '2026-11-20' }));
ng('スタンプにひとこと（空白だけ）はまだ弾く', stamp({ text: ' ' }));
ng('スタンプによびかたがない', stamp({ who: '' }));
ng('スタンプの IDが不正', stamp({ id: '<x>' }));
ng('スタンプのどうぶつが不正', stamp({ animal: 'らいおん' }));
ng('スタンプの名前だけで kind がない（ふつうの投稿にはお題が要る）', { id: 's1', who: 'まご', stamp: 'みかん' });
ng('ふつうの投稿に stamp を混ぜる', { ...text, stamp: 'みかん' });
ng('お題がないふつうの投稿は、今までどおり弾く', { id: 'a', who: 'まご' });

test('cleanPosts / loadState: スタンプとふつうの投稿が混ざった束を通し、保存して読み戻せる', () => {
  const r = cleanPosts({ posts: [text, stamp()] });
  assert.equal(r.ok, true);
  const loaded = loadState(serializeState(r.posts, undefined, undefined));
  assert.deepEqual(loaded.posts, r.posts);
  // 保存データのスタンプが壊れていれば、全体を捨てる（型を確かめてから使う）
  const broken = JSON.stringify({ v: 1, posts: [stamp({ stamp: 'ばなな' })] });
  assert.equal(loadState(broken), null);
});

test('checkPostWords: スタンプの投稿は、本文がないので通る', () => {
  assert.deepEqual(checkPostWords(stamp()), { ok: true });
});

// ---- 番組の検査 ----
const mixed = cleanPosts({ posts: [text, stamp()] }).posts;
const news = (hostOfStamp, corner = 'ひとこと') => ({
  opening: 'こんばんは、テレ吉です。',
  segments: [
    { corner: 'ひとこと', from: 'p1', host: 'おばあちゃんのひとことです。' },
    { corner, from: 's1', host: hostOfStamp },
  ],
  closing: 'また明日の夜7時にお会いしましょう。',
});

test('checkNews: 「まごから、みかんのスタンプです」のように、名前を言う紹介を通す（スタンプ のカタカナも通る）', () => {
  const r = checkNews(news('まごから、みかんのスタンプです。'), mixed);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.news.segments[1].from, 's1');
});

test('checkNews: スタンプだけの投稿の束でも、番組になる（特集名とわけも検査に通る）', () => {
  const only = cleanPosts({ posts: [stamp(), stamp({ id: 's2', who: 'おばあちゃん', stamp: 'ほし' })] }).posts;
  const r = checkNews({
    feature: 'かぞくの一言特集',
    opening: 'こんばんは、テレ吉です。',
    segments: [
      { corner: 'ひとこと', from: 's1', host: 'まごから、みかんのスタンプです。' },
      { corner: 'ひとこと', from: 's2', host: 'おばあちゃんから、ほしのスタンプです。' },
    ],
    lineup: [{ corner: 'ひとこと', reason: 'ちがう人が、かわるがわる出ます' }],
    closing: 'また明日の夜7時にお会いしましょう。',
  }, only);
  assert.equal(r.ok, true, r.reason);
});

test('checkNews: 弾く - スタンプが むかし／つぎ にある', () => {
  for (const corner of ['むかし', 'つぎ']) {
    const r = checkNews(news('まごから、みかんのスタンプです。', corner), mixed);
    assert.equal(r.ok, false, corner);
    assert.ok(/スタンプ|合わない/.test(r.reason), r.reason);
  }
});

test('checkNews: 弾く - 紹介にスタンプの名前がない／別のスタンプの名前を言っている', () => {
  for (const host of ['まごからのスタンプです。', 'まごから、ほしのスタンプです。']) {
    const r = checkNews(news(host), mixed);
    assert.equal(r.ok, false, host);
    assert.ok(r.reason.includes('スタンプの名前が、つなぎの言葉にない'), r.reason);
  }
});

test('checkNews: 理由の文に「」は入らない（server.mjs が「」の中を取り除いて頼み方を選ぶため）', () => {
  const r = checkNews(news('まごからのスタンプです。'), mixed);
  assert.equal(/[「」]/.test(r.reason), false, r.reason);
});

test('checkNews: スタンプのつなぎの言葉にも、ほかの決まりは効く（投稿にない人の名前・健康の言葉）', () => {
  assert.equal(checkNews(news('おじいちゃんから、みかんのスタンプです。'), mixed).ok, false);
  assert.equal(checkNews(news('みかんのスタンプで元気になれます。'), mixed).ok, false);
});

test('checkShelfProgram: スタンプの投稿を含む番組も、本棚・部屋の検査を通る', () => {
  const r = checkShelfProgram({ news: news('まごから、みかんのスタンプです。'), posts: mixed, madeAt: 1_800_000_000_000 });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.program.posts[1], mixed[1]);
});
