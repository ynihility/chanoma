// chanoma-room.js のテスト（家族の茶の間）。動きの計算は純粋な関数なので、そのまま確かめる。
// canvas は、描いた四角を記録するだけの偽物で確かめる（ブラウザでの見え方は、ここでは確かめない）。実行: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  W, H, FRAME_MS, TABLE_SEATS, WATCH_SEATS, HOP_PATH, rosterOf, countText, fitScale, newCreature, pickState, stepCreature, createChaNoMa,
} from '../chanoma-room.js';
import { ANIMALS } from '../safe.js';
import { drawSpriteAt } from '../pixel.js';

// 乱数は、種から同じ数列を作る（結果を毎回そろえるため）
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('rosterOf: 重ならず、ANIMALS の並びにそろい、一覧にない値は捨てる', () => {
  assert.deepEqual(rosterOf(['くま', 'ねこ', 'くま'], ['ねこ', 'かめ']), ['ねこ', 'くま', 'かめ']);
  assert.deepEqual(rosterOf(['らいおん', '', null, undefined, 5, {}, ['ねこ']], 'ねこ', null), []);
  assert.deepEqual(rosterOf(), []);
  assert.deepEqual(rosterOf(ANIMALS), ANIMALS);
});

test('rosterOf: 渡すのは動物の名前だけで、よびかたを受け取らない（動物以外の文字は結果に入らない）', () => {
  assert.deepEqual(rosterOf(['おばあちゃん', 'まご', 'ねこ']), ['ねこ']);
});

test('countText: 動物の種類の数を言う。「人」とも「みんな投稿した」とも言わない', () => {
  assert.equal(countText(3), 'きょうの茶の間: どうぶつ 3 種類');
  assert.equal(countText(1), 'きょうの茶の間: どうぶつ 1 種類');
  for (const n of [0, 1, 6]) assert.ok(!/人|投稿|みんな|そろ/.test(countText(n)), countText(n));
});

test('fitScale: 幅に収まる整数倍。320 に満たなければ null', () => {
  assert.equal(fitScale(320), 1);
  assert.equal(fitScale(319), null);
  assert.equal(fitScale(640), 2);
  assert.equal(fitScale(959), 2);
  assert.equal(fitScale(960), 3);
  assert.equal(fitScale(0), null);
  assert.equal(fitScale(NaN), null);
});

test('stepCreature: 5000 コマ動かしても、部屋の中から出ず、歩く・座る・はねるの 3 つが出る', () => {
  const rng = seeded(7);
  const states = new Set();
  for (const [i, animal] of ANIMALS.entries()) {
    const c = newCreature(animal, i, rng);
    for (let n = 0; n < 5000; n++) {
      stepCreature(c, rng);
      states.add(c.state);
      assert.ok(c.x >= 0 && c.x <= W && c.y >= 100 && c.y <= H, `${animal}: (${c.x}, ${c.y})`);
      assert.ok(c.hop >= 0 && c.hop < HOP_PATH.length);
    }
  }
  assert.deepEqual([...states].sort(), ['hop', 'sit', 'walk']);
});

test('stepCreature: 動きは乱数だけで決まる（同じ乱数なら、同じ動き）', () => {
  const run = (seed) => {
    const rng = seeded(seed);
    const c = newCreature('ねこ', 0, rng);
    const trace = [];
    for (let n = 0; n < 300; n++) {
      stepCreature(c, rng);
      trace.push(`${c.x},${c.y},${c.state}`);
    }
    return trace.join('|');
  };
  assert.equal(run(1), run(1));
  assert.notEqual(run(1), run(2));
});

test('stepCreature: 座る動物は、ちゃぶ台のまわりの席へ歩いていき、着いたら座る', () => {
  const rng = seeded(3);
  const c = newCreature('いぬ', 2, rng);
  c.state = 'sit';
  c.timer = 30;
  for (let n = 0; n < 400 && !c.seated; n++) stepCreature(c, rng);
  assert.equal(c.seated, true);
  assert.deepEqual([c.x, c.y], TABLE_SEATS[2]);
});

test('はねる: 床の位置は動かず、上へのずれは HOP_PATH の範囲で、終わると別の動きに替わる', () => {
  const rng = seeded(11);
  const c = newCreature('うさぎ', 1, rng);
  c.state = 'hop';
  c.timer = HOP_PATH.length;
  c.hop = 0;
  const { x, y } = c;
  for (let n = 0; n < HOP_PATH.length; n++) {
    // はねている間は、床の位置は変わらず、高さの番号は決まった範囲の中
    if (c.state === 'hop') {
      assert.deepEqual([c.x, c.y], [x, y]);
      assert.ok(c.hop >= 0 && c.hop < HOP_PATH.length);
    }
    stepCreature(c, rng);
  }
  // HOP_PATH の長さのコマが終わると、次の動きが選ばれている（続けてはねるときは、高さの番号が 0 に戻る）
  assert.ok(c.timer > 0);
  assert.ok(c.state !== 'hop' || c.hop === 0);
});

