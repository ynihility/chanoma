// 画面とサーバーの両方で使う検査の部品。
// ブラウザでも Node でも同じ検査が動くように、外のものは何も読み込まない。

export const STORAGE_KEY = 'chanoma.v1';
export const MAX_POSTS = 30;
export const MAX_HOST_CHARS = 80;
export const MAX_GREETING_CHARS = 100;
export const TODAY_TOPICS = ['ごはん', 'そら', 'したこと', 'みつけた'];
export const NEXT_TOPICS = ['なにしたい', 'どこ行きたい', 'なに食べたい'];
export const HEADLINES = ['うれしかった', 'おいしかった', 'びっくり', 'なつかしい'];
export const ANIMALS = ['ねこ', 'いぬ', 'うさぎ', 'くま', 'すずめ', 'かめ'];
// 放送の順番。この並びより前に戻るコーナーがあれば、番組として受け取らない
export const CORNERS = ['ひとこと', 'むかし', 'つぎ'];

const ID_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// 改行や制御文字は、1行のひとことには要らないので入れさせない
// ゼロ幅文字や文字の向きを変える文字も、見えないまま紛れ込むので同じく入れさせない
const CONTROL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const MAX_STATE_CHARS = 64 * 1024;

// 項目の検査に失敗したことを知らせる例外。message は画面に出してよい文だけにする
class Invalid extends Error {}
const fail = (message) => {
  throw new Invalid(message);
};

function optionalText(value, max, label) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max || CONTROL_CHARS.test(value)) {
    fail(`${label}は${max}文字以内の文字で入力してください。`);
  }
  return value.trim() || undefined;
}

function optionalChoice(value, choices, label) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !choices.includes(value)) fail(`${label}の値が正しくありません。`);
  return value;
}

function optionalDate(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const message = 'つぎに会う日の日付が正しくありません。';
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) fail(message);
  // 2026-02-31 のような、形だけ合っている存在しない日付も弾く
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail(message);
  // 0000年や9999年のような、あり得ない年も弾く
  if (d.getUTCFullYear() < 2020 || d.getUTCFullYear() > 2100) fail(message);
  return value;
}

// 投稿1件を検査し、決まった項目だけを持つ新しいオブジェクトに作り直す。
// 余計な項目や __proto__ のような変なキーを持ち込ませないため、受け取ったオブジェクトはそのまま使わない
function buildPost(p, ids) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('投稿の形が正しくありません。');
  if (typeof p.id !== 'string' || !ID_PATTERN.test(p.id) || ids.has(p.id)) fail('投稿のIDが正しくありません。');
  ids.add(p.id);
  const who = optionalText(p.who, 20, 'よびかた');
  if (!who) fail('よびかたを入れてください。');
  const topic = optionalChoice(p.topic, [...TODAY_TOPICS, ...NEXT_TOPICS], 'お題');
  if (!topic) fail('お題を選んでください。');
  const post = {
    id: p.id,
    who,
    name: optionalText(p.name, 20, 'ニックネーム'),
    animal: optionalChoice(p.animal, ANIMALS, 'どうぶつ'),
    topic,
    card: optionalText(p.card, 30, '札'),
    headline: optionalChoice(p.headline, HEADLINES, '見出し'),
    text: optionalText(p.text, 200, 'ひとこと'),
  };
  // 空の項目は消して、Claude や保存データに入っている項目だけを残す
  return Object.fromEntries(Object.entries(post).filter(([, v]) => v !== undefined));
}

function buildPosts(input, allowEmpty) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.posts)) fail('投稿の形が正しくありません。');
  const n = input.posts.length;
  if ((n === 0 && !allowEmpty) || n > MAX_POSTS) {
    fail(`投稿は1件以上、${MAX_POSTS}件以内にしてください。`);
  }
  const ids = new Set();
  const posts = input.posts.map((p) => buildPost(p, ids));
  const nextDate = optionalDate(input.nextDate);
  return nextDate ? { posts, nextDate } : { posts };
}

