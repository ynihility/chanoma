// sound.js のテレ吉の声（文字→高さ、文→音の計画）のテスト。実行: node --test
// 音の聞こえ方は確かめられない（耳で確かめる）。ここで見るのは、高さ・数・間隔の決まりと、音が出せない環境で何も起きないこと。
import test from 'node:test';
import assert from 'node:assert/strict';
import { pitchForChar, planVoice, hostBlips, stopBlips, setMuted } from '../sound.js';

test('同じ文字は同じ高さで、300〜700Hz の範囲に入る', () => {
  for (const ch of 'あいうえおかきくけこ漢字ABC1ー') {
    const f = pitchForChar(ch);
    if (ch === 'ー') continue;
    assert.equal(f, pitchForChar(ch));
    assert.ok(f >= 300 && f <= 700, `${ch}: ${f}`);
  }
});

test('カタカナはひらがなと同じ高さ', () => {
  assert.equal(pitchForChar('ア'), pitchForChar('あ'));
  assert.equal(pitchForChar('ン'), pitchForChar('ん'));
});

test('空白・句読点・記号・空文字・文字でないものは無音', () => {
  for (const ch of [' ', '　', '、', '。', '！', '？', '…', '「', '」', '・', '\n', ',', '.', '', null, 1]) {
    assert.equal(pitchForChar(ch), null, JSON.stringify(ch));
  }
});

test('空文字・文字列でないものからは音が出ない', () => {
  assert.deepEqual(planVoice(''), []);
  assert.deepEqual(planVoice('、。 　'), []);
  assert.deepEqual(planVoice(undefined), []);
  assert.deepEqual(planVoice(42), []);
});

test('句読点は鳴らさず、一拍あける', () => {
  const [a, b] = planVoice('あ、い');
  assert.ok(b.start - a.start > 0.139, `${b.start - a.start}`);
  const [c, d] = planVoice('あい');
  assert.ok(d.start - c.start >= 0.07 && d.start - c.start <= 0.09);
});

test('音の間隔は 70〜90ms', () => {
  const notes = planVoice('こんばんは、てれきちです');
  for (let i = 1; i < notes.length; i++) {
    const gap = notes[i].start - notes[i - 1].start;
    assert.ok(gap >= 0.0699, `gap ${gap}`);
  }
  const [x, y] = planVoice('こん');
  assert.ok(y.start - x.start >= 0.07 && y.start - x.start <= 0.09);
});

test('長い文でも音は40個まで、全体は5秒を超えない', () => {
  const notes = planVoice('あいうえおかきくけこ'.repeat(30));
  assert.equal(notes.length, 40);
  const end = notes.at(-1).start + notes.at(-1).dur;
  assert.ok(end < 5, `end ${end}`);
  const sparse = planVoice('あ、'.repeat(200));
  assert.ok(sparse.length <= 40);
  assert.ok(sparse.at(-1).start < 5);
});

test('長音と小さい文字は短く、長音は前の音と同じ高さ', () => {
  const notes = planVoice('おーゃあ');
  assert.equal(notes[1].freq, notes[0].freq);
  assert.ok(notes[1].dur < notes[0].dur);
  assert.ok(notes[2].dur < notes[3].dur);
  assert.equal(planVoice('ー').length, 0);
});

test('音が出せない環境（node）では、鳴らす・止める・ミュートが何も起きずに終わる', () => {
  assert.doesNotThrow(() => hostBlips('こんばんは'));
  assert.doesNotThrow(() => stopBlips());
  assert.doesNotThrow(() => setMuted(true));
  assert.doesNotThrow(() => hostBlips('こんばんは'));
  assert.doesNotThrow(() => setMuted(false));
});
