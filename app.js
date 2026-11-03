// 画面の動き。投稿をためて、夜7時に /api/news で番組を作ってもらい、テレビに順に映す。
// 画面に出す文字はすべて textContent で入れる。innerHTML は使わない。
import {
  STORAGE_KEY, MAX_POSTS, TODAY_TOPICS, NEXT_TOPICS, WISH_DATE_TOPIC, HEADLINES, ANIMALS,
  DEFAULT_ROLES, cleanPosts, cleanDate, cleanRoles, checkNews, loadState, serializeState,
} from './safe.js';
import { play, setMuted } from './sound.js';
import { voiceSupported, listen } from './voice.js';
import { spriteCanvas } from './pixel.js';

// 演出（canvas）は飾り。読み込めなかったときも、投稿と放送は動かす
let fx = null;
import('./effects.js').then((m) => { fx = m; }).catch((e) => console.warn('effects.js を読み込めませんでした', e));

// お題ごとの札。「つぎに会う日」の希望も同じ形で持つ
const CARDS = {
  'ごはん': ['ごはん', 'パン', 'めん', 'おかず', 'おやつ', 'のみもの'],
  'そら': ['はれ', 'くもり', 'あめ', 'ゆき', 'かぜ', 'おつきさま'],
  'したこと': ['さんぽ', 'おそうじ', 'かいもの', 'おしゃべり', 'おりょうり', 'おひるね'],
  'みつけた': ['はな', 'とり', 'むし', 'あたらしいおみせ', 'おもしろいもの', 'なつかしいもの'],
  'なにしたい': ['おさんぽ', 'おはなし', 'おりょうり', 'おかいもの', 'おでかけ', 'ゆっくりする'],
  'どこ行きたい': ['こうえん', 'うみ', 'やま', 'おんせん', 'おまつり', 'おうち'],
  'なに食べたい': ['おすし', 'おにく', 'おさかな', 'めん', 'おかし', 'なべ'],
};
// コーナーの題字。語のまとまりごとに分けておく（折れるときは、まとまりの切れ目で折れる）
const CORNER_TITLES = { 'ひとこと': ['きょうの一言'], 'むかし': ['むかし話', 'コーナー'], 'つぎ': ['つぎに会う日'] };
// 司会の言葉の中で、途中で折れてほしくない決まった語（よびかたとニックネームは、画面に出すときに足す）
const FIXED_WORDS = ['ひとこと', 'むかし話', 'コーナー', 'つぎに会う日', '会いたい日', '夜7時', 'かぞくニュース', 'テレ吉'];

const $ = (id) => document.getElementById(id);
// 要素を作り、文字は textContent で入れる
function el(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}
// 語の途中で折れない箱（CSS の .nw）。長すぎて行に入りきらないときだけ、箱の中で折る
const nw = (text) => el('span', text, 'nw');

// 順に並べた語を、nw の箱に入れて、間に区切りの文字を挟んだものにする（箱の中の文字は、元のまま）
function nwJoin(parent, parts, separator = '　') {
  parts.forEach((part, i) => {
    if (i > 0) parent.append(separator);
    parent.append(nw(part));
  });
}

