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
function tone(c, { freq, start = 0, dur = 0.15, type = 'sine', gain = 1, to }) {
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(VOLUME * gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
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

export function play(name) {
  const c = context();
  if (c && SOUNDS[name]) SOUNDS[name](c);
}

export function setMuted(value) {
  muted = Boolean(value);
}
