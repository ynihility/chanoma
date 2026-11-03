// 効果音。音声ファイルは使わず、Web Audio API（ブラウザの音を作る仕組み）でその場で合成する。
// 音が出せない環境や、ミュート中は、何もせずに終わる。

let ctx = null;
let muted = false;
// 音量。大きすぎると驚かせるので小さめにしている
const VOLUME = 0.12;

// 音を出す部品。ブラウザは画面を操作するまで音を出せないので、鳴らす直前に作る
function context() {
  if (muted) return null;
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// 1つの音。音量を急に変えるとプツッという雑音が出るので、短い立ち上がりと余韻をつける
function tone(c, { freq, start = 0, dur = 0.15, type = 'sine', gain = 1, to, out = c.destination }) {
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(VOLUME * gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// ざーっという音（ブラウン管の電源が入るときの雑音）。ランダムな波形を、だんだん低い音だけ通すようにする
function hiss(c, { start = 0, dur = 0.4, from = 5000, to = 300, gain = 1 }) {
  const t0 = c.currentTime + start;
  const length = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(VOLUME * gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t0);
}

// 鳴らす音の一覧。それぞれ、その場の動きに合わせた短い音
const SOUNDS = {
  // ボタンを押したとき
  tap: (c) => tone(c, { freq: 660, dur: 0.06, type: 'square', gain: 0.4 }),
  // 投稿をおくったとき（ふたつの音が上がる）
  send: (c) => {
    tone(c, { freq: 523, dur: 0.14, gain: 0.9 });
    tone(c, { freq: 784, start: 0.12, dur: 0.22, gain: 0.9 });
  },
  // テレビの電源が入るとき
  tvon: (c) => {
    hiss(c, { dur: 0.45 });
    tone(c, { freq: 60, dur: 0.5, type: 'sawtooth', gain: 0.5 });
    tone(c, { freq: 1200, start: 0.35, dur: 0.25, gain: 0.5, to: 2400 });
  },
  // つぎの場面へ進むとき（やわらかい鐘）
  next: (c) => {
    tone(c, { freq: 880, dur: 0.35, type: 'triangle', gain: 0.8 });
    tone(c, { freq: 1320, dur: 0.25, type: 'sine', gain: 0.3 });
  },
  // 番組の最後（音が下がっていく）
  end: (c) => {
    tone(c, { freq: 784, dur: 0.25, gain: 0.9 });
    tone(c, { freq: 659, start: 0.22, dur: 0.25, gain: 0.9 });
    tone(c, { freq: 523, start: 0.44, dur: 0.5, gain: 0.9 });
  },
  // うまくいかなかったとき（低いブザー。驚かせないように短く）
  error: (c) => tone(c, { freq: 180, dur: 0.22, type: 'sawtooth', gain: 0.6, to: 120 }),
};

// ---- テレ吉の「声っぽい音」 ----
// 言葉を読み上げるのではなく、文字に合わせた高さの短い電子音を並べる（動物の言葉のような「ぽぽぽ」）。
// 声の合成や音声ファイルは使わず、効果音と同じ Web Audio API だけで作る。

// 高さを決める音階。ペンタトニック（半音の隙間がない5音の並び）にして、どの文字の組み合わせでも耳ざわりにならないようにする。
// 約 311〜700Hz の範囲
const BASE_FREQ = 311.13;
const SCALE = [0, 2, 4, 7, 9, 12, 14];
// 間隔と上限。長い文でもうるさくならないよう、音の数と全体の長さの両方を抑える
const SLOT = 0.08;
const MAX_NOTES = 40;
const MAX_SLOTS = 56;
const NOTE_DUR = 0.06;
const SHORT_DUR = 0.035;
// 小さい文字は、前の音にくっつく響きなので短くする
const SMALL_KANA = 'ぁぃぅぇぉゃゅょゎっァィゥェォャュョヮッ';

// カタカナはひらがなに寄せる。同じ読みの文字を、同じ高さにするため
function toHiragana(ch) {
  const code = ch.codePointAt(0);
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : ch;
}

// 音にしない文字（空白・句読点・記号）か。「ー」は音にするので、ここには入れない
function isSilent(ch) {
  return /[\s\p{P}\p{S}]/u.test(ch) && ch !== 'ー';
}

// 文字から高さ（Hz）を決める。同じ文字は必ず同じ高さ。音にしない文字は null
export function pitchForChar(ch) {
  if (typeof ch !== 'string' || ch === '' || isSilent(ch)) return null;
  const code = toHiragana(ch).codePointAt(0);
  // 隣り合う文字が同じ高さに偏らないよう、素数をかけてから音階に割り当てる
  const step = SCALE[(code * 7) % SCALE.length];
  return BASE_FREQ * 2 ** (step / 12);
}

// 文から鳴らす音の計画を作る。start は文の頭からの秒数。無音の文字は、間として一拍あける
export function planVoice(text) {
  const notes = [];
  if (typeof text !== 'string') return notes;
  let slot = 0;
  let last = null;
  for (const ch of text) {
    if (notes.length >= MAX_NOTES || slot >= MAX_SLOTS) break;
    const freq = ch === 'ー' ? last : pitchForChar(ch);
    if (freq !== null) {
      const short = ch === 'ー' || SMALL_KANA.includes(ch);
      notes.push({ freq, start: slot * SLOT, dur: short ? SHORT_DUR : NOTE_DUR });
      last = freq;
    }
    slot += 1;
  }
  return notes;
}

// いま鳴っている声の出口。切り替えのときに、まとめて止める
let voiceBus = null;
// 文の頭を少し遅らせる。場面の切り替えの効果音（テレビの電源など）と重ならないようにする
const VOICE_LEAD = 0.3;

// 鳴っている声を止める。プツッという雑音が出ないよう、音量を落としてから切り離す
export function stopBlips() {
  if (!voiceBus || !ctx) {
    voiceBus = null;
    return;
  }
  const bus = voiceBus;
  voiceBus = null;
  try {
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
    setTimeout(() => bus.disconnect(), 100);
  } catch {
    // 止められなかったときも、短い音なので、そのまま終わるのを待つ
  }
}

// テレ吉の言葉に合わせて「ぽぽぽ」と鳴らす。前の声が残っていれば先に止めて、重ならないようにする
export function hostBlips(text) {
  stopBlips();
  // 見えていない画面から音が出ないようにする
  if (typeof document !== 'undefined' && document.hidden) return;
  const notes = planVoice(text);
  if (notes.length === 0) return;
  const c = context();
  if (!c) return;
  voiceBus = c.createGain();
  voiceBus.connect(c.destination);
  for (const n of notes) {
    tone(c, { freq: n.freq, start: VOICE_LEAD + n.start, dur: n.dur, type: 'triangle', gain: 0.35, out: voiceBus });
  }
}

// 別のタブに移ったら、残りの声を止める
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopBlips();
  });
}

export function play(name) {
  const c = context();
  if (c && SOUNDS[name]) SOUNDS[name](c);
}

export function setMuted(value) {
  muted = Boolean(value);
  if (muted) stopBlips();
}
