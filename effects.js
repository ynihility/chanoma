// テレビの画面の上に重ねる演出（canvas）。画像や音声のファイルは使わず、四角を描くだけで作る。
// 外部のライブラリも使わない。演出は飾りなので、動かせない環境では、場面の入れ替えだけをすぐ行う。

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
// 「動きを減らす」設定のとき true。その場合、演出は動かさない
export const reducedMotion = () => window.matchMedia(REDUCED_QUERY).matches;

// ---- 色の道具 ----

// '#RRGGBB'、'rgb(r, g, b)'、'rgba(r, g, b, a)' を [r, g, b, a] にする。読めなければ null
function parseColor(text) {
  let m = /^#([0-9a-f]{6})$/i.exec(text);
  if (m) {
    const n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 1];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(text);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length >= 3 && p.every(Number.isFinite)) return [p[0], p[1], p[2], p[3] ?? 1];
  }
  return null;
}
// 画面の色は CSS の :root の変数から読む。色の決まりを、ここに二重に持たないため
const cssColor = (name, fallback) => parseColor(getComputedStyle(document.documentElement).getPropertyValue(name).trim()) ?? fallback;
// 色の混ぜ合わせは、光の量（線形の明るさ）で行う。見た目の数値（sRGB）のまま混ぜると、混ぜた色が実際より暗くなり、
// 絵を粗くしたときに画面全体が暗く沈んでしまうため
const LINEAR = Array.from({ length: 256 }, (_, v) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
});
const toSrgb = (x) => Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
// a から b へ、割合 t だけ近づけた色（[r, g, b]）
const mix = (a, b, t) => [0, 1, 2].map((i) => toSrgb(LINEAR[a[i]] + (LINEAR[b[i]] - LINEAR[a[i]]) * t));
const toCss = ([r, g, b]) => `rgb(${r},${g},${b})`;

// ---- いまの画面を、粗い色の塊として読み取る ----

// 画面の部品ごとの「文字が占める割合」。文字は面の一部しか塗らないので、地の色と文字の色をこの割合で混ぜると、
// 絵を粗くしたときの平均に近い色になる。後に書いたものほど手前（上に重なるもの）
const COVER = [['.bars span', 0], ['.corner', 0.55], ['.meet', 0.45], ['.notice', 0.45], ['.wait-card', 0.3], ['.post', 0.28], ['.host', 0.3], ['.ai-chip', 0.35], ['.sprite', 0.5]];

// 戻り値は、画面の中の座標（x, y）から、その場所の粗い色 [r, g, b] を返す関数。
// 画面を実際に撮るのではなく、各部品の場所と色から作る（画像の読み取りや外部の道具は使わない）
function sampleLayout(screen) {
  const crt = cssColor('--crt', [16, 33, 26]);
  const mid = cssColor('--crt-mid', [26, 51, 40]);
  const light = cssColor('--crt-light', [191, 232, 208]);
  const box = screen.getBoundingClientRect();
  const ox = box.left + screen.clientLeft;
  const oy = box.top + screen.clientTop;
  const regions = [];
  for (const [selector, cover] of COVER) {
    for (const e of screen.querySelectorAll(selector)) {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      const fg = parseColor(cs.color) ?? light;
      const bgRaw = parseColor(cs.backgroundColor);
      // 地が透けている部品は、画面の色の上に載っているものとして扱う
      const bg = bgRaw && bgRaw[3] > 0.5 ? bgRaw : mid;
      regions.push({ x0: r.left - ox, y0: r.top - oy, x1: r.right - ox, y1: r.bottom - oy, color: mix(bg, fg, cover) });
    }
  }
  return (x, y) => {
    for (let i = regions.length - 1; i >= 0; i--) {
      const g = regions[i];
      if (x >= g.x0 && x < g.x1 && y >= g.y0 && y < g.y1) return g.color;
    }
    // 何もない所は、画面の濃い緑の中でゆらぐ
    return mix(crt, mid, Math.random());
  };
}

// ---- 四角の並び ----

// 画面を、およそ cell px の四角に分ける。端が1pxずつずれて隙間にならないよう、境目は整数で持つ
function makeGrid(w, h, cell) {
  const cols = Math.max(4, Math.round(w / cell));
  const rows = Math.max(3, Math.round(h / cell));
  const xs = Array.from({ length: cols + 1 }, (_, i) => Math.round((i * w) / cols));
  const ys = Array.from({ length: rows + 1 }, (_, i) => Math.round((i * h) / rows));
  return { cols, rows, xs, ys, count: cols * rows };
}

// i 番目の四角を、中心を保ったまま s 倍（0〜1）の大きさで塗る
function fillCell(ctx, g, i, s) {
  const c = i % g.cols;
  const r = Math.floor(i / g.cols);
  const x0 = g.xs[c];
  const y0 = g.ys[r];
  const cw = g.xs[c + 1] - x0;
  const ch = g.ys[r + 1] - y0;
  const w = Math.round(cw * s);
  const h = Math.round(ch * s);
  ctx.fillRect(x0 + Math.floor((cw - w) / 2), y0 + Math.floor((ch - h) / 2), w, h);
}

