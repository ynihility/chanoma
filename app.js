// 画面の動き。投稿をためて、夜7時に /api/news で番組を作ってもらい、テレビに順に映す。
// 画面に出す文字はすべて textContent で入れる。innerHTML は使わない。
import {
  STORAGE_KEY, MAX_POSTS, TODAY_TOPICS, HEADLINES, cleanPosts, checkNews, loadState, serializeState,
} from './safe.js';

// 1台で実演するために、ここで使う人を切り替える
const ROLES = ['おばあちゃん', 'おかあさん', 'まご'];
// お題ごとの札
const CARDS = {
  'ごはん': ['ごはん', 'パン', 'めん', 'おかず', 'おやつ', 'のみもの'],
  'そら': ['はれ', 'くもり', 'あめ', 'ゆき', 'かぜ', 'おつきさま'],
  'したこと': ['さんぽ', 'おそうじ', 'かいもの', 'おしゃべり', 'おりょうり', 'おひるね'],
  'みつけた': ['はな', 'とり', 'むし', 'あたらしいおみせ', 'おもしろいもの', 'なつかしいもの'],
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
  if (saved) state = saved;
  else if (raw !== null) loadNote = '保存していた投稿を読み込めませんでした。新しく始めます。';
} catch {
  // 保存が使えない環境でも、画面は動かす
}

let role = ROLES[0];
const pick = { topic: '', card: '', headline: '' };
// 放送中の状態。steps は順に映す内容、index は今の位置
let show = { steps: [], index: 0 };

function say(message) {
  $('msg').textContent = message;
}

// 保存できたら true。使えない環境や容量いっぱいのときは false
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeState(state.posts, state.nextDate));
    return true;
  } catch {
    return false;
  }
}

// ---- 投稿画面 ----

// 選ぶボタンの並びを作る。並びが同じなら、ボタンは作り直さず選択の印だけを更新する。
// 作り直すとキーボードのフォーカスが消えて、押すたびに先頭から Tab をやり直すことになるため
function renderChoices(containerId, items, current, onPick, emptyText) {
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
        // もう一度押すと、選びなおせるように印を外す
        b.addEventListener('click', () => onPick(b.getAttribute('aria-pressed') === 'true' ? '' : item));
        return b;
      }));
    }
  }
  for (const b of box.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.textContent === current));
}

function renderForm() {
  $('post-title').textContent = `${role}のひとこと`;
  renderChoices('topics', TODAY_TOPICS, pick.topic, (v) => {
    pick.topic = v;
    pick.card = '';
    renderForm();
  });
  renderChoices('cards', CARDS[pick.topic] ?? [], pick.card, (v) => {
    pick.card = v;
    renderForm();
  }, 'お題をえらぶと、札が出ます。');
  renderChoices('headlines', HEADLINES, pick.headline, (v) => {
    pick.headline = v;
    renderForm();
  });
}

function renderRoles() {
  const box = $('roles');
  if (box.children.length === 0) {
    for (const r of ROLES) {
      const b = el('button', r);
      b.type = 'button';
      b.addEventListener('click', () => {
        role = r;
        say('');
        renderRoles();
        renderForm();
      });
      box.append(b);
    }
  }
  for (const b of box.children) b.setAttribute('aria-pressed', String(b.textContent === role));
}

function renderPosts() {
  const list = $('posts');
  list.replaceChildren();
  if (state.posts.length === 0) {
    list.append(el('li', 'まだ投稿はありません。'));
  }
  for (const p of state.posts) {
    const li = el('li');
    const body = el('span', undefined, 'body');
    const parts = [`${p.who}`, p.topic, p.card, p.headline, p.text].filter(Boolean);
    body.textContent = parts.join('　');
    const del = el('button', '消す');
    del.type = 'button';
    // 「消す」が何件も並ぶので、読み上げでどの投稿か分かるように名前を付ける
    del.setAttribute('aria-label', `${p.who}の「${p.card ?? p.topic}」の投稿を消す`);
    del.addEventListener('click', () => {
      state.posts = state.posts.filter((x) => x.id !== p.id);
      save();
      renderPosts();
      // 消したボタンは無くなるので、フォーカスを見出しに移す
      $('list-title').focus();
    });
    li.append(body, del);
    list.append(li);
  }
}

// 投稿のIDは、safe.js の決まり（英数字と - _ で20文字まで）に合わせる
const newId = () => `p${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-5)}`;

