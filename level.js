// 自分のキャラのレベル。この端末の中だけで数え、サーバーにも家族にも送らない（家族のレベルとは比べない）。
// ブラウザでも Node でも同じ計算が動くように、外のものは何も読み込まない。

export const LEVEL_KEY = 'chanoma.v1.level';
// 投稿1件 +3、スタンプ1件 +1
export const XP_POST = 3;
export const XP_STAMP = 1;
// 壊れた保存データで、極端に大きな数が入らないようにする上限
const MAX_XP = 1_000_000;

// 経験値からレベルを出す。Lv.2 は投稿1件（3）、Lv.3 は4件（12）、Lv.4 は9件（27）…
export const levelOf = (xp) => Math.floor(Math.sqrt(xp / XP_POST)) + 1;

// 投稿1件でもらえる経験値
export const xpOf = (post) => (post?.kind === 'stamp' ? XP_STAMP : XP_POST);

// 保存の文字列を読む。型を確かめて、level は保存された値を信じず xp から計算し直す。壊れていれば最初の状態
export function loadLevel(raw) {
  const first = { xp: 0, level: 1 };
  if (typeof raw !== 'string' || raw.length > 1024) return first;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return first;
  }
  const xp = data?.xp;
  if (!Number.isSafeInteger(xp) || xp < 0 || xp > MAX_XP) return first;
  return { xp, level: levelOf(xp) };
}

// 経験値を足す。up はレベルが上がったか
export function addXp(current, gain) {
  const xp = Math.min(MAX_XP, current.xp + gain);
  const level = levelOf(xp);
  return { xp, level, up: level > current.level };
}

export const serializeLevel = (current) => JSON.stringify({ xp: current.xp, level: current.level });

// ページが上まで戻ってから run を1回だけ呼ぶ。レベルアップの一言は、送信後に画面が上へ戻る前に出すと
// 下にいる人には見えないまま時間が過ぎるため、見える位置に着いてから出す。
// 上に戻らないとき（本人が画面を動かしたとき）のために、timeoutMs たったら、その場で出す。戻り値は取り消す関数
export function whenAtTop(win, run, { topPx = 40, timeoutMs = 6000 } = {}) {
  let done = false;
  let timer = 0;
  const cancel = () => {
    done = true;
    clearTimeout(timer);
    win.removeEventListener('scroll', onScroll);
  };
  const fire = () => {
    if (done) return;
    cancel();
    run();
  };
  function onScroll() {
    if (win.scrollY <= topPx) fire();
  }
  if (win.scrollY <= topPx) {
    fire();
    return cancel;
  }
  win.addEventListener('scroll', onScroll, { passive: true });
  timer = setTimeout(fire, timeoutMs);
  return cancel;
}
