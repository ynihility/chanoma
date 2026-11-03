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

// ---- 「なつかしい」を選んだ今日の投稿は、必ず むかし に入る ----
import { isNostalgic } from '../safe.js';
const NOSTALGIC_REASON = 'なつかしいを選んだ今日の投稿が むかし にない';
// 番組の中の、ある投稿のコーナーだけを差し替える
const moveTo = (news, from, corner) => {
  news.segments.find((s) => s.from === from).corner = corner;
  return news;
};
// p3 を、見出しではなく札 なつかしいもの で「なつかしい」を選んだ投稿に替えた組
const cardPosts = posts.map((p) =>
  (p.id === 'p3' ? { id: 'p3', who: 'おかあさん', topic: 'みつけた', card: 'なつかしいもの', text: '古いアルバムを見つけた' } : p));

test('isNostalgic: 見出しが なつかしい か、札が なつかしいもの の今日の投稿だけが当てはまる', () => {
  assert.equal(isNostalgic({ topic: 'みつけた', headline: 'なつかしい' }), true);
  assert.equal(isNostalgic({ topic: 'みつけた', card: 'なつかしいもの' }), true);
  // 希望の投稿は、見出しが なつかしい でも対象外
  assert.equal(isNostalgic({ topic: 'なに食べたい', headline: 'なつかしい' }), false);
  // 本文に書いてあるだけの投稿は対象外（それは Claude の判断）
  assert.equal(isNostalgic({ topic: 'したこと', text: 'なつかしい写真を見た' }), false);
  // ほかの見出し・ほかの札は対象外
  assert.equal(isNostalgic({ topic: 'そら', headline: 'びっくり', card: 'はれ' }), false);
});

test('なつかしい: 見出しが なつかしい の今日の投稿を ひとこと に置いた番組は弾く', () => {
  const r = checkNews(moveTo(goodNews(), 'p3', 'ひとこと'), posts);
  assert.equal(r.ok, false);
  assert.equal(r.reason, NOSTALGIC_REASON);
});

test('なつかしい: 札が なつかしいもの の今日の投稿を ひとこと に置いた番組は弾く', () => {
  const r = checkNews(moveTo(goodNews(), 'p3', 'ひとこと'), cardPosts);
  assert.equal(r.ok, false);
  assert.equal(r.reason, NOSTALGIC_REASON);
});

test('なつかしい: 見出しが なつかしい の希望の投稿は、つぎ に置いて通る', () => {
  const ps = posts.map((p) => (p.id === 'p4' ? { ...p, headline: 'なつかしい' } : p));
  const r = checkNews(goodNews(), ps);
  assert.equal(r.ok, true, r.reason);
});

test('なつかしい: なつかしい の投稿（見出しでも札でも）を むかし に置いた番組は通る', () => {
  assert.equal(checkNews(goodNews(), posts).ok, true);
  const r = checkNews(goodNews(), cardPosts);
  assert.equal(r.ok, true, r.reason);
});

test('なつかしい: なつかしいを選んでいない、本文のある今日の投稿を むかし に置いても通る（Claude の判断を残す）', () => {
  const n = goodNews();
  const [s1, s2, s3, s4] = n.segments;
  n.segments = [s2, { ...s1, corner: 'むかし' }, s3, s4];
  const r = checkNews(n, posts);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.news.segments.map((s) => `${s.from}:${s.corner}`), ['p2:ひとこと', 'p1:むかし', 'p3:むかし', 'p4:つぎ']);
});

test('なつかしい: なつかしい の今日の投稿を つぎ に置くと、先に「投稿とコーナーが合わない」で弾く（理由の優先順）', () => {
  const r = checkNews(moveTo(goodNews(), 'p3', 'つぎ'), posts);
  assert.equal(r.ok, false);
  assert.equal(r.reason, '投稿とコーナーが合わない');
});

// ---- 今夜の特集名と、コーナーごとの編成のわけ ----
import { FEATURES, REASONS, CORNERS, NEXT_TOPICS, reasonFact } from '../safe.js';

