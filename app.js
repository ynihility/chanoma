// 画面の動き。投稿をためて、夜7時に /api/news で番組を作ってもらい、テレビに順に映す。
// 画面に出す文字はすべて textContent で入れる。innerHTML は使わない。
import {
  STORAGE_KEY, MAX_POSTS, TODAY_TOPICS, NEXT_TOPICS, HEADLINES, ANIMALS,
  cleanPosts, cleanDate, checkNews, loadState, serializeState,
} from './safe.js';
import { play, setMuted } from './sound.js';
import { voiceSupported, listen } from './voice.js';

// 1台で実演するために、ここで使う人（家族でのよびかた）を切り替える
const ROLES = ['おばあちゃん', 'おじいちゃん', 'おかあさん', 'おとうさん', 'まご'];
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
  if (saved) state = saved;
  else if (raw !== null) loadNote = '保存していた投稿を読み込めませんでした。新しく始めます。';
} catch {
  // 保存が使えない環境でも、画面は動かす
}

let role = ROLES[0];
const pick = { topic: '', card: '', headline: '' };
// キャラ（どうぶつ）とニックネームは、よびかたごとに覚える。前に投稿していれば、その内容を引き継ぐ
const profiles = {};
for (const p of state.posts) profiles[p.who] = { animal: p.animal ?? '', nick: p.name ?? '' };
const profile = () => (profiles[role] ??= { animal: '', nick: '' });
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
  });
  if ($('nick').value !== profile().nick) $('nick').value = profile().nick;
}

function renderRoles() {
  const box = $('roles');
  if (box.children.length === 0) {
    for (const r of ROLES) {
      const b = el('button', r);
      b.type = 'button';
      b.addEventListener('click', () => {
        play('tap');
        cancelVoice();
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
    const parts = [p.animal ? `【${p.animal}】` : '', p.who, p.topic, p.card, p.headline, p.text].filter(Boolean);
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
  cancelVoice();
  if (!pick.topic || !pick.card) {
    play('error');
    say('お題と札を、えらんでください。');
    return;
  }
  if (state.posts.length >= MAX_POSTS) {
    play('error');
    say(`投稿は${MAX_POSTS}件までです。いらない投稿を消してください。`);
    return;
  }
  const post = {
    id: newId(), who: role, name: profile().nick, animal: profile().animal,
    topic: pick.topic, card: pick.card, headline: pick.headline, text: $('text').value,
  };
  const r = cleanPosts({ posts: [...state.posts, post], nextDate: state.nextDate });
  if (!r.ok) {
    play('error');
    say(r.error);
    return;
  }
  state = { posts: r.posts, ...(r.nextDate ? { nextDate: r.nextDate } : {}) };
  const saved = save();
  play('send');
  pick.topic = pick.card = pick.headline = '';
  $('text').value = '';
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

function setView(onAir) {
  $('post-view').hidden = onAir;
  $('list-view').hidden = onAir;
  $('date-view').hidden = onAir;
  $('tv-view').hidden = !onAir;
  $('evening').hidden = onAir;
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

// 「つぎに会う日」の1行。日数は Claude には言わせず、ここで数えて出す
function meetLine(dateText) {
  if (!dateText) return 'つぎに会う日は、まだ決まっていません。';
  const [, m, d] = dateText.split('-').map(Number);
  const left = daysUntil(dateText);
  if (left < 0) return `つぎに会う日：${m}月${d}日`;
  return left === 0 ? `つぎに会う日：${m}月${d}日（きょうです）` : `つぎに会う日：${m}月${d}日（あと${left}日）`;
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
    if (step.corner === 'つぎ') wrap.append(el('p', meetLine(step.nextDate), 'meet'));
    const p = step.post;
    const box = el('div', undefined, 'post');
    const name = p.name ? `${p.who}（${p.name}）` : p.who;
    box.append(el('p', p.animal ? `【${p.animal}】${name}` : name, 'who'));
    // つぎに会う日の希望は「なにしたい　おでかけ」のように、お題と札を並べて出す
    const cardLine = NEXT_TOPICS.includes(p.topic) ? [p.topic, p.card] : [p.card];
    box.append(el('p', [...cardLine, p.headline].filter(Boolean).join('　'), 'card'));
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
  play('error');
  setView(true);
  show = { steps: [{ kind: 'closing', host: message }], index: 0 };
  const screen = $('screen');
  screen.replaceChildren(el('p', '番組を作れませんでした', 'corner'), el('p', message, 'host'));
  $('next').hidden = true;
}

async function goEvening() {
  cancelVoice();
  if (state.posts.length === 0) {
    say('まだ投稿がありません。ひとことを、おくってください。');
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
$('clear').addEventListener('click', () => {
  if (state.posts.length === 0) return;
  if (!confirm('きょうの投稿を、ぜんぶ消します。よろしいですか？')) return;
  state = state.nextDate ? { posts: [], nextDate: state.nextDate } : { posts: [] };
  save();
  renderPosts();
});
$('evening').addEventListener('click', goEvening);
$('next').addEventListener('click', () => {
  show.index = show.index === show.steps.length - 1 ? 0 : show.index + 1;
  renderStep();
  // 最後の場面では終わりの音、それ以外は鐘の音（はじめに戻るときはテレビの音）
  play(show.index === 0 ? 'tvon' : show.index === show.steps.length - 1 ? 'end' : 'next');
});
$('sound').addEventListener('click', () => {
  const off = $('sound').getAttribute('aria-pressed') !== 'true';
  $('sound').setAttribute('aria-pressed', String(off));
  // 色だけで状態を伝えないように、文字も変える
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
  $('next-date').min = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
if (state.nextDate) $('next-date').value = state.nextDate;

renderRoles();
renderForm();
renderPosts();
if (loadNote) say(loadNote);
