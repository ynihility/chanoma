// ドット絵を canvas に描く小さな道具。外部のライブラリは使わない
import { PALETTE, SPRITES } from './sprites.js';

// 影の色と、ずらす量（ドット単位）
const SHADOW_COLOR = PALETTE.s;
const SHADOW_DOTS = 1;

// 倍率は 1 以上の整数だけにする（端数の倍率はドットがにじむため）
function toScale(scale) {
  const n = Math.floor(Number(scale));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

// スプライトを canvas に描く。options.shadow が true なら、右下に1ドットずらした影を付ける
export function drawSprite(canvas, name, scale = 1, options = {}) {
  const sprite = SPRITES[name];
  if (!sprite) return false;
  const s = toScale(scale);
  const pad = options.shadow ? SHADOW_DOTS : 0;
  canvas.width = (sprite.w + pad) * s;
  canvas.height = (sprite.h + pad) * s;
  // 表示の大きさも整数倍に固定する（CSS で伸び縮みしてにじまないように）
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  // canvas の大きさを変えると設定が戻るので、描くたびに補間を切る
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // 影: 透明でないドットを、影の色で右下にずらして先に塗る
  if (pad) {
    ctx.fillStyle = SHADOW_COLOR;
    sprite.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== '.') ctx.fillRect((x + pad) * s, (y + pad) * s, s, s);
      }
    });
  }
  // 本体: 同じ色が横に続くところは1回の fillRect にまとめる
  sprite.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === key) end++;
      if (key !== '.' && PALETTE[key]) {
        ctx.fillStyle = PALETTE[key];
        ctx.fillRect(x * s, y * s, (end - x) * s, s);
      }
      x = end;
    }
  });
  return true;
}

// スプライトを描いた canvas を作って返す。
// label があれば絵として読み上げ（role="img"）、なければ飾りとして読み上げから外す
export function spriteCanvas(name, scale = 1, label, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'sprite';
  drawSprite(canvas, name, scale, options);
  if (label) {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
  } else {
    canvas.setAttribute('aria-hidden', 'true');
  }
  return canvas;
}