// 編成のわけ（safe.js の REASONS と同じ言葉。言葉が変わったときに、ここで気づけるように書き出している）
const R1 = 'きょうのことを集めました';
const R2 = 'つぎに会う日の希望を集めました';
const R3 = '「なつかしい」をえらんだ投稿です';
const R4 = 'むかしの話が書かれています';
const R5 = '同じお題をえらんだ人がいます';
const R6 = '同じ札をえらんだ人がいます';
const R7 = '同じ見出しをえらんだ人がいます';
const R8 = '同じ日に会いたい人がいます';
const R9 = 'ちがう人が、かわるがわる出ます';

test('一覧: 特集名は10個、編成のわけは9個で、決めた言葉のとおり', () => {
  assert.deepEqual(FEATURES, [
    'ごはん特集', 'そら特集', 'したこと特集', 'みつけた特集', 'うれしかった特集',
    'おいしかった特集', 'びっくり特集', 'なつかしい特集', 'つぎに会う日特集', 'かぞくの一言特集',
  ]);
  assert.deepEqual(REASONS, [R1, R2, R3, R4, R5, R6, R7, R8, R9]);
});

// 検査用の番組を、投稿の一覧から作る。今日の投稿は ひとこと、なつかしいを選んだ投稿は むかし、希望の投稿は つぎ に置く
const cornerOf = (p) => (NEXT_TOPICS.includes(p.topic) ? 'つぎ' : isNostalgic(p) ? 'むかし' : 'ひとこと');
const programFor = (ps, plan = {}) => ({
  opening: 'こんばんは、テレ吉です。',
  segments: CORNERS.flatMap((corner) =>
    ps.filter((p) => cornerOf(p) === corner).map((p) => ({ corner, from: p.id, host: '次の話です。' }))),
  closing: 'おやすみなさい。',
  ...plan,
});
const tp = (id, topic, o = {}) => ({ id, who: 'おばあちゃん', topic, ...o });
const L = (corner, reason) => ({ corner, reason });
const goodLineup = () => [L('ひとこと', R1), L('むかし', R3), L('つぎ', R2)];
// goodNews（p3 が むかし にある）に、特集名と lineup を足した番組
const planOf = (lineup, feature = 'かぞくの一言特集') => ({ ...goodNews(), feature, lineup });

test('特集名と編成のわけ: 正しい feature と lineup を足した番組は通り、同じ値が新しいオブジェクトで返る', () => {
  const lineup = goodLineup();
  const r = checkNews(planOf(lineup), posts);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.news.feature, 'かぞくの一言特集');
  assert.deepEqual(r.news.lineup, goodLineup());
  assert.notEqual(r.news.lineup, lineup);
  assert.notEqual(r.news.lineup[0], lineup[0]);
});

test('特集名と編成のわけ: feature も lineup もない番組は今までどおり通り、返す番組にも入らない', () => {
  for (const news of [goodNews(), { ...goodNews(), feature: undefined, lineup: undefined }]) {
    const r = checkNews(news, posts);
    assert.equal(r.ok, true, r.reason);
    assert.equal('feature' in r.news, false);
    assert.equal('lineup' in r.news, false);
  }
});

test('特集名と編成のわけ: どちらか片方だけでも通る（それぞれ「あれば検査する」）', () => {
  assert.equal(checkNews({ ...goodNews(), feature: 'かぞくの一言特集' }, posts).ok, true);
  const r = checkNews({ ...goodNews(), lineup: goodLineup() }, posts);
  assert.equal(r.ok, true, r.reason);
  assert.equal('feature' in r.news, false);
});

