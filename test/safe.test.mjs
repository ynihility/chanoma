// safe.js のテスト。実行: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPosts, cleanDate, checkNews, loadState, serializeState, MAX_POSTS } from '../safe.js';

const posts = [
  { id: 'p1', who: 'おばあちゃん', topic: 'ごはん', headline: 'おいしかった', text: 'きょうは煮物を作った' },
  { id: 'p2', who: 'まご', name: 'たろ', animal: 'ねこ', topic: 'そら', headline: 'びっくり', text: 'にじが見えた' },
  { id: 'p3', who: 'おかあさん', topic: 'みつけた', headline: 'なつかしい', text: '古いアルバムを見つけた' },
  { id: 'p4', who: 'まご', topic: 'なに食べたい', card: 'おすし' },
];
const goodNews = () => ({
  opening: 'こんばんは、テレ吉です。',
  segments: [
    { corner: 'ひとこと', from: 'p1', host: '最初は、おばあちゃんのひとことです。' },
    { corner: 'ひとこと', from: 'p2', host: '次は、まごさんのひとことです。' },
    { corner: 'むかし', from: 'p3', host: 'むかし話のコーナーです。' },
    { corner: 'つぎ', from: 'p4', host: 'つぎに会う日の希望です。' },
  ],
  closing: 'また明日の夜7時にお会いしましょう。',
});
const withHost = (i, host) => {
  const n = goodNews();
  n.segments[i].host = host;
  return n;
};

test('cleanPosts: 正常な投稿を通し、決まった項目だけにする', () => {
  const r = cleanPosts({ posts: [{ ...posts[0], extra: 'x', __proto__: { a: 1 } }], nextDate: '2026-11-20' });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.posts[0]).sort(), ['headline', 'id', 'text', 'topic', 'who']);
  assert.equal(r.nextDate, '2026-11-20');
});

test('cleanPosts: 空の項目は消える', () => {
  const r = cleanPosts({ posts: [{ id: 'a', who: 'まご', topic: 'そら', text: '   ', name: '' }] });
  assert.deepEqual(r.posts[0], { id: 'a', who: 'まご', topic: 'そら' });
});

const ng = (name, input) =>
  test(`cleanPosts: 弾く - ${name}`, () => {
    const r = cleanPosts(input);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
  });
const one = (o) => ({ posts: [{ id: 'a', who: 'まご', topic: 'そら', ...o }] });
ng('null', null);
ng('posts が空', { posts: [] });
ng('posts が文字列', { posts: 'x' });
ng(`${MAX_POSTS + 1}件`, { posts: Array.from({ length: MAX_POSTS + 1 }, (_, i) => ({ id: `a${i}`, who: 'まご', topic: 'そら' })) });
ng('お題が不正', one({ topic: 'へんなお題' }));
ng('お題がない', { posts: [{ id: 'a', who: 'まご' }] });
ng('よびかたがない', { posts: [{ id: 'a', topic: 'そら' }] });
ng('見出しが不正', one({ headline: 'ふしぎ' }));
ng('動物が不正', one({ animal: 'らいおん' }));
ng('IDが重複', { posts: [{ id: 'a', who: 'まご', topic: 'そら' }, { id: 'a', who: 'まご', topic: 'ごはん' }] });
ng('IDに記号', one({ id: '<x>' }));
ng('IDが数値', one({ id: 5 }));
ng('本文が201文字', one({ text: 'あ'.repeat(201) }));
ng('本文が文字列でない', one({ text: { x: 1 } }));
ng('本文に改行', one({ text: '1行目\n2行目' }));
ng('お題が配列', one({ topic: ['そら'] }));
ng('投稿が配列', { posts: [[]] });
ng('日付の形が不正', { ...one({}), nextDate: '来週' });
ng('存在しない日付', { ...one({}), nextDate: '2026-02-31' });

test('checkNews: 正常な番組を通す', () => {
  const r = checkNews(goodNews(), posts);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(Object.keys(r.news.segments[0]).sort(), ['corner', 'from', 'host']);
});

test('checkNews: 余計な項目は取り除く', () => {
  const n = goodNews();
  n.segments[0].text = '書き換えた本文';
  n.extra = 'x';
  const r = checkNews(n, posts);
  assert.equal(r.ok, true);
  assert.equal('text' in r.news.segments[0], false);
  assert.equal('extra' in r.news, false);
});

