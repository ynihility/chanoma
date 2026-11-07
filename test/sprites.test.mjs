// sprites.js のテスト。手で打った絵の列は、幅や文字の打ち間違いに気づきにくいので、形を確かめる。実行: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, SPRITES } from '../sprites.js';

const STAMP_NAMES = ['ゆのみ', 'みかん', 'おにぎり', 'はな', 'ほし', 'ふとん'];

test('すべてのスプライト: 行数が h、各行の長さが w、文字は透明（.）かパレットのキー', () => {
  for (const [name, sprite] of Object.entries(SPRITES)) {
    assert.equal(sprite.rows.length, sprite.h, `${name}: 行数`);
    sprite.rows.forEach((row, y) => {
      assert.equal(row.length, sprite.w, `${name}: ${y} 行目の長さ`);
      for (const ch of row) assert.ok(ch === '.' || ch in PALETTE, `${name}: ${y} 行目の文字「${ch}」がパレットにない`);
    });
  }
});

test('スタンプ 6 種: 16×16 で、輪郭（k）と中身があり、装飾の「みかん」「湯呑」を上書きしていない', () => {
  for (const name of STAMP_NAMES) {
    const sprite = SPRITES[`スタンプ:${name}`];
    assert.ok(sprite, `${name} がない`);
    assert.deepEqual([sprite.w, sprite.h], [16, 16]);
    const dots = sprite.rows.join('');
    assert.ok(dots.includes('k'), `${name}: 輪郭がない`);
    // 透明でないドットが、全体の 20% 以上ある（空の絵ではない）
    const filled = [...dots].filter((ch) => ch !== '.').length;
    assert.ok(filled >= 256 * 0.2, `${name}: ドットが少なすぎる（${filled}）`);
  }
  // 障子の飾りが使う 12×12 の「みかん」はそのまま
  assert.deepEqual([SPRITES['みかん'].w, SPRITES['みかん'].h], [12, 12]);
  assert.deepEqual([SPRITES['湯呑'].w, SPRITES['湯呑'].h], [12, 12]);
});

test('動物の胴: ねこ・いぬ・うさぎ・くまに、立1・立2・座の 8×6。体の色（B・D）は残らない', () => {
  for (const animal of ['ねこ', 'いぬ', 'うさぎ', 'くま']) {
    for (const frame of ['立1', '立2', '座']) {
      const sprite = SPRITES[`からだ:${animal}:${frame}`];
      assert.ok(sprite, `${animal} ${frame}`);
      assert.deepEqual([sprite.w, sprite.h], [8, 6]);
      assert.ok(!sprite.rows.join('').match(/[BD]/), `${animal} ${frame}: 色が置き換わっていない`);
    }
  }
  // 全身の横向きの絵（すずめ・かめ）には胴を足さない
  assert.equal(SPRITES['からだ:すずめ:立1'], undefined);
  assert.equal(SPRITES['からだ:かめ:立1'], undefined);
});