// 文の中の「折れてほしくない語」（よびかた・ニックネーム・決まった語）を見つけて、nw の箱で包む。
// 文字そのものは変えず、箱に入れるだけ。1文字の語は、もともと途中で折れないので対象にしない
function guard(text) {
  const words = [...roles(), ...state.posts.flatMap((p) => [p.who, p.name ?? '']), ...FIXED_WORDS];
  // 長い語から先に探す（短い語が、長い語の一部だけを先に取ってしまわないように）
  const list = [...new Set(words)].filter((w) => w.length >= 2).sort((a, b) => b.length - a.length);
  const re = new RegExp(list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const nodes = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) nodes.push(document.createTextNode(text.slice(last, m.index)));
    nodes.push(nw(m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

// コーナーなどの題字（段落）。語のまとまりごとに nw の箱へ入れる
function titleLine(units) {
  const p = el('p', undefined, 'corner');
  p.append(...units.map(nw));
  return p;
}

// 保存データは型を確かめてから使う。読めなければ空から始める
let state = { posts: [] };
let loadNote = '';
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  const saved = loadState(raw);
  if (saved) {
    state = saved;
    // よびかただけ壊れていたときは、投稿は残して、はじめの名前に戻したと知らせる
    if (!saved.roles && JSON.parse(raw).roles !== undefined) loadNote = 'よびかたを読み込めなかったので、はじめの名前に戻しました。';
  } else if (raw !== null) {
    loadNote = '保存していた投稿を読み込めませんでした。新しく始めます。';
  }
} catch {
  // 保存が使えない環境でも、画面は動かす
}

// 1台で実演するために、ここで使う人（家族でのよびかた）を切り替える。よびかたは本人が好きな名前に変えられる
const roles = () => state.roles ?? DEFAULT_ROLES;
// 保存データのうち、投稿以外（つぎに会う日・よびかた）を引き継ぐための部分
const keep = () => ({
  ...(state.nextDate ? { nextDate: state.nextDate } : {}),
  ...(state.roles ? { roles: state.roles } : {}),
});
let role = roles()[0];
const pick ={ topic: '', card: '', headline: '' };
// キャラ（どうぶつ）とニックネームは、よびかたごとに覚える。前に投稿していれば、その内容を引き継ぐ
// 名前を「__proto__」などにされても全体が汚染されないよう、土台のない入れ物にする
const profiles = Object.create(null);
for (const p of state.posts) profiles[p.who] = { animal: p.animal ?? '', nick: p.name ?? '' };
const profile = () => (profiles[role] ??= { animal: '', nick: '' });
// 放送中の状態。steps は順に映す内容、index は今の位置
let show = { steps: [], index: 0 };
// いま動いている画面の演出（なければ null）
let run = null;
// 番組ができるのを待っている最中か
let waiting = false;
// 届いたけれど、まだテレビで見ていない番組（待っているあいだに「投稿にもどる」を押したときなど）。なければ null
let ready = null;
// 待ちが長いときに、待ち画面の一言を替えるためのタイマー
let waitTimer = 0;

function say(message) {
  $('msg').textContent = message;
  // 操作した場所から離れた所にメッセージが出るので、見える位置まで画面を動かす
  if (message) $('msg').scrollIntoView({ block: 'nearest' });
}

// 保存できたら true。使えない環境や容量いっぱいのときは false
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeState(state.posts, state.nextDate, state.roles));
    return true;
  } catch {
    return false;
  }
}

// ---- 投稿画面 ----

// 選ぶボタンの並びを作る。並びが同じなら、ボタンは作り直さず選択の印だけを更新する。
// 作り直すとキーボードのフォーカスが消えて、押すたびに先頭から Tab をやり直すことになるため
function renderChoices(containerId, items, current, onPick, emptyText, withIcon = false) {
  const box = $(containerId);
  const key = items.join('\u0000');
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    if (items.length === 0) {
      box.replaceChildren(el('span', emptyText ?? '', 'note'));
    } else {
      box.replaceChildren(...items.map((item) => {
        const b = el('button', item);
        b.type = 'button';
        // 動物のボタンは、名前の上にドット絵を出す（飾りなので読み上げない）
        if (withIcon) {
          b.classList.add('animal');
          b.prepend(spriteCanvas(item, 3, undefined, { shadow: true }));
        }
        // もう一度押すと、選びなおせるように印を外す
        b.addEventListener('click', () => {
          play('tap');
          onPick(b.getAttribute('aria-pressed') === 'true' ? '' : item);
        });
        return b;
      }));
    }
  }
  for (const b of box.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.textContent === current));
}

// お題（今日のこと／つぎに会う日の希望）を選ぶと、札が入れ替わる
function pickTopic(v) {
  pick.topic = v;
  pick.card = '';
  renderForm();
}

function renderForm() {
  // 見出し「○○のひとこと」は、よびかたと「のひとこと」を別の箱にして、語の途中で折れないようにする
  $('post-title').replaceChildren(nw(role), nw('のひとこと'));
  // 「いつ会いたい」のときは、札のかわりに日付をえらぶ
  const askDate = pick.topic === WISH_DATE_TOPIC;
  $('cards-box').hidden = askDate;
  $('wish-date-box').hidden = !askDate;
  renderChoices('topics', TODAY_TOPICS, pick.topic, pickTopic);
  renderChoices('wishes', NEXT_TOPICS, pick.topic, pickTopic);
  renderChoices('cards', CARDS[pick.topic] ?? [], pick.card, (v) => {
    pick.card = v;
    renderForm();
  }, 'お題をえらぶと、札が出ます。');
  renderChoices('headlines', HEADLINES, pick.headline, (v) => {
    pick.headline = v;
    renderForm();
  });
  renderChoices('animals', ANIMALS, profile().animal, (v) => {
    profile().animal = v;
    renderForm();
  }, undefined, true);
  if ($('nick').value !== profile().nick) $('nick').value = profile().nick;
  // よびかたの入力欄は、人を切り替えたときに合わせる（入力中は触らない）
  if (document.activeElement !== $('rename') && $('rename').value !== role) $('rename').value = role;
  renderSteps();
}