const bad = (name, news) =>
  test(`checkNews: 弾く - ${name}`, () => {
    const r = checkNews(news, posts);
    assert.equal(r.ok, false);
    assert.equal(typeof r.reason, 'string');
  });
bad('null', null);
bad('segments がない', { opening: 'a', closing: 'b' });
bad('投稿にないID', (() => { const n = goodNews(); n.segments[0].from = 'zzz'; return n; })());
bad('投稿が1件抜けた', (() => { const n = goodNews(); n.segments.pop(); return n; })());
bad('同じ投稿を2回', (() => { const n = goodNews(); n.segments[3] = n.segments[0]; return n; })());
bad('希望の投稿が「ひとこと」', (() => { const n = goodNews(); n.segments[3].corner = 'ひとこと'; return n; })());
bad('今日の投稿が「つぎ」', (() => { const n = goodNews(); n.segments[0].corner = 'つぎ'; return n; })());
bad('コーナーの順番が逆', (() => { const n = goodNews(); n.segments.unshift(n.segments.splice(2, 1)[0]); return n; })());
bad('コーナー名が不正', (() => { const n = goodNews(); n.segments[0].corner = 'へんなコーナー'; return n; })());
bad('host が長い', withHost(0, 'あ'.repeat(81)));
bad('host が空', withHost(0, '  '));
bad('host が文字列でない', withHost(0, 5));
bad('opening が空', { ...goodNews(), opening: '' });
bad('closing が長い', { ...goodNews(), closing: 'あ'.repeat(101) });
bad('投稿にないよびかた（おじいちゃん）', withHost(0, 'おじいちゃんのひとことです。'));
bad('投稿にないカタカナ語', withHost(0, 'ハンバーグの話です。'));
bad('投稿の本文を写した', withHost(0, 'きょうは煮物を作った話です。'));
bad('HTMLが混ざる', withHost(0, '<b>次の話です</b>'));
bad('URLが混ざる', withHost(0, 'https://example.com を見てね'));
bad('絵文字が混ざる', withHost(0, '次の話です😀'));
bad('順位づけ', withHost(1, '今日のランキング第1位です。'));
bad('健康にふれる', withHost(1, '健康によい話です。'));
bad('孤独にふれる', withHost(1, 'さみしさがなくなる話です。'));
bad('催促', withHost(1, '返事をお願いします。'));
bad('closing に日数', { ...goodNews(), closing: 'あと3日で会えます。' });
bad('closing に投稿にない家族', { ...goodNews(), closing: 'おじいちゃんによろしく。' });

test('checkNews: 投稿の text が未指定でも落ちない', () => {
  const ps = [{ id: 'a', who: 'まご', topic: 'そら' }];
  const r = checkNews({ opening: 'こんばんは。', segments: [{ corner: 'ひとこと', from: 'a', host: 'まごさんの話です。' }], closing: 'おやすみなさい。' }, ps);
  assert.equal(r.ok, true, r.reason);
});

test('loadState: 保存した状態を読み戻せる', () => {
  const clean = cleanPosts({ posts, nextDate: '2026-11-20' });
  const raw = serializeState(clean.posts, clean.nextDate);
  const s = loadState(raw);
  assert.equal(s.posts.length, 4);
  assert.equal(s.nextDate, '2026-11-20');
});

test('loadState: 空の状態は許す', () => {
  assert.deepEqual(loadState('{"v":1,"posts":[]}'), { posts: [] });
});

for (const [name, raw] of [
  ['壊れた JSON', '{"v":1,'],
  ['文字列ではない', null],
  ['版が違う', '{"v":2,"posts":[]}'],
  ['posts がない', '{"v":1}'],
  ['配列そのもの', '[]'],
  ['投稿が不正', '{"v":1,"posts":[{"id":"a"}]}'],
  ['大きすぎる', 'x'.repeat(70 * 1024)],
]) {
  test(`loadState: 捨てる - ${name}`, () => assert.equal(loadState(raw), null));
}

test('loadState: __proto__ を持ち込んでも Object.prototype が汚れない', () => {
  const raw = '{"v":1,"posts":[{"id":"a","who":"まご","topic":"そら","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}]}';
  const s = loadState(raw);
  assert.equal(s.posts.length, 1);
  assert.equal({}.polluted, undefined);
  assert.equal('polluted' in s.posts[0], false);
});