// 特集名ごとに [条件に合う投稿, 条件に合わない投稿]。数えるのは件数なので、同じ人の2件でも特集になる
const FEATURE_CASES = [
  ['ごはん特集', [tp('a', 'ごはん'), tp('b', 'ごはん')], [tp('a', 'ごはん'), tp('b', 'そら')]],
  ['そら特集', [tp('a', 'そら'), tp('b', 'そら')], [tp('a', 'そら'), tp('b', 'ごはん')]],
  ['したこと特集', [tp('a', 'したこと'), tp('b', 'したこと')], [tp('a', 'したこと'), tp('b', 'そら')]],
  ['みつけた特集', [tp('a', 'みつけた'), tp('b', 'みつけた')], [tp('a', 'みつけた'), tp('b', 'そら')]],
  // 見出しの特集は、今日の投稿だけで数える。希望の投稿に付いた見出しは数えない
  ['うれしかった特集',
    [tp('a', 'そら', { headline: 'うれしかった' }), tp('b', 'ごはん', { headline: 'うれしかった' })],
    [tp('a', 'そら', { headline: 'うれしかった' }), tp('b', 'なに食べたい', { headline: 'うれしかった' })]],
  ['おいしかった特集',
    [tp('a', 'ごはん', { headline: 'おいしかった' }), tp('b', 'そら', { headline: 'おいしかった' })],
    [tp('a', 'ごはん', { headline: 'おいしかった' }), tp('b', 'なに食べたい', { headline: 'おいしかった' })]],
  ['びっくり特集',
    [tp('a', 'そら', { headline: 'びっくり' }), tp('b', 'ごはん', { headline: 'びっくり' })],
    [tp('a', 'そら', { headline: 'びっくり' }), tp('b', 'なに食べたい', { headline: 'びっくり' })]],
  // なつかしい特集は、見出しで選んだ投稿と、札で選んだ投稿を合わせて数える。希望の投稿は数えない
  ['なつかしい特集',
    [tp('a', 'みつけた', { headline: 'なつかしい' }), tp('b', 'みつけた', { card: 'なつかしいもの' })],
    [tp('a', 'みつけた', { headline: 'なつかしい' }), tp('b', 'なに食べたい', { headline: 'なつかしい' })]],
  ['つぎに会う日特集', [tp('a', 'なに食べたい'), tp('b', 'どこ行きたい')], [tp('a', 'なに食べたい'), tp('b', 'そら')]],
];
for (const [feature, fit, unfit] of FEATURE_CASES) {
  test(`特集名: ${feature} は条件に合えば通り、合わなければ「特集名が投稿と合わない」で弾く`, () => {
    const ok = checkNews(programFor(fit, { feature }), fit);
    assert.equal(ok.ok, true, ok.reason);
    assert.equal(ok.news.feature, feature);
    const ng = checkNews(programFor(unfit, { feature }), unfit);
    assert.equal(ng.ok, false);
    assert.equal(ng.reason, '特集名が投稿と合わない');
  });
}
test('特集名: かぞくの一言特集以外の9つが、すべて条件の確かめを持っている', () => {
  assert.deepEqual(FEATURE_CASES.map(([feature]) => feature), FEATURES.filter((f) => f !== 'かぞくの一言特集'));
});
test('特集名: かぞくの一言特集は、どんな投稿でも通る', () => {
  const single = [tp('a', 'そら')];
  assert.equal(checkNews(programFor(single, { feature: 'かぞくの一言特集' }), single).ok, true);
  assert.equal(checkNews(planOf(goodLineup()), posts).ok, true);
});
for (const [name, value] of [['一覧にない言葉', 'ほげ特集'], ['空の文字', ''], ['数', 5], ['null', null], ['オブジェクト', {}], ['配列', ['そら特集']]]) {
  test(`特集名: 弾く（形が違う） - ${name}`, () => {
    const r = checkNews({ ...goodNews(), feature: value }, posts);
    assert.equal(r.ok, false);
    assert.equal(r.reason, '特集名の形が違う');
  });
}