// 投稿の手順の丸（だれ → お題 → 札 → おくる）。選んだところにチェックが付き、次にやることの丸が目立つ
// 送った直後だけ、その人の4つを全部「できた」にして見せる（次の選択を始めるか、少し経つと戻る）
let sentBy = '';
let sentTimer = 0;
function renderSteps() {
  const askDate = pick.topic === WISH_DATE_TOPIC;
  if (sentBy && (sentBy !== role || pick.topic || pick.card)) sentBy = '';
  const all = sentBy === role;
  // だれ: 上のボタンでいつも誰かが選ばれている。おくる: 送った直後だけ「できた」
  const flags = [true, Boolean(pick.topic), askDate ? Boolean($('wish-date').value) : Boolean(pick.card), false].map((v) => v || all);
  const nowIndex = flags.indexOf(false);
  const items = [...$('steps').children];
  items.forEach((li, i) => {
    li.classList.toggle('done', flags[i]);
    li.classList.toggle('now', i === nowIndex);
    if (i === nowIndex) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
    li.querySelector('.sr').textContent = flags[i] ? '（できた）' : i === nowIndex ? '（いま）' : '';
  });
  // 3つめは、「いつ会いたい」のときだけ、札のかわりに日にちをえらぶ
  const name = items[2].querySelector('.name');
  const label = askDate ? '日にち' : '札';
  if (name.textContent !== label) name.textContent = label;
}

function renderRoles() {
  const box = $('roles');
  // ボタンは最初に1回だけ作り、名前が変わったときは文字だけ入れ替える（フォーカスを保つため）
  if (box.children.length === 0) {
    roles().forEach((_, i) => {
      const b = el('button');
      b.type = 'button';
      b.addEventListener('click', () => {
        play('tap');
        cancelVoice();
        role = roles()[i];
        say('');
        renderRoles();
        renderForm();
      });
      box.append(b);
    });
  }
  [...box.children].forEach((b, i) => {
    b.textContent = roles()[i];
    b.setAttribute('aria-pressed', String(roles()[i] === role));
  });
}

// よびかたを好きな名前に変える。前の投稿の名前も、まとめて新しい名前に直す
function renameRole() {
  const name = $('rename').value.trim();
  const old = role;
  if (name === old) {
    $('rename').value = old;
    say('');
    return;
  }
  const checked = cleanRoles(roles().map((r) => (r === old ? name : r)));
  if (!checked.ok) {
    // 打ち直さなくてよいように、入力した文字は消さない
    play('error');
    say(checked.error);
    return;
  }
  state = { ...state, roles: checked.roles, posts: state.posts.map((p) => (p.who === old ? { ...p, who: name } : p)) };
  if (profiles[old]) {
    profiles[name] = profiles[old];
    delete profiles[old];
  }
  role = name;
  const saved = save();
  play('send');
  say(saved ? `「${name}」にかえました。` : `「${name}」にかえました。ただし、この端末には保存できませんでした。画面を閉じると消えます。`);
  renderRoles();
  renderForm();
  renderPosts();
}

function renderPosts() {
  const list = $('posts');
  list.replaceChildren();
  if (state.posts.length === 0) {
    const empty = el('li');
    empty.append(nw('きょうの投稿は、'), nw('ここに'), nw('ならびます。'));
    list.append(empty);
  }
  for (const p of state.posts) {
    const li = el('li');
    const body = el('span', undefined, 'body');
    const wish = p.wishDate ? monthDay(p.wishDate) : '';
    // 選んだ言葉は、語の途中で折れない箱に入れる。本人が書いたひとことは、そのまま流す
    nwJoin(body, [p.animal ? `【${p.animal}】` : '', p.who, p.topic, p.card, wish, p.headline].filter(Boolean));
    if (p.text) body.append('　', p.text);
    const del = el('button', '消す');
    del.type = 'button';
    // 「消す」が何件も並ぶので、読み上げでどの投稿か分かるように名前を付ける
    del.setAttribute('aria-label', `${p.who}の「${p.card ?? (p.wishDate ? monthDay(p.wishDate) : p.topic)}」の投稿を消す`);
    del.addEventListener('click', () => {
      state.posts = state.posts.filter((x) => x.id !== p.id);
      save();
      renderPosts();
      // 消したボタンは無くなるので、フォーカスを見出しに移す
      $('list-title').focus();
    });
    // 動物を選んでいれば、左にドット絵を置く（飾りなので読み上げない）
    if (p.animal) li.append(spriteCanvas(p.animal, 3, undefined, { shadow: true }));
    li.append(body, del);
    list.append(li);
  }
  // 投稿が変わったので、できていた番組が使えるかどうかを、ボタンに反映する
  syncEvening();
}