// 四角ごとの、動き出す遅れ（0〜1）。ばらつきに、流れの向きを少し混ぜる
const DELAYS = {
  // 画面の左から右へ
  x: (g) => Array.from({ length: g.count }, (_, i) => 0.6 * Math.random() + 0.4 * ((i % g.cols) / (g.cols - 1))),
  // 画面の上から下へ
  y: (g) => Array.from({ length: g.count }, (_, i) => 0.55 * Math.random() + 0.45 * (Math.floor(i / g.cols) / (g.rows - 1))),
  // 順番なし
  random: (g) => Array.from({ length: g.count }, () => Math.random()),
  // 上から下へ進みながら、1行おきに先に晴れる（昔のテレビの、飛び越し走査のように）
  scan: (g) => Array.from({ length: g.count }, (_, i) => {
    const r = Math.floor(i / g.cols);
    return 0.6 * (r / (g.rows - 1)) + 0.25 * (r % 2) + 0.15 * Math.random();
  }),
};

// ---- 四角の色の作り方 ----

// 「四角の並び g」を渡すと、四角ごとの色（[r, g, b]）の一覧を返す関数を作る。
// いまの画面の絵を粗くした色で、呼んだ時点の画面を読み取る（はじめは前の絵、入れ替えのあとは新しい絵）。
// grain が 0 より大きいときは、その割合だけ、暗い緑の粒（砂嵐）をまぜる。絵の色を土台にするので、
// 砂嵐のあいだも画面の明るさが大きくは変わらず、ちらつきにならない
function look(screen, grain) {
  const crt = cssColor('--crt', [16, 33, 26]);
  const mid = cssColor('--crt-mid', [26, 51, 40]);
  const light = cssColor('--crt-light', [191, 232, 208]);
  const tones = [crt, mid, mix(mid, light, 0.15), mix(mid, light, 0.28)];
  const spark = mix(mid, light, 0.55);
  return (g) => {
    const at = sampleLayout(screen);
    return Array.from({ length: g.count }, (_, i) => {
      const c = i % g.cols;
      const r = Math.floor(i / g.cols);
      const base = at((g.xs[c] + g.xs[c + 1]) / 2, (g.ys[r] + g.ys[r + 1]) / 2);
      if (!grain) return base;
      // ごくまれに、少し明るい粒を混ぜる
      return mix(base, Math.random() < 0.02 ? spark : tones[Math.floor(Math.random() * tones.length)], grain);
    });
  };
}

// ---- 演出の種類 ----
// 時間はミリ秒。全体は「四角が出そろう → 中身を入れ替える → 四角がほどける」の順で、どちらも1秒に届かない
//   cell: 四角の大きさ（px）  coverSpread・grow: 四角が出そろうまでのばらつきと、1つが出る長さ
//   hold: 入れ替えの間  revealSpread・shrink: ほどけるまでのばらつきと、1つが消える長さ
//   steps: 大きさの段数（コマ送りの細かさ）  cover・reveal: 出る順・消える順（DELAYS）
//   grain: まぜる砂嵐の粒の割合（0なら絵の色だけ）  reroll: 粒を振り直す間隔（0なら振り直さない）  fps: 描く回数の上限（0なら制限なし）
const KINDS = {
  // コーナーが変わるとき。絵が粗い四角に崩れ、新しい絵の粗い四角に変わってから、ほどけて新しい絵が出る
  mosaic: { cell: 40, coverSpread: 170, grow: 90, hold: 120, revealSpread: 170, shrink: 90, steps: 3, cover: 'x', reveal: 'y', grain: 0, reroll: 0, fps: 0 },
  // 同じコーナーの中で、つぎの場面へ進むとき。細かい砂嵐が一瞬で絵をおおい、上から1行おきに晴れて、文が出る
  snow: { cell: 8, coverSpread: 70, grow: 40, hold: 40, revealSpread: 260, shrink: 40, steps: 1, cover: 'random', reveal: 'scan', grain: 0.25, reroll: 80, fps: 24 },
};

// 並びが変わったとき（中身の高さが変わったとき）に、前の色を新しい並びへ写し取る。
// 前の画面の外だった所は fallback の色にする。色が急に変わらないよう、色の移り変わりを続けるために使う
function resample(from, colors, to, fallback) {
  const index = (edges, count, v) => edges.findIndex((e, k) => k < count && v >= e && v < edges[k + 1]);
  return Array.from({ length: to.count }, (_, i) => {
    const c = i % to.cols;
    const r = Math.floor(i / to.cols);
    const fc = index(from.xs, from.cols, (to.xs[c] + to.xs[c + 1]) / 2);
    const fr = index(from.ys, from.rows, (to.ys[r] + to.ys[r + 1]) / 2);
    return fc >= 0 && fr >= 0 ? colors[fr * from.cols + fc] : fallback;
  });
}