// 編成のわけごとに [わけ, コーナー, そのコーナーの投稿, 期待する答え]。null は当てはまらない、{} は補足なしで当てはまる
const OBA = 'おばあちゃん';
const MAGO = 'まご';
const OKA = 'おかあさん';
const OTO = 'おとうさん';
const rp = (who, o = {}) => ({ who, topic: 'そら', ...o });
const wp = (who, wishDate) => rp(who, { topic: 'いつ会いたい', wishDate });
const REASON_CASES = [
  // R1・R2: そのコーナーのときだけ
  [R1, 'ひとこと', [rp(OBA)], {}],
  [R1, 'むかし', [rp(OBA)], null],
  [R1, 'つぎ', [rp(OBA)], null],
  [R2, 'つぎ', [rp(OBA, { topic: 'どこ行きたい' })], {}],
  [R2, 'ひとこと', [rp(OBA)], null],
  [R2, 'むかし', [rp(OBA)], null],
  // R3: むかし のコーナーに、なつかしいを選んだ投稿（見出しでも札でも）があるとき
  [R3, 'むかし', [rp(OBA, { headline: 'なつかしい' })], {}],
  [R3, 'むかし', [rp(OBA, { topic: 'みつけた', card: 'なつかしいもの' })], {}],
  [R3, 'むかし', [rp(OBA, { text: '古い話' })], null],
  [R3, 'ひとこと', [rp(OBA, { headline: 'なつかしい' })], null],
  // R4: むかし のコーナーに、本文のある投稿があるとき
  [R4, 'むかし', [rp(OBA, { text: '古い話' })], {}],
  [R4, 'むかし', [rp(OBA), rp(MAGO, { text: '古い話' })], {}],
  [R4, 'むかし', [rp(OBA, { headline: 'なつかしい' })], null],
  [R4, 'ひとこと', [rp(OBA, { text: '古い話' })], null],
  // R5: ちがう人どうしで、お題が同じ
  [R5, 'ひとこと', [rp(OBA, { topic: 'そら' }), rp(MAGO, { topic: 'そら' })], { kind: 'topic', value: 'そら' }],
  [R5, 'つぎ', [rp(OBA, { topic: 'どこ行きたい' }), rp(MAGO, { topic: 'どこ行きたい' })], { kind: 'topic', value: 'どこ行きたい' }],
  [R5, 'ひとこと', [rp(OBA, { topic: 'そら' }), rp(OBA, { topic: 'そら' })], null],
  [R5, 'ひとこと', [rp(OBA, { topic: 'そら' }), rp(MAGO, { topic: 'ごはん' })], null],
  // R6: ちがう人どうしで、札が同じ（札のない投稿は数えない）
  [R6, 'ひとこと', [rp(OBA, { card: 'うみ' }), rp(MAGO, { card: 'うみ' })], { kind: 'card', value: 'うみ' }],
  [R6, 'ひとこと', [rp(OBA, { card: 'うみ' }), rp(OBA, { card: 'うみ' })], null],
  [R6, 'ひとこと', [rp(OBA), rp(MAGO)], null],
  [R6, 'ひとこと', [rp(OBA, { card: 'うみ' }), rp(MAGO, { card: 'やま' })], null],
  // R7: ちがう人どうしで、見出しが同じ
  [R7, 'ひとこと', [rp(OBA, { headline: 'びっくり' }), rp(MAGO, { headline: 'びっくり' })], { kind: 'headline', value: 'びっくり' }],
  [R7, 'ひとこと', [rp(OBA, { headline: 'びっくり' }), rp(OBA, { headline: 'びっくり' })], null],
  [R7, 'ひとこと', [rp(OBA), rp(MAGO)], null],
  [R7, 'ひとこと', [rp(OBA, { headline: 'びっくり' }), rp(MAGO, { headline: 'うれしかった' })], null],
  // R8: つぎ のコーナーで、ちがう人どうしの会いたい日が同じ
  [R8, 'つぎ', [wp(OBA, '2026-11-23'), wp(MAGO, '2026-11-23')], { kind: 'wishDate', value: '2026-11-23' }],
  [R8, 'つぎ', [wp(OBA, '2026-11-23'), wp(OBA, '2026-11-23')], null],
  [R8, 'つぎ', [wp(OBA, '2026-11-23'), wp(MAGO, '2026-11-24')], null],
  [R8, 'ひとこと', [wp(OBA, '2026-11-23'), wp(MAGO, '2026-11-23')], null],
  // R9: 投稿が2件以上で、となりあう投稿がどれもちがう人
  [R9, 'ひとこと', [rp(OBA), rp(MAGO)], {}],
  [R9, 'ひとこと', [rp(OBA), rp(MAGO), rp(OBA)], {}],
  [R9, 'ひとこと', [rp(OBA), rp(MAGO), rp(OKA)], {}],
  [R9, 'ひとこと', [rp(OBA), rp(OBA)], null],
  [R9, 'ひとこと', [rp(OBA), rp(MAGO), rp(MAGO)], null],
  [R9, 'ひとこと', [rp(OBA)], null],
];
REASON_CASES.forEach(([reason, corner, ps, expected], i) => {
  const who = ps.map((p) => p.who).join('→');
  test(`編成のわけ ${i + 1}: ${reason} / ${corner} / ${who} は ${expected === null ? '当てはまらない' : JSON.stringify(expected)}`, () => {
    assert.deepEqual(reasonFact(reason, corner, ps), expected);
  });
});
test('編成のわけ: 9つのわけが、すべて当てはまる例を持っている', () => {
  const covered = new Set(REASON_CASES.filter(([, , , expected]) => expected !== null).map(([reason]) => reason));
  assert.deepEqual([...covered].sort(), [...REASONS].sort());
});
test('編成のわけ: 当てはまる組がいくつもあるときは、先に出てくる組の値を返す', () => {
  const ps = [rp(OBA, { card: 'うみ' }), rp(MAGO, { card: 'うみ' }), rp(OKA, { card: 'やま' }), rp(OTO, { card: 'やま' })];
  assert.deepEqual(reasonFact(R6, 'ひとこと', ps), { kind: 'card', value: 'うみ' });
});
test('編成のわけ: 一覧にない言葉や文字でない値は、どのコーナーでも当てはまらない', () => {
  for (const reason of ['ほげ', '', 5, null, undefined, {}, [R1]]) {
    for (const corner of CORNERS) assert.equal(reasonFact(reason, corner, [rp(OBA)]), null, String(reason));
  }
});