// 動きを減らす設定か（そのときは、飾りの動きを出さない）
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 「おくる」を押したとき、選んだどうぶつが、ボタンの横でつぶれて、のびて、はずむ（飾り。動きは CSS の .hop）
function hopAnimal(animal) {
  if (!animal || prefersReducedMotion()) return;
  const row = $('send-row');
  // 続けて押されたときは、前のものを片づけてから出す
  row.querySelector('.hop')?.remove();
  const hop = el('span', undefined, 'hop');
  hop.setAttribute('aria-hidden', 'true');
  const body = el('span', undefined, 'hop-body');
  body.append(spriteCanvas(animal, 5, undefined, { shadow: true }));
  hop.append(body);
  row.append(hop);
  // 動きが終わったら外す。終わりの合図が来なかったときも、残らないように時間でも外す
  body.addEventListener('animationend', (e) => {
    if (e.animationName === 'hop-fade') hop.remove();
  });
  setTimeout(() => hop.remove(), 1500);
}

// 投稿のIDは、safe.js の決まり（英数字と - _ で20文字まで）に合わせる
const newId = () => `p${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-5)}`;

function submitPost() {
  cancelVoice();
  const askDate = pick.topic === WISH_DATE_TOPIC;
  const wishDate = askDate ? $('wish-date').value : '';
  if (!pick.topic || (askDate ? !wishDate : !pick.card)) {
    play('error');
    say(askDate ? '会いたい日を、えらんでください。' : 'お題と札を、えらんでください。');
    return;
  }
  // 会いたい日の希望は、今日より前の日にちにはできない
  if (askDate && daysUntil(wishDate) < 0) {
    play('error');
    say('今日より前の日にちは、えらべません。');
    return;
  }
  if (state.posts.length >= MAX_POSTS) {
    play('error');
    say(`投稿は${MAX_POSTS}件までです。いらない投稿を消してください。`);
    return;
  }
  const post = {
    id: newId(), who: role, name: profile().nick, animal: profile().animal,
    topic: pick.topic, card: askDate ? '' : pick.card, wishDate, headline: pick.headline, text: $('text').value,
  };
  const r = cleanPosts({ posts: [...state.posts, post], nextDate: state.nextDate });
  if (!r.ok) {
    play('error');
    say(r.error);
    return;
  }
  state = { posts: r.posts, ...keep() };
  const saved = save();
  play('send');
  hopAnimal(post.animal);
  // 手順の丸を、少しのあいだ全部「できた」にする
  sentBy = role;
  clearTimeout(sentTimer);
  sentTimer = setTimeout(() => {
    sentBy = '';
    renderSteps();
  }, 1800);
  pick.topic = pick.card = pick.headline = '';
  $('text').value = '';
  $('wish-date').value = '';
  say(saved ? 'おくりました。' : 'おくりました。ただし、この端末には保存できませんでした。画面を閉じると消えます。');
  renderForm();
  renderPosts();
}

// つぎに会う日を決める。投稿が0件でも保存できるように、日付だけを検査する
function changeDate() {
  const r = cleanDate($('next-date').value);
  // 入れられない日付のときは、欄を前の日付に戻す（画面と保存の食い違いを防ぐ）
  const reject = (message) => {
    $('next-date').value = state.nextDate ?? '';
    play('error');
    say(message);
  };
  if (!r.ok) return reject(r.error);
  if (r.value && daysUntil(r.value) < 0) return reject('今日より前の日にちは、えらべません。');
  const { nextDate, ...rest } = state;
  state = r.value ? { ...rest, nextDate: r.value } : rest;
  say(save() ? '' : 'この端末には保存できませんでした。画面を閉じると消えます。');
  syncEvening();
}