// ---- レビューで再現されたすり抜け（弾くべきもの） ----
const richPosts = [
  { id: 'p1', who: 'おばあちゃん', topic: 'ごはん', text: 'きょうは煮物を作った。とてもおいしかったよ' },
  { id: 'p2', who: 'まご', name: 'たろ', topic: 'そら', text: 'にじが見えた' },
  { id: 'p3', who: 'ひいおじいちゃん', topic: 'みつけた', text: 'じいじと歩いた' },
  { id: 'p4', who: 'まご', topic: 'なに食べたい', card: 'おすし' },
];
const rich = (host) => ({
  opening: 'こんばんは、テレ吉です。',
  segments: [
    { corner: 'ひとこと', from: 'p1', host },
    { corner: 'ひとこと', from: 'p2', host: '次は、まごさんのひとことです。' },
    { corner: 'ひとこと', from: 'p3', host: '次の話です。' },
    { corner: 'つぎ', from: 'p4', host: 'つぎに会う日の希望です。' },
  ],
  closing: 'また明日の夜7時にお会いしましょう。',
});
const hostBad = (host) =>
  test(`すり抜け防止: host「${host.replace(/[\u0000-\u001f\u200B-\u200F\u202E\uFEFF]/g, '□')}」`, () => {
    const r = checkNews(rich(host), richPosts);
    assert.equal(r.ok, false, `通ってしまった: ${host}`);
  });
for (const h of [
  'もっと投稿してね。', '早く返事してね。', '既読になっています。',
  // 表記ゆれ・不可視文字
  '健\u200B康によい話です。', 'ﾗﾝｷﾝｸﾞの話です。', 'ベ\u200Bストの話です。', '孤\u200B独の話です。', '1\u200B位の話です。',
  'ひとり ぼっちの話です。', '元気に なります。', 'おじ\u200Bいちゃんの話です。', 'ｵｼﾞｲﾁｬﾝの話です。',
  'おじーちゃんの話です。', 'おとーさんの話です。', 'お爺ちゃんの話です。', 'お父さんの話です。', '祖父の話です。',
  'おじいさまの話です。', 'ばあさんの話です。', 'おふくろの話です。',
  // 投稿にない人名・カタカナ語・英字
  'はなこさんの話です。', '田中さんの話です。', 'たろうくんの話です。', 'パンの話です。', 'Tokyoの話です。', 'ﾊﾝﾊﾞｰｸﾞの話です。',
  // よびかたのすり替え（whoは「ひいおじいちゃん」、本文にだけ「じいじ」がある）
  'おじいちゃんの話です。', 'じいじの話です。',
  // 順位づけ・健康・孤独の言い換え
  'いちばんうれしい話です。', '一番すてきな話です。', '二位の話です。', 'トップの話です。'.replace('トップ', '首位'),
  '寂しさがなくなる話です。', 'さみしくないですね。', 'ひとりじゃないですよ。', '長生きできる話です。',
  '元気が出る話です。', 'ぼけ防止になります。',
  // 記号・URL・Markdown
  '次は★の話です♪', '**次の話**です。', '# 見出し', 'HTTP://example.com', 'www.example.com', 'example.com',
  'javascript:alert(1)', '[ここ](a)', '&lt;b&gt;', '🇯🇵の話です。',
  // 見えない文字・改行
  '次の\n話です。', '次の\u202E話です。', '\u200B',
  // 本文の写し（8文字未満の全文、句読点で分けた写し、空白で分けた写し）
  'にじが見えた', 'きょうは、煮物を作った話です。', 'きょうは 煮物を 作った', 'キョウハ煮物ヲ作ッタ',
]) hostBad(h);

test('すり抜け防止: opening / closing にも催促・本文の写し・日数を当てる', () => {
  for (const [key, s] of [
    ['opening', '早く返事してくださいね'], ['closing', '既読になっています。'], ['closing', 'お返事待ってます'],
    ['closing', 'また投稿してね。'], ['opening', 'きょうは煮物を作った、から始めます。'],
    ['closing', 'あと三日で会えます。'], ['closing', 'あと3週間で会えます。'], ['closing', '3 日後に会います。'],
    ['closing', 'みなさん元気になりましたね。'], ['opening', 'おじ\u200Bいちゃんこんばんは'], ['closing', 'パ パによろしく'],
    ['closing', 'はなこさんおやすみ'],
  ]) {
    const n = rich('次の話です。');
    n[key] = s;
    assert.equal(checkNews(n, richPosts).ok, false, `${key}: ${s}`);
  }
});