// ひとこと に3件、つぎ に2件ある番組。ちがう人どうしが、同じお題・同じ札を選んでいる
const sharePosts = [
  { id: 'a', who: 'おばあちゃん', topic: 'そら', card: 'はれ', text: 'いい天気だった' },
  { id: 'b', who: 'まご', topic: 'そら', card: 'はれ' },
  { id: 'c', who: 'おかあさん', topic: 'ごはん', card: 'おかず' },
  { id: 'd', who: 'まご', topic: 'どこ行きたい', card: 'こうえん' },
  { id: 'e', who: 'おばあちゃん', topic: 'どこ行きたい', card: 'こうえん' },
];
test('編成のわけ: 条件に合うわけを選んだ番組は通り、合わないわけを選んだ番組は「編成のわけが投稿と合わない」で弾く', () => {
  const run = (hitokoto, tsugi) => {
    const plan = { feature: 'かぞくの一言特集', lineup: [L('ひとこと', hitokoto), L('つぎ', tsugi)] };
    return checkNews(programFor(sharePosts, plan), sharePosts);
  };
  const ok = run(R5, R6);
  assert.equal(ok.ok, true, ok.reason);
  assert.deepEqual(ok.news.lineup, [L('ひとこと', R5), L('つぎ', R6)]);
  // 見出しがない／会いたい日がない／コーナーがちがう
  for (const [hitokoto, tsugi] of [[R7, R6], [R5, R8], [R2, R6], [R5, R1], [R3, R6], [R4, R6]]) {
    const r = run(hitokoto, tsugi);
    assert.equal(r.ok, false, `${hitokoto} / ${tsugi}`);
    assert.equal(r.reason, '編成のわけが投稿と合わない');
  }
});

