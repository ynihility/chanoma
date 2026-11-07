// 家族の茶の間。畳の部屋に、家族の動物が歩いたり、座ったり、はねたりする（320×180 のドット絵の canvas）。
// 決まり: 動きは乱数だけで決める。だれが投稿したか・していないかでは、動きも出る動物も変えない。
// 部屋にいる動物の数は出すが、「みんな投稿した」とは言わない。
// 動きの計算（stepCreature など）は、画面の部品なしで動く純粋な関数にしてある（テストのため）。
import { PALETTE, SPRITES } from './sprites.js';
import { drawSpriteAt } from './pixel.js';
import { ANIMALS } from './safe.js';

export const W = 320;
export const H = 180;
// 1 秒に 8 コマ
export const FRAME_MS = 125;
// 動物がうろうろできる左右の範囲（家具の外側）と、歩く道筋（奥から手前への3本）
const MIN_X = 20;
const MAX_X = 300;
const LANES = [140, 152, 164];
// ちゃぶ台のまわりの座る場所（足もとの位置）。動物の順番ごとに1か所ずつ
export const TABLE_SEATS = [[118, 140], [202, 140], [140, 154], [180, 154], [254, 150], [96, 154]];
// 夜 7 時、テレビの前に集まって座る場所（2列）
export const WATCH_SEATS = [[30, 132], [52, 132], [74, 132], [30, 150], [52, 150], [74, 150]];
// はねるときの高さ（コマごとの、上へのずれ）
export const HOP_PATH = [0, -2, -4, -5, -4, -2, 0, -1, 0];
// 横向きの全身の絵（胴を足さない動物）が、もともと向いている向き（-1 が左）
const NATIVE_DIR = { 'すずめ': -1, 'かめ': 1 };

// ---- 部屋にいる動物 ----
// 動物の名前の一覧を、重ならないように、ANIMALS の並びにそろえる。一覧にない値は捨てる。
// 受け取るのは動物の名前だけで、だれの動物か（よびかた）は持たない
export function rosterOf(...lists) {
  const seen = new Set();
  for (const list of lists) {
    for (const value of Array.isArray(list) ? list : []) {
      if (typeof value === 'string' && ANIMALS.includes(value)) seen.add(value);
    }
  }
  return ANIMALS.filter((a) => seen.has(a));
}

// 「きょうの茶の間: どうぶつ 3 種類」。数えているのは、画面に出ている動物の種類で、部屋にいる人の数ではない
// （1 台で役割を切り替えて動物を選んでも増える）。「人」と書くと実際より多くの人がいるように読めるので書かない。投稿の有無も言わない
export const countText = (n) => (n > 0 ? `きょうの茶の間: どうぶつ ${n} 種類` : 'キャラ（どうぶつ）をえらぶと、茶の間に出ます。');