// 画面（.screen）に演出を重ねて、四角が出そろったところで swap() を呼ぶ（中身の入れ替えは、四角の陰で行う）。
// 戻り値の done は、演出が終わると解決する。skip() は、演出を今すぐ終わらせる（swap がまだなら、先に呼ぶ）
export function playWipe(screen, kind, swap) {
  const cfg = KINDS[kind];
  const none = { done: Promise.resolve(), skip() {} };
  let w = screen.clientWidth;
  let h = screen.clientHeight;
  const canvas = document.createElement('canvas');
  const ctx = cfg && !reducedMotion() && w >= 40 && h >= 40 ? canvas.getContext('2d') : null;
  if (!ctx) {
    swap();
    return none;
  }
  canvas.className = 'fx';
  canvas.setAttribute('aria-hidden', 'true');
  // 位置と重なり順は、ここで決める（画面の中身より手前、操作は邪魔しない）
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;image-rendering:pixelated';
  canvas.width = w;
  canvas.height = h;
  screen.append(canvas);

  const crt = cssColor('--crt', [16, 33, 26]);
  const mid = cssColor('--crt-mid', [26, 51, 40]);
  const colorsOf = look(screen, cfg.grain);
  let grid = makeGrid(w, h, cfg.cell);
  let colorsFrom = colorsOf(grid);
  let colorsTo = null;
  let delayOut = null;
  const delayIn = DELAYS[cfg.cover](grid).map((d) => d * cfg.coverSpread);

  const coverEnd = cfg.coverSpread + cfg.grow;
  const holdEnd = coverEnd + cfg.hold;
  const total = holdEnd + cfg.revealSpread + cfg.shrink;
  // 四角の大きさの割合（0〜1）。段をつけて、コマ送りのように大きくなる
  const step = (t, start, len) => Math.ceil(Math.min(1, Math.max(0, (t - start) / len)) * cfg.steps) / cfg.steps;

  let swapped = false;
  let finished = false;
  let rafId = 0;
  let t0;
  let lastDraw = -1e9;
  let lastRoll = 0;
  let resolve;
  const done = new Promise((r) => { resolve = r; });

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(rafId);
    canvas.remove();
    resolve();
  }

  // 四角が全部出ている間に、中身を入れ替え、新しい絵に合わせて四角の色と並びを作り直す。
  // このときに入れ替えたなら true（そのコマは、すぐ描き直す）
  function doSwap() {
    if (swapped) return false;
    swapped = true;
    // 入れ替えの途中で例外が出ても、四角（canvas）が画面に残ったり、演出の終わりを待つ側が固まったりしないよう、
    // 最後まで行かなかったときは、必ず finish() を通して片づける（例外そのものは、そのまま呼び出し元へ返す）
    let ok = false;
    try {
      swap();
      w = screen.clientWidth;
      h = screen.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const next = makeGrid(w, h, cfg.cell);
      // 並びが変わった（中身の高さが変わった）ときは、前の色を新しい並びに写して、そこから新しい色へ移り変わらせる
      if (next.cols !== grid.cols || next.rows !== grid.rows) colorsFrom = resample(grid, colorsFrom, next, mix(crt, mid, 0.5));
      grid = next;
      colorsTo = colorsOf(grid);
      delayOut = DELAYS[cfg.reveal](grid).map((d) => d * cfg.revealSpread);
      ok = true;
    } finally {
      if (!ok) finish();
    }
    return true;
  }

  function frame(now) {
    rafId = 0;
    t0 ??= now;
    const t = Math.max(0, now - t0);
    const justSwapped = t >= coverEnd && doSwap();
    // 描く回数に上限がある演出（砂嵐）は、間を空ける。入れ替えた直後と、終わりの処理は止めない
    if (!justSwapped && cfg.fps && t < total && now - lastDraw < 1000 / cfg.fps - 4) {
      rafId = requestAnimationFrame(frame);
      return;
    }
    lastDraw = now;
    // 砂嵐は、一定の間隔で粒の色を振り直す
    if (cfg.reroll && now - lastRoll >= cfg.reroll) {
      lastRoll = now;
      colorsFrom = colorsOf(grid);
      if (swapped) colorsTo = colorsOf(grid);
    }
    ctx.clearRect(0, 0, w, h);
    if (t < coverEnd) {
      for (let i = 0; i < grid.count; i++) {
        const s = step(t, delayIn[i], cfg.grow);
        if (s > 0) {
          ctx.fillStyle = toCss(colorsFrom[i]);
          fillCell(ctx, grid, i, s);
        }
      }
    } else if (t < holdEnd) {
      const k = (t - coverEnd) / cfg.hold;
      for (let i = 0; i < grid.count; i++) {
        ctx.fillStyle = toCss(mix(colorsFrom[i], colorsTo[i], k));
        fillCell(ctx, grid, i, 1);
      }
    } else if (t < total) {
      for (let i = 0; i < grid.count; i++) {
        const s = 1 - step(t - holdEnd, delayOut[i], cfg.shrink);
        if (s > 0) {
          ctx.fillStyle = toCss(colorsTo[i]);
          fillCell(ctx, grid, i, s);
        }
      }
    } else {
      finish();
      return;
    }
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    done,
    skip() {
      doSwap();
      finish();
    },
  };
}