test('返す値は、検査した値（前後の空白を除いたもの）', () => {
  const n = rich('  次の話です。  ');
  const r = checkNews(n, richPosts);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.news.segments[0].host, '次の話です。');
});

test('検査中に値を差し替える細工（getter）をしても、検査していない値は返らない', () => {
  let reads = 0;
  const n = rich('次の話です。');
  Object.defineProperty(n.segments[0], 'host', { get: () => (++reads === 1 ? '次の話です。' : '<b>x</b>'), enumerable: true });
  const r = checkNews(n, richPosts);
  assert.equal(r.ok, true);
  assert.equal(r.news.segments[0].host, '次の話です。');
});

// ---- 誤検知（正しい番組は通すべきもの） ----
const hostOk = (host) =>
  test(`通す: host「${host}」`, () => {
    const r = checkNews(rich(host), richPosts);
    assert.equal(r.ok, true, r.reason);
  });
for (const h of [
  '最初は、おばあちゃんのひとことです。', 'おばあちゃんのお話です。', 'ひいおじいちゃんのお話です。',
  'まごころのこもったお話です。', 'たまごのお話です。', '最高気温のお話です。', '朝早くのお話です。',
  '効果音つきのお話です。', 'ニュースコーナーです。', 'ちゃんと聞きましょう。', 'みなさん、聞いてみましょう。',
  'たろさんのお話です。', '散歩のお話です。', 'ラジオのような時間です。',
]) hostOk(h);

// ---- 助言・指図（弾くべきもの）と、ふつうの言い方（通すべきもの） ----
for (const h of [
  '早めに病院へ行ったほうがいいですよ。', '毎日歩くべきです。', '水をたくさん飲みましょう。', '病院に行くといいですよ。',
  '無理をしないでくださいね。', '早く寝ることをおすすめします。', 'お大事に。', 'しっかり休みましょう。',
  '気をつけてくださいね。', '医者に見てもらうのがよい話です。', 'ほうがいい',
]) test(`弾く: 助言「${h}」`, () => {
  const r = checkNews(rich(h), richPosts);
  assert.equal(r.ok, false);
});
test('弾く: 助言の理由は「助言や指図」と報告される', () => {
  const r = checkNews(rich('毎日歩くべきです。'), richPosts);
  assert.match(r.reason, /助言や指図/);
});
for (const h of [
  'ばーべきゅーのお話です。', 'ちょっといいですね。', 'いい天気のお話です。', 'お会いしましょう。', 'みんなで聞いてみましょう。', 'まっすぐな気持ちのお話です。',
]) hostOk(h);

test('通す: 家族の呼び名が who に漢字で書かれていても、ひらがなの host と同じ人として扱う', () => {
  const ps = [{ id: 'a', who: 'お爺ちゃん', topic: 'そら' }];
  const n = { opening: 'こんばんは。', segments: [{ corner: 'ひとこと', from: 'a', host: 'おじいちゃんのお話です。' }], closing: 'おやすみなさい。' };
  assert.equal(checkNews(n, ps).ok, true);
});

test('cleanPosts: ゼロ幅文字・向きを変える文字・範囲外の年を弾く', () => {
  assert.equal(cleanPosts({ posts: [{ id: 'a', who: '\u200B', topic: 'そら' }] }).ok, false);
  assert.equal(cleanPosts({ posts: [{ id: 'a', who: 'まご', topic: 'そら', text: 'a\u202Eb' }] }).ok, false);
  assert.equal(cleanPosts({ posts: [{ id: 'a', who: 'まご', topic: 'そら' }], nextDate: '9999-12-31' }).ok, false);
  assert.equal(cleanPosts({ posts: [{ id: 'a', who: 'まご', topic: 'そら' }], nextDate: '2026-11-20' }).ok, true);
});

