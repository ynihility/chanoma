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
const CORNER_TITLES = { 'ひとこと': 'きょうの一言', 'むかし': 'むかし話コーナー', 'つぎ': 'つぎに会う日' };

const $ = (id) => document.getElementById(id);
// 要素を作り、文字は textContent で入れる
function el(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
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
  $('post-title').textContent = `${role}のひとこと`;
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
    list.append(el('li', 'きょうの投稿は、ここにならびます。'));
  }
  for (const p of state.posts) {
    const li = el('li');
    const body = el('span', undefined, 'body');
    const wish = p.wishDate ? monthDay(p.wishDate) : '';
    const parts = [p.animal ? `【${p.animal}】` : '', p.who, p.topic, p.card, wish, p.headline, p.text].filter(Boolean);
    body.textContent = parts.join('　');
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
}

// ---- 放送画面 ----

// 動いている演出があれば、今すぐ終わらせる（中身の入れ替えまで済ませる）
function cancelFx() {
  const r = run;
  run = null;
  r?.skip();
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
  // 押したボタンは隠れるので、フォーカスを新しい画面に移す（キーボードや読み上げの人が迷子にならないように）
  (onAir ? $('screen') : $('post-title')).focus();
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

// 「つぎに会う日」の1行
function meetLine(dateText) {
  if (!dateText) return 'つぎに会う日は、決まったらここに出ます。';
  return `つぎに会う日：${monthDay(dateText)}${daysSuffix(dateText)}`;
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
  bubble.append(el('span', 'AI', 'ai-chip'), document.createTextNode(text));
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

// いまの場面を、画面にすぐ描く
function renderStep() {
  const step = show.steps[show.index];
  const wrap = el('div', undefined, 'fade');
  if (step.kind === 'segment') {
    wrap.append(el('p', CORNER_TITLES[step.corner] ?? '', 'corner'), hostLine(step.host));
    if (step.corner === 'つぎ') wrap.append(el('p', meetLine(step.nextDate), 'meet'));
    const p = step.post;
    const box = el('div', undefined, 'post');
    const name = p.name ? `${p.who}（${p.name}）` : p.who;
    const who = el('p', p.animal ? `【${p.animal}】${name}` : name, 'who');
    // 投稿した人の動物を、名前の左に出す（飾り）
    if (p.animal) who.prepend(spriteCanvas(p.animal, 3, undefined, { shadow: true }));
    box.append(who);
    // つぎに会う日の希望は「なにしたい　おでかけ」のように、お題と札を並べて出す
    // 「いつ会いたい」は、札のかわりに日付と、あと何日かを出す
    const wish = p.wishDate ? `${monthDay(p.wishDate)}${daysSuffix(p.wishDate)}` : p.card;
    const cardLine = NEXT_TOPICS.includes(p.topic) ? [p.topic, wish] : [p.card];
    box.append(el('p', [...cardLine, p.headline].filter(Boolean).join('　'), 'card'));
    if (p.text) box.append(el('p', p.text, 'text'));
    wrap.append(box);
  } else {
    wrap.append(el('p', step.kind === 'opening' ? '夜7時のかぞくニュース' : 'おしまい', 'corner'), hostLine(step.host));
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

// 場面を切り替える。コーナーが変わるときは、画面にモザイクの演出をはさむ。
// 演出が使えない（読み込めない・動きを減らす設定）ときは、すぐ入れ替える
function goStep(from) {
  updateNext();
  if (!fx || cornerKey(from) === cornerKey(show.steps[show.index])) {
    renderStep();
    return;
  }
  const mine = fx.playWipe($('screen'), 'mosaic', renderStep);
  run = mine;
  mine.done.then(() => {
    if (run === mine) run = null;
  });
}

function showError(message) {
  play('error');
  setView(true);
  show = { steps: [{ kind: 'closing', host: message }], index: 0 };
  // アプリ自身のお知らせなので、AI の吹き出し（host）にはしない
  setScreen(el('p', '番組を作れませんでした', 'corner'), el('p', message, 'notice'));
  $('next').hidden = true;
}

async function goEvening() {
  cancelVoice();
  if (state.posts.length === 0) {
    say('投稿が1件以上あると、番組を作れます。');
    return;
  }
  const button = $('evening');
  button.disabled = true;
  button.textContent = 'テレ吉が準備中…';
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
      showError(typeof data?.error === 'string' ? data.error : '番組を作れませんでした。もう一度お試しください。');
      return;
    }
    // サーバーでも検査しているが、画面でも同じ検査を通してから使う
    const checked = checkNews(data, sent);
    if (!checked.ok) {
      showError('番組をうまく組み立てられませんでした。もう一度お試しください。');
      return;
    }
    show = { steps: buildSteps(checked.news, sent, sentDate), index: 0 };
    $('next').hidden = false;
    setView(true);
    play('tvon');
    renderStep();
  } catch {
    showError('通信できませんでした。つながっているか確かめて、もう一度お試しください。');
  } finally {
    button.disabled = false;
    button.textContent = '夜7時にする';
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