for (const [name, lineup] of [
  ['配列でない（文字）', 'ひとこと'],
  ['配列でない（オブジェクト）', L('ひとこと', R1)],
  ['null', null],
  ['4件', [...goodLineup(), L('つぎ', R2)]],
  ['項目が文字', ['ひとこと', L('むかし', R3), L('つぎ', R2)]],
  ['項目が null', [null, L('むかし', R3), L('つぎ', R2)]],
  ['一覧にない reason', [L('ひとこと', 'ほげ'), L('むかし', R3), L('つぎ', R2)]],
  ['文字でない reason', [{ corner: 'ひとこと', reason: 5 }, L('むかし', R3), L('つぎ', R2)]],
  ['一覧にない corner', [L('へんなコーナー', R1), L('むかし', R3), L('つぎ', R2)]],
]) {
  test(`lineup: 弾く（形が違う） - ${name}`, () => {
    const r = checkNews(planOf(lineup), posts);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'lineup の形が違う');
  });
}
for (const [name, lineup] of [
  // 最後のコーナーが足りない例は、件数の検査だけが見つけられる（途中が抜けた例は、コーナーの順の検査でも見つかる）
  ['足りない（つぎ がない）', [L('ひとこと', R1), L('むかし', R3)]],
  ['足りない（むかし がない）', [L('ひとこと', R1), L('つぎ', R2)]],
  ['0件', []],
  ['順番が逆', [L('つぎ', R2), L('むかし', R3), L('ひとこと', R1)]],
  ['同じコーナーを2回', [L('ひとこと', R1), L('ひとこと', R1), L('つぎ', R2)]],
  ['むかし が抜けて つぎ が2回', [L('ひとこと', R1), L('つぎ', R2), L('つぎ', R2)]],
]) {
  test(`lineup: 弾く（コーナーが番組と合わない） - ${name}`, () => {
    const r = checkNews(planOf(lineup), posts);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'lineup のコーナーが番組と合わない');
  });
}
test('lineup: 番組に出てこないコーナーのわけがあれば弾き、出てくるコーナーだけなら通る', () => {
  const ps = [tp('a', 'そら'), tp('b', 'なに食べたい')]; // むかし のない番組
  const withLineup = (lineup) => checkNews(programFor(ps, { feature: 'かぞくの一言特集', lineup }), ps);
  const ng = withLineup(goodLineup());
  assert.equal(ng.ok, false);
  assert.equal(ng.reason, 'lineup のコーナーが番組と合わない');
  const ok = withLineup([L('ひとこと', R1), L('つぎ', R2)]);
  assert.equal(ok.ok, true, ok.reason);
});
test('lineup: 項目の余計なキーは取り除いて返す', () => {
  const r = checkNews(planOf(goodLineup().map((x) => ({ ...x, html: '<script>' }))), posts);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.news.lineup, goodLineup());
});

test('特集名と編成のわけ: 検査中に値を差し替える細工（getter）をしても、検査していない値は返らない', () => {
  let featureReads = 0;
  let reasonReads = 0;
  let cornerReads = 0;
  const n = planOf(goodLineup());
  Object.defineProperty(n, 'feature', { get: () => (++featureReads === 1 ? 'かぞくの一言特集' : '<b>x</b>'), enumerable: true });
  Object.defineProperty(n.lineup[0], 'reason', { get: () => (++reasonReads === 1 ? R1 : '<b>x</b>'), enumerable: true });
  Object.defineProperty(n.lineup[1], 'corner', { get: () => (++cornerReads === 1 ? 'むかし' : 'へんなコーナー'), enumerable: true });
  const r = checkNews(n, posts);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.news.feature, 'かぞくの一言特集');
  assert.equal(r.news.lineup[0].reason, R1);
  assert.equal(r.news.lineup[1].corner, 'むかし');
});