// ---- 再レビューで見つかった誤検知（通すべきもの）と、残っていた穴（弾くべきもの） ----
const namePosts = [
  { id: 'a', who: 'ゆきちゃん', animal: 'ねこ', topic: 'そら', text: 'にじが見えた' },
  { id: 'b', who: 'たなかさん', topic: 'ごはん', text: 'おにぎりを食べた' },
  { id: 'c', who: 'おとーさん', topic: 'したこと' },
];
const named = (host, closing = 'おやすみなさい。') => ({
  opening: 'こんばんは。',
  segments: [
    { corner: 'ひとこと', from: 'a', host },
    { corner: 'ひとこと', from: 'b', host: '次の話です。' },
    { corner: 'ひとこと', from: 'c', host: '最後の話です。' },
  ],
  closing,
});
for (const h of [
  'たくさんのお話です。', 'さまざまなお話です。', '様々なお話です。', '様子をお伝えします。', '皆さん、こんばんは。',
  '皆様、こんばんは。', 'お客様、ようこそ。', '今日は一日、おつかれさまでした。', 'チャンネルは変えないでね。'.replace('ね', ''),
  'ゆきちゃんのお話です。', 'ゆきのお話です。', 'ねこさんのお話です。', 'たなかさんのお話です。', 'おとーさんのお話です。',
  'ちゃんと聞きましょう。', 'そして、ちゃんと聞きましょう。', '一番星のお話です。', '一番乗りのお話です。',
  'お話を教えてくれました。', '静寂の朝のお話です。', '三日月がきれいでした。', '残りの煮物のお話です。',
]) {
  test(`通す(再レビュー): 「${h}」`, () => {
    const r = checkNews(named(h), namePosts);
    assert.equal(r.ok, true, r.reason);
  });
}
for (const h of [
  '健、康によい話です。', '健・康によい話です。', '孤.独の話です。', '健\uFE0F康の話です。', '健\u3164康の話です。', '健\u2800康の話です。',
  'はなこちゃんと遊んだ話です。', 'はなこちゃんとたろのお話です。', 'あと3日で会えます。', '3日後に会います。', 'あと三週間です。',
]) {
  test(`弾く(再レビュー): 「${h}」`, () => {
    assert.equal(checkNews(named(h), namePosts).ok, false, `通ってしまった: ${h}`);
  });
}
test('弾く(再レビュー): opening と closing の日数', () => {
  assert.equal(checkNews({ ...named('次の話です。'), opening: 'あと三日で会えます。' }, namePosts).ok, false);
  assert.equal(checkNews(named('次の話です。', 'あと3日で会えます。'), namePosts).ok, false);
  assert.equal(checkNews(named('次の話です。', '今日は一日おつかれさまでした。'), namePosts).ok, true);
});

// ---- cleanDate（つぎに会う日だけの検査） ----
test('cleanDate: 正しい日付と、未指定を通す', () => {
  assert.deepEqual(cleanDate('2026-11-20'), { ok: true, value: '2026-11-20' });
  assert.deepEqual(cleanDate(''), { ok: true, value: undefined });
  assert.deepEqual(cleanDate(undefined), { ok: true, value: undefined });
});
for (const bad of ['来週', '2026-02-31', '9999-12-31', '2026-1-5', 20261120, ['2026-11-20']]) {
  test(`cleanDate: 弾く - ${JSON.stringify(bad)}`, () => assert.equal(cleanDate(bad).ok, false));
}

test('loadState: 投稿が0件でも、つぎに会う日は読み戻せる', () => {
  const s = loadState(serializeState([], '2026-11-20'));
  assert.deepEqual(s, { posts: [], nextDate: '2026-11-20' });
});

// ---- 会いたい日の希望（いつ会いたい） ----
const wishPost = (o = {}) => ({ id: 'w1', who: 'おじいちゃん', topic: 'いつ会いたい', wishDate: '2026-11-23', ...o });
test('いつ会いたい: 日付つきの投稿を通す。札はなくてよい', () => {
  const r = cleanPosts({ posts: [wishPost()] });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.posts[0].wishDate, '2026-11-23');
  assert.equal('card' in r.posts[0], false);
});
for (const [name, p] of [
  ['日付がない', wishPost({ wishDate: undefined })],
  ['存在しない日付', wishPost({ wishDate: '2026-02-31' })],
  ['範囲外の年', wishPost({ wishDate: '2101-01-01' })],
  ['日付が文字列でない', wishPost({ wishDate: 20261123 })],
  ['ほかのお題に日付', wishPost({ topic: 'ごはん' })],
  ['札のお題に日付', wishPost({ topic: 'なにしたい', card: 'おでかけ' })],
]) {
  test(`いつ会いたい: 弾く - ${name}`, () => assert.equal(cleanPosts({ posts: [p] }).ok, false));
}
test('いつ会いたい: 番組では「つぎ」コーナーにだけ入れられる', () => {
  const ps = [{ id: 'a', who: 'まご', topic: 'そら' }, wishPost({ id: 'w', who: 'おじいちゃん' })];
  const news = (corner) => ({
    opening: 'こんばんは。',
    segments: [
      { corner: 'ひとこと', from: 'a', host: 'まごさんのひとことです。' },
      { corner, from: 'w', host: '会いたい日の希望です。' },
    ],
    closing: 'おやすみなさい。',
  });
  assert.equal(checkNews(news('つぎ'), cleanPosts({ posts: ps }).posts).ok, true);
  assert.equal(checkNews(news('ひとこと'), cleanPosts({ posts: ps }).posts).ok, false);
});
test('いつ会いたい: 保存して読み戻せる', () => {
  const clean = cleanPosts({ posts: [wishPost()] });
  assert.equal(loadState(serializeState(clean.posts)).posts[0].wishDate, '2026-11-23');
});

