// 画面の動き。投稿をためて、夜7時に /api/news で番組を作ってもらい、テレビに順に映す。
// 画面に出す文字はすべて textContent で入れる。innerHTML は使わない。
import {
  STORAGE_KEY, MAX_POSTS, TODAY_TOPICS, NEXT_TOPICS, WISH_DATE_TOPIC, HEADLINES, ANIMALS,
  DEFAULT_ROLES, cleanPosts, cleanPost, cleanDate, cleanRoles, checkNews, checkPostWords, reasonFact, loadState, serializeState,
} from './safe.js';
import { createRoomClient, parseInvite, hasInvite, SYNC_MS } from './room.js';
import { play, setMuted, hostBlips, stopBlips } from './sound.js';
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
const FIXED_WORDS = ['ひとこと', 'むかし話', 'コーナー', 'つぎに会う日', '会いたい日', '夜7時', 'かぞくニュース', 'テレ吉', 'もう一度', '見本の番組'];

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
  // 放送中の投稿（見本の番組なら見本の投稿）の名前も、箱に入れる対象にする
  const words = [...roles(), ...state.posts.flatMap((p) => [p.who, p.name ?? '']), ...(show.posts ?? []).flatMap((p) => [p.who, p.name ?? '']), ...FIXED_WORDS];
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

// 部屋（家族でつながるサーバー）とのやりとり。入っていないときは何も送らず、これまでどおり1台の中だけで動く
const rc = createRoomClient();

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
// 放送中の状態。steps は順に映す内容、index は今の位置。
// 見本の番組のときだけ、sample が true になり、posts に見本の投稿が入る（本物の番組では持たない）
let show = { steps: [], index: 0 };
// いま動いている画面の演出（なければ null）
let run = null;
// 番組ができるのを待っている最中か
let waiting = false;
// 届いたけれど、まだテレビで見ていない番組（待っているあいだに「投稿にもどる」を押したときなど）。なければ null
let ready = null;
// 待ちが長いときに、待ち画面の一言を替えるためのタイマー
let waitTimer = 0;

// 下の案内（「おくる」ボタンの近く）。出すときは上の案内を片づける（古い案内と並んで出ないように）
function say(message) {
  clearTop();
  $('msg').textContent = message;
  // 操作した場所から離れた所にメッセージが出るので、見える位置まで画面を動かす
  if (message) $('msg').scrollIntoView({ block: 'nearest' });
}