// ---- 放送画面 ----

// 動いている演出があれば、今すぐ終わらせる（中身の入れ替えまで済ませる）
function cancelFx() {
  const r = run;
  run = null;
  r?.skip();
}

// テレビを画面の先頭へ寄せる（テレビと「つぎへ」が、最初の画面に入るように）。
// 動きを減らす設定の人には、なめらかに動かさず、すぐ移す
function tvToTop() {
  $('tv-view').scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function setView(onAir) {
  cancelFx();
  $('post-view').hidden = onAir;
  $('list-view').hidden = onAir;
  $('date-view').hidden = onAir;
  $('tv-view').hidden = !onAir;
  $('evening').hidden = onAir;
  // 夜7時: 部屋を暗くして、テレビだけを光らせる
  document.body.classList.toggle('night', onAir);
  // 押したボタンは隠れるので、フォーカスを新しい画面に移す（キーボードや読み上げの人が迷子にならないように）。
  // テレビのほうは、フォーカスで勝手に動かさず、tvToTop で先頭へ寄せる
  if (onAir) {
    $('screen').focus({ preventScroll: true });
    tvToTop();
  } else {
    $('post-title').focus();
  }
}

// 今日から日付までの日数（同じ日なら 0）。時刻は無視して、日付だけで数える
function daysUntil(dateText) {
  const [y, m, d] = dateText.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}

// 「11月20日」の形にする
function monthDay(dateText) {
  const [, m, d] = dateText.split('-').map(Number);
  return `${m}月${d}日`;
}

// 日付のうしろに付ける日数。日数は Claude には言わせず、ここで数えて出す（過ぎた日には付けない）
function daysSuffix(dateText) {
  const left = daysUntil(dateText);
  if (left < 0) return '';
  return left === 0 ? '（きょうです）' : `（あと${left}日）`;
}

// 「つぎに会う日」の1行（画面に出す段落）。日付と日数は、それぞれ途中で折れない箱に入れる
function meetLine(dateText) {
  const p = el('p', undefined, 'meet');
  if (!dateText) {
    p.append(...guard('つぎに会う日は、決まったらここに出ます。'));
    return p;
  }
  const suffix = daysSuffix(dateText);
  nwJoin(p, ['つぎに会う日：', monthDay(dateText), ...(suffix ? [suffix] : [])], '');
  return p;
}

// 番組を、画面に映す順番の一覧にする。本文は投稿のほうから取り、Claude の返事からは取らない
function buildSteps(news, posts, nextDate) {
  const byId = new Map(posts.map((p) => [p.id, p]));
  return [
    { kind: 'opening', host: news.opening },
    ...news.segments.map((s) => ({ kind: 'segment', corner: s.corner, host: s.host, post: byId.get(s.from), nextDate })),
    { kind: 'closing', host: news.closing },
  ];
}

// 司会のつなぎの言葉。テレ吉（飾り）の横に吹き出しを出し、中に「AI」の札を入れる（家族の短冊と見分けるため）
function hostLine(text) {
  const row = el('div', undefined, 'host-row');
  const bubble = el('p', undefined, 'host');
  // 文字は元のまま。よびかたなどの語だけ、途中で折れない箱に入れる
  bubble.append(el('span', 'AI', 'ai-chip'), ...guard(text));
  row.append(spriteCanvas('テレ吉', 4, undefined, { shadow: true }), bubble);
  return row;
}

// 画面の中身を入れ替える。演出の canvas（class が fx）は、動いている最中でも残す
function setScreen(...nodes) {
  const screen = $('screen');
  for (const child of [...screen.children]) {
    if (!child.classList.contains('fx')) child.remove();
  }
  screen.append(...nodes);
}

// いまの場面を、画面にすぐ描く。still が true のときは、中身がふわっと出る動きを付けない（演出の中で入れ替えるとき）
function renderStep(still = false) {
  const step = show.steps[show.index];
  const wrap = el('div', undefined, still ? 'fade still' : 'fade');
  if (step.kind === 'segment') {
    wrap.append(titleLine(CORNER_TITLES[step.corner] ?? []), hostLine(step.host));
    if (step.corner === 'つぎ') wrap.append(meetLine(step.nextDate));
    const p = step.post;
    const box = el('div', undefined, 'post');
    // 名前の行。動物の絵（飾り）の右に、動物・よびかた・ニックネームを、それぞれ途中で折れない箱に入れて並べる
    const who = el('p', undefined, 'who');
    if (p.animal) who.append(spriteCanvas(p.animal, 3, undefined, { shadow: true }));
    const whoText = el('span', undefined, 'who-text');
    nwJoin(whoText, [p.animal ? `【${p.animal}】` : '', p.who, p.name ? `（${p.name}）` : ''].filter(Boolean), '');
    who.append(whoText);
    box.append(who);
    // つぎに会う日の希望は「なにしたい　おでかけ」のように、お題と札を並べて出す
    // 「いつ会いたい」は、札のかわりに日付と、あと何日かを出す
    const wish = p.wishDate ? `${monthDay(p.wishDate)}${daysSuffix(p.wishDate)}` : p.card;
    const cardLine = NEXT_TOPICS.includes(p.topic) ? [p.topic, wish] : [p.card];
    const card = el('p', undefined, 'card');
    nwJoin(card, [...cardLine, p.headline].filter(Boolean));
    box.append(card);
    if (p.text) box.append(el('p', p.text, 'text'));
    wrap.append(box);
  } else {
    wrap.append(titleLine(step.kind === 'opening' ? ['夜7時の', 'かぞくニュース'] : ['おしまい']), hostLine(step.host));
  }
  setScreen(wrap);
  updateNext();
}

// 「つぎへ」のボタンの文字。最後の場面では「もう一度みる」
function updateNext() {
  $('next').textContent = show.index === show.steps.length - 1 ? 'もう一度みる' : 'つぎへ';
}

// コーナーの区別。はじめ・おわりも、ひとつのまとまりとして数える
const cornerKey = (step) => (step.kind === 'segment' ? step.corner : step.kind);

// 画面に演出をはさんで、中身を入れ替える（paint が入れ替えの処理）。演出が使えない
// （読み込めない・動きを減らす設定）ときは、すぐ入れ替える
function wipeTo(kind, paint) {
  if (!fx) {
    paint();
    return;
  }
  // 演出が出入りを受け持つので、中身には、ふわっと出る動きを付けない。
  // 入れ替えで画面の高さが変わると、先頭に寄せた位置がずれるので、四角の陰で入れ替えたあとに、寄せ直す
  // （途中で終わらせる cancelFx のときは run が空なので、寄せ直さない。すぐ入れ替える場合は mine がまだ空）
  let mine = null;
  mine = fx.playWipe($('screen'), kind, () => {
    paint(true);
    if (mine && run === mine) tvToTop();
  });
  run = mine;
  mine.done.then(() => {
    if (run === mine) run = null;
  });
}

// 場面を切り替える。文が出る前に、画面に短い演出をはさむ（どちらも1秒たらず）。
// コーナーが変わるときはモザイク、同じコーナーの中では砂嵐
function goStep(from) {
  updateNext();
  wipeTo(cornerKey(from) === cornerKey(show.steps[show.index]) ? 'snow' : 'mosaic', renderStep);
}

function showError(message) {
  play('error');
  setView(true);
  show = { steps: [{ kind: 'closing', host: message }], index: 0 };
  // アプリ自身のお知らせなので、AI の吹き出し（host）にはしない
  const wrap = el('div', undefined, 'fade');
  wrap.append(titleLine(['番組を', '作れませんでした']), el('p', message, 'notice'));
  setScreen(wrap);
  $('next').hidden = true;
}

// 番組を待つあいだの画面（試験放送の色の帯と、テレ吉の札）。待ちが長いときは、一言を替える
const WAIT_NOTE = 'できるまで、少しお待ちください。';
const WAIT_NOTE_LONG = 'すこし時間がかかっています。もうしばらく、お待ちください。';
function showWaiting() {
  show = { steps: [], index: 0 };
  $('next').hidden = true;
  setView(true);
  play('tvon');
  const bars = el('div', undefined, 'bars');
  bars.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 14; i++) bars.append(el('span'));
  const spinner = el('span', undefined, 'spinner');
  spinner.setAttribute('aria-hidden', 'true');
  const card = el('div', undefined, 'wait-card');
  card.append(spriteCanvas('テレ吉', 4, undefined, { shadow: true }), el('p', 'テレ吉が じゅんびしています', 'wait-title'), spinner, el('p', WAIT_NOTE, 'wait-note'));
  setScreen(bars, card);
  clearTimeout(waitTimer);
  waitTimer = setTimeout(() => {
    const note = document.querySelector('#screen .wait-note');
    if (note) note.textContent = WAIT_NOTE_LONG;
  }, 10_000);
}

