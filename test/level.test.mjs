// level.js のテスト。レベルの計算と、保存データの読み込み。実行: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { levelOf, xpOf, loadLevel, addXp, serializeLevel, whenAtTop, XP_POST, XP_STAMP } from '../level.js';

test('levelOf: 投稿 1 件で Lv.2、4 件で Lv.3、9 件で Lv.4（境目の前後も確かめる）', () => {
  assert.equal(levelOf(0), 1);
  assert.equal(levelOf(2), 1);
  assert.equal(levelOf(3), 2); // 投稿 1 件
  assert.equal(levelOf(11), 2);
  assert.equal(levelOf(12), 3); // 投稿 4 件
  assert.equal(levelOf(26), 3);
  assert.equal(levelOf(27), 4); // 投稿 9 件
  assert.equal(levelOf(48), 5); // 投稿 16 件
});

test('xpOf: 投稿 +3、スタンプ +1', () => {
  assert.equal(XP_POST, 3);
  assert.equal(XP_STAMP, 1);
  assert.equal(xpOf({ id: 'a', topic: 'そら' }), 3);
  assert.equal(xpOf({ id: 'a', kind: 'stamp', stamp: 'ほし' }), 1);
});

test('addXp: 投稿 1 件でレベルが上がる。スタンプ 3 件では上がらず、4 件目で上がる', () => {
  let cur = { xp: 0, level: 1 };
  cur = addXp(cur, xpOf({ topic: 'そら' }));
  assert.deepEqual(cur, { xp: 3, level: 2, up: true });
  cur = { xp: 0, level: 1 };
  for (let i = 0; i < 2; i++) {
    cur = addXp(cur, XP_STAMP);
    assert.equal(cur.up, false);
  }
  assert.equal(cur.level, 1);
  cur = addXp(cur, XP_STAMP);
  assert.equal(cur.xp, 3);
  assert.equal(cur.up, true);
  // 上がらない足しかたでは up が false
  assert.equal(addXp({ xp: 3, level: 2 }, 3).up, false);
});

test('loadLevel: 保存した値を読み戻せる', () => {
  assert.deepEqual(loadLevel(serializeLevel({ xp: 12, level: 3 })), { xp: 12, level: 3 });
});

test('loadLevel: level は保存された値を信じず、xp から計算し直す', () => {
  assert.deepEqual(loadLevel('{"xp":3,"level":99}'), { xp: 3, level: 2 });
});

test('loadLevel: 壊れた保存データは、最初の状態に戻す', () => {
  const first = { xp: 0, level: 1 };
  for (const raw of [null, undefined, '', 'こわれた', '[]', 'null', '{}', '{"xp":-1}', '{"xp":1.5}', '{"xp":"3"}', '{"xp":1e12}', '{"xp":null}', 42, 'x'.repeat(2000)]) {
    assert.deepEqual(loadLevel(raw), first, String(raw).slice(0, 20));
  }
});

// ---- whenAtTop: 上に戻ってから一言を出す ----
// window の代わりの、スクロール位置と scroll の聞き役だけを持つ見本
function fakeWindow(scrollY) {
  const listeners = new Set();
  return {
    scrollY,
    addEventListener: (type, fn) => type === 'scroll' && listeners.add(fn),
    removeEventListener: (type, fn) => type === 'scroll' && listeners.delete(fn),
    scrollTo(y) {
      this.scrollY = y;
      for (const fn of [...listeners]) fn();
    },
    count: () => listeners.size,
  };
}

test('whenAtTop: すでに上にいれば、その場で 1 回だけ呼ぶ', () => {
  const win = fakeWindow(0);
  let n = 0;
  whenAtTop(win, () => n++);
  assert.equal(n, 1);
  assert.equal(win.count(), 0);
});

test('whenAtTop: 下にいるあいだは呼ばず、上に着いたとき 1 回だけ呼ぶ（聞き役も外す）', () => {
  const win = fakeWindow(5264);
  let n = 0;
  whenAtTop(win, () => n++, { timeoutMs: 5000 });
  assert.equal(n, 0);
  win.scrollTo(2000);
  win.scrollTo(41); // 境目の外（40 より下）
  assert.equal(n, 0);
  win.scrollTo(40); // 境目（40 以内は上とみなす）
  assert.equal(n, 1);
  win.scrollTo(0);
  assert.equal(n, 1);
  assert.equal(win.count(), 0);
});

test('whenAtTop: 上に戻らないときは、時間が来たらその場で呼ぶ', async () => {
  const win = fakeWindow(900);
  let n = 0;
  whenAtTop(win, () => n++, { timeoutMs: 30 });
  assert.equal(n, 0);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(n, 1);
  assert.equal(win.count(), 0);
});

test('whenAtTop: 取り消せば、上に着いても時間が来ても呼ばない', async () => {
  const win = fakeWindow(900);
  let n = 0;
  const cancel = whenAtTop(win, () => n++, { timeoutMs: 30 });
  cancel();
  win.scrollTo(0);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(n, 0);
  assert.equal(win.count(), 0);
});