// 上の案内（よびかたのボタンと「夜7時にする」のすぐ下）。おくったあとや、夜7時にできないときに出す。
// 下の案内は片づける。画面は動かさない（押したボタンの近くに出るので、そのまま見える）
function sayTop(message) {
  $('msg').textContent = '';
  $('top-msg').textContent = message;
  $('top-msg').hidden = !message;
}
function clearTop() {
  $('top-msg').textContent = '';
  $('top-msg').hidden = true;
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

// ---- 文字数の表示（ひとこと・ニックネーム・よびかた）----

// 数え方は、サーバーの検査（safe.js の optionalText）と同じ .length（UTF-16 の数。絵文字は2字に数える）。
// 数え方を変えるときは、ここだけ直す
const countOf = (text) => text.length;

// 入力欄ごとの上限と、数える文字列。上限は safe.js の検査と同じ（ひとこと200・ニックネーム20・よびかた20）。
// ひとこと・ニックネームは打ったまま、よびかたは前後の空白をのぞいた形で数える（送るときの形と同じ）。
// advice は、上限をこえたときに添える一言
const LIMITS = {
  text: { max: 200, label: 'ひとこと', read: () => $('text').value, advice: 'けずってから送ってください。' },
  nick: { max: 20, label: 'ニックネーム', read: () => $('nick').value, advice: 'けずってから送ってください。' },
  rename: { max: 20, label: 'よびかた', read: () => $('rename').value.trim(), advice: 'けずってから「なまえをかえる」を押してください。' },
};
// 上限をこえている字数（こえていなければ 0）
const overBy = (id) => Math.max(0, countOf(LIMITS[id].read()) - LIMITS[id].max);

// 文字を、上限の字数（countOf で数えた数）に収まる所までで切る。
// Array.from で1字ずつに分けてから数えるので、絵文字のような2つ組の文字（サロゲートペア）を途中で割って、壊れた字を残すことがない
function clipText(text, max) {
  let out = '';
  let used = 0;
  for (const ch of Array.from(text)) {
    used += countOf(ch);
    if (used > max) break;
    out += ch;
  }
  return out;
}

// 入力欄の下の文字数の表示を、いまの入力に合わせる。
// 残りの数が前と同じときは触らない（読み上げが、同じ案内をくり返さないように）
function showCount(id) {
  const box = $(`${id}-count`);
  const rest = LIMITS[id].max - countOf(LIMITS[id].read());
  if (box.dataset.rest === String(rest)) return;
  box.dataset.rest = String(rest);
  const main = box.querySelector('.count-main');
  const over = box.querySelector('.count-over');
  if (rest >= 0) {
    main.replaceChildren('あと ', el('span', String(rest), 'num'), ' 字');
    over.replaceChildren();
  } else {
    main.replaceChildren();
    over.replaceChildren(el('span', String(-rest), 'num'), `字 多いです。${LIMITS[id].advice}`);
  }
}
const showCounts = () => Object.keys(LIMITS).forEach(showCount);

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
  // 選んだら、札（「いつ会いたい」なら日付）の欄が見えるように、画面を動かす。動きを減らす設定では、すぐ動かす
  if (v) {
    const box = $('cards-box').hidden ? $('wish-date-box') : $('cards-box');
    box.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
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
  // 人を切り替えたときや、送ったあとに入力欄が空になったときも、文字数を合わせる
  showCounts();
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
  // 字数が上限をこえているあいだは変えない。入力した文字は消さず、何字多いかを伝える
  if (overBy('rename') > 0) {
    play('error');
    say(`よびかたが ${overBy('rename')}字 多いので、かえられません。けずってから、もう一度「なまえをかえる」を押してください。`);
    return;
  }
  if (name === old) {
    $('rename').value = old;
    showCount('rename');
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
  dropUndo();
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

// 直前に消した投稿（元に戻すための控え）: { post, index, timer }。なければ null。
// 戻せるのは、直前に消した1件だけ。ほかの操作（送る・名前を変える・ぜんぶ消す・別の投稿を消す）をしたら捨てる
let undo = null;
const UNDO_MS = 8000;
function dropUndo() {
  if (!undo) return;
  clearTimeout(undo.timer);
  undo = null;
}

// 消した場所に出す「もとにもどす」の行。読み上げでは、ボタンに「だれの投稿を消したか」を添える
function undoItem() {
  const li = el('li', undefined, 'undo');
  const body = el('span', undefined, 'body');
  body.id = 'undo-text';
  body.append(nw(undo.post.who), 'の投稿を消しました。');
  const back = el('button', 'もとにもどす');
  back.type = 'button';
  back.setAttribute('aria-describedby', 'undo-text');
  back.addEventListener('click', () => {
    play('tap');
    restorePost();
  });
  li.append(body, back);
  return li;
}

// 時間が来たら、「もとにもどす」の行を片づける（ボタンにフォーカスがあったときは、見出しへ移す）
function expireUndo() {
  const hadFocus = $('posts').querySelector('.undo')?.contains(document.activeElement);
  undo = null;
  renderPosts();
  if (hadFocus) $('list-title').focus({ preventScroll: true });
}

// 消した投稿を、もとの位置にもどして、保存し直す
function restorePost() {
  if (!undo) return;
  const { post, index } = undo;
  dropUndo();
  const posts = [...state.posts];
  posts.splice(Math.min(index, posts.length), 0, post);
  state.posts = posts;
  save();
  renderPosts();
  $('list-title').focus({ preventScroll: true });
}

// 投稿1件の本文（選んだ言葉は、語の途中で折れない箱に入れる。本人が書いたひとことは、そのまま流す）
function postBody(p) {
  const body = el('span', undefined, 'body');
  const wish = p.wishDate ? monthDay(p.wishDate) : '';
  nwJoin(body, [p.animal ? `【${p.animal}】` : '', p.who, p.topic, p.card, wish, p.headline].filter(Boolean));
  if (p.text) body.append('　', p.text);
  return body;
}

function renderPosts() {
  const list = $('posts');
  list.replaceChildren();
  if (state.posts.every((p) => roomOn() && !rc.isMine(p.id)) && !undo) {
    const empty = el('li');
    empty.append(nw('きょうの投稿は、'), nw('ここに'), nw('ならびます。'));
    list.append(empty);
  }
  state.posts.forEach((p, i) => {
    // 消した投稿の場所に、「もとにもどす」の行を出す
    if (undo && undo.index === i) list.append(undoItem());
    // 部屋に入っているときは、この端末から送った投稿だけを出す（ほかの人の投稿は、数だけ）
    if (roomOn() && !rc.isMine(p.id)) return;
    const li = el('li');
    const body = postBody(p);
    // まだ部屋に送れていない投稿には、そう添える（つながったら、自動で送る）
    if (roomOn() && rc.isPending(p.id)) body.append('　', nw('（まだ送れていません）'));
    const del = el('button', '消す');
    del.type = 'button';
    // 「消す」が何件も並ぶので、読み上げでどの投稿か分かるように名前を付ける
    del.setAttribute('aria-label', `${p.who}の「${p.card ?? (p.wishDate ? monthDay(p.wishDate) : p.topic)}」の投稿を消す`);
    del.addEventListener('click', () => {
      // 部屋の投稿は、部屋からも消す（消したあとは元に戻せない）
      if (roomOn()) {
        removeRoomPost(p);
        return;
      }
      // 押したらすぐ消して保存する。確認の窓は出さず、数秒のあいだ「もとにもどす」を出す
      dropUndo();
      const index = state.posts.findIndex((x) => x.id === p.id);
      state.posts = state.posts.filter((x) => x.id !== p.id);
      save();
      undo = { post: p, index, timer: setTimeout(expireUndo, UNDO_MS) };
      renderPosts();
      // 消したボタンは無くなるので、フォーカスを「もとにもどす」へ移す（画面は動かさない）
      $('posts').querySelector('.undo button')?.focus({ preventScroll: true });
    });
    // 動物を選んでいれば、左にドット絵を置く（飾りなので読み上げない）
    if (p.animal) li.append(spriteCanvas(p.animal, 3, undefined, { shadow: true }));
    li.append(body, del);
    list.append(li);
  });
  // いちばん後ろの投稿を消したときは、一覧の終わりに出す
  if (undo && undo.index >= state.posts.length) list.append(undoItem());
  // 投稿が変わったので、できていた番組が使えるかどうかを、ボタンに反映する
  syncEvening();
  renderRoomCount();
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
  // 字数が上限をこえているあいだは送らない。入力欄の文字は消さず、何字多いかを伝える
  // （入力欄の maxlength で黙って切ると、変換で確定した語が途中で切れるため、入力はそのまま受けている）
  const tooLong = ['nick', 'text'].filter((id) => overBy(id) > 0).map((id) => `${LIMITS[id].label}が ${overBy(id)}字`);
  if (tooLong.length > 0) {
    play('error');
    say(`${tooLong.join('、')} 多いので、送れません。けずってから、もう一度おくってください。`);
    return;
  }
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
  if (roomOn()) {
    submitRoomPost(post);
    return;
  }
  const r = cleanPosts({ posts: [...state.posts, post], nextDate: state.nextDate });
  if (!r.ok) {
    play('error');
    say(r.error);
    return;
  }
  dropUndo();
  state = { posts: r.posts, ...keep() };
  const saved = save();
  finishSend(post, saved ? 'おくりました。つぎの人に切り替えて、送れます。' : 'おくりました。ただし、この端末には保存できませんでした。画面を閉じると消えます。');
}

// 送れたあとの画面の更新（1台のときも、部屋のときも同じ）
function finishSend(post, message) {
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
  sayTop(message);
  renderForm();
  renderPosts();
  returnToTop(Boolean(post.animal));
}

// 送ったあと、画面を先頭（よびかたのボタンが見える所）へ戻す。動物がはずむ（.hop）あいだは少し待ち、見せてから戻す。
// そのあいだに本人が画面を動かしていたり、放送の画面に移っていたりしたら、戻さない
const HOP_WAIT_MS = 800;
function returnToTop(hasHop) {
  const y = window.scrollY;
  const go = () => {
    if ($('post-view').hidden || Math.abs(window.scrollY - y) >= 8) return;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };
  if (hasHop && !prefersReducedMotion()) setTimeout(go, HOP_WAIT_MS);
  else go();
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

// onAir が true ならテレビ、false なら投稿の画面（shelf が true のときは、本棚の画面）
function setView(onAir, shelf = false) {
  cancelFx();
  // 画面を替えるときは、前の場面のテレ吉の声を残さない
  stopBlips();
  $('post-view').hidden = onAir || shelf;
  $('list-view').hidden = onAir || shelf;
  $('date-view').hidden = onAir || shelf;
  $('shelf-view').hidden = onAir || !shelf;
  $('tv-view').hidden = !onAir;
  $('evening').hidden = onAir;
  $('room-bar').hidden = onAir;
  if (onAir) {
    $('back').textContent = '投稿にもどる';
    setTvMsg('');
  }
  // 夜7時: 部屋を暗くして、テレビだけを光らせる
  document.body.classList.toggle('night', onAir);
  // 押したボタンは隠れるので、フォーカスを新しい画面に移す（キーボードや読み上げの人が迷子にならないように）。
  // テレビのほうは、フォーカスで勝手に動かさず、tvToTop で先頭へ寄せる
  if (onAir) {
    clearTop();
    $('screen').focus({ preventScroll: true });
    tvToTop();
  } else if (shelf) {
    $('shelf-title').focus();
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

// 番組表の補足の見出し。値は投稿の言葉そのもの（会いたい日だけ「11月23日」の形に直して出す）
const FACT_LABELS = { topic: 'お題', card: '札', headline: '見出し', wishDate: '会いたい日' };
// 出る人がこの件数以上の番組では、番組表に絵を付けず、名前を「、」でつないで流す（縦に長くなりすぎないように）
const COMPACT_FROM = 11;

// 番組表の場面のデータ。出る人の並びは、投稿からコードだけで作る（Claude の返事から名前を取らない）。
// 特集名（feature）とわけ（lineup）は、checkNews が「一覧にある言葉で、投稿の事実と合う」と確かめたものだけが入っている。
// どちらも無い番組では、名前の並びだけの番組表になる
function tableStep(news, byId) {
  const reasons = new Map((news.lineup ?? []).map((l) => [l.corner, l.reason]));
  // 番組に出てくるコーナーを、出てくる順に
  const corners = [...new Set(news.segments.map((s) => s.corner))].map((corner) => {
    const cornerPosts = news.segments.filter((s) => s.corner === corner).map((s) => byId.get(s.from));
    const reason = reasons.get(corner);
    // わけの補足（「お題：そら」など）は、検査と同じ reasonFact で出す。合わなければ、わけも出さない
    const fact = reason ? reasonFact(reason, corner, cornerPosts) : null;
    return {
      corner,
      reason: fact ? reason : undefined,
      fact: fact?.kind ? fact : undefined,
      members: cornerPosts.map((p) => ({ who: p.who, name: p.name, animal: p.animal })),
    };
  });
  return { kind: 'table', feature: news.feature, corners };
}

// 番組を、画面に映す順番の一覧にする。本文は投稿のほうから取り、Claude の返事からは取らない。
// はじめの次に、今夜の番組表を1場面入れる
function buildSteps(news, posts, nextDate) {
  const byId = new Map(posts.map((p) => [p.id, p]));
  return [
    { kind: 'opening', host: news.opening },
    tableStep(news, byId),
    ...news.segments.map((s) => ({ kind: 'segment', corner: s.corner, host: s.host, post: byId.get(s.from), nextDate })),
    { kind: 'closing', host: news.closing },
  ];
}

// 司会「テレ吉」の札。つなぎの言葉と、番組表の特集名・わけに付けて、家族の言葉と見分けられるようにする。
// 見た目の文字は「テレ吉」。読み上げでは「AI が考えた言葉」だと伝える（AI の表示は、テレビの下の注記にも常に出している）。
// 見本の番組では「テレ吉（見本）」にして、いまの AI が考えた本物の言葉と取り違えないようにする。
// class 名の ai-chip は、はじめ「AI」の札だった名残（effects.js も同じ名前で読むので、変えない）
function hostChip() {
  const chip = el('span', undefined, show.sample ? 'ai-chip sample-chip' : 'ai-chip');
  // 絵として読み上げさせて、見た目の文字のかわりに、読み上げ用の文を伝える
  chip.setAttribute('role', 'img');
  if (show.sample) {
    chip.setAttribute('aria-label', 'テレ吉（AI が考えた見本の言葉）');
    // 札が行より長い狭い画面では、「テレ吉」と「（見本）」の切れ目で折れる。「（見本）」は小さめにして、札を細くする
    chip.append(nw('テレ吉'), el('span', '（見本）', 'nw tail'));
  } else {
    chip.setAttribute('aria-label', 'テレ吉（AI が考えた言葉）');
    chip.append('テレ吉');
  }
  return chip;
}

// 見本の番組のすべての場面の、いちばん上に出す帯。画面の中に置くので、テレビだけを切り取って録画しても残る
function sampleBand() {
  const band = el('p', undefined, 'sample-band');
  // 語のまとまりごとに箱へ入れる（狭い画面でも、まとまりの切れ目で折れる）
  nwJoin(band, ['見本の番組です', '（きょうの投稿', 'ではありません）'], '');
  return band;
}

// 本棚から流している番組の、すべての場面のいちばん上に出す帯（再放送であることと、端末から戻した番組であること）。
// 画面の中に置くので、テレビだけを切り取って録画しても残る
function airBand(rerun) {
  const band = el('p', undefined, 'air-band');
  // 語のまとまりごとに箱へ入れる（狭い画面でも、日付の途中では折れない）
  nwJoin(band, ['再放送です', `（${monthDay(rerun.date)}`, 'の番組）'], '');
  if (rerun.restored) {
    band.append('　');
    nwJoin(band, ['端末から戻した', '番組です'], '');
  }
  return band;
}

// テレビの下の注記を、いま映しているものに合わせる（見本の番組のときは、見本用の注記）
function syncSlip() {
  $('slip').hidden = Boolean(show.sample);
  $('slip-sample').hidden = !show.sample;
}

// 今夜の番組表の中身（特集名と、コーナーごとのわけ・出る人）。文字はすべて textContent で入れる。
// 特集名とわけは AI が考えたものなので、「テレ吉」の札を付ける。コーナー名・出る人・補足は、コードが投稿から作ったものなので、札は付けない
function lineupNodes(step) {
  const nodes = [];
  if (step.feature) {
    // 札と特集名を1つの枠にまとめて、テレ吉（AI）が選んだのは特集名だと分かるようにする
    const box = el('div', undefined, 'feature');
    const label = el('p', undefined, 'feature-label');
    label.append(hostChip(), nw('今夜の特集'));
    const name = el('p', undefined, 'feature-name');
    name.append(nw(step.feature));
    box.append(label, name);
    nodes.push(box);
  }
  // 出る人が多い番組では、絵を付けず、名前をつなげて出す
  const compact = step.corners.reduce((n, c) => n + c.members.length, 0) >= COMPACT_FROM;
  // 出る人の名前。ニックネームがあれば「（　）」で添える（箱は、よびかたとニックネームで別々にする）
  const nameParts = (m) => [m.who, m.name ? `（${m.name}）` : ''].filter(Boolean);
  const list = el('ul', undefined, 'lineup');
  list.setAttribute('role', 'list');
  for (const c of step.corners) {
    const item = el('li', undefined, 'lineup-item');
    const title = el('p', undefined, 'lineup-title');
    title.append(...(CORNER_TITLES[c.corner] ?? []).map(nw));
    item.append(title);
    if (c.reason) {
      const why = el('p', undefined, 'lineup-why');
      // わけの文は1つの箱に入れる。札と同じ行に入りきらないときは、文ごと次の行へ移る（文節の途中で折れない）
      why.append(hostChip(), nw(c.reason));
      item.append(why);
    }
    if (c.fact) {
      const value = c.fact.kind === 'wishDate' ? monthDay(c.fact.value) : c.fact.value;
      const fact = el('p', undefined, 'lineup-fact');
      fact.append(nw(`${FACT_LABELS[c.fact.kind]}：${value}`));
      item.append(fact);
    }
    // 出る人は、出る順のまま。番号や件数は付けない（順位に見えないように）
    if (compact) {
      // 「、」は直前の名前の箱に入れる（「、」が行の頭に来ないように）
      const names = el('p', undefined, 'lineup-names');
      const last = c.members.length - 1;
      nwJoin(names, c.members.map((m, i) => nameParts(m).join('') + (i < last ? '、' : '')), '');
      item.append(names);
    } else {
      const members = el('ul', undefined, 'lineup-members');
      members.setAttribute('role', 'list');
      for (const m of c.members) {
        const li = el('li', undefined, 'lineup-who');
        // 動物の絵は飾りなので読み上げない。動物を選んでいない人は、同じ幅のあきを置いて、名前の左をそろえる
        if (m.animal) {
          li.append(spriteCanvas(m.animal, 2, undefined, { shadow: true }));
        } else {
          const blank = el('span', undefined, 'blank');
          blank.setAttribute('aria-hidden', 'true');
          li.append(blank);
        }
        const text = el('span', undefined, 'lineup-who-text');
        nwJoin(text, nameParts(m), '');
        li.append(text);
        members.append(li);
      }
      item.append(members);
    }
    list.append(item);
  }
  nodes.push(list);
  return nodes;
}

// 司会のつなぎの言葉。テレ吉（飾り）の横に吹き出しを出し、中に「テレ吉」の札を入れる（家族の短冊と見分けるため）
function hostLine(text) {
  const row = el('div', undefined, 'host-row');
  const bubble = el('p', undefined, 'host');
  // 文字は元のまま。よびかたなどの語だけ、途中で折れない箱に入れる
  bubble.append(hostChip(), ...guard(text));
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
  // 画面の中身を替えるときに、下の注記も合わせる（show は、これを呼ぶ前に新しいものに替わっている）
  syncSlip();
}

// いまの場面を、画面にすぐ描く。still が true のときは、中身がふわっと出る動きを付けない（演出の中で入れ替えるとき）
function renderStep(still = false) {
  const step = show.steps[show.index];
  const wrap = el('div', undefined, still ? 'fade still' : 'fade');
  // 見本の番組は、どの場面にも帯を付ける
  if (show.sample) wrap.append(sampleBand());
  if (show.rerun) wrap.append(airBand(show.rerun));
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
  } else if (step.kind === 'table') {
    // 番組表はテレ吉のせりふではないので、司会の吹き出しは付けない
    wrap.append(titleLine(['今夜の', '番組表']), ...lineupNodes(step));
  } else {
    wrap.append(titleLine(step.kind === 'opening' ? ['夜7時の', 'かぞくニュース'] : ['おしまい']), hostLine(step.host));
  }
  setScreen(wrap);
  // 吹き出しが出る場面だけ、テレ吉の声を鳴らす（番組表は、鳴らさずに前の声だけ止める）。文字は一括で出すので、出た時に合わせて鳴らし始める
  if (step.kind === 'table') stopBlips();
  else hostBlips(step.host);
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

// うまく作れなかった画面。見出し（何が起きたか）と本文（理由・投稿が無事なこと・次にすること）を分けて出す。
// サーバーの文の頭が見出しと同じ言葉のときは、重ねて出さない
const FAIL_HEAD = '番組を作れませんでした。';
function showError(message) {
  play('error');
  setView(true);
  show = { steps: [{ kind: 'closing', host: message }], index: 0 };
  const reason = message.startsWith(FAIL_HEAD) ? message.slice(FAIL_HEAD.length) : message;
  // アプリ自身のお知らせなので、AI の吹き出し（host）にはしない
  const wrap = el('div', undefined, 'fade');
  // この題字には ChanomaDot に無い字が入るので、題字の書体は使わない（.plain）
  const failTitle = titleLine(['番組を', '作れませんでした']);
  failTitle.classList.add('plain');
  wrap.append(failTitle);
  if (reason) {
    const why = el('p', undefined, 'notice');
    why.append(...guard(reason));
    wrap.append(why);
  }
  const next = el('p', undefined, 'notice');
  nwJoin(next, ['投稿は', '消えていません。', '「もう一度つくる」', 'を押してください。'], '');
  wrap.append(next);
  // 番組が作れなくても、番組の流れを見られるように、見本の番組への入口を出す。自動では流さず、押したときだけ流す。
  // 下の帯（「もう一度つくる」「投稿にもどる」）には足さず、画面の中に置く
  const alt = el('p', undefined, 'notice');
  alt.append(...guard('かわりに、見本の番組を見ることもできます。'));
  const go = el('button', '見本の番組をみる', 'sample-go');
  go.type = 'button';
  // 見本を読み込めなかったときの知らせは、ボタンの下に出す
  const goFail = el('p', undefined, 'notice');
  goFail.hidden = true;
  go.addEventListener('click', () => {
    play('tap');
    goFail.hidden = true;
    watchSample((text) => {
      goFail.textContent = text;
      goFail.hidden = false;
    });
  });
  wrap.append(alt, go, goFail);
  setScreen(wrap);
  $('next').hidden = true;
  // 押すと、いまの投稿で、もう一度番組を頼む（回数の上限はサーバーが見ている）
  $('retry').hidden = false;
  renderLate();
}

// 番組を待つあいだの画面（試験放送の色の帯と、テレ吉の札）。待ちが長いときは、一言を替える
const WAIT_NOTE = 'できるまで、少しお待ちください。';
const WAIT_NOTE_LONG = 'すこし時間がかかっています。もうしばらく、お待ちください。';
function showWaiting() {
  // 演出の最中なら、先に終わらせる（いまの場面の入れ替えまで済ませる）。表示を替える前にしないと、
  // 空にした show を使って入れ替えようとして、例外で「準備中」のまま固まる
  cancelFx();
  show = { steps: [], index: 0 };
  $('next').hidden = true;
  $('retry').hidden = true;
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
  // 本物の番組を待っているあいだは、見本のボタンも押せない（届いた番組と見本が入れ替わってしまうため）
  $('sample').disabled = waiting;
  if (waiting) {
    button.disabled = true;
    button.textContent = 'テレ吉が準備中…';
    return;
  }
  // 投稿が変わったら、できていた番組は使わない（部屋のときは、部屋にきょうの番組があるかどうか）
  if (!roomOn() && ready && !isReady()) ready = null;
  button.disabled = false;
  const has = roomOn() ? Boolean(rc.todayProgram()) : Boolean(ready);
  button.textContent = has ? '番組をみる' : '夜7時にする';
  if (!has && $('msg').textContent === READY_MESSAGE) $('msg').textContent = '';
}

// 届いた番組をテレビで見せる。待ち画面を見ていたなら、そのままモザイクで番組に切り替える
// 部屋の番組（r.room）と、本棚の再放送（r.rerun）は、番組の投稿の写し（r.posts）を持つ。名前を折れない箱に入れるのに使う
function watch(r, fromWaiting) {
  ready = null;
  show = { steps: r.steps, index: 0, ...(r.posts ? { posts: r.posts } : {}), ...(r.room ? { room: true } : {}), ...(r.rerun ? { rerun: r.rerun } : {}) };
  $('next').hidden = false;
  $('retry').hidden = true;
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
  if (r.rerun) $('back').textContent = '本棚にもどる';
  setTvMsg(r.note ?? '');
  renderLate();
  syncEvening();
}

// 投稿の一覧の下にある「見本の番組をみる」の下の案内（見本を読み込めなかったときなど）
function sampleMsg(message) {
  $('sample-msg').textContent = message;
  $('sample-msg').hidden = !message;
}

// 見本の番組を読み込んで、テレビで流す。読み込めなかったときは、押した場所の近くに出す知らせ（onFail）で伝える。
// 家族の投稿（state.posts）・保存・できていた番組（ready）には触らない。
// 本物の番組を待っているあいだは流さない（届いた番組と入れ替わってしまうため）
async function watchSample(onFail) {
  if (waiting) return;
  cancelVoice();
  let sample;
  try {
    sample = await import('./sample.js');
  } catch {
    onFail('見本の番組を読み込めませんでした。');
    return;
  }
  // 本物と同じ決まりに合っていることを、毎回確かめてから使う
  const cleaned = cleanPosts({ posts: sample.SAMPLE_POSTS });
  const checked = cleaned.ok ? checkNews(sample.SAMPLE_NEWS, cleaned.posts) : null;
  if (!checked?.ok) {
    onFail('見本の番組を用意できませんでした。');
    return;
  }
  // 読み込んでいるあいだに本物の番組を頼まれていたら、そちらを優先する
  if (waiting) return;
  // 見本には、つぎに会う日（nextDate）がないので、「決まったらここに出ます」の行になる
  show = { steps: buildSteps(checked.news, cleaned.posts), index: 0, sample: true, posts: cleaned.posts };
  sampleMsg('');
  $('next').hidden = false;
  $('retry').hidden = true;
  updateNext();
  setView(true);
  play('tvon');
  renderStep();
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
  if (roomOn()) return goRoomEvening();
  if (state.posts.length === 0) {
    // 押したボタンの近く（上）に、読める大きさで出す
    sayTop('投稿が1件以上あると、番組を作れます。');
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
    // この番組は、いまの投稿から作ったものか（待っているあいだに投稿やつぎに会う日が変わっていたら、使わない）
    const current = made.sent === state.posts && made.sentDate === state.nextDate;
    if (!$('tv-view').hidden) {
      if (current) {
        // 待ち画面を見ているので、そのまま番組に切り替える
        watch(made, true);
      } else {
        // 古い番組は映さない。待ち画面のまま固まらないよう、やり直せる失敗の画面にする
        fail('できた番組は、いまの投稿とは別のものでした。');
      }
    } else if (current) {
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

// ---- 部屋（家族でつながる） ----
// 部屋に入っていないときは、ここの関数は何も送らない。入っているときだけ、投稿・番組・本棚を部屋とそろえる。
// 部屋のコードは、画面にも記録にも出さない（コードを知っている人は、だれでも入れるため）

const roomOn = () => rc.inRoom();
// きょうの部屋の投稿の数（サーバーの数と、まだ送れていない数）。人の名前や、だれが読んだかは持たない
let roomCount = 0;
// 部屋とのつながり: 'ok'・'offline'（つながっていない）
let roomStatus = 'ok';
// 「部屋に入る」の入力欄を開いているか
let joinOpen = false;
// 投稿を部屋へ送っている最中か（二重に送らないため）
let sending = false;

// 部屋の帯の下に出す案内
function roomSay(message) {
  $('room-msg').textContent = message;
  $('room-msg').hidden = !message;
  if (message) $('room-link').hidden = true;
}

// 「2026年11月3日」の形にする
function fullDate(dateText) {
  const [y, m, d] = dateText.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

// テレビの下の案内（きょうの番組はもうできています、など）
function setTvMsg(text) {
  $('tv-msg').textContent = text;
  $('tv-msg').hidden = !text;
}

// 部屋の帯を、いまの状態に合わせる
function renderRoom() {
  const inRoom = roomOn();
  const lost = inRoom && rc.isLost();
  let status;
  if (!inRoom) status = rc.unsupported() || 'いまは、この端末の中だけで使っています。家族とつなぐときは、「部屋に入る」を押してください。';
  else if (lost) status = '部屋が、サーバーに見つかりません。新しい部屋を作って、招待を送り直してください。投稿と本棚は、この端末に残っています。';
  else if (roomStatus === 'offline') status = '部屋に入っています。いまはつながっていません。つながると、自動でそろえます。';
  else status = '部屋に入っています。家族の投稿と番組は、部屋でそろいます。';
  $('room-status').textContent = status;
  $('room-share').hidden = !inRoom || lost;
  $('room-leave').hidden = !inRoom;
  $('room-join-box').hidden = !joinOpen;
  $('room-join-open').setAttribute('aria-expanded', String(joinOpen));
  // 部屋のことばの行き先は、入る前の画面と、入っているあいだ、いつも出す
  $('room-notice').hidden = !inRoom && !joinOpen;
  // 部屋の投稿は、1件ずつ消す（まとめて消すと、部屋とこの端末の数が食い違うため）
  $('clear').hidden = inRoom;
}

// 「きょうの投稿 n 件」。数だけ出す（だれの投稿か、だれが読んだかは出さない）
function renderRoomCount() {
  const box = $('room-count');
  box.hidden = !roomOn();
  if (!roomOn()) return;
  box.replaceChildren('きょうの投稿 ', el('span', String(roomCount), 'num'), ' 件');
  const unsent = rc.pendingCount();
  if (unsent > 0) box.append('　', nw(`（${unsent}件は、まだ送れていません）`));
}

// 番組のあとに届いた一言。番組には混ぜず、テレビの下に並べる
function renderLate() {
  const posts = show.room && !$('tv-view').hidden ? rc.latePosts() : [];
  $('late').hidden = posts.length === 0;
  $('late-posts').replaceChildren(...posts.map((p) => {
    const li = el('li');
    if (p.animal) li.append(spriteCanvas(p.animal, 3, undefined, { shadow: true }));
    li.append(postBody(p));
    return li;
  }));
}

// 禁止の言葉で断られたとき。本文は消さず、理由を伝える
const bannedMessage = (reason) => `この言葉は使えません。${typeof reason === 'string' && reason.length <= 60 ? `理由：${reason}。` : ''}ひとことは消していません。書き直してから、もう一度おくってください。`;

// 投稿を部屋に送る。圏外などで送れなかったときは、端末に持って、つながったら送る
async function submitRoomPost(post) {
  if (sending) return;
  const clean = cleanPost(post);
  if (!clean.ok) {
    play('error');
    say(clean.error);
    return;
  }
  // サーバーでも同じ検査をするが、送る前に止めたほうが早く伝えられる
  const words = checkPostWords(clean.post);
  if (!words.ok) {
    play('error');
    say(bannedMessage(words.reason));
    return;
  }
  if (roomCount >= MAX_POSTS) {
    play('error');
    say(`きょうは${MAX_POSTS}件までです。`);
    return;
  }
  sending = true;
  $('send').disabled = true;
  try {
    const res = await rc.post(clean.post);
    if (!roomOn()) return;
    if (!res.ok) {
      play('error');
      say(res.reason ? bannedMessage(res.reason) : res.error);
      if (res.lost) applySync({ ok: false, lost: true });
      return;
    }
    // この端末にも残す（消すときと、部屋を出たあとのため）
    dropUndo();
    state = { posts: [...state.posts, clean.post], ...keep() };
    const saved = save();
    roomCount += 1;
    finishSend(clean.post, res.queued
      ? 'おくりました。いまはつながっていないので、つながったら部屋に送ります。'
      : `おくりました。部屋に届きました。${saved ? 'つぎの人に切り替えて、送れます。' : 'ただし、この端末には保存できませんでした。画面を閉じると消えます。'}`);
    syncRoom();
  } finally {
    sending = false;
    $('send').disabled = false;
  }
}

// 自分の投稿を、部屋からも消す
async function removeRoomPost(p) {
  play('tap');
  const r = await rc.remove(p.id);
  if (!r.ok) {
    play('error');
    say(r.error);
    return;
  }
  dropUndo();
  state = { posts: state.posts.filter((x) => x.id !== p.id), ...keep() };
  save();
  roomCount = Math.max(0, roomCount - 1);
  renderPosts();
  say('部屋の投稿を消しました。');
  syncRoom();
}

// 部屋とそろえる（新しい投稿を取り、まだ送れていない投稿を送り、番組のようすを知る）
async function syncRoom() {
  if (!roomOn() || rc.isLost()) return;
  const r = await rc.sync();
  if (!roomOn()) return;
  applySync(r);
  if (!r.ok) return;
  // 部屋に入ったあとの最初の1回だけ、本棚を持ち寄る（2回目からは、何もしない）
  const e = await rc.exchange();
  if (e.ok && e.received > 0 && roomOn()) {
    roomSay(`ほかの端末から、${e.received}本の番組が本棚に戻りました。`);
    if (!$('shelf-view').hidden) renderShelf();
  }
}

// そろえた結果を、画面に映す
function applySync(r) {
  if (!r) return;
  // 送れなかった投稿（断られたもの）と、前の日の投稿は、この端末の一覧からも外す
  const gone = new Set([...(r.goneIds ?? []), ...(r.dropped ?? []).map((d) => d.id)]);
  if (gone.size > 0) {
    state = { posts: state.posts.filter((p) => !gone.has(p.id)), ...keep() };
    save();
    renderPosts();
  }
  if (r.dropped?.length > 0) roomSay(`${r.dropped.length}件の投稿は、部屋に送れませんでした。${r.dropped[0].error ?? ''}`);
  if (r.ok) {
    roomStatus = 'ok';
    roomCount = r.count;
  } else if (r.lost) {
    // 新しい部屋を作れるように、入力欄を開く
    joinOpen = true;
  } else if (r.offline) {
    roomStatus = 'offline';
  }
  if (r.badProgram) roomSay('届いた番組が決まりに合わなかったので、使いませんでした。');
  renderRoom();
  renderRoomCount();
  renderLate();
  syncEvening();
}

// 画面が見えているあいだ、20秒ごとに部屋とそろえる
let syncTimer = 0;
function stopSync() {
  clearInterval(syncTimer);
  syncTimer = 0;
}
function startSync() {
  stopSync();
  if (!roomOn()) return;
  syncRoom();
  syncTimer = setInterval(() => {
    if (document.visibilityState === 'visible') syncRoom();
  }, SYNC_MS);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncRoom();
});

// 部屋に入った・作った・出たあとに、画面を合わせて、そろえ直す
function onRoomChanged() {
  ready = null;
  roomCount = 0;
  roomStatus = 'ok';
  joinOpen = false;
  roomSay('');
  renderRoom();
  renderPosts();
  startSync();
}

const JOIN_ASK = 'この部屋に入りますか？\nこの部屋のことばは、ちゃのまのサーバーと Claude に送られます。投稿は翌朝に消えます。';
const SWITCH_ASK = 'この部屋に入りますか？（いまの部屋の投稿と本棚は、この端末に残ります）';

// コードの部屋に入る。ask が true のときは、確かめてから入る（確かめる前は、何も送らない）
async function joinRoom(code, ask) {
  if (code === rc.code()) return { ok: true, same: true };
  if (ask && !confirm(rc.inRoom() ? SWITCH_ASK : JOIN_ASK)) return { ok: false, cancelled: true };
  const r = await rc.enter(code);
  if (r.ok) onRoomChanged();
  return r;
}

// 招待リンク（#r=コード）で開いたとき。確かめてから入り、入ったあとは URL から #r= を消す
function clearInviteHash() {
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    // 消せなくても、画面は動かす
  }
}
async function handleInvite() {
  if (!hasInvite(location.hash)) return;
  const code = parseInvite(location.hash);
  // 確かめる前に、コードを URL に残さない（履歴に残るため）。コードはこの関数の中だけで持つ
  clearInviteHash();
  if (!code) {
    roomSay('招待のリンクの形が正しくありません。もう一度、送ってもらってください。');
    return;
  }
  const reason = rc.unsupported();
  if (reason) {
    roomSay(reason);
    return;
  }
  const r = await joinRoom(code, true);
  if (r.ok && !r.same) roomSay('部屋に入りました。');
  else if (!r.ok && !r.cancelled) roomSay(r.error);
}

// ---- 部屋の夜7時 ----

// 部屋の番組をテレビで流す。made が false のときは、すでにあった番組なので、そう伝える
function showRoomProgram(program, { made, fromWaiting }) {
  const steps = buildSteps(program.news, program.posts, program.nextDate);
  watch({ steps, posts: program.posts, room: true, note: made ? '' : 'きょうの番組はもうできています。' }, fromWaiting);
}

async function goRoomEvening() {
  // もう部屋にきょうの番組があれば、作らずにそれを流す
  const known = rc.todayProgram();
  if (known && known.date === rc.today()) {
    showRoomProgram(known, { made: false, fromWaiting: false });
    return;
  }
  waiting = true;
  syncEvening();
  try {
    // 先に部屋をそろえる。まだ送れていない投稿を送り、ほかの人がもう番組を作っていないかを知る
    const synced = await rc.sync();
    if (!roomOn()) return;
    applySync(synced);
    if (synced.lost) {
      sayTop(synced.error);
      return;
    }
    if (synced.ok && synced.program) {
      waiting = false;
      showRoomProgram(synced.program, { made: false, fromWaiting: false });
      return;
    }
    if (synced.ok && synced.count === 0) {
      sayTop('投稿が1件以上あると、番組を作れます。');
      return;
    }
    showWaiting();
    const res = await rc.makeNews(state.nextDate);
    if (!roomOn()) return;
    waiting = false;
    if (!res.ok) {
      fail(res.error);
      return;
    }
    if (!$('tv-view').hidden) {
      showRoomProgram(res.program, { made: res.made, fromWaiting: true });
    } else {
      // 待っているあいだに「投稿にもどる」を押していたら、勝手にテレビへは戻さない。できたことだけ知らせる
      play('next');
      $('msg').textContent = READY_MESSAGE;
    }
    syncRoom();
  } finally {
    waiting = false;
    clearTimeout(waitTimer);
    syncEvening();
  }
}

// ---- 番組の本棚 ----

// 本棚の1本を、テレビで流す（再放送）。AI の注記は、再放送でも出る
function playShelfItem(item) {
  const steps = buildSteps(item.news, item.posts, item.nextDate);
  watch({ steps, posts: item.posts, rerun: { date: item.date, restored: Boolean(item.restored) } }, false);
}

function renderShelf() {
  const items = rc.shelf();
  $('shelf-empty').hidden = items.length > 0;
  $('shelf-list').replaceChildren(...items.map((item) => {
    const li = el('li');
    const b = el('button');
    b.type = 'button';
    nwJoin(b, [fullDate(item.date), ...(item.restored ? ['（端末から戻した）'] : [])], '　');
    b.addEventListener('click', () => {
      play('tap');
      playShelfItem(item);
    });
    li.append(b);
    return li;
  }));
}

function openShelf() {
  cancelVoice();
  renderShelf();
  setView(false, true);
}

$('shelf-open').addEventListener('click', () => {
  play('tap');
  openShelf();
});
$('shelf-back').addEventListener('click', () => {
  play('tap');
  setView(false);
  say('');
});

// ---- 部屋の帯のボタン ----

$('room-join-open').addEventListener('click', () => {
  play('tap');
  const reason = rc.unsupported();
  if (reason) {
    roomSay(reason);
    return;
  }
  joinOpen = !joinOpen;
  roomSay('');
  renderRoom();
  if (joinOpen) $('room-code').focus();
});

let joining = false;
async function enterByCode() {
  if (joining) return;
  const code = $('room-code').value.trim();
  if (!code) {
    play('error');
    roomSay('部屋のコードを入れてください。');
    return;
  }
  joining = true;
  try {
    // 別の部屋に入っているときだけ、確かめる（入っていないときは、入るために打ったので）
    const r = await joinRoom(code, rc.inRoom());
    if (r.ok) {
      $('room-code').value = '';
      roomSay(r.same ? 'いま入っている部屋です。' : '部屋に入りました。');
    } else if (!r.cancelled) {
      play('error');
      roomSay(r.error);
    }
  } finally {
    joining = false;
  }
}
$('room-enter').addEventListener('click', enterByCode);
$('room-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) enterByCode();
});

$('room-create').addEventListener('click', async () => {
  if (joining) return;
  if (rc.inRoom() && !confirm('新しい部屋を作って、そちらに移ります。いまの部屋の投稿と本棚は、この端末に残ります。よろしいですか？')) return;
  joining = true;
  try {
    play('tap');
    roomSay('部屋を作っています…');
    const r = await rc.create();
    if (r.ok) {
      onRoomChanged();
      roomSay('部屋を作りました。「家族に送る」で、招待を送ってください。');
    } else {
      play('error');
      roomSay(r.error);
    }
  } finally {
    joining = false;
  }
});

$('room-leave').addEventListener('click', () => {
  if (!confirm('部屋を出ますか？\n部屋のコードを忘れます。もう一度入るには、招待のリンクかコードが要ります。投稿と本棚は、この端末に残ります。')) return;
  play('tap');
  rc.leave();
  onRoomChanged();
  roomSay('部屋を出ました。');
});

// 招待を送る。スマホの共有の画面が使えればそれで、使えなければコピーする
$('room-share').addEventListener('click', async () => {
  const url = rc.link();
  if (!url) return;
  play('tap');
  const text = 'ちゃのまの、家族の部屋にさそいます。このリンクを開くと、部屋に入れます。';
  roomSay('');
  if (navigator.share) {
    try {
      await navigator.share({ title: 'ちゃのま', text, url });
      return;
    } catch (e) {
      // 共有の画面を閉じただけなら、何もしない。ほかの失敗は、コピーに切り替える
      if (e?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    roomSay('招待をコピーしました。LINE などに貼って、家族に送ってください。');
  } catch {
    // コピーできないときは、リンクを出して、手でコピーしてもらう
    roomSay('コピーできませんでした。下のリンクを、手でコピーして送ってください。');
    $('room-link').value = url;
    $('room-link').hidden = false;
    $('room-link').select();
  }
});

// ---- つなぐ ----

$('send').addEventListener('click', submitPost);
$('text').addEventListener('keydown', (e) => {
  // 変換の確定の Enter では送らない（Safari は確定直後でも isComposing が false になるので、keyCode 229 も見る）
  if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) submitPost();
});
$('nick').addEventListener('input', () => {
  profile().nick = $('nick').value;
});
// 文字数は、入力のたびに合わせる。変換の途中は数えない（未確定の文字は、確定すると長さが変わるため）ので、
// 変換が確定したとき（compositionend）に数える。どちらも入力欄の値には触らない（変換の途中で値を書き換えると、変換が壊れるため）
for (const id of Object.keys(LIMITS)) {
  $(id).addEventListener('input', (e) => {
    if (!e.isComposing) showCount(id);
  });
  $(id).addEventListener('compositionend', () => showCount(id));
}
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
  dropUndo();
  state = { posts: [], ...keep() };
  save();
  renderPosts();
});
$('evening').addEventListener('click', goEvening);
$('retry').addEventListener('click', goEvening);
$('sample').addEventListener('click', () => {
  play('tap');
  sampleMsg('');
  watchSample(sampleMsg);
});
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
  // 本棚から流していたときは、本棚に戻る
  if (show.rerun) openShelf();
  else setView(false);
  say('');
  sampleMsg('');
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
        // 入力欄の上限（200文字）に収める。改行などはここで取り除く。切るときは絵文字を途中で割らない（clipText）
        const joined = [$('text').value, text].filter(Boolean).join('　').replace(/[\r\n\t]+/g, '');
        $('text').value = clipText(joined, LIMITS.text.max);
        showCount('text');
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
renderRoom();
if (loadNote) say(loadNote);
// 招待リンクで開いたときは、確かめてから部屋に入る。そのあと、入っている部屋とそろえ始める
function openedByLink() {
  handleInvite().finally(startSync);
}
window.addEventListener('hashchange', openedByLink);
openedByLink();