// 画面から届いた投稿の束を検査する。成功なら {ok:true, posts, nextDate?}、失敗なら {ok:false, error}
export function cleanPosts(input) {
  try {
    return { ok: true, ...buildPosts(input, false) };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

// localStorage から読んだ文字列を、型を確かめてから使える形にする。壊れていれば null
export function loadState(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_STATE_CHARS) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || data.v !== 1) return null;
  try {
    return buildPosts(data, true);
  } catch (e) {
    if (e instanceof Invalid) return null;
    throw e;
  }
}

export function serializeState(posts, nextDate) {
  return JSON.stringify(nextDate ? { v: 1, posts, nextDate } : { v: 1, posts });
}

// ---- Claude が返した番組の検査 ----
// この検査が見るのは「文字の見た目」だけ。ひらがな・漢字の人名や食べもの、言い換えは見つけられない。
// そこは prompt.txt の指示と、人の目に頼る。

// 改行、制御文字、ゼロ幅文字、文字の向きを変える文字など、目に見えない文字
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

// ひらがなを、母音（あ・い・う・え・お）ごとに分けた表。長音「ー」を母音に直すのに使う
const VOWELS = {
  あ: 'ぁあかがさざただなはばぱまゃやらゎわ',
  い: 'ぃいきぎしじちぢにひびぴみり',
  う: 'ぅうくぐすずっつづぬふぶぷむゅゆるゔ',
  え: 'ぇえけげせぜてでねへべぺめれ',
  お: 'ぉおこごそぞとどのほぼぽもょよろを',
};
const vowelOf = (ch) => Object.keys(VOWELS).find((v) => VOWELS[v].includes(ch)) ?? ch;

// 漢字で書かれたよびかたは、ひらがなに直してから比べる
const KANJI_FAMILY = [
  ['お爺ちゃん', 'おじいちゃん'], ['お祖父ちゃん', 'おじいちゃん'], ['お婆ちゃん', 'おばあちゃん'],
  ['お祖母ちゃん', 'おばあちゃん'], ['お爺さん', 'おじいさん'], ['お婆さん', 'おばあさん'],
  ['お父さん', 'おとうさん'], ['お母さん', 'おかあさん'], ['お兄ちゃん', 'おにいちゃん'],
  ['お姉ちゃん', 'おねえちゃん'], ['お兄さん', 'おにいさん'], ['お姉さん', 'おねえさん'],
  ['祖父', 'おじいちゃん'], ['祖母', 'おばあちゃん'], ['孫', 'まご'], ['息子', 'むすこ'], ['娘', 'むすめ'],
];

// 全角・半角をそろえ、空白を消す（「ハン バーグ」のような分断を防ぐ）
const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');
// さらに、カタカナをひらがなに、長音を母音に、漢字のよびかたをひらがなに直す
function fold(s) {
  let t = norm(s);
  for (const [from, to] of KANJI_FAMILY) t = t.split(from).join(to);
  t = t.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  return t.replace(/([ぁ-ん])(ー+)/g, (_, c, bars) => c + vowelOf(c).repeat(bars.length));
}
const foldAll = (list) => list.map(fold);
const removeAll = (s, words) => words.reduce((t, w) => t.split(w).join(''), s);

// 家族のよびかた。長い語から探して、見つけた所は消す（「ひいおじいちゃん」の中の「おじいちゃん」を二重に数えない）
const FAMILY = foldAll([
  'ひいおばあちゃん', 'ひいおじいちゃん', 'おばあちゃん', 'おじいちゃん', 'おばあさん', 'おじいさん',
  'おばあさま', 'おじいさま', 'おかあさん', 'おとうさん', 'おかあさま', 'おとうさま', 'おかあちゃん',
  'おとうちゃん', 'おにいちゃん', 'おねえちゃん', 'おにいさん', 'おねえさん', 'おじさん', 'おばさん',
  'ばあちゃん', 'じいちゃん', 'ばあさん', 'じいさん', 'ばあば', 'じいじ', 'かあさん', 'とうさん',
  'おふくろ', 'おやじ', 'まご', 'むすこ', 'むすめ', 'おとうと', 'いもうと',
]).sort((a, b) => b.length - a.length);
// 「まご」を含むふつうの言葉。家族のよびかたとは数えない
const FAMILY_BENIGN = foldAll(['たまご', 'まごころ', 'まごまご', 'まごつ']);
// 「さん」「ちゃん」などの前に来てよい言葉（よびかたの語幹と、みなさんなど）
const HONORIFIC_STEMS = foldAll([
  'おじい', 'おばあ', 'おかあ', 'おとう', 'おにい', 'おねえ', 'おじ', 'おば', 'じい', 'ばあ', 'かあ', 'とう',
  'みな', 'みんな', '皆', 'おきゃく', 'お客', 'かぞく', 'ごかぞく', 'ご家族',
]);
// 「さん」「さま」を含むふつうの言葉。敬称の検査の前に取り除く
const HONORIFIC_BENIGN = foldAll([
  'たくさん', 'さまざま', '様々', '様子', '同様', 'おつかれさま', 'お疲れ様', 'ごちそうさま', 'ご馳走様', 'おかげさま', 'お陰様',
]);
// 「さんぽ」「さんま」のような、敬称ではない言葉は除く
const HONORIFIC = /(さん(?!ぽ|ま|かく|か|せい|すう|にん|じゅう|ど|ばし|さい|みゃく|ぶ|ぎょう|ち|きゅう|び|けい)|くん(?!れん|せい)|君|ちゃん|さま|様)/gu;

