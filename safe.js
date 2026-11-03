// 画面とサーバーの両方で使う検査の部品。
// ブラウザでも Node でも同じ検査が動くように、外のものは何も読み込まない。

export const STORAGE_KEY = 'chanoma.v1';
export const MAX_POSTS = 30;
export const MAX_HOST_CHARS = 80;
export const MAX_GREETING_CHARS = 100;
export const TODAY_TOPICS = ['ごはん', 'そら', 'したこと', 'みつけた'];
// 「いつ会いたい」は、日付で答える（wishDate）。ほかの3つは札で答える
export const WISH_DATE_TOPIC = 'いつ会いたい';
export const NEXT_TOPICS = [WISH_DATE_TOPIC, 'なにしたい', 'どこ行きたい', 'なに食べたい'];
export const HEADLINES = ['うれしかった', 'おいしかった', 'びっくり', 'なつかしい'];
export const ANIMALS = ['ねこ', 'いぬ', 'うさぎ', 'くま', 'すずめ', 'かめ'];
// 放送の順番。この並びより前に戻るコーナーがあれば、番組として受け取らない
export const CORNERS = ['ひとこと', 'むかし', 'つぎ'];

const ID_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// 改行や制御文字は、1行のひとことには要らないので入れさせない
// ゼロ幅文字や文字の向きを変える文字も、見えないまま紛れ込むので同じく入れさせない
const CONTROL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
// ただし、絵文字と絵文字をつなぐ U+200D（家族・料理人・白髪の人・虹の旗・白熊などの絵文字に使われる）だけは許す。
// 前が絵文字（肌色や U+FE0F がついていてもよい）で、後ろも絵文字（髪の部品 U+1F9B0〜1F9B3 を含む）のときだけ。
// 文字の間や、前後どちらかが絵文字でない U+200D は、今までどおり弾く
const EMOJI_JOINER = /(?<=\p{Extended_Pictographic}[\uFE0F\u{1F3FB}-\u{1F3FF}]?)\u200D(?=\p{Extended_Pictographic}|[\u{1F9B0}-\u{1F9B3}])/gu;
const MAX_STATE_CHARS = 64 * 1024;

// 項目の検査に失敗したことを知らせる例外。message は画面に出してよい文だけにする
class Invalid extends Error {}
const fail = (message) => {
  throw new Invalid(message);
};

// 見えない文字や改行が最初に出てくる位置を、1から数えた文字数で返す（なければ 0）。
// 数え方は、打ったままの文字列を Array.from で1字ずつに分けた番目（絵文字は1字、つなぎの U+200D も1字に数える）。
// 絵文字をつなぐ U+200D は、検査に当てる写しの上でだけ、同じ長さの別の字に置き換える（元の文字列は変えない。数もずれない）
function invisibleAt(value) {
  const probe = value.replace(EMOJI_JOINER, '-');
  return Array.from(probe).findIndex((ch) => CONTROL_CHARS.test(ch)) + 1;
}

function optionalText(value, max, label) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) fail(`${label}は${max}文字以内の文字で入力してください。`);
  const at = invisibleAt(value);
  if (at > 0) fail(`${label}の ${at} 文字目に、見えない文字か改行が入っています。消してから送ってください。`);
  return value.trim() || undefined;
}

function optionalChoice(value, choices, label) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !choices.includes(value)) fail(`${label}の値が正しくありません。`);
  return value;
}

function optionalDate(value, message = 'つぎに会う日の日付が正しくありません。') {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) fail(message);
  // 2026-02-31 のような、形だけ合っている存在しない日付も弾く
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail(message);
  // 0000年や9999年のような、あり得ない年も弾く
  if (d.getUTCFullYear() < 2020 || d.getUTCFullYear() > 2100) fail(message);
  return value;
}