// ---- よびかたの変更 ----
import { DEFAULT_ROLES, cleanRoles } from '../safe.js';
test('cleanRoles: 好きな名前に変えた5つを通し、前後の空白は除く', () => {
  const r = cleanRoles(['ばあば', ' じいじ ', 'ママ', 'パパ', 'たろう']);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.roles, ['ばあば', 'じいじ', 'ママ', 'パパ', 'たろう']);
});
for (const [name, v] of [
  ['5つではない', ['a', 'b']],
  ['配列ではない', 'ばあば'],
  ['空の名前', ['ばあば', '', 'a', 'b', 'c']],
  ['空白だけ', ['ばあば', '   ', 'a', 'b', 'c']],
  ['重なる名前', ['ばあば', 'ばあば', 'a', 'b', 'c']],
  ['21文字', ['あ'.repeat(21), 'a', 'b', 'c', 'd']],
  ['改行入り', ['ば\nあば', 'a', 'b', 'c', 'd']],
  ['ゼロ幅文字', ['ば\u200Bあば', 'a', 'b', 'c', 'd']],
  ['文字列でない', [1, 2, 3, 4, 5]],
]) {
  test(`cleanRoles: 弾く - ${name}`, () => assert.equal(cleanRoles(v).ok, false));
}
test('cleanRoles: 初めの名前は5つで、重ならない', () => {
  assert.equal(DEFAULT_ROLES.length, 5);
  assert.equal(cleanRoles(DEFAULT_ROLES).ok, true);
});
test('loadState: 変えたよびかたを保存して読み戻せる', () => {
  const raw = serializeState([], undefined, ['ばあば', 'じいじ', 'ママ', 'パパ', 'たろう']);
  assert.deepEqual(loadState(raw).roles, ['ばあば', 'じいじ', 'ママ', 'パパ', 'たろう']);
});
test('loadState: よびかたが壊れていても、投稿は捨てない', () => {
  const raw = JSON.stringify({ v: 1, posts: [{ id: 'a', who: 'まご', topic: 'そら' }], roles: ['a', 'a', 'b', 'c', 'd'] });
  const s = loadState(raw);
  assert.equal(s.posts.length, 1);
  assert.equal('roles' in s, false);
});