// 画面の幅に収まる、整数倍の拡大率。幅が 320 に満たないときは、null（CSS で幅に合わせる）
export function fitScale(available) {
  const n = Math.floor(Number(available) / W);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

// ---- 動物の動き ----
export function newCreature(animal, index, rng) {
  return {
    animal,
    index,
    x: MIN_X + Math.floor(rng() * (MAX_X - MIN_X)),
    y: LANES[index % LANES.length],
    dir: rng() < 0.5 ? -1 : 1,
    state: 'walk',
    timer: 8 + Math.floor(rng() * 16),
    frame: 0,
    hop: 0,
    seated: false,
    watching: false,
  };
}

// 次の動きを乱数で決める（歩く 50%・座る 35%・はねる 15%）
export function pickState(c, rng) {
  const r = rng();
  c.seated = false;
  if (r < 0.5) {
    c.state = 'walk';
    c.dir = rng() < 0.5 ? -1 : 1;
    c.timer = 10 + Math.floor(rng() * 20);
  } else if (r < 0.85) {
    c.state = 'sit';
    c.timer = 20 + Math.floor(rng() * 40);
  } else {
    c.state = 'hop';
    c.timer = HOP_PATH.length;
    c.hop = 0;
  }
}

// 縦横それぞれ speed ドットまで、目的地へ近づく。着いていれば true
function moveToward(c, tx, ty, speed = 1) {
  const dx = Math.sign(tx - c.x) * Math.min(speed, Math.abs(tx - c.x));
  const dy = Math.sign(ty - c.y) * Math.min(speed, Math.abs(ty - c.y));
  c.x += dx;
  c.y += dy;
  if (dx !== 0) c.dir = Math.sign(dx);
  return c.x === tx && c.y === ty;
}
// 夜 7 時に集まるときは、急いで歩く（1 コマに 4 ドット。部屋の端からでも 7 秒ほどで着く）
const WATCH_SPEED = 4;

// 1 コマ進める。watching が true のあいだは、テレビの前の席へ向かって座る
export function stepCreature(c, rng, watching = false) {
  c.frame += 1;
  if (watching) {
    c.watching = true;
    const [sx, sy] = WATCH_SEATS[c.index % WATCH_SEATS.length];
    c.seated = moveToward(c, sx, sy, WATCH_SPEED);
    c.state = 'sit';
    return;
  }
  // 番組が終わったら、元の動きに戻る
  if (c.watching) {
    c.watching = false;
    pickState(c, rng);
  }
  if (c.state === 'walk') {
    c.x += c.dir;
    if (c.x <= MIN_X) c.dir = 1;
    if (c.x >= MAX_X) c.dir = -1;
    // 座っていた場所から、歩く道筋へ、少しずつ戻る
    const lane = LANES[c.index % LANES.length];
    c.y += Math.sign(lane - c.y);
    c.seated = false;
  } else if (c.state === 'sit') {
    const [sx, sy] = TABLE_SEATS[c.index % TABLE_SEATS.length];
    c.seated = moveToward(c, sx, sy);
    // 席に着いてから、座っている時間を数える
    if (!c.seated) return;
  } else {
    c.hop = Math.min(c.hop + 1, HOP_PATH.length - 1);
  }
  c.timer -= 1;
  if (c.timer <= 0) pickState(c, rng);
}

// ---- 絵 ----
const rect = (ctx, key, x, y, w, h) => {
  ctx.fillStyle = PALETTE[key];
  ctx.fillRect(x, y, w, h);
};
// 楕円を 1 ドットの横線で塗る
function ellipse(ctx, key, cx, cy, rx, ry) {
  ctx.fillStyle = PALETTE[key];
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(1 - (dy / ry) ** 2));
    ctx.fillRect(cx - half, cy + dy, half * 2, 1);
  }
}