// つぎに会う日だけを検査したいとき（投稿がまだ0件のときなど）に使う。成功なら {ok:true, value}（未指定なら value は undefined）
export function cleanDate(value) {
  try {
    return { ok: true, value: optionalDate(value) };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
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
  // 会いたい日の希望は、「いつ会いたい」のときだけ、日付で答える
  const wishDate = optionalDate(p.wishDate, '会いたい日の日付が正しくありません。');
  if (topic === WISH_DATE_TOPIC && !wishDate) fail('会いたい日を入れてください。');
  if (topic !== WISH_DATE_TOPIC && wishDate) fail('会いたい日は、「いつ会いたい」のときだけ入れられます。');
  const post = {
    id: p.id,
    who,
    name: optionalText(p.name, 20, 'ニックネーム'),
    animal: optionalChoice(p.animal, ANIMALS, 'どうぶつ'),
    topic,
    card: optionalText(p.card, 30, '札'),
    wishDate,
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
    const state = buildPosts(data, true);
    // よびかたが壊れていても、投稿は捨てない（初めの名前に戻すだけ）
    const roles = data.roles === undefined ? null : cleanRoles(data.roles);
    return roles?.ok ? { ...state, roles: roles.roles } : state;
  } catch (e) {
    if (e instanceof Invalid) return null;
    throw e;
  }
}

// 家族のよびかた。画面の切り替えボタンになる。本人が好きな名前に変えられる
export const DEFAULT_ROLES = ['おばあちゃん', 'おじいちゃん', 'おかあさん', 'おとうさん', 'まご'];

// 変えたよびかたを検査する。5つそろっていて、空でなく、重ならないこと。成功なら {ok:true, roles}
export function cleanRoles(input) {
  try {
    if (!Array.isArray(input) || input.length !== DEFAULT_ROLES.length) fail('よびかたの数が正しくありません。');
    const roles = input.map((r) => {
      const name = optionalText(r, 20, 'よびかた');
      if (!name) fail('よびかたを空にはできません。');
      return name;
    });
    // 「お母さん」と「おかあさん」、「ABC」と「ＡＢＣ」のような表記ゆれも、同じ名前として扱う
    const seen = new Map();
    for (const r of roles) {
      const key = fold(r);
      if (seen.has(key)) {
        const other = seen.get(key);
        fail(other === r
          ? `「${r}」は、ほかの人がもう使っています。ちがう名前にしてください。`
          : `「${other}」と「${r}」は、同じ名前に見えます。ちがう名前にしてください。`);
      }
      seen.set(key, r);
    }
    return { ok: true, roles };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

export function serializeState(posts, nextDate, roles) {
  return JSON.stringify({ v: 1, posts, ...(nextDate ? { nextDate } : {}), ...(roles ? { roles } : {}) });
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
  'おばちゃん', 'おじちゃん', 'ぱぱ', 'ひいばあば', 'ひいじいじ', 'ひいばあちゃん', 'ひいじいちゃん',
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
// 司会が家族に助言や指図をしてはいけない（医療・生活の助言、「〜したほうがいい」「〜すべき」など）。
// 「お会いしましょう」「聞いてみましょう」のふつうの呼びかけは通すため、「〜ましょう」は健康に関わる動作だけ当てる
const ADVICE_WORDS = foldAll([
  'ほうがいい', 'ほうがよ', '方がいい', '方が良', '方がよ', 'おすすめ', 'お勧め', 'お薦め', 'オススメ',
  '病院', '医者', '医師', '受診', '診察', 'お大事', 'おだいじ', '無理をしな', '無理しな', 'むりをしな', 'むりしな',
  '気をつけて', 'きをつけて', '気を付けて', '気をつけま', 'きをつけま',
]);
// 「べき」は「バーベキュー」の「べきゅ」に当てない
const ADVICE_PATTERN = /べき(?!ゅ)|(飲み|のみ|休み|やすみ|寝|眠り|ねむり|歩き|あるき|運動し|早く寝)ましょう|(といい|ばいい|とよい|ばよい)(ですよ|でしょう|と思)/;
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
// 日付・月・曜日・「来週」などは、画面が出すので、つなぎの言葉では言わせない（言い間違えると画面の日付と食い違うため）。
// 「一日」「三日月」や、「また明日」は日常の言い方なので当てない
const DATE_PATTERN_WORDS = /[0-9二三四五六七八九十百]+日(?![中月])|[0-9一二三四五六七八九十]+月|[月火水木金土日]曜|曜日|来週|再来週|来月|来年/;
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
    // 記号の検査（MARKUP）の前に、文から取り除く投稿の名前（よびかた・ニックネーム）。
    // 打ったままの形と、norm でそろえた形の両方を、長いものから順に並べる。
    // 短い名前を先に消すと、長い名前の記号だけが文に残る（「ばあば」と「ばあば♪」がいる投稿など）ため
    nameForms: [...new Set(posts.flatMap((p) => [p.who, p.name]).filter(Boolean).flatMap((t) => [t, norm(t)]))]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length),
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
  // 記号の検査にだけ、投稿の名前そのものを取り除いた文を当てる。名前に記号が入っていても（ばあば♪、Baba_1 など）、
  // 司会が名前を呼んだだけの文を弾かないため。名前のほかの記号（投稿にない♪や <b> など）は、今までどおり弾く。
  // 健康・助言・催促・順位などのほかの検査は、名前を含んだまま当てる（名前に禁止語が入っていても、そちらは変えない）
  if (MARKUP.test(removeAll(n, ctx.nameForms))) return 'HTMLや記号、URL、絵文字が混ざっている';
  const rank = removeAll(g, RANK_BENIGN);
  if (RANK_WORDS.some((w) => rank.includes(w)) || RANK_PATTERN.test(rank)) return '順位づけや比べる言葉がある';
  const health = removeAll(g, HEALTH_BENIGN);
  if (HEALTH_WORDS.some((w) => health.includes(w))) return '健康や孤独にふれる言葉がある';
  if (ADVICE_WORDS.some((w) => g.includes(w)) || ADVICE_PATTERN.test(g)) return '助言や指図にあたる言葉がある';
  const urging = removeAll(g, URGING_BENIGN);
  if (URGING_WORDS.some((w) => urging.includes(w)) || URGING_PATTERN.test(f)) return '催促や返事を求める言葉がある';
  if (DAYS_PATTERN.test(g)) return '残り日数を言っている';
  if (DATE_PATTERN_WORDS.test(g)) return '日付や曜日を言っている';

  // 家族のよびかたは、投稿の「よびかた・ニックネーム」に出ているものだけ許す（本文に出てくるだけでは許さない）
  // 「うちのおばあちゃん」のような投稿の名前そのものは、よびかたの照合の前に、文から取り除く。
  // 取り除くのは長い名前から：短い名前を先に消すと、長い名前の一部だけが文に残り、その残りを投稿にないよびかたと見誤るため。
  // 名前より長いよびかた（名前が「おばあちゃん」のときの「ひいおばあちゃん」）は、名前を消す前に照合する。
  // 先に名前を消すと、よびかたの一部が消えて、投稿にない人を見逃すため。そこで、名前とよびかたを1つの列にして、長い順に調べる。
  // 文のほうは記号を除いてあるので、名前も同じ形にしてから探す
  const postNames = [...new Set(ctx.persons.map((t) => t.replace(SPLITTERS, '')).filter(Boolean))];
  let rest = removeAll(g, FAMILY_BENIGN);
  for (const w of [...FAMILY, ...postNames].sort((a, b) => b.length - a.length)) {
    if (!rest.includes(w)) continue;
    // 投稿の名前そのものはそのまま通す。家族のよびかたは、今までどおりの条件で照合する
    if (!postNames.includes(w) && !ctx.persons.some((t) => t === w || t.startsWith(w))) return `投稿にない家族のよびかた「${w}」がある`;
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

// 家族が「なつかしい」を選んだ今日の投稿か（見出しが なつかしい、または札が なつかしいもの）。
// つぎに会う日の希望の投稿は、見出しが なつかしい でも対象にしない。本文に書いてあるだけの投稿も対象にしない（それは Claude の判断）
export const isNostalgic = (post) =>
  TODAY_TOPICS.includes(post.topic) && (post.headline === 'なつかしい' || post.card === 'なつかしいもの');

// ---- 今夜の特集名と、コーナーごとの編成のわけ ----
// どちらも、Claude には「この一覧から選ぶ」ことだけをさせる。選んだものが投稿の事実と合うかは、ここで確かめる。
// 一覧の言葉はそのまま画面に出る（prompt.txt にも同じ言葉を書いてある。変えるときは両方そろえる）

const countIf = (list, test) => list.filter(test).length;

// 今夜の特集名と、選べる条件。today は今日のことの投稿、next はつぎに会う日の希望の投稿。
// 数えるのは件数で、同じ人の投稿が2件でも特集になる。見出しの特集は、今日の投稿だけで数える
const FEATURE_RULES = [
  ['ごはん特集', (today) => countIf(today, (p) => p.topic === 'ごはん') >= 2],
  ['そら特集', (today) => countIf(today, (p) => p.topic === 'そら') >= 2],
  ['したこと特集', (today) => countIf(today, (p) => p.topic === 'したこと') >= 2],
  ['みつけた特集', (today) => countIf(today, (p) => p.topic === 'みつけた') >= 2],
  ['うれしかった特集', (today) => countIf(today, (p) => p.headline === 'うれしかった') >= 2],
  ['おいしかった特集', (today) => countIf(today, (p) => p.headline === 'おいしかった') >= 2],
  ['びっくり特集', (today) => countIf(today, (p) => p.headline === 'びっくり') >= 2],
  ['なつかしい特集', (today) => countIf(today, isNostalgic) >= 2],
  ['つぎに会う日特集', (today, next) => next.length >= 2],
  // ほかに当てはまるものがないとき用。いつでも選べる
  ['かぞくの一言特集', () => true],
];
export const FEATURES = FEATURE_RULES.map(([name]) => name);

// 選んだ特集名が、投稿の事実と合うか
function featureFits(feature, posts) {
  const rule = FEATURE_RULES.find(([name]) => name === feature);
  if (!rule) return false;
  const today = posts.filter((p) => TODAY_TOPICS.includes(p.topic));
  const next = posts.filter((p) => NEXT_TOPICS.includes(p.topic));
  return rule[1](today, next);
}

// ちがう人（よびかたがちがう人）どうしが同じ値を選んでいれば、その値を返す。なければ null。
// 値を覚えるのは Map（札が __proto__ のような文字でも壊れないように）
function sharedValue(cornerPosts, pick) {
  const firstWho = new Map();
  for (const p of cornerPosts) {
    const value = pick(p);
    if (!value) continue;
    if (!firstWho.has(value)) firstWho.set(value, p.who);
    else if (firstWho.get(value) !== p.who) return value;
  }
  return null;
}
const fact = (kind, value) => (value ? { kind, value } : null);

// コーナーごとの編成のわけと、選べる条件。corner はコーナー名、posts はそのコーナーに入れた投稿（出てくる順）。
// 条件に合わなければ null、合えば {}（補足なし）か { kind, value }（画面に出す補足。投稿の言葉そのもの）を返す
const REASON_RULES = [
  ['きょうのことを集めました', (corner) => (corner === 'ひとこと' ? {} : null)],
  ['つぎに会う日の希望を集めました', (corner) => (corner === 'つぎ' ? {} : null)],
  ['「なつかしい」をえらんだ投稿です', (corner, posts) => (corner === 'むかし' && posts.some(isNostalgic) ? {} : null)],
  // 本文に書かれているのが本当に昔の話かは、コードでは確かめられない。見るのは「本文がある」ことまで
  ['むかしの話が書かれています', (corner, posts) => (corner === 'むかし' && posts.some((p) => p.text) ? {} : null)],
  ['同じお題をえらんだ人がいます', (corner, posts) => fact('topic', sharedValue(posts, (p) => p.topic))],
  ['同じ札をえらんだ人がいます', (corner, posts) => fact('card', sharedValue(posts, (p) => p.card))],
  ['同じ見出しをえらんだ人がいます', (corner, posts) => fact('headline', sharedValue(posts, (p) => p.headline))],
  ['同じ日に会いたい人がいます', (corner, posts) => (corner === 'つぎ' ? fact('wishDate', sharedValue(posts, (p) => p.wishDate)) : null)],
  ['ちがう人が、かわるがわる出ます', (corner, posts) => (posts.length >= 2 && posts.every((p, i) => i === 0 || p.who !== posts[i - 1].who) ? {} : null)],
];
export const REASONS = REASON_RULES.map(([name]) => name);

// 選んだわけが、そのコーナーの投稿の事実と合うか。合わなければ null。
// 検査と、画面に出す補足の両方でこれを使う（確かめた事実と、画面に出す補足が食い違わないように）
export function reasonFact(reason, corner, cornerPosts) {
  const rule = REASON_RULES.find(([name]) => name === reason);
  return rule ? rule[1](corner, cornerPosts) : null;
}

// 番組を検査する。posts は cleanPosts を通したもの。
// 成功なら {ok:true, news}（news は決まった項目だけの新しいオブジェクト）、失敗なら {ok:false, reason}。
// 検査した値をそのまま返すため、各項目は最初に1回だけ読む
export function checkNews(news, posts) {
  const bad = (reason) => ({ ok: false, reason });
  if (!Array.isArray(posts) || !news || typeof news !== 'object') return bad('番組の形が違う');
  const { opening, closing, segments: input, feature, lineup } = news;
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
    // 家族が「なつかしい」を選んだ今日の投稿は、必ず むかし に入る。置き場所の誤りは、つなぎの言葉の検査より先に知らせる
    if (isNostalgic(post) && corner !== 'むかし') return bad('なつかしいを選んだ今日の投稿が むかし にない');
    if (typeof host !== 'string' || host.trim() === '' || host.length > MAX_HOST_CHARS) return bad('host の長さや型が違う');
    const w = wordProblem(host, ctx);
    if (w) return bad(`host(${from}): ${w}`);
    segments.push({ corner, from, host: host.trim() });
  }
  if (used.size !== posts.length) return bad('使われていない投稿がある');

  // 今夜の特集名と、コーナーごとの編成のわけ。スキーマでは必須なので、本物の返事には必ずある。
  // ここでは「あれば検査し、なければ無しで通す」（この2つを外しても、番組が動くようにしておくため）。
  // 理由の文には「」を入れない（server.mjs の頼み方の選び方が、「」の中を取り除くため）
  const result = { opening: greetings.opening, segments, closing: greetings.closing };
  if (feature !== undefined) {
    if (typeof feature !== 'string' || !FEATURES.includes(feature)) return bad('特集名の形が違う');
    if (!featureFits(feature, posts)) return bad('特集名が投稿と合わない');
    result.feature = feature;
  }
  if (lineup !== undefined) {
    if (!Array.isArray(lineup) || lineup.length > CORNERS.length) return bad('lineup の形が違う');
    // 番組に出てくるコーナー（出てくる順、重なりなし）。lineup は、これを1つずつ、同じ順で書いたものでなければならない
    const corners = [...new Set(segments.map((s) => s.corner))];
    if (lineup.length !== corners.length) return bad('lineup のコーナーが番組と合わない');
    const items = [];
    for (let i = 0; i < lineup.length; i++) {
      const item = lineup[i];
      if (!item || typeof item !== 'object') return bad('lineup の形が違う');
      const { corner, reason } = item;
      if (!CORNERS.includes(corner) || !REASONS.includes(reason)) return bad('lineup の形が違う');
      if (corner !== corners[i]) return bad('lineup のコーナーが番組と合わない');
      // 事実の照合に使うのは、検査ずみの segments（Claude の返事の生の配列ではない）
      const cornerPosts = segments.filter((s) => s.corner === corner).map((s) => byId.get(s.from));
      if (!reasonFact(reason, corner, cornerPosts)) return bad('編成のわけが投稿と合わない');
      items.push({ corner, reason });
    }
    result.lineup = items;
  }
  return { ok: true, news: result };
}