// できていた番組が、いまの投稿から作ったものか（投稿やつぎに会う日が変わっていたら、使えない）
const isReady = () => ready !== null && ready.sent === state.posts && ready.sentDate === state.nextDate;
const READY_MESSAGE = '番組ができました。「番組をみる」を押すと、テレビで見られます。';

// 「夜7時にする」のボタンの文字と、押せるかどうかを、いまの状態に合わせる
function syncEvening() {
  const button = $('evening');
  if (waiting) {
    button.disabled = true;
    button.textContent = 'テレ吉が準備中…';
    return;
  }
  // 投稿が変わったら、できていた番組は使わない
  if (ready && !isReady()) ready = null;
  button.disabled = false;
  button.textContent = ready ? '番組をみる' : '夜7時にする';
  if (!ready && $('msg').textContent === READY_MESSAGE) $('msg').textContent = '';
}

// 届いた番組をテレビで見せる。待ち画面を見ていたなら、そのままモザイクで番組に切り替える
function watch(r, fromWaiting) {
  ready = null;
  show = { steps: r.steps, index: 0 };
  $('next').hidden = false;
  updateNext();
  if (fromWaiting) {
    play('next');
    wipeTo('mosaic', renderStep);
    tvToTop();
  } else {
    setView(true);
    play('tvon');
    renderStep();
  }
  syncEvening();
}