// ---- 日付・曜日はつなぎの言葉で言わせない／よびかたの重なり ----
for (const h of ['11月20日に会いたいそうです。', '金曜日に会いたいそうです。', '20日のお話です。', '十一月のお話です。', '来週のお話です。', '二日目のお話です。', '来月のお話です。', '日曜のお話です。']) {
  test(`弾く(日付): 「${h}」`, () => assert.equal(checkNews(named(h), namePosts).ok, false, `通ってしまった: ${h}`));
}
for (const h of ['また明日、お会いしましょう。', '今日は一日、おつかれさまでした。', '三日月がきれいでした。', '日曜大工のお話です。'.replace('日曜大工', '大工')]) {
  test(`通す(日付): 「${h}」`, () => {
    const r = checkNews(named('次の話です。', h), namePosts);
    assert.equal(r.ok, true, r.reason);
  });
}
test('cleanRoles: 表記ゆれで同じ名前に見えるものは重なりとして弾き、どの名前か教える', () => {
  for (const dup of [['お母さん', 'おかあさん'], ['ABC', 'ＡＢＣ'], ['ばあば', 'バアバ']]) {
    const r = cleanRoles([...dup, 'c', 'd', 'e']);
    assert.equal(r.ok, false, dup.join('/'));
    assert.match(r.error, new RegExp(dup[0]));
  }
});
test('cleanRoles: __proto__ という名前でも、結果が壊れたり全体が汚染されたりしない', () => {
  const r = cleanRoles(['__proto__', 'b', 'c', 'd', 'e']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.roles, ['__proto__', 'b', 'c', 'd', 'e']);
  assert.equal({}.polluted, undefined);
});
test('checkNews: 好きな名前（ママ）の人を、投稿にないよびかた（ぱぱ・おばちゃん）で呼べない', () => {
  const ps = [{ id: 'a', who: 'ママ', topic: 'そら' }];
  const n = (host) => ({ opening: 'こんばんは。', segments: [{ corner: 'ひとこと', from: 'a', host }], closing: 'おやすみなさい。' });
  assert.equal(checkNews(n('ママのお話です。'), ps).ok, true);
  for (const h of ['ぱぱのお話です。', 'おばちゃんのお話です。', 'おじちゃんのお話です。']) assert.equal(checkNews(n(h), ps).ok, false, h);
});

test('cleanRoles: 全く同じ名前が重なったときは、同じ言葉を並べない文にする', () => {
  const r = cleanRoles(['おばあちゃん', 'おばあちゃん', 'c', 'd', 'e']);
  assert.equal(r.ok, false);
  assert.match(r.error, /ほかの人がもう使っています/);
});

// ---- よびかたを変えた人（「うちのおばあちゃん」など）を、司会が名前のまま呼ぶ ----
// 投稿にある名前そのものは通す。投稿にいない人を足したときは、今までどおり弾く
// whos の人たちの投稿を、hosts の文でそれぞれ呼ぶ番組を検査する
const callAs = (whos, hosts) => {
  const ps = whos.map((who, i) => ({ id: `p${i}`, who, topic: 'そら' }));
  const segments = ps.map((p, i) => ({ corner: 'ひとこと', from: p.id, host: hosts[i] }));
  return checkNews({ opening: 'こんばんは。', segments, closing: 'おやすみなさい。' }, ps);
};
for (const [who, host] of [
  ['うちのおばあちゃん', 'うちのおばあちゃんのひとことです。'],
  ['東京のおじいちゃん', '東京のおじいちゃんのお話です。'],
]) {
  test(`通す(よびかた変更): 「${who}」を「${host}」と呼ぶ`, () => {
    const r = callAs([who], [host]);
    assert.equal(r.ok, true, r.reason);
  });
}
for (const [who, host] of [
  ['うちのおばあちゃん', 'おじいちゃんのお話です。'],
  ['うちのおばあちゃん', 'おばあちゃんとおじいちゃんのお話です。'],
]) {
  test(`弾く(よびかた変更): 「${who}」だけの投稿に「${host}」`, () => {
    assert.equal(callAs([who], [host]).ok, false, `通ってしまった: ${host}`);
  });
}
test('弾く(よびかた変更): 名前をそのまま呼んだあとに、投稿にいない「おじいちゃん」を足したら、その理由で弾く', () => {
  const r = callAs(['うちのおばあちゃん'], ['うちのおばあちゃんとおじいちゃんのお話です。']);
  assert.equal(r.ok, false);
  assert.match(r.reason, /おじいちゃん/);
});
test('弾く(よびかた変更): 投稿の名前を一部に含む、もっと長いよびかた（ひいおばあちゃん・ひいばあば）は、投稿にいなければ弾く', () => {
  for (const [who, host] of [['おばあちゃん', 'ひいおばあちゃんのお話です。'], ['ばあば', 'ひいばあばのお話です。']]) {
    assert.equal(callAs([who], [host]).ok, false, `通ってしまった: ${who} の投稿に ${host}`);
  }
});
test('通す(よびかた変更): 名前が別の名前を含んでいても、長い名前をそのまま呼べる', () => {
  // 短い「おばあちゃん」を先に消すと、「東京のおじいちゃんと」が残り、「おじいちゃん」を投稿にないよびかたと見誤る
  const r = callAs(['おばあちゃん', '東京のおじいちゃんとおばあちゃん'], ['おばあちゃんのお話です。', '東京のおじいちゃんとおばあちゃんのお話です。']);
  assert.equal(r.ok, true, r.reason);
});