// テレビ以外の背景（畳・障子・ちゃぶ台・座布団）。動かないので、1 回だけ描いて使い回す
function paintBackground(ctx) {
  // 壁と鴨居
  rect(ctx, 'e', 0, 0, W, 70);
  rect(ctx, 'w', 0, 0, W, 5);
  rect(ctx, 'k', 0, 5, W, 1);
  // 障子: 紙に、木の格子
  rect(ctx, 'k', 106, 10, 188, 58);
  rect(ctx, 'w', 108, 12, 184, 54);
  rect(ctx, 'p', 111, 15, 178, 48);
  ctx.fillStyle = PALETTE.b;
  for (let x = 111; x <= 289; x += 30) ctx.fillRect(x - 1, 15, 3, 48);
  for (let y = 27; y < 63; y += 12) ctx.fillRect(111, y, 178, 2);
  // 畳: い草の線と、畳の縁
  rect(ctx, 'w', 0, 70, W, 3);
  rect(ctx, 'k', 0, 73, W, 1);
  rect(ctx, 'g', 0, 74, W, H - 74);
  ctx.fillStyle = PALETTE.G;
  for (let y = 76; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  ctx.fillStyle = PALETTE.v;
  for (const x of [0, 106, 214]) ctx.fillRect(x, 74, 2, H - 74);
  ctx.fillRect(0, 118, 106, 2);
  ctx.fillRect(214, 118, 106, 2);
  // 右の座布団
  rect(ctx, 'k', 236, 134, 40, 20);
  rect(ctx, 'r', 238, 136, 36, 16);
  rect(ctx, 'y', 254, 140, 4, 8);
  rect(ctx, 's', 238, 150, 36, 2);
  // ちゃぶ台: 脚、天板のふち、天板
  rect(ctx, 'k', 130, 130, 5, 6);
  rect(ctx, 'k', 186, 130, 5, 6);
  ellipse(ctx, 'k', 160, 124, 36, 13);
  ellipse(ctx, 'w', 160, 125, 34, 12);
  ellipse(ctx, 'b', 160, 121, 34, 11);
  ellipse(ctx, 'b', 160, 121, 30, 9);
  ctx.fillStyle = PALETTE.G;
  ctx.fillRect(140, 117, 14, 1);
  // 湯呑み 1 つ（浅葱色。お茶は畳色）
  rect(ctx, 'k', 169, 114, 10, 9);
  rect(ctx, 'a', 170, 116, 8, 6);
  rect(ctx, 'g', 170, 115, 8, 1);
  rect(ctx, 's', 176, 116, 2, 6);
}

// ブラウン管テレビ。lit が true なら画面が光る（番組の光）。tick は光のゆれに使う
function paintTv(ctx, lit, tick) {
  // アンテナ
  ctx.fillStyle = PALETTE.k;
  for (let i = 0; i < 16; i++) {
    ctx.fillRect(50 - i, 40 - i, 2, 2);
    ctx.fillRect(52 + i, 40 - i, 2, 2);
  }
  rect(ctx, 'y', 49, 38, 6, 3);
  // 本体
  rect(ctx, 'k', 14, 40, 72, 64);
  rect(ctx, 'w', 16, 42, 68, 60);
  rect(ctx, 'b', 16, 42, 68, 2);
  // 脚
  rect(ctx, 'k', 22, 102, 6, 4);
  rect(ctx, 'k', 72, 102, 6, 4);
  // 画面のふち、つまみ、スピーカー
  rect(ctx, 'k', 21, 47, 46, 50);
  rect(ctx, 'y', 72, 52, 8, 8);
  rect(ctx, 'k', 72, 52, 8, 1);
  rect(ctx, 'a', 72, 64, 8, 8);
  ctx.fillStyle = PALETTE.k;
  for (let y = 80; y < 96; y += 3) ctx.fillRect(72, y, 8, 1);
  // 画面
  if (!lit) {
    rect(ctx, 'd', 23, 49, 42, 46);
    rect(ctx, 'w', 25, 51, 8, 2);
    rect(ctx, 'a', 25, 54, 2, 6);
    return;
  }
  const bars = ['L', 'y', 'a', 'r', 'P'];
  bars.forEach((key, i) => rect(ctx, key, 23 + i * 8, 49, i === 4 ? 10 : 8, 28));
  rect(ctx, 'L', 23, 77, 42, 18);
  // 走査線と、上から下へ流れる明るい帯
  ctx.fillStyle = PALETTE.d;
  ctx.globalAlpha = 0.22;
  for (let y = 49; y < 95; y += 2) ctx.fillRect(23, y, 42, 1);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = PALETTE.p;
  ctx.fillRect(23, 49 + ((tick * 3) % 44), 42, 3);
  ctx.globalAlpha = 1;
}

// 1 体を描く。足もと (x, y) を基準に、顔と胴を重ねる
function paintCreature(ctx, c) {
  const hopY = c.state === 'hop' ? HOP_PATH[c.hop] : 0;
  // 足もとの影
  ctx.globalAlpha = 0.3;
  rect(ctx, 's', c.x - 6, c.y, 12, 2);
  ctx.globalAlpha = 1;
  const walking = c.state === 'walk' || (c.state === 'sit' && !c.seated);
  const frame = c.seated ? '座' : walking && c.frame % 2 === 1 ? '立2' : '立1';
  const body = `からだ:${c.animal}:${frame}`;
  if (SPRITES[body]) {
    drawSpriteAt(ctx, body, c.x - 4, c.y - 6 + hopY);
    drawSpriteAt(ctx, c.animal, c.x - 8, c.y - (c.seated ? 18 : 20) + hopY);
  } else {
    // 全身の横向きの絵（すずめ・かめ）は、歩くときだけ 1 ドット上下にゆれる
    const bob = walking && c.frame % 2 === 1 ? -1 : 0;
    const flip = c.dir !== NATIVE_DIR[c.animal];
    drawSpriteAt(ctx, c.animal, c.x - 8, c.y - 16 + hopY + bob + (c.seated ? 2 : 0), { flip });
  }
}

// ---- 茶の間（画面の部品） ----
// canvas を受け取り、動かす。deps は差し替え用（テストと、乱数の固定のため）
export function createChaNoMa(canvas, deps = {}) {
  const rng = deps.rng ?? Math.random;
  const reduced = deps.reducedMotion ?? (() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const doc = deps.document ?? globalThis.document;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // 背景は 1 回だけ描いて、毎コマ貼る
  const bg = doc.createElement('canvas');
  bg.width = W;
  bg.height = H;
  paintBackground(bg.getContext('2d'));

  let creatures = [];
  let watching = false;
  let tick = 0;
  let timer = 0;

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0);
    if (watching) {
      // 夜 7 時: 部屋を少し暗くして、テレビの光を床まで届かせる
      ctx.globalAlpha = 0.3;
      rect(ctx, 'd', 0, 0, W, H);
      ctx.globalAlpha = 0.14;
      ellipse(ctx, 'L', 52, 128, 64, 30);
      ctx.globalAlpha = 1;
    }
    paintTv(ctx, watching, tick);
    // 奥の動物から先に描く（手前の動物が上に重なる）
    for (const c of [...creatures].sort((a, b) => a.y - b.y)) paintCreature(ctx, c);
    if (!watching) {
      // 湯気（2 コマで、ゆれる）。動物がいなくても、茶の間が止まって見えないように
      ctx.fillStyle = PALETTE.W;
      const s = Math.floor(tick / 4) % 2;
      ctx.fillRect(172 + s, 109, 1, 2);
      ctx.fillRect(175 - s, 107, 1, 2);
    }
  }

  function step() {
    tick += 1;
    for (const c of creatures) stepCreature(c, rng, watching);
    render();
  }

  // 静止画の姿勢: 全員がちゃぶ台（夜 7 時ならテレビ）の前に座った絵
  function settle() {
    for (const c of creatures) {
      const [sx, sy] = (watching ? WATCH_SEATS : TABLE_SEATS)[c.index % TABLE_SEATS.length];
      Object.assign(c, { x: sx, y: sy, state: 'sit', seated: true, watching });
    }
  }

  const api = {
    // 部屋にいる動物の名前の一覧を合わせる。いる動物の動きは、そのまま続ける
    setAnimals(list) {
      const names = rosterOf(list);
      const old = new Map(creatures.map((c) => [c.animal, c]));
      creatures = names.map((name, i) => {
        const c = old.get(name) ?? newCreature(name, i, rng);
        c.index = i;
        return c;
      });
      if (reduced()) settle();
      render();
    },
    setWatching(on) {
      watching = Boolean(on);
      if (reduced()) settle();
      render();
    },
    // 動かし始める。動きを減らす設定のときは、静止画を 1 枚描くだけ
    start() {
      api.stop();
      if (reduced()) {
        settle();
        render();
        return;
      }
      if (doc.visibilityState === 'hidden') return;
      timer = setInterval(step, FRAME_MS);
    },
    stop() {
      clearInterval(timer);
      timer = 0;
    },
    isRunning: () => timer !== 0,
    count: () => creatures.length,
    render,
  };
  // タブが見えないあいだは止める（電池と処理を使わないため）。見えたら再開する
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') api.stop();
    else api.start();
  });
  // 動きを減らす設定が切り替わったら、動きと静止画を入れ替える
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => api.start());
  api.start();
  render();
  return api;
}