// うまく作れなかったとき。テレビを見ていればテレビに、投稿に戻っていれば投稿の画面に知らせる
function fail(message) {
  if ($('tv-view').hidden) {
    play('error');
    say(message);
  } else {
    showError(message);
  }
}

async function goEvening() {
  cancelVoice();
  if (state.posts.length === 0) {
    say('投稿が1件以上あると、番組を作れます。');
    return;
  }
  // 番組ができていて、投稿も変わっていなければ、作り直さずにそのまま見せる
  if (isReady()) {
    watch(ready, false);
    return;
  }
  ready = null;
  waiting = true;
  syncEvening();
  showWaiting();
  // 送った時点の投稿。待っているあいだに投稿が増減しても、番組の検査と表示はこの一覧で行う
  const sent = state.posts;
  const sentDate = state.nextDate;
  try {
    const payload = { posts: sent, ...(sentDate ? { nextDate: sentDate } : {}) };
    const res = await fetch('/api/news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // 画面が番組を待つのは最大100秒。server.mjs の CLIENT_WAIT_MS と同じ長さで、サーバーは作り直しもこの中に収める
      signal: AbortSignal.timeout(100_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      fail(typeof data?.error === 'string' ? data.error : '番組を作れませんでした。もう一度お試しください。');
      return;
    }
    // サーバーでも検査しているが、画面でも同じ検査を通してから使う
    const checked = checkNews(data, sent);
    if (!checked.ok) {
      fail('番組をうまく組み立てられませんでした。もう一度お試しください。');
      return;
    }
    const made = { steps: buildSteps(checked.news, sent, sentDate), sent, sentDate };
    waiting = false;
    if (!$('tv-view').hidden) {
      // 待ち画面を見ているので、そのまま番組に切り替える
      watch(made, true);
    } else if (made.sent === state.posts && made.sentDate === state.nextDate) {
      // 待っているあいだに「投稿にもどる」を押していたら、勝手にテレビへは戻さない。できたことだけ知らせる
      ready = made;
      play('next');
      $('msg').textContent = READY_MESSAGE;
    }
  } catch {
    fail('通信できませんでした。つながっているか確かめて、もう一度お試しください。');
  } finally {
    waiting = false;
    clearTimeout(waitTimer);
    syncEvening();
  }
}

// ---- つなぐ ----

$('send').addEventListener('click', submitPost);
$('text').addEventListener('keydown', (e) => {
  // 変換の確定の Enter では送らない（Safari は確定直後でも isComposing が false になるので、keyCode 229 も見る）
  if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) submitPost();
});
$('nick').addEventListener('input', () => {
  profile().nick = $('nick').value;
});
$('next-date').addEventListener('change', changeDate);
// 会いたい日をえらんだら、手順の3つめにチェックを付ける
$('wish-date').addEventListener('input', renderSteps);
$('wish-date').addEventListener('change', renderSteps);
$('rename-go').addEventListener('click', renameRole);
$('rename').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) renameRole();
});
$('clear').addEventListener('click', () => {
  if (state.posts.length === 0) return;
  if (!confirm('きょうの投稿を、ぜんぶ消します。よろしいですか？')) return;
  state = { posts: [], ...keep() };
  save();
  renderPosts();
});
$('evening').addEventListener('click', goEvening);
$('next').addEventListener('click', () => {
  // 演出の途中で押されたら、演出だけを終わらせて、いまの場面をすぐ見せる（場面は飛ばさない）
  if (run) {
    cancelFx();
    return;
  }
  const from = show.steps[show.index];
  show.index = show.index === show.steps.length - 1 ? 0 : show.index + 1;
  goStep(from);
  tvToTop();
  // 最後の場面では終わりの音、それ以外は鐘の音（はじめに戻るときはテレビの音）
  play(show.index === 0 ? 'tvon' : show.index === show.steps.length - 1 ? 'end' : 'next');
});
$('sound').addEventListener('click', () => {
  // 状態は、ボタンの文字だけで伝える（aria-pressed を付けると「音を出す、押されている」と逆に読まれるため）
  const off = $('sound').textContent === '音を消す';
  $('sound').textContent = off ? '音を出す' : '音を消す';
  setMuted(off);
  if (!off) play('tap');
});
$('back').addEventListener('click', () => {
  setView(false);
  say('');
});