// 司会が普通に使うカタカナ語。これ以外のカタカナ語は、投稿に出てくるものだけ許す
const ALLOWED_KATAKANA = [
  'ニュース', 'コーナー', 'テレビ', 'テレ', 'スタート', 'スタジオ', 'ゲスト', 'メッセージ',
  'オープニング', 'エンディング', 'ラジオ', 'コメント', 'チャンネル', 'ナレーション', 'プログラム',
].sort((a, b) => b.length - a.length);

// 設計のルールで禁じていること。ひらがなに直した文字列に対して、部分一致で探す
const RANK_WORDS = foldAll([
  'ランキング', 'ナンバーワン', 'ナンバー1', 'ベスト', '首位', '優勝', '随一', 'いちばん', '一番', '順位',
  'ランク', 'もっとも', '最も', 'くらべ', '比べ', 'だれよりも', '誰よりも', '圧倒',
]);
// 禁止語を含むふつうの言葉。禁止語の検査の前に取り除く
const RANK_BENIGN = foldAll(['一番星', '一番乗り', 'ベストセラー', 'ブランク']);
const RANK_PATTERN =/[0-9一二三四五六七八九十百]+位(?![置相])|[0-9二三四五六七八九十百]+番目|第[0-9一二三四五六七八九十]+位/;
const HEALTH_WORDS = foldAll([
  '健康', '病気', '認知', '予防', '効果', '癒', 'いやし', 'さみし', 'さびし', '寂', '淋', '孤独', '孤立',
  'こどく', 'ひとりぼっち', '一人ぼっち', '独りぼっち', 'ぼっち', '元気にな', '元気が出', '元気がで',
  '元気をもら', '長生', '長寿', 'ながいき', '若返', '防止', '回復', 'すこやか', '健やか', '体にいい',
  '体によい', 'からだにいい', 'からだによい', '笑顔になれ', '治る', 'なおる', 'ひとりじゃない',
  '一人じゃない', '独りじゃない', 'ぼけ',
]);
const HEALTH_BENIGN = foldAll(['効果音', '静寂', 'ぼけっと']);
// 「教えてくれました」は、司会が投稿を紹介するときの自然な言い方なので催促とは数えない
const URGING_BENIGN = foldAll(['教えてくれ', 'おしえてくれ']);
// 催促や返事を求める言い方。おわりの「お会いしましょう」は含まれないので、あいさつにも当てる
const URGING_WORDS = foldAll([
  'てください', 'て下さい', 'お願い', 'おねがい', '返事', '返信', 'へんじ', '既読', 'てね', 'てほしい',
  'てもらえ', '早くして', 'はやくして', '忘れず', '待ってい', '待ってま', '待ってる', 'まってい',
  'まってま', 'まってる', 'お待ちして', 'おまちして', '教えて', 'おしえて', 'お聞かせ', '聞かせて',
]);
const URGING_PATTERN = /まだ[^。！？]{0,12}ません/;
// HTML、Markdown、URL、絵文字、飾りの記号。画面は textContent で出すが、二重の守りとして弾く
const MARKUP = /[<>`*#_~|[\]{}\\^]|:\/\/|https?:|www\.|javascript:|&[#a-z0-9]+;|\p{Extended_Pictographic}|\p{Regional_Indicator}|[★☆♪♫♬♡♥◎◆◇■□●○※〒✿]|[a-z0-9-]+\.(com|jp|net|org|io)\b/iu;
// 残り日数を言わせない（日数は画面が出す）。「一日」「三日月」のようなふつうの言葉は当てない
const DAYS_PATTERN = /(あと|のこり|残り|もう)[0-9一二三四五六七八九十百]+(日|にち|週|か月|ヶ月|ヵ月|かげつ)|[0-9一二三四五六七八九十百]+(日|にち|週間|か月|ヶ月|ヵ月|かげつ)(後|ご|前|まえ|ほど|で会|で逢)|(あと|のこり|残り)(なん|何|いく)(日|にち|週)/;
// 区切りの記号や結合文字を挟んで禁止語を分断する細工（「健、康」など）に備え、これらを除いた形でも調べる
const SPLITTERS = /[\p{P}\p{S}\p{M}͏ᅟᅠㅤ⠀]/gu;
const QUOTE_LEN = 8;
const QUOTE_MIN = 5;

// 検査のもとになる、投稿の側の情報を作る
function makeContext(posts) {
  const strings = posts.flatMap((p) => [p.who, p.name, p.card, p.text, p.headline]).filter(Boolean);
  const persons = posts.flatMap((p) => [p.who, p.name]).filter(Boolean).map(fold);
  // 敬称の前に来てよい名前。「ゆきちゃん」と書かれていれば「ゆき」も、投稿のどうぶつ（ねこさん）も入れる
  const names = [
    ...persons,
    ...persons.map((t) => t.replace(/(さん|くん|ちゃん|さま|君|様)$/u, '')).filter(Boolean),
    ...posts.map((p) => p.animal).filter(Boolean).map(fold),
  ];
  return {
    // カタカナ語や英字が「投稿に出てくるか」を調べるための、全角半角をそろえた文字列
    known: strings.map(norm).join('\n'),
    persons,
    names,
    // 本文の写しを探すために、ひらがなに直して記号を除いた本文
    quotes: posts.map((p) => quoteForm(p.text ?? '')).filter((t) => t.length >= QUOTE_MIN),
  };
}
const quoteForm = (s) => fold(s).replace(/[\p{P}\p{S}]/gu, '');

// 1つの文を検査し、問題があれば理由を、なければ null を返す
function wordProblem(s, ctx) {
  if (INVISIBLE.test(s)) return '見えない文字や改行が混ざっている';
  const n = norm(s);
  const f = fold(s);
  // 区切りの記号や結合文字を除いた形。禁止語の検査はこちらに当てる
  const g = f.replace(SPLITTERS, '');
  if (MARKUP.test(n)) return 'HTMLや記号、URL、絵文字が混ざっている';
  const rank = removeAll(g, RANK_BENIGN);
  if (RANK_WORDS.some((w) => rank.includes(w)) || RANK_PATTERN.test(rank)) return '順位づけや比べる言葉がある';
  const health = removeAll(g, HEALTH_BENIGN);
  if (HEALTH_WORDS.some((w) => health.includes(w))) return '健康や孤独にふれる言葉がある';
  const urging = removeAll(g, URGING_BENIGN);
  if (URGING_WORDS.some((w) => urging.includes(w)) || URGING_PATTERN.test(f)) return '催促や返事を求める言葉がある';
  if (DAYS_PATTERN.test(g)) return '残り日数を言っている';

  // 家族のよびかたは、投稿の「よびかた・ニックネーム」に出ているものだけ許す（本文に出てくるだけでは許さない）
  let rest = removeAll(g, FAMILY_BENIGN);
  for (const w of FAMILY) {
    if (!rest.includes(w)) continue;
    if (!ctx.persons.some((t) => t === w || t.startsWith(w))) return `投稿にない家族のよびかた「${w}」がある`;
    rest = rest.split(w).join('');
  }
  // 「はなこさん」「田中さん」のような名前。さん・くん・ちゃんの前が、投稿の名前か語幹でなければ弾く
  // 許可したカタカナ語（チャンネルなど）や、さんを含むふつうの言葉（たくさん）は、先に取り除く
  const honorific = removeAll(fold(removeAll(n, ALLOWED_KATAKANA)), HONORIFIC_BENIGN);
  for (const m of honorific.matchAll(HONORIFIC)) {
    const pre = honorific.slice(Math.max(0, m.index - 8), m.index);
    if (ctx.names.some((t) => pre.endsWith(t)) || HONORIFIC_STEMS.some((t) => pre.endsWith(t))) continue;
    // 「ちゃんと聞く」のような副詞は、文のはじめや助詞のあとなら名前ではないので許す
    if (m[1] === 'ちゃん' && honorific[m.index + m[1].length] === 'と' && (pre === '' || /[、。！？はがをもにでへて]$/u.test(pre))) continue;
    return `投稿にない名前らしい言葉「${pre.slice(-4)}${m[1]}」がある`;
  }

  // 投稿にないカタカナ語・英字。許可語は先に取り除く（「ニュースコーナー」を1語として弾かないため）
  for (const run of removeAll(n, ALLOWED_KATAKANA).match(/[ァ-ヶ][ァ-ヶー]+/g) ?? []) {
    if (!ctx.known.includes(run)) return `投稿にないカタカナ語「${run}」がある`;
  }
  const knownLower = ctx.known.toLowerCase();
  for (const run of n.match(/[A-Za-z]{3,}/g) ?? []) {
    if (!knownLower.includes(run.toLowerCase())) return `投稿にない英字「${run}」がある`;
  }

  // 投稿の本文を写していないか。記号を除いて8文字続けて同じなら写しとみなす（短い本文は全文一致）
  const q = quoteForm(s);
  for (const t of ctx.quotes) {
    const win = Math.min(QUOTE_LEN, t.length);
    for (let i = 0; i + win <= t.length; i++) {
      if (q.includes(t.slice(i, i + win))) return '投稿の本文を写している';
    }
  }
  return null;
}

// 番組を検査する。posts は cleanPosts を通したもの。
// 成功なら {ok:true, news}（news は決まった項目だけの新しいオブジェクト）、失敗なら {ok:false, reason}。
// 検査した値をそのまま返すため、各項目は最初に1回だけ読む
export function checkNews(news, posts) {
  const bad = (reason) => ({ ok: false, reason });
  if (!Array.isArray(posts) || !news || typeof news !== 'object') return bad('番組の形が違う');
  const { opening, closing, segments: input } = news;
  if (!Array.isArray(input) || input.length > posts.length) return bad('segments の数が違う');
  const ctx = makeContext(posts);

  const greetings = {};
  for (const [key, s] of [['opening', opening], ['closing', closing]]) {
    if (typeof s !== 'string' || s.trim() === '' || s.length > MAX_GREETING_CHARS) return bad(`${key} の長さや型が違う`);
    const w = wordProblem(s, ctx);
    if (w) return bad(`${key}: ${w}`);
    greetings[key] = s.trim();
  }

  const byId = new Map(posts.map((p) => [p.id, p]));
  const used = new Set();
  let lastCorner = 0;
  const segments = [];
  for (const seg of input) {
    if (!seg || typeof seg !== 'object') return bad('segments の項目が違う');
    const { from, corner, host } = seg;
    const post = byId.get(from);
    if (!post || used.has(from)) return bad('投稿にないIDか、同じ投稿を2回使っている');
    used.add(from);
    const cornerIndex = CORNERS.indexOf(corner);
    if (cornerIndex < 0 || cornerIndex < lastCorner) return bad('コーナーの順番が違う');
    lastCorner = cornerIndex;
    // つぎに会う日の希望は「つぎ」コーナーにだけ、今日の投稿はそれ以外にだけ入る
    if (NEXT_TOPICS.includes(post.topic) !== (corner === 'つぎ')) return bad('投稿とコーナーが合わない');
    if (typeof host !== 'string' || host.trim() === '' || host.length > MAX_HOST_CHARS) return bad('host の長さや型が違う');
    const w = wordProblem(host, ctx);
    if (w) return bad(`host(${from}): ${w}`);
    segments.push({ corner, from, host: host.trim() });
  }
  if (used.size !== posts.length) return bad('使われていない投稿がある');
  return { ok: true, news: { opening: greetings.opening, segments, closing: greetings.closing } };
}
