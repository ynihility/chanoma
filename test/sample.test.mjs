// sample.js（見本の番組）のテスト。見本の投稿と番組が、本物と同じ検査（safe.js）に通ることを確かめる。実行: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPosts, checkNews, isNostalgic, DEFAULT_ROLES, CORNERS } from '../safe.js';
import * as sample from '../sample.js';

const { SAMPLE_POSTS, SAMPLE_NEWS } = sample;

test('見本: 投稿は cleanPosts を通り、中身が変わらない', () => {
  const r = cleanPosts({ posts: SAMPLE_POSTS });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.posts, SAMPLE_POSTS);
});

test('見本: 番組は checkNews を通り、feature と lineup も含めて同じ番組が返る', () => {
  const clean = cleanPosts({ posts: SAMPLE_POSTS });
  const r = checkNews(SAMPLE_NEWS, clean.posts);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.news, SAMPLE_NEWS);
});

test('見本: 家族は3人で、よびかたは初めの名前だけ。ニックネームも日付も持たない', () => {
  const who = new Set(SAMPLE_POSTS.map((p) => p.who));
  assert.equal(who.size, 3);
  for (const w of who) assert.ok(DEFAULT_ROLES.includes(w), `${w} は DEFAULT_ROLES にない`);
  for (const p of SAMPLE_POSTS) {
    assert.equal('name' in p, false, `${p.id} にニックネームがある`);
    assert.equal('wishDate' in p, false, `${p.id} に会いたい日がある`);
  }
  // つぎに会う日（nextDate）は、どこにも持たない
  assert.equal('nextDate' in sample, false);
  assert.equal(SAMPLE_POSTS.some((p) => 'nextDate' in p), false);
  assert.equal('nextDate' in SAMPLE_NEWS, false);
});

test('見本: 画面に出る文字（投稿の id 以外の全項目と、番組の文）に、数字がない', () => {
  // id と from は画面に出ない内部の印なので数えない
  const strings = [];
  (function collect(value, key) {
    if (typeof value === 'string') {
      if (key !== 'id' && key !== 'from') strings.push(value);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) collect(v, k);
    }
  })([SAMPLE_POSTS, SAMPLE_NEWS], '');
  // 集め損ねていないことの確かめ（投稿の項目と番組の文を合わせて30個はある）
  assert.ok(strings.length > 30, `集めた文字が少ない: ${strings.length}`);
  for (const s of strings) assert.equal(/[0-9０-９]/.test(s), false, `数字が入っている: ${s}`);
});

test('見本: 3つのコーナーが全部出て、なつかしいを選んだ投稿は むかし にある', () => {
  assert.deepEqual([...new Set(SAMPLE_NEWS.segments.map((s) => s.corner))], CORNERS);
  const nostalgic = SAMPLE_POSTS.filter(isNostalgic);
  assert.ok(nostalgic.length >= 1);
  for (const p of nostalgic) {
    assert.equal(SAMPLE_NEWS.segments.find((s) => s.from === p.id).corner, 'むかし', p.id);
  }
});

test('見本: つなぎの言葉を1つ「健康によい話です。」に替えると、本物の番組と同じ検査で弾かれる', () => {
  const clean = cleanPosts({ posts: SAMPLE_POSTS });
  const bad = structuredClone(SAMPLE_NEWS);
  bad.segments[1].host = '健康によい話です。';
  const r = checkNews(bad, clean.posts);
  assert.equal(r.ok, false);
  assert.match(r.reason, /健康や孤独/);
});

test('見本: 特集名やわけを、投稿の事実と合わないものに替えると、弾かれる', () => {
  const clean = cleanPosts({ posts: SAMPLE_POSTS });
  // ごはん のお題は1件しかない
  const wrongFeature = { ...structuredClone(SAMPLE_NEWS), feature: 'ごはん特集' };
  assert.equal(checkNews(wrongFeature, clean.posts).reason, '特集名が投稿と合わない');
  // ひとこと の3件は、見出しが共通でない
  const wrongReason = structuredClone(SAMPLE_NEWS);
  wrongReason.lineup[0].reason = '同じ見出しをえらんだ人がいます';
  assert.equal(checkNews(wrongReason, clean.posts).reason, '編成のわけが投稿と合わない');
});