// 音声入力。聞き取った言葉は入力欄に入れるだけで、送らない（人が文字で確かめてから「おくる」を押す）
const VOICE_ERRORS = {
  'not-allowed': 'マイクが使えません。文字で入れてください。',
  'service-not-allowed': 'マイクが使えません。文字で入れてください。',
  'no-speech': '声が聞こえませんでした。もう一度どうぞ。',
  'audio-capture': 'マイクが見つかりません。文字で入れてください。',
  'network': '音声を文字にできませんでした。文字で入れてください。',
};
let stopVoice = null;
// 聞き取りの世代。投稿や人の切り替えで聞き取りをやめたあとに届いた声は、世代が古いので捨てる
let voiceRun = 0;
function cancelVoice() {
  voiceRun++;
  stopVoice?.();
}
// 文字だけで状態を伝える（読み上げで「押されている」と二重に伝わらないように）
function setListening(on) {
  $('voice').textContent = on ? 'きくのをやめる' : '声で入れる';
}
$('voice').addEventListener('click', () => {
  if (stopVoice) {
    stopVoice();
    return;
  }
  play('tap');
  say('おはなしください…');
  const run = ++voiceRun;
  try {
    stopVoice = listen({
      onResult: (text) => {
        if (run !== voiceRun) return;
        // 入力欄の上限（200文字）に収める。改行などはここで取り除く
        const joined = [$('text').value, text].filter(Boolean).join('　').replace(/[\r\n\t]+/g, '');
        $('text').value = joined.slice(0, 200);
        say('文字にしました。まちがいがないか見てから、「おくる」を押してください。');
      },
      onError: (reason) => say(VOICE_ERRORS[reason] ?? '音声を文字にできませんでした。文字で入れてください。'),
      onEnd: () => {
        stopVoice = null;
        setListening(false);
        // 何も聞き取れずに終わったときは、「おはなしください…」を消す
        if ($('msg').textContent === 'おはなしください…') say('');
      },
    });
    setListening(true);
  } catch {
    stopVoice = null;
    say('音声入力を始められませんでした。文字で入れてください。');
  }
});
// 音声認識が使えないブラウザでは、ボタンも説明も出さない（文字だけで使える）
$('voice-box').hidden = !voiceSupported();

// つぎに会う日は、今日より前を選べないようにする（日付は端末の今日）
{
  const t = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  $('next-date').min = today;
  $('wish-date').min = today;
}
if (state.nextDate) $('next-date').value = state.nextDate;

// 障子の帯の飾り（柱時計・湯呑・みかん）。飾りなので読み上げない
for (const slot of document.querySelectorAll('[data-sprite]')) {
  slot.append(spriteCanvas(slot.dataset.sprite, Number(slot.dataset.scale) || 3, undefined, { shadow: true }));
}

renderRoles();
renderForm();
renderPosts();
if (loadNote) say(loadNote);