test('編成のわけ: 札の値が __proto__ などでも壊れず、Object.prototype も汚れない', () => {
  for (const card of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.deepEqual(reasonFact(R6, 'ひとこと', [rp(OBA, { card }), rp(MAGO, { card })]), { kind: 'card', value: card }, card);
    // 同じ人が2回選んだだけなら当てはまらない
    assert.equal(reasonFact(R6, 'ひとこと', [rp(OBA, { card }), rp(OBA, { card })]), null, card);
    // その札を選んだ人が1人だけなら当てはまらない（Object.prototype の中身を「選ばれた札」と見まちがえない）
    assert.equal(reasonFact(R6, 'ひとこと', [rp(OBA, { card }), rp(MAGO, { card: 'うみ' })]), null, card);
  }
  // 投稿の検査から番組の検査までを通しても同じ
  const ps = cleanPosts({
    posts: [
      { id: 'a', who: 'おばあちゃん', topic: 'そら', card: '__proto__' },
      { id: 'b', who: 'まご', topic: 'そら', card: '__proto__' },
    ],
  }).posts;
  const r = checkNews(programFor(ps, { feature: 'かぞくの一言特集', lineup: [L('ひとこと', R6)] }), ps);
  assert.equal(r.ok, true, r.reason);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.keys(Object.prototype).length, 0);
});

// ---- 絵文字をつなぐ U+200D は通し、見えない文字は「何文字目か」を伝えて弾く ----
const ZWJ = '\u200D';
// コードポイントの並びから絵文字を組み立てる。つなぎの U+200D は見えないので、ソースには直接書かない
const emoji = (...codePoints) => codePoints.map((c) => String.fromCodePoint(c)).join('');
const joined = (...codePoints) => codePoints.map((c) => String.fromCodePoint(c)).join(ZWJ);
const EMOJI_OK = [
  // U+200D でつないだ絵文字（これまでは「見えない文字」として弾かれていた）
  ['家族', joined(0x1F468, 0x1F469, 0x1F467, 0x1F466)],
  ['料理人', joined(0x1F9D1, 0x1F373)],
  ['白髪の人', joined(0x1F469, 0x1F9B3)],
  ['虹の旗（U+FE0F つき）', emoji(0x1F3F3, 0xFE0F) + ZWJ + emoji(0x1F308)],
  ['白熊（U+FE0F つき）', emoji(0x1F43B) + ZWJ + emoji(0x2744, 0xFE0F)],
  ['肌色つきの家族', emoji(0x1F468, 0x1F3FB) + ZWJ + emoji(0x1F469, 0x1F3FD) + ZWJ + emoji(0x1F467, 0x1F3FF)],
  // つなぎのない絵文字（これまでも通っていて、これからも通る）
  ['肌色つき', emoji(0x1F44D, 0x1F3FD)],
  ['国旗', emoji(0x1F1EF, 0x1F1F5)],
  ['赤いハート（U+FE0F つき）', emoji(0x2764, 0xFE0F)],
  ['キーキャップの 1（U+FE0F と U+20E3 つき）', emoji(0x31, 0xFE0F, 0x20E3)],
];
for (const [label, value] of EMOJI_OK) {
  test(`絵文字: 通す（${label}）- ひとこと・ニックネーム・よびかた・よびかたの変更。文字列は変わらない`, () => {
    const r = cleanPosts({ posts: [{ id: 'a', who: value, name: value, topic: 'そら', text: `きょうは${value}を見た` }] });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual([r.posts[0].who, r.posts[0].name, r.posts[0].text], [value, value, `きょうは${value}を見た`]);
    const roles = cleanRoles([value, 'a', 'b', 'c', 'd']);
    assert.equal(roles.ok, true, roles.error);
    assert.equal(roles.roles[0], value);
  });
}
test('絵文字: つなぎの U+200D が入った投稿は、保存して読み戻せる', () => {
  const [, family] = EMOJI_OK[0];
  const clean = cleanPosts({ posts: [{ id: 'a', who: 'まご', name: family, topic: 'そら', text: family }] });
  const s = loadState(serializeState(clean.posts));
  assert.equal(s.posts[0].name, family);
  assert.equal(s.posts[0].text, family);
});