function submitPost() {
  if (!pick.topic || !pick.card) {
    say('お題と札を、えらんでください。');
    return;
  }
  if (state.posts.length >= MAX_POSTS) {
    say(`投稿は${MAX_POSTS}件までです。いらない投稿を消してください。`);
    return;
  }
  const post = { id: newId(), who: role, topic: pick.topic, card: pick.card, headline: pick.headline, text: $('text').value };
  const r = cleanPosts({ posts: [...state.posts, post], nextDate: state.nextDate });
  if (!r.ok) {
    say(r.error);
    return;
  }
  state = { posts: r.posts, ...(r.nextDate ? { nextDate: r.nextDate } : {}) };
  const saved = save();
  pick.topic = pick.card = pick.headline = '';
  $('text').value = '';
  say(saved ? 'おくりました。' : 'おくりました。ただし、この端末には保存できませんでした。画面を閉じると消えます。');
  renderForm();
  renderPosts();
}

// ---- 放送画面 ----

function setView(onAir) {
  $('post-view').hidden = onAir;
  $('list-view').hidden = onAir;
  $('tv-view').hidden = !onAir;
  $('evening').hidden = onAir;
  // 押したボタンは隠れるので、フォーカスを新しい画面に移す（キーボードや読み上げの人が迷子にならないように）
  (onAir ? $('screen') : $('post-title')).focus();
}

// 番組を、画面に映す順番の一覧にする。本文は投稿のほうから取り、Claude の返事からは取らない
function buildSteps(news, posts) {
  const byId = new Map(posts.map((p) => [p.id, p]));
  return [
    { kind: 'opening', host: news.opening },
    ...news.segments.map((s) => ({ kind: 'segment', corner: s.corner, host: s.host, post: byId.get(s.from) })),
    { kind: 'closing', host: news.closing },
  ];
}

function hostLine(text) {
  const p = el('p', undefined, 'host');
  p.append(el('span', 'AI', 'ai-chip'), document.createTextNode(text));
  return p;
}

function renderStep() {
  const screen = $('screen');
  const step = show.steps[show.index];
  screen.replaceChildren();
  const wrap = el('div', undefined, 'fade');
  if (step.kind === 'segment') {
    wrap.append(el('p', CORNER_TITLES[step.corner] ?? '', 'corner'), hostLine(step.host));
    const p = step.post;
    const box = el('div', undefined, 'post');
    box.append(el('p', p.name ? `${p.who}（${p.name}）` : p.who, 'who'));
    box.append(el('p', [p.card, p.headline].filter(Boolean).join('　'), 'card'));
    if (p.text) box.append(el('p', p.text, 'text'));
    wrap.append(box);
  } else {
    wrap.append(el('p', step.kind === 'opening' ? '夜7時のかぞくニュース' : 'おしまい', 'corner'), hostLine(step.host));
  }
  screen.append(wrap);
  const last = show.index === show.steps.length - 1;
  $('next').textContent = last ? 'もう一度みる' : 'つぎへ';
}

function showError(message) {
  setView(true);
  show = { steps: [{ kind: 'closing', host: message }], index: 0 };
  const screen = $('screen');
  screen.replaceChildren(el('p', '番組を作れませんでした', 'corner'), el('p', message, 'host'));
  $('next').hidden = true;
}

async function goEvening() {
  if (state.posts.length === 0) {
    say('まだ投稿がありません。ひとことを、おくってください。');
    return;
  }
  const button = $('evening');
  button.disabled = true;
  button.textContent = 'テレ吉が準備中…';
  // 送った時点の投稿。待っているあいだに投稿が増減しても、番組の検査と表示はこの一覧で行う
  const sent = state.posts;
  try {
    const payload = { posts: sent, ...(state.nextDate ? { nextDate: state.nextDate } : {}) };
    const res = await fetch('/api/news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // サーバーは90秒で切るので、画面はそれより少しだけ長く待つ
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
    show = { steps: buildSteps(checked.news, sent), index: 0 };
    $('next').hidden = false;
    setView(true);
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
$('clear').addEventListener('click', () => {
  if (state.posts.length === 0) return;
  if (!confirm('きょうの投稿を、ぜんぶ消します。よろしいですか？')) return;
  state = { posts: [] };
  save();
  renderPosts();
});
$('evening').addEventListener('click', goEvening);
$('next').addEventListener('click', () => {
  show.index = show.index === show.steps.length - 1 ? 0 : show.index + 1;
  renderStep();
});
$('back').addEventListener('click', () => {
  setView(false);
  say('');
});

renderRoles();
renderForm();
renderPosts();
if (loadNote) say(loadNote);