test('夜 7 時（watching）: 全員がテレビの前の席に着いて座る。終わると、元の動きに戻る', () => {
  const rng = seeded(5);
  const all = ANIMALS.map((a, i) => newCreature(a, i, rng));
  for (let n = 0; n < 600; n++) all.forEach((c) => stepCreature(c, rng, true));
  all.forEach((c, i) => {
    assert.deepEqual([c.x, c.y], WATCH_SEATS[i], c.animal);
    assert.equal(c.seated, true);
    assert.equal(c.state, 'sit');
  });
  // 番組が終わる: 1 コマで、集まった状態をやめる（watching が false に戻る）
  all.forEach((c) => stepCreature(c, rng, false));
  all.forEach((c) => assert.equal(c.watching, false));
  // その後は 3000 コマのうちに、席から離れて歩く動物が出る
  let walked = 0;
  for (let n = 0; n < 3000; n++) {
    all.forEach((c) => {
      stepCreature(c, rng, false);
      if (c.state === 'walk') walked++;
    });
  }
  assert.ok(walked > 0);
});

test('pickState: 歩く・座る・はねるの割合は、およそ 5 : 3.5 : 1.5', () => {
  const rng = seeded(99);
  const c = newCreature('ねこ', 0, rng);
  const n = { walk: 0, sit: 0, hop: 0 };
  for (let i = 0; i < 20000; i++) {
    pickState(c, rng);
    n[c.state]++;
  }
  assert.ok(Math.abs(n.walk / 20000 - 0.5) < 0.02, JSON.stringify(n));
  assert.ok(Math.abs(n.sit / 20000 - 0.35) < 0.02, JSON.stringify(n));
  assert.ok(Math.abs(n.hop / 20000 - 0.15) < 0.02, JSON.stringify(n));
});

test('drawSpriteAt: flip で左右が入れ替わり、同じ数のドットを描く', () => {
  const dots = (flip) => {
    const out = [];
    drawSpriteAt({ set fillStyle(v) { this.c = v; }, fillRect: (x, y, w, h) => out.push(`${x},${y},${w},${h}`) }, 'ねこ', 0, 0, { flip });
    return out;
  };
  const a = dots(false);
  const b = dots(true);
  assert.equal(a.length, b.length);
  assert.notDeepEqual(a, b);
  // ねこの顔は左右対称ではないが、反転を2回しても元と同じになる性質を、描いた四角の合計面積で確かめる
  const area = (list) => list.reduce((s, r) => s + Number(r.split(',')[2]), 0);
  assert.equal(area(a), area(b));
});

// ---- createChaNoMa（偽の canvas で） ----
function fakeEnv({ hidden = false } = {}) {
  const log = [];
  const ctx = {
    log,
    set fillStyle(v) { this.fs = v; },
    get fillStyle() { return this.fs; },
    fillRect: (...a) => log.push(a.join(',')),
    clearRect: () => log.push('clear'),
    drawImage: () => log.push('image'),
  };
  const canvasOf = () => ({ width: 0, height: 0, getContext: () => ctx });
  const listeners = {};
  const doc = {
    visibilityState: hidden ? 'hidden' : 'visible',
    createElement: canvasOf,
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    emit(type) { (listeners[type] ?? []).forEach((fn) => fn()); },
  };
  return { ctx, log, doc, canvas: canvasOf() };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('createChaNoMa: 動物がいると、画面が時間とともに変わる。タブが見えないあいだは止まり、見えたら再開する', async () => {
  const env = fakeEnv();
  const room = createChaNoMa(env.canvas, { document: env.doc, rng: seeded(21), reducedMotion: () => false });
  assert.equal(env.canvas.width, W);
  assert.equal(env.canvas.height, H);
  room.setAnimals(['ねこ', 'くま']);
  assert.equal(room.count(), 2);
  assert.equal(room.isRunning(), true);
  env.log.length = 0;
  room.render();
  const first = env.log.join('|');
  await wait(FRAME_MS * 6);
  env.log.length = 0;
  room.render();
  assert.notEqual(env.log.join('|'), first, '時間がたっても絵が変わらない');
  // タブが見えなくなる → 止まる。見えるようになる → 動く
  env.doc.visibilityState = 'hidden';
  env.doc.emit('visibilitychange');
  assert.equal(room.isRunning(), false);
  env.doc.visibilityState = 'visible';
  env.doc.emit('visibilitychange');
  assert.equal(room.isRunning(), true);
  room.stop();
  assert.equal(room.isRunning(), false);
});

test('createChaNoMa: 動きを減らす設定では、動かさず、静止画を描く（動物は席に座っている）', async () => {
  const env = fakeEnv();
  const room = createChaNoMa(env.canvas, { document: env.doc, rng: seeded(21), reducedMotion: () => true });
  room.setAnimals(['ねこ']);
  assert.equal(room.isRunning(), false);
  env.log.length = 0;
  room.render();
  const first = env.log.join('|');
  await wait(FRAME_MS * 4);
  env.log.length = 0;
  room.render();
  // 湯気は tick で変わるが、tick は動いていないので、同じ絵になる
  assert.equal(env.log.join('|'), first);
});

test('createChaNoMa: setWatching でテレビの絵が変わる（光る）', () => {
  const env = fakeEnv();
  const room = createChaNoMa(env.canvas, { document: env.doc, rng: seeded(1), reducedMotion: () => true });
  env.log.length = 0;
  room.render();
  const off = env.log.join('|');
  room.setWatching(true);
  env.log.length = 0;
  room.render();
  assert.notEqual(env.log.join('|'), off);
  room.stop();
});

test('createChaNoMa: 見えないタブで始めたときは、動かさない', () => {
  const env = fakeEnv({ hidden: true });
  const room = createChaNoMa(env.canvas, { document: env.doc, rng: seeded(1), reducedMotion: () => false });
  assert.equal(room.isRunning(), false);
});