for (const [label, value] of [
  ['ZWSP（U+200B）', 'あ\u200Bい'],
  ['ZWNJ（U+200C）', 'あ\u200Cい'],
  ['向きを変える文字（U+202E）', 'あ\u202Eい'],
  ['BOM（U+FEFF）', '\uFEFFあい'],
  ['タブ', 'あ\tい'],
  ['改行', 'あ\nい'],
  ['文字の間の U+200D', `あ${ZWJ}い`],
  ['英字の間の U+200D', `a${ZWJ}b`],
  ['文字と絵文字の間の U+200D（前が文字）', `あ${ZWJ}${emoji(0x1F600)}`],
  ['絵文字と文字の間の U+200D（後ろが文字）', `${emoji(0x1F600)}${ZWJ}あ`],
  ['絵文字のあとの U+200D だけ', `${emoji(0x1F600)}${ZWJ}`],
  ['先頭の U+200D', `${ZWJ}${emoji(0x1F600)}`],
  ['U+200D が2つ続く', `${emoji(0x1F600)}${ZWJ}${ZWJ}${emoji(0x1F600)}`],
  ['つないだ絵文字のあとの ZWSP', `${joined(0x1F468, 0x1F469)}\u200B`],
]) {
  test(`絵文字: 弾く（${label}）- ひとこと・ニックネーム・よびかた・よびかたの変更`, () => {
    for (const field of ['text', 'name', 'who']) {
      assert.equal(cleanPosts(one({ [field]: value })).ok, false, `${field} が通ってしまった`);
    }
    assert.equal(cleanRoles([value, 'a', 'b', 'c', 'd']).ok, false, 'cleanRoles が通ってしまった');
  });
}

test('見えない文字: 何文字目に入っているかを、決まった文で伝える', () => {
  const tail = '見えない文字か改行が入っています。消してから送ってください。';
  assert.equal(cleanPosts(one({ text: 'あいうえ\u200Bお' })).error, `ひとことの 5 文字目に、${tail}`);
  assert.equal(cleanPosts(one({ name: 'ab\u202Ec' })).error, `ニックネームの 3 文字目に、${tail}`);
  assert.equal(cleanPosts(one({ who: '\uFEFFまご' })).error, `よびかたの 1 文字目に、${tail}`);
  assert.equal(cleanRoles(['ばあ\u200Bば', 'a', 'b', 'c', 'd']).error, `よびかたの 3 文字目に、${tail}`);
});
test('見えない文字: 改行は何文字目かを伝え、見つけた最初の所だけを言う', () => {
  assert.match(cleanPosts(one({ text: '1行目\n2行目' })).error, /^ひとことの 4 文字目に、/);
  assert.match(cleanPosts(one({ text: 'あ\u200Bい\u200Bう' })).error, /^ひとことの 2 文字目に、/);
});
test('見えない文字: 数えるのは1字ずつ（絵文字は1字）。UTF-16 の長さの数え方にはしない', () => {
  // 😀 は UTF-16 では2つ分だが、1字と数えて 2 文字目
  assert.match(cleanPosts(one({ text: `${emoji(0x1F600)}\u200B` })).error, /^ひとことの 2 文字目に、/);
});
test('見えない文字: つないだ絵文字のあとでも、打ったままの文字列の何番目かを伝える（つなぎの U+200D も1字に数える）', () => {
  // 👨 U+200D 👩 の3字のあとなので 4 文字目
  assert.match(cleanPosts(one({ text: `${joined(0x1F468, 0x1F469)}\u200B` })).error, /^ひとことの 4 文字目に、/);
});
test('見えない文字: 長さの上限の文は今までどおり（何文字目は付けない）', () => {
  assert.equal(cleanPosts(one({ text: 'あ'.repeat(201) })).error, 'ひとことは200文字以内の文字で入力してください。');
});
