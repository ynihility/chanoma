// ちゃのまのサーバー。画面のファイルを配り、Claude に番組を組んでもらう。
// 起動の形は2つ。ローカル（既定）は 1台での実演用で、POST /api/news で番組を作る。
// 公開（CHANOMA_PUBLIC=1）は家族の「部屋」だけを出し、/api/news は出さない。部屋は /api/room 以下にある。
// 外部ライブラリは使わず、Node の標準モジュールと組み込みの fetch だけで書く。
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// 投稿と番組の検査は、画面でも使う safe.js に一本化している
import {
  CORNERS, FEATURES, REASONS, MAX_POSTS, MAX_PROGRAM_BYTES,
  cleanPosts, cleanPost, cleanDate, checkNews, checkPostWords, checkShelfProgram, isRoomCode, isDeviceHash, isDateKey,
} from './safe.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// 公開の形かどうか。公開では、ほかの端末（家族のスマホ）から届くように 0.0.0.0 で待ち受ける。
// ローカルでは、1台での実演が前提なので、ほかのパソコンからは届かないように 127.0.0.1 だけで待ち受ける
const PUBLIC = process.env.CHANOMA_PUBLIC === '1';
const HOST = PUBLIC ? '0.0.0.0' : '127.0.0.1';
const PORT = Number(process.env.PORT) || 8787;
// テストでは偽の API サーバーに向けられるように、送り先を環境変数で差し替えられるようにしている。
// Claude Code などが設定する ANTHROPIC_BASE_URL は、あえて読まない（本物の API に送るつもりが、別の接続先に
// 向いてしまうのを防ぐため）。テスト専用の名前 CHANOMA_API_BASE を指定したときだけ、差し替わる
const API_BASE = process.env.CHANOMA_API_BASE || 'https://api.anthropic.com';
const MODEL = 'claude-opus-5-5';
const SYSTEM_PROMPT = await readFile(path.join(ROOT, 'prompt.txt'), 'utf8');

// 配ってよいファイルだけを並べる。.env やサーバーのコードを URL から読まれないようにするため
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/safe.js': ['safe.js', 'text/javascript; charset=utf-8'],
  '/sound.js': ['sound.js', 'text/javascript; charset=utf-8'],
  '/voice.js': ['voice.js', 'text/javascript; charset=utf-8'],
  '/sprites.js': ['sprites.js', 'text/javascript; charset=utf-8'],
  '/pixel.js': ['pixel.js', 'text/javascript; charset=utf-8'],
  '/effects.js': ['effects.js', 'text/javascript; charset=utf-8'],
  '/sample.js': ['sample.js', 'text/javascript; charset=utf-8'],
  '/room.js': ['room.js', 'text/javascript; charset=utf-8'],
  // 同梱フォントと、そのライセンス全文（OFL では、フォントと一緒にライセンスを配る決まり）
  '/fonts/ReggaeOne-Regular.ttf': ['fonts/ReggaeOne-Regular.ttf', 'font/ttf'],
  '/fonts/DotGothic16-Regular.ttf': ['fonts/DotGothic16-Regular.ttf', 'font/ttf'],
  '/fonts/ChanomaDot-Regular.ttf': ['fonts/ChanomaDot-Regular.ttf', 'font/ttf'],
  '/fonts/OFL-ReggaeOne.txt': ['fonts/OFL-ReggaeOne.txt', 'text/plain; charset=utf-8'],
  '/fonts/OFL-DotGothic16.txt': ['fonts/OFL-DotGothic16.txt', 'text/plain; charset=utf-8'],
  '/fonts/LICENSE-ChanomaDot.txt': ['fonts/LICENSE-ChanomaDot.txt', 'text/plain; charset=utf-8'],
};
// 配るファイルは、起動時に1回だけ読み、同じ Buffer を使い回す。要求のたびに読むと、受け取らない接続の数だけ
// フォント（約2MB）の写しがメモリに残るため。起動時に読めなかったファイルは、起動を止めずに 404 のままにする。
// ファイルを直したときは、サーバーを起動し直すと反映される
const STATIC_CACHE = new Map();
for (const [urlPath, [file]] of Object.entries(STATIC_FILES)) {
  try {
    STATIC_CACHE.set(urlPath, await readFile(path.join(ROOT, file)));
  } catch {
    // 読めないファイルは入れない（handleStatic が 404 を返す）
  }
}
// 画面のファイルの応答で、接続に動きがないまま（受け取りが止まったまま）この長さがたったら、接続を切る。
// 送りの途中で少しずつ受け取っている端末の扱いは、置き場所の OS では確かめていないので、遅い回線でも約2MBが届く長さにしている。
// テストでは短い値に差し替えられる
const STATIC_SEND_TIMEOUT_MS = Number(process.env.CHANOMA_STATIC_SEND_TIMEOUT_MS) || 60_000;

// 30件 × 200文字のひとことが、日本語（1文字3バイト）で約22KBになる。それより余裕をもたせた上限
const MAX_BODY_BYTES = 32 * 1024;
// 同時に Claude を呼べる数。万一ほかから呼ばれ続けても、API の料金が一気に減らないようにする
const MAX_IN_FLIGHT = 3;
let inFlight = 0;
// 時間あたりの呼び出し上限。撮影スクリプトの暴走や連打で、API の料金を使い切らないようにする。
// テストでは少ない回数で上限に届くように、環境変数で差し替えられる
const RATE_PER_MINUTE = Number(process.env.CHANOMA_RATE_PER_MINUTE) || 10;
const RATE_PER_DAY = Number(process.env.CHANOMA_RATE_PER_DAY) || 100;
const RATE_LIMITED = '番組を作る回数が上限に達しました。しばらく待ってから、もう一度お試しください。';
// Claude を呼んだ時刻を古い順に持つ。24時間より前のものは捨てる。
// 時刻は Date.now() ではなく、戻らない時計の performance.now()（サーバーを起動してからのミリ秒）で数える。
// パソコンの時計を合わせ直されても（進んでも戻っても）、上限の数え方が狂わないようにするため
const callTimes = [];

// Claude への1回の問い合わせを待つ長さ
const API_TIMEOUT_MS = 90_000;
// 画面（app.js）が番組を待つ長さ。作り直しはこの中に収める
const CLIENT_WAIT_MS = 100_000;
// 1回目にこれより長くかかったら、作り直しは間に合わないので頼まない
const RETRY_WITHIN_MS = 45_000;
// 作り直しの待ち時間は、画面が待つ時間の残り（CLIENT_WAIT_MS - 1回目にかかった時間 - 余裕の5秒）で決まる。
// RETRY_WITHIN_MS を長くしすぎると、作り直しに回せる時間が足りなくなる。最低でも10秒は残る範囲かを起動時に確かめ、
// 守られていなければ、そのまま動かさずに止める
if (RETRY_WITHIN_MS > CLIENT_WAIT_MS - 15_000) {
  throw new Error('RETRY_WITHIN_MS は CLIENT_WAIT_MS - 15_000 以下にしてください（作り直しの待ち時間が足りなくなります）');
}
const NOT_BUILT = '番組をうまく組み立てられませんでした。もう一度お試しください。';
// 作り直しを頼むときの言い方。検査の理由には、返事の断片（投稿の文が写っていることもある）が入りうる。
// それを投稿の囲みの外に置くと、投稿に仕込まれた指示が格上げされるので、理由の文字列は渡さず、この一覧の決まった言い方だけを選ぶ
const RETRY_HINTS = [
  ['番組の形が違う', '返事は、決められた番組の JSON の形だけにしてください。'],
  ['segments の', 'すべての投稿を、1回ずつ、投稿にある id で使ってください。'],
  ['使われていない投稿', 'すべての投稿を、1回ずつ、投稿にある id で使ってください。'],
  ['投稿にないIDか', 'すべての投稿を、1回ずつ、投稿にある id で使ってください。'],
  ['コーナーの順番', 'コーナーは、ひとこと、むかし、つぎ の順に並べてください。'],
  ['投稿とコーナーが合わない', 'つぎに会う日の希望は「つぎ」に、今日の投稿はそれ以外のコーナーに入れてください。'],
  ['の長さや型が違う', 'つなぎの言葉とあいさつは、決められた長さの中で書いてください。'],
  ['見えない文字', '見えない文字や改行を入れないでください。'],
  ['HTML', '記号、URL、絵文字を入れないでください。'],
  ['順位づけ', '順位をつけたり、比べたりする言葉を使わないでください。'],
  ['健康や孤独', '健康や孤独にふれる言葉を使わないでください。'],
  ['助言や指図', '助言や指図にあたる言葉を使わないでください。'],
  ['催促や返事', '催促や返事を求める言葉を使わないでください。'],
  ['残り日数', '残り日数を言わないでください。'],
  ['日付や曜日', '日付や曜日を言わないでください。'],
  ['投稿にない家族のよびかた', '投稿にない人の呼び方や名前を足さないでください。'],
  ['投稿にない名前らしい言葉', '投稿にない人の呼び方や名前を足さないでください。'],
  ['投稿にないカタカナ語', '投稿に出てこない言葉を足さないでください。'],
  ['投稿にない英字', '投稿に出てこない言葉を足さないでください。'],
  ['投稿の本文を写している', '投稿の本文を、つなぎの言葉の中でくり返さないでください。'],
  ['なつかしいを選んだ今日の投稿', '見出しが「なつかしい」か札が「なつかしいもの」の、今日のことの投稿は、むかし のコーナーに入れてください。'],
  ['特集名', '今夜の特集名は、説明にある条件に合うものを選んでください。'],
  ['編成のわけ', '編成のわけは、そのコーナーに入れた投稿に当てはまるものを選んでください。'],
  ['lineup', 'lineup には、segments に出てくるコーナーを、出てくる順に1つずつ入れてください。'],
];
// 検査の理由の「…」の中には、返事や投稿の断片（家族の名前など）が入りうる。
// 断片に」が混ざっていても漏れないように、最後の」までまとめて対象にする
const FRAGMENT = /「.*」/gs;
// サーバーの記録に断片が残らないよう、「…」の中を伏せる（例: 投稿にない名前らしい言葉「…」がある）
const maskFragments = (reason) => reason.replace(FRAGMENT, '「…」');
// 作り直しの頼み方は、断片と、先頭の場所の印（host(p1): など）を取り除いた理由で選ぶ。
// 断片や投稿のIDに HTML などの言葉が入っていても、別の頼み方に取り違えないようにするため
const plainReason = (reason) => reason.replace(FRAGMENT, '').replace(/^(?:host\([^)]*\)|opening|closing): /, '');
const retryHint = (reason) => {
  const plain = plainReason(reason);
  return RETRY_HINTS.find(([key]) => plain.includes(key))?.[1] ?? 'ほかの決まりに合うように作り直してください。';
};

// 上限の中なら今回の分を数えて true、上限を超えるなら数えずに false を返す
function takeRateSlot(now = performance.now()) {
  while (callTimes.length > 0 && callTimes[0] <= now - 86_400_000) callTimes.shift();
  const lastMinute = callTimes.filter((t) => t > now - 60_000).length;
  if (callTimes.length >= RATE_PER_DAY || lastMinute >= RATE_PER_MINUTE) return false;
  callTimes.push(now);
  return true;
}
// CHANOMA_ORIGIN（カンマ区切りで複数可。例: https://xxx.onrender.com）を、https://名前 の形（Origin）にそろえる。
// 形が違うものがあれば、そのまま動かさずに止める（許可の書き間違いに気づけるように）
function parseOrigins(raw) {
  const origins = new Set();
  for (const item of String(raw ?? '').split(',')) {
    const text = item.trim();
    if (!text) continue;
    let url;
    try {
      url = new URL(text);
    } catch {
      throw new Error('CHANOMA_ORIGIN に、URL ではない値があります');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('CHANOMA_ORIGIN は http か https の URL にしてください');
    origins.add(url.origin);
  }
  return origins;
}
const PUBLIC_ORIGINS = PUBLIC ? parseOrigins(process.env.CHANOMA_ORIGIN) : new Set();
// 公開で許可する Origin が1つもないと、画面から呼べないか、だれからでも呼べる状態になる。どちらも避けるため、止める
if (PUBLIC && PUBLIC_ORIGINS.size === 0) {
  throw new Error('CHANOMA_PUBLIC=1 のときは、CHANOMA_ORIGIN（例: https://xxx.onrender.com）を指定してください');
}
// 自分のアドレスあてのリクエストだけ受ける。外のサイトの名前が一時的に自分のパソコンを指すようにして
// 呼びつける攻撃（DNS リバインディング）では、Host がそのサイト名になるので弾ける。
// 公開では、Host も CHANOMA_ORIGIN の名前から作る（置き場所の名前で届くため）
const ALLOWED_HOSTS = PUBLIC
  ? new Set([...PUBLIC_ORIGINS].map((o) => new URL(o).host))
  : new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = PUBLIC ? PUBLIC_ORIGINS : new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);

// Claude に返してもらう番組の形。本文は返させず、from で元の投稿を指してもらう。
// 特集名とわけは、safe.js の一覧から選ばせる（自由な文にしない）。
// 長さや件数の制約はスキーマに書かず、safe.js で確かめる。出てくる順は、ここに書いた順（すべて必須）
const NEWS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['feature', 'opening', 'segments', 'lineup', 'closing'],
  properties: {
    // 今夜の特集名。opening より前に置き、あいさつで特集にふれるときに食い違わないようにする
    feature: { type: 'string', enum: FEATURES },
    opening: { type: 'string' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['corner', 'from', 'host'],
        properties: {
          corner: { type: 'string', enum: CORNERS },
          from: { type: 'string' },
          host: { type: 'string' },
        },
      },
    },
    // コーナーごとの、並べたわけ。segments に出てくるコーナーを、出てくる順に1つずつ
    lineup: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['corner', 'reason'],
        properties: {
          corner: { type: 'string', enum: CORNERS },
          reason: { type: 'string', enum: REASONS },
        },
      },
    },
    closing: { type: 'string' },
  },
};

// 理由をつけて処理を止めるための例外。message は画面にそのまま出してよい文だけにする
class PublicError extends Error {
  // extra は、画面に返す補足の項目（理由の分類など）。message と同じく、画面に出してよいものだけを入れる
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// 画面のファイルにも JSON の返事にも付ける守りのヘッダー。他のサイトの枠（iframe）に入れられない・参照元を送らない・マイクは自分のページだけ（音声入力のため）
const SECURITY_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'microphone=(self)',
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...SECURITY_HEADERS,
    // 大きすぎる本文を送られたときは、返事を返したあとで接続を閉じて、残りを読み続けない
    ...(status === 413 ? { Connection: 'close' } : {}),
  });
  res.end(JSON.stringify(data));
}

const TOO_LARGE = '投稿の量が多すぎます。ひとことを短くして、もう一度お試しください。';

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (done) return;
      // 上限を超えたら、すぐ断る。届いた分は捨てて、これ以上ためない
      if (size > limit) {
        done = true;
        chunks.length = 0;
        reject(new PublicError(413, TOO_LARGE));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

// API キーを環境変数から取り出す。未設定のときは、内部の事情は画面に出さず、サーバーの記録にだけ残して 500 で断る
function requireApiKey() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[news] ANTHROPIC_API_KEY が設定されていません');
    throw new PublicError(500, 'サーバーの準備ができていません。管理する人に確認してください。');
  }
  return apiKey;
}

// 番組を作る。検査で弾いた番組は、決まった言い方の理由を添えて1回だけ作り直させる。
// API のエラーや、Claude が断った・途中で終わったときは作り直さない（費用と時間を増やさないため）
// signal は、画面側が途中でやめたときに Claude への問い合わせも止めるためのもの。
// apiKey は、handleNews が回数の枠を数える前に requireApiKey で確かめたもの
async function askClaude(apiKey, data, signal) {
  // 経過時間も、パソコンの時計を合わせ直しても狂わないよう、戻らない時計（performance.now）で測る
  const started = performance.now();
  const first = await callClaude(apiKey, data, signal, '', API_TIMEOUT_MS);
  if (first.ok) return first.news;
  console.error(`[news] 返ってきた番組が決まりに合いませんでした: ${maskFragments(first.reason)}`);
  const elapsed = performance.now() - started;
  if (elapsed > RETRY_WITHIN_MS) {
    console.error('[news] 時間が足りないため、作り直しは頼みません');
    throw new PublicError(502, NOT_BUILT);
  }
  // 作り直しも1回の呼び出しとして数える。上限に届いていたら頼まない
  if (!takeRateSlot()) {
    console.error('[news] 回数の上限に届いたため、作り直しは頼みません');
    throw new PublicError(502, NOT_BUILT);
  }
  console.log('[news] 作り直しを1回だけ頼みます');
  // 作り直しを待つ長さは、画面が待つ時間の残りに収める。下限（1秒）を付けるのは、0 だと通信がすぐ打ち切られ、
  // 負の値だと待ち時間の指定そのものが失敗する（RangeError）ため。通常は、起動時の確かめで10秒以上が残る
  const retryTimeout = Math.max(1_000, Math.min(API_TIMEOUT_MS, CLIENT_WAIT_MS - elapsed - 5_000));
  const second = await callClaude(apiKey, data, signal, retryHint(first.reason), retryTimeout);
  if (second.ok) return second.news;
  console.error(`[news] 作り直した番組も決まりに合いませんでした: ${maskFragments(second.reason)}`);
  throw new PublicError(502, NOT_BUILT);
}

// Claude に1回だけ問い合わせ、検査に通れば {ok:true, news}、通らなければ {ok:false, reason} を返す。
// hint は作り直しのときだけ渡す、RETRY_HINTS の決まった言い方
async function callClaude(apiKey, data, signal, hint, timeoutMs) {
  // この1回の問い合わせにかかった時間を、成功の記録に残すために測る（戻らない時計 performance.now で）
  const started = performance.now();
  // 投稿の中に </posts> と書かれていても囲みが崩れないように、< を JSON のエスケープに置き換える
  const postsJson = JSON.stringify({ posts: data.posts, nextDate: data.nextDate }).replace(/</g, '\\u003c');
  const body = {
    model: MODEL,
    max_tokens: 16000,
    // 並べてつなぎの言葉を付けるだけの作業なので、考える深さは標準のまま明示しておく
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: NEWS_SCHEMA },
    },
    // 安全のための判定で断られたときに、別のモデルで自動でやり直してもらう
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `今夜の番組の材料です。\n<posts>\n${postsJson}\n</posts>`
          + (hint ? `\n\n前に作った番組は、決まりに合わなかったため使えませんでした。${hint}ほかの決まりも、これまでどおり守ってください。` : ''),
      },
    ],
  };

  let apiRes;
  try {
    apiRes = await fetch(`${API_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]),
    });
  } catch (err) {
    console.error('[news] API に接続できませんでした:', err.name);
    throw new PublicError(502, '番組を作れませんでした。通信を確かめて、もう一度お試しください。');
  }

  if (!apiRes.ok) {
    // 返ってきた本文はキーなどを含まないが、念のため種類と状態だけを記録する
    let type = '';
    try {
      type = (await apiRes.json())?.error?.type || '';
    } catch {}
    console.error(`[news] API がエラーを返しました: ${apiRes.status} ${type}`);
    const message = apiRes.status === 429 || apiRes.status === 529
      ? '番組の準備が混み合っています。少し待ってから、もう一度お試しください。'
      : '番組を作れませんでした。もう一度お試しください。';
    throw new PublicError(502, message);
  }

  let result;
  try {
    // 本文を読む途中で時間切れになったり、JSON ではなかったりしたときも、502 として扱う
    result = await apiRes.json();
  } catch (err) {
    console.error('[news] API の返事を読めませんでした:', err.name);
    throw new PublicError(502, '番組を作れませんでした。もう一度お試しください。');
  }
  if (result?.stop_reason !== 'end_turn') {
    console.error(`[news] 番組が最後まで作られませんでした: ${result?.stop_reason}`);
    throw new PublicError(502, '番組を作れませんでした。投稿を見直して、もう一度お試しください。');
  }
  const textBlock = Array.isArray(result.content) ? result.content.find((b) => b.type === 'text') : null;
  let news;
  try {
    news = JSON.parse(textBlock?.text ?? '');
  } catch {
    news = null;
  }
  const checked = checkNews(news, data.posts);
  // 理由はサーバーの記録にだけ残す（画面には出さない）。作り直すかどうかは呼ぶ側が決める
  if (!checked.ok) return { ok: false, reason: checked.reason };
  // 選んだ特集名とわけは、決まった一覧の言葉だけなので、投稿の中身は記録に残らない。番組づくりの成功率や選び方の偏りを調べるのに使う
  const { feature, lineup } = checked.news;
  const plan = feature ? `、特集 ${feature}、わけ ${(lineup ?? []).map((l) => `${l.corner}=${l.reason}`).join(' / ')}` : '';
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`[news] 番組を作りました（${checked.news.segments.length}件、出力 ${result.usage?.output_tokens ?? '?'} トークン、${seconds}秒${plan}${hint ? '、作り直し' : ''}）`);
  return { ok: true, news: checked.news };
}

// ブラウザから送られるときは Origin が付く。自分の画面以外から来たものは断る（本文のない GET や DELETE でも確かめる）
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) throw new PublicError(403, '送り方が正しくありません。');
}

// 本文が JSON のリクエストを受け取って、読んだ値を返す。確かめる順番は、種類 → Origin → 大きさ → 読む → JSON
async function readJson(req, limit = MAX_BODY_BYTES) {
  // JSON 以外を断ると、ほかのサイトからフォーム送信で呼ばれるのも防げる
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    throw new PublicError(415, '送り方が正しくありません。');
  }
  checkOrigin(req);
  // 本文の大きさを先に申告してくるので、上限を超えるなら読み始める前に断る
  if (Number(req.headers['content-length']) > limit) throw new PublicError(413, TOO_LARGE);
  const raw = await readBody(req, limit);
  try {
    return JSON.parse(raw);
  } catch {
    throw new PublicError(400, '投稿の形が正しくありません。');
  }
}

async function handleNews(req, res) {
  const input = await readJson(req);
  const data = cleanPosts(input);
  if (!data.ok) throw new PublicError(400, data.error);
  if (inFlight >= MAX_IN_FLIGHT) throw new PublicError(429, '番組の準備が混み合っています。少し待ってから、もう一度お試しください。');
  // キーの未設定は、回数の枠を数える前に断る。数えたあとに断ると、キーが無いまま送り続けただけで上限に届き、
  // 本当の原因（キーの未設定）が分からない 429 に変わってしまうため
  const apiKey = requireApiKey();
  // 同時数の確認のあとに数える。混雑で断った分は、回数に入れない
  if (!takeRateSlot()) throw new PublicError(429, RATE_LIMITED);
  // 画面側が途中でやめた（接続が切れた）ら、Claude への問い合わせも止める
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });
  inFlight++;
  try {
    sendJson(res, 200, await askClaude(apiKey, data, abort.signal));
  } finally {
    inFlight--;
  }
}

// ---- 部屋（家族でつながる） ----
// 部屋はサーバーのメモリにだけ置く（サーバーが寝ると忘れる。番組は各端末の本棚から戻せる）。
// { posts: [{ post, key, at, day }], programs: Map<日付, 番組>, generating, touchedAt, lastAt }
// key は端末の鍵のハッシュ。投稿を消せる端末を確かめるためだけに持ち、どの返事にも、番組の写しにも、Claude への送り物にも入れない

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
// 部屋の上限と、さわられていない部屋を消すまでの長さ
const MAX_ROOMS = 100;
const ROOM_TTL_MS = 3 * DAY_MS;
// 部屋ごとに持つ番組の数（サーバーで作ったものも、端末から差し出されたものも含む）。1本は48KB以内なので、全体で約144MBが上限
const MAX_PROGRAMS_PER_ROOM = 30;
// 本棚に差し出せる日付は、きょうから何日前までか
const SHELF_DAYS = 60;
// 本棚の取得は1回に何本までか
const MAX_SHELF_FETCH = 10;
// 本棚の差し出しは、番組（48KB）に包みの分を足した大きさまで読む
const MAX_SHELF_BODY_BYTES = MAX_PROGRAM_BYTES + 16 * 1024;
const ROOM_FULL_TODAY = `きょうは${MAX_POSTS}件までです。`;
// 部屋ごとの番組づくりの試行は、1日（日付の鍵ごと）に何回までか。失敗した試行も数える（失敗が続いても費用が膨らまないように）
const MAX_NEWS_TRIES_PER_ROOM_PER_DAY = 3;
const NEWS_TRIES_USED = 'きょうの番組は作れませんでした。あした、もう一度お試しください。';
const ROOM_NOT_FOUND = 'この部屋は見つかりません。';
const BAD_REQUEST = '送り方が正しくありません。';
const TOO_MANY = '短い間に送りすぎです。少し待ってから、もう一度お試しください。';

// 回数の上限。テストでは少ない回数で上限に届くように、環境変数で差し替えられる（CHANOMA_RATE_* と同じ流儀）
const ROOMS_PER_IP_PER_DAY = Number(process.env.CHANOMA_ROOMS_PER_IP_PER_DAY) || 5;
// 送り元 IP は X-Forwarded-For を送る側が偽れるので、IP に頼らない上限も置く。サーバー全体で、部屋を作れるのは1時間に何室までか
const ROOMS_PER_HOUR = Number(process.env.CHANOMA_ROOMS_PER_HOUR) || 20;
const ROOM_READS_PER_MINUTE = Number(process.env.CHANOMA_ROOM_READS_PER_MINUTE) || 60;
const ROOM_WRITES_PER_MINUTE = Number(process.env.CHANOMA_ROOM_WRITES_PER_MINUTE) || 60;
const POSTS_PER_DEVICE_PER_MINUTE = 10;
// 掃除の間隔（既定は1時間）
const SWEEP_MS = Number(process.env.CHANOMA_SWEEP_MS) || HOUR_MS;

// 部屋の日付と掃除の基準になる時計。公開では、いつも本物の時計を使う。
// テストでは、CHANOMA_FAKE_NOW（例 2026-11-05T03:00:00Z）から数え始め、CHANOMA_FAKE_SPEED 倍の速さで進められる。
// 経過は、戻らない時計（performance.now）で測る
const FAKE_NOW = PUBLIC ? Number.NaN : Date.parse(process.env.CHANOMA_FAKE_NOW ?? '');
const FAKE_SPEED = Number(process.env.CHANOMA_FAKE_SPEED) || 1;
const CLOCK_START = performance.now();
const now = () => (Number.isNaN(FAKE_NOW) ? Date.now() : Math.floor(FAKE_NOW + (performance.now() - CLOCK_START) * FAKE_SPEED));

// 日付の鍵。サーバーが JST（UTC+9）を固定で計算し、4時間引いた日付にする（翌朝 4:00 が境目）。端末の時計は使わない
const dayKeyOf = (ms) => new Date(ms + 9 * HOUR_MS - 4 * HOUR_MS).toISOString().slice(0, 10);

// 回数の窓。key ごとに、数えた時刻を古い順に持つ。時刻は、パソコンの時計を合わせ直されても狂わない performance.now で数える
function hitCount(map, key, windowMs) {
  const list = map.get(key);
  if (!list) return 0;
  const edge = performance.now() - windowMs;
  while (list.length > 0 && list[0] <= edge) list.shift();
  if (list.length === 0) map.delete(key);
  return list.length;
}
// 表ごとの、前回の掃除の時刻。掃除は表の全件を調べるので、1分に1回までにする（毎回やると、偽の送り元を大量に送られたとき、そのたびに全件を調べて遅くなる）
const lastPurgeAt = new WeakMap();
const PURGE_EVERY_MS = 60_000;
const HITS_PURGE_AT = 5_000;
const HITS_MAX = 10_000;
// windowMs は、その表の窓の長さ。窓より古い記録だけが期限切れになるので、表ごとの長さで掃除する
function addHit(map, key, windowMs) {
  // 偽の送り元を大量に作られても、記録が増え続けないように、たまったら期限切れを捨てる
  if (map.size > HITS_PURGE_AT) {
    const t = performance.now();
    const last = lastPurgeAt.get(map);
    if (last === undefined || t - last >= PURGE_EVERY_MS) {
      lastPurgeAt.set(map, t);
      purgeHits(map, windowMs);
    }
    // 窓のなかの記録だけで上限を超えているときは、期限切れを待てないので、いちばん古い送り元（先に入れたもの）から捨てる
    for (const oldest of map.keys()) {
      if (map.size <= HITS_MAX) break;
      map.delete(oldest);
    }
  }
  const list = map.get(key);
  if (list) list.push(performance.now());
  else map.set(key, [performance.now()]);
}
// 上限の中なら数えて true、超えるなら数えずに false
function takeHit(map, key, limit, windowMs) {
  if (hitCount(map, key, windowMs) >= limit) return false;
  addHit(map, key, windowMs);
  return true;
}
function purgeHits(map, windowMs) {
  for (const key of [...map.keys()]) hitCount(map, key, windowMs);
}
const roomCreateHits = new Map(); // 送り元 IP → 部屋を作った時刻（1日）
const roomCreateAllHits = new Map(); // 'all' → サーバー全体で部屋を作った時刻（1時間）。IP に頼らない上限
const roomReadHits = new Map(); // 送り元 IP → 読みに来た時刻（1分）
const roomWriteHits = new Map(); // 送り元 IP → 書きに来た時刻（1分）
const deviceHits = new Map(); // 端末の鍵のハッシュ → 投稿した時刻（1分）

// X-Forwarded-For の右から何番目を送り元とするか。置き場所の前に並ぶ中継の段数に合わせる（Render で実測して決める。既定は1段）
const TRUSTED_HOPS = Math.max(1, Math.floor(Number(process.env.CHANOMA_TRUSTED_HOPS)) || 1);
// CHANOMA_LOG_XFF=1 のとき、最初の5リクエストだけ、X-Forwarded-For の値の数を記録する（段数を実測するため。IP の値そのものは記録しない）
const LOG_XFF = process.env.CHANOMA_LOG_XFF === '1';
let xffLogged = 0;

// 送り元 IP。公開では置き場所の中継を通って届くので、X-Forwarded-For の右から TRUSTED_HOPS 番目を使う。
// 中継は、受け取った値の右に自分が見た相手のアドレスを足していくので、送る側が先頭に足した値は右から数えれば無視される。N は置き場所の中継の段数
// （段数の設定が実際とちがうと、IP ごとの上限は回避されたり共有されたりする。費用の上限は IP に頼らない）。
// ローカルでは、ヘッダーは信じず、つながってきた相手のアドレスを使う
function clientIp(req) {
  if (PUBLIC) {
    const forwarded = req.headers['x-forwarded-for'];
    const values = typeof forwarded === 'string' ? forwarded.split(',').map((v) => v.trim()).filter((v) => v !== '') : [];
    if (LOG_XFF && xffLogged < 5) {
      xffLogged++;
      console.log(`[room] X-Forwarded-For の値の数: ${values.length}（右から ${TRUSTED_HOPS} 番目を使用）`);
    }
    if (values.length > 0) {
      const picked = values.length >= TRUSTED_HOPS ? values[values.length - TRUSTED_HOPS] : values[values.length - 1];
      if (picked.length <= 64) return picked;
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

const rooms = new Map();
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
// 部屋のコード。英数字22字（62文字から22字で約131ビット）を、暗号用の乱数から作る。
// 256 は 62 で割り切れないので、偏りが出ないように、248（= 62 × 4）以上の値は捨てて引き直す
function newRoomCode() {
  let code = '';
  while (code.length < 22) {
    for (const byte of crypto.randomBytes(32)) {
      if (byte < 248 && code.length < 22) code += BASE62[byte % 62];
    }
  }
  return code;
}
// 記録には、部屋のコードの先頭4字だけを出す（コードは家族だけの鍵なので、全部は残さない）
const shortCode = (code) => `${code.slice(0, 4)}…`;

// ほかの人の端末の鍵と同じかを、時間の差から当てられないように比べる（どちらも検査ずみの64字の16進数）
const sameKey = (a, b) => crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

// 3日さわられていない部屋を消す。消した数を返す
function evictStaleRooms() {
  const t = now();
  let count = 0;
  for (const [code, room] of rooms) {
    if (t - room.touchedAt > ROOM_TTL_MS) {
      rooms.delete(code);
      count++;
    }
  }
  return count;
}

// 掃除。きょうより前の日付の投稿と、3日さわられていない部屋を消す。画面の返事は、きょうの投稿しか返さないので、
// 掃除の間隔が空いても、古い投稿が見えることはない
function sweep() {
  const staleRooms = evictStaleRooms();
  const today = dayKeyOf(now());
  let oldPosts = 0;
  for (const room of rooms.values()) {
    const before = room.posts.length;
    room.posts = room.posts.filter((e) => e.day >= today);
    oldPosts += before - room.posts.length;
  }
  purgeHits(roomCreateHits, DAY_MS);
  purgeHits(roomCreateAllHits, HOUR_MS);
  purgeHits(roomReadHits, 60_000);
  purgeHits(roomWriteHits, 60_000);
  purgeHits(deviceHits, 60_000);
  if (oldPosts > 0 || staleRooms > 0) console.log(`[room] 掃除: 前の日の投稿 ${oldPosts} 件、使われていない部屋 ${staleRooms} 室を消しました`);
}

// コードから部屋を取り出す。形が違えば 400、なければ 404。見つかったら「さわられた」ことにする
function findRoom(code) {
  if (!isRoomCode(code)) throw new PublicError(400, 'この部屋のコードの形が正しくありません。');
  const room = rooms.get(code);
  if (!room) throw new PublicError(404, ROOM_NOT_FOUND);
  room.touchedAt = now();
  return room;
}

// 画面に返す投稿。端末の鍵は入れない
const publicPost = (entry) => ({ ...entry.post, at: entry.at });
// 画面に返す番組。作ったときの投稿の写しと一緒に返す（検査も表示も、この写しで行う）
const publicProgram = (date, p) => ({
  date,
  news: p.news,
  posts: p.posts,
  ...(p.nextDate ? { nextDate: p.nextDate } : {}),
  madeAt: p.madeAt,
  source: p.source,
});
// きょうの投稿（古い日の分は、ここで落とす）
const todaysPosts = (room, today) => room.posts.filter((e) => e.day === today);

// 番組を部屋に置く。部屋の上限（30本）に達していたら、いちばん古い日付のものを捨てる
// （きょうの番組が作れなくならないように。差し出された番組のときは、呼ぶ前に断っている）
function storeProgram(room, date, program) {
  if (!room.programs.has(date) && room.programs.size >= MAX_PROGRAMS_PER_ROOM) {
    const oldest = [...room.programs.keys()].sort()[0];
    room.programs.delete(oldest);
  }
  room.programs.set(date, program);
}

// POST /api/room: 部屋を作り、コードを返す
async function createRoom(req, res, ip) {
  await readJson(req);
  if (hitCount(roomCreateHits, ip, DAY_MS) >= ROOMS_PER_IP_PER_DAY) {
    throw new PublicError(429, 'きょうは作れる部屋の数に達しました。あした、もう一度お試しください。');
  }
  // 送り元を偽られても守れるように、IP に頼らないサーバー全体の上限を、IP ごとの上限の次に確かめる
  if (hitCount(roomCreateAllHits, 'all', HOUR_MS) >= ROOMS_PER_HOUR) {
    throw new PublicError(429, 'いま、新しい部屋を作れません。しばらくしてから、もう一度お試しください。');
  }
  if (rooms.size >= MAX_ROOMS) evictStaleRooms();
  if (rooms.size >= MAX_ROOMS) throw new PublicError(429, 'いま、新しい部屋を作れません。しばらくしてから、もう一度お試しください。');
  let code = newRoomCode();
  while (rooms.has(code)) code = newRoomCode();
  rooms.set(code, { posts: [], programs: new Map(), generating: null, tries: { day: '', count: 0 }, touchedAt: now(), lastAt: 0 });
  addHit(roomCreateHits, ip, DAY_MS);
  addHit(roomCreateAllHits, 'all', HOUR_MS);
  console.log(`[room] 部屋を作りました（${shortCode(code)}、いま ${rooms.size} 室）`);
  sendJson(res, 201, { code });
}

// GET /api/room/:code?since=<時刻>: きょうの投稿、番組の日付の一覧、きょうの番組があればそれ
function getRoom(url, code, res) {
  const room = findRoom(code);
  const sinceText = url.searchParams.get('since');
  if (sinceText !== null && !/^\d{1,16}$/.test(sinceText)) throw new PublicError(400, BAD_REQUEST);
  const since = sinceText === null ? 0 : Number(sinceText);
  const today = dayKeyOf(now());
  const todays = todaysPosts(room, today);
  const program = room.programs.get(today);
  sendJson(res, 200, {
    // 端末の時計は使わない決まりなので、「きょう」と今の時刻は、ここから知らせる
    day: today,
    now: now(),
    // since より後に届いた投稿だけ。ids は、きょうの投稿の全部のID（ほかの端末で消された投稿に気づくため）
    posts: todays.filter((e) => e.at > since).map(publicPost),
    ids: todays.map((e) => e.post.id),
    dates: [...room.programs.keys()].sort(),
    program: program ? publicProgram(today, program) : null,
  });
}

// POST /api/room/:code/posts: 投稿を1件足す。{ post, device }（device は端末の鍵のハッシュ）
async function addPost(req, code, res) {
  const input = await readJson(req);
  const room = findRoom(code);
  if (!input || typeof input !== 'object' || !isDeviceHash(input.device)) throw new PublicError(400, '投稿の形が正しくありません。');
  const device = input.device;
  const cleaned = cleanPost(input.post);
  if (!cleaned.ok) throw new PublicError(400, cleaned.error);
  // 本文は書き換えない。禁止の言葉があれば、送る前に止める
  const words = checkPostWords(cleaned.post);
  if (!words.ok) throw new PublicError(422, 'この言葉は使えません。', { reason: words.reason });
  const today = dayKeyOf(now());
  room.posts = todaysPosts(room, today);
  // 同じ ID が来たとき。同じ端末からの送り直し（圏外で送れなかったものの再送）なら、足さずに前のものを返す。
  // ちがう端末なら断る（IDが重なると、番組を作るときに投稿の束が検査で落ち、その日は番組が作れなくなるため）
  const same = room.posts.find((e) => e.post.id === cleaned.post.id);
  if (same) {
    if (!sameKey(same.key, device)) throw new PublicError(409, 'この投稿の番号は、すでに使われています。');
    sendJson(res, 200, { post: publicPost(same), count: room.posts.length });
    return;
  }
  if (room.posts.length >= MAX_POSTS) throw new PublicError(409, ROOM_FULL_TODAY);
  if (!takeHit(deviceHits, device, POSTS_PER_DEVICE_PER_MINUTE, 60_000)) throw new PublicError(429, TOO_MANY);
  // 届いた順を、時刻で決める。同じ時刻に2件届いても、since で取りこぼさないように、必ず前より大きくする
  const at = Math.max(now(), room.lastAt + 1);
  room.lastAt = at;
  const entry = { post: cleaned.post, key: device, at, day: today };
  room.posts.push(entry);
  sendJson(res, 200, { post: publicPost(entry), count: room.posts.length });
}

// DELETE /api/room/:code/posts/:id: 自分の端末で送った投稿を消す。鍵のハッシュは X-Chanoma-Device ヘッダーで受ける
function deletePost(req, code, id, res) {
  const room = findRoom(code);
  const device = req.headers['x-chanoma-device'];
  if (!isDeviceHash(device)) throw new PublicError(400, BAD_REQUEST);
  const today = dayKeyOf(now());
  room.posts = todaysPosts(room, today);
  const index = room.posts.findIndex((e) => e.post.id === id);
  if (index < 0) throw new PublicError(404, '投稿が見つかりません。');
  if (!sameKey(room.posts[index].key, device)) throw new PublicError(403, 'この投稿は、送った端末からだけ消せます。');
  room.posts.splice(index, 1);
  sendJson(res, 200, { ok: true });
}

// 番組を作る約束（Promise）を待つ。待つ人が全員いなくなったら、Claude への問い合わせを止める。
// 1人が切れただけでは止めない（ほかの人が待っているし、作った番組は部屋に残って、みんなが使えるため）
function waitForProgram(gen, res) {
  gen.waiters++;
  res.on('close', () => {
    if (res.writableFinished) return;
    gen.waiters--;
    if (gen.waiters <= 0 && !gen.done) gen.abort.abort();
  });
  return gen.promise;
}

// POST /api/room/:code/news: きょうの番組を返す。なければ、部屋の投稿で作る。{ nextDate? }
async function makeRoomNews(req, code, res) {
  const input = await readJson(req);
  const room = findRoom(code);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PublicError(400, '投稿の形が正しくありません。');
  const dateCheck = cleanDate(input.nextDate);
  if (!dateCheck.ok) throw new PublicError(400, dateCheck.error);
  const today = dayKeyOf(now());
  const existing = room.programs.get(today);
  // きょうの番組がもうあれば、作らずに返す（二重に作らない。費用が増えないようにする）
  if (existing) {
    sendJson(res, 200, { made: false, program: publicProgram(today, existing) });
    return;
  }
  let gen = room.generating;
  if (!gen || gen.day !== today) {
    // 番組の材料は、部屋のきょうの投稿の写し（端末から送り直させない）
    room.posts = todaysPosts(room, today);
    const data = cleanPosts({ posts: room.posts.map((e) => e.post), ...(dateCheck.value ? { nextDate: dateCheck.value } : {}) });
    if (!data.ok) throw new PublicError(400, 'きょうの投稿がまだありません。');
    // 部屋の試行の上限は、全体の枠より先に確かめる（上限に達した部屋が、全体の枠を使わないように）。日付が変われば数え直す
    if (room.tries.day !== today) room.tries = { day: today, count: 0 };
    if (room.tries.count >= MAX_NEWS_TRIES_PER_ROOM_PER_DAY) throw new PublicError(429, NEWS_TRIES_USED);
    // 確かめる順番は /api/news と同じ。同時数 → キー → 回数。あとから来て同じ約束を待つ人は、枠を使わない
    if (inFlight >= MAX_IN_FLIGHT) throw new PublicError(429, '番組の準備が混み合っています。少し待ってから、もう一度お試しください。');
    const apiKey = requireApiKey();
    if (!takeRateSlot()) throw new PublicError(429, RATE_LIMITED);
    // 全体の枠を取れた時点で、問い合わせを始めたことになる。成功でも失敗でも、この試行は数える
    room.tries.count++;
    gen = { day: today, waiters: 0, done: false, abort: new AbortController(), promise: null };
    inFlight++;
    gen.promise = (async () => {
      try {
        const news = await askClaude(apiKey, data, gen.abort.signal);
        const program = {
          news,
          posts: data.posts,
          ...(data.nextDate ? { nextDate: data.nextDate } : {}),
          madeAt: now(),
          source: 'server',
        };
        storeProgram(room, today, program);
        console.log(`[room] きょうの番組を置きました（${shortCode(code)}、${data.posts.length}件）`);
        return program;
      } finally {
        // 失敗した約束を残すと、その部屋はその日、作り直せなくなる。成功でも失敗でも、約束は外す
        gen.done = true;
        inFlight--;
        if (room.generating === gen) room.generating = null;
      }
    })();
    room.generating = gen;
  }
  const program = await waitForProgram(gen, res);
  sendJson(res, 200, { made: true, program: publicProgram(gen.day, program) });
}

// GET /api/room/:code/shelf?dates=2026-11-01,2026-11-02: 本棚の番組を取る（1回10本まで）。あるものだけ返す
function getShelf(url, code, res) {
  const room = findRoom(code);
  const text = url.searchParams.get('dates');
  if (!text) throw new PublicError(400, BAD_REQUEST);
  const dates = [...new Set(text.split(','))];
  if (dates.length > MAX_SHELF_FETCH || !dates.every(isDateKey)) throw new PublicError(400, BAD_REQUEST);
  const programs = dates.filter((d) => room.programs.has(d)).map((d) => publicProgram(d, room.programs.get(d)));
  sendJson(res, 200, { programs });
}

// PUT /api/room/:code/shelf/:date: 本棚に番組を差し出す。{ news, posts, madeAt, nextDate? }
// きょうより前で、60日以内で、その日付がまだないときだけ。検査を通ったものだけを、検査で作り直した形で置く
async function putShelf(req, code, date, res) {
  const today = dayKeyOf(now());
  if (!isDateKey(date)) throw new PublicError(400, '日付の形が正しくありません。');
  if (date >= today) throw new PublicError(400, 'きょうの番組は、差し出せません。');
  if (date < dayKeyOf(now() - SHELF_DAYS * DAY_MS)) throw new PublicError(400, `${SHELF_DAYS}日より前の番組は、差し出せません。`);
  const input = await readJson(req, MAX_SHELF_BODY_BYTES);
  const room = findRoom(code);
  // 状態の確かめと置く処理は、間に待ちを挟まずに続けて行う（同時に来た2件が、両方通らないように）
  if (room.programs.has(date)) throw new PublicError(409, 'この日の番組は、もう本棚にあります。');
  if (room.programs.size >= MAX_PROGRAMS_PER_ROOM) throw new PublicError(409, 'この部屋の本棚は、いっぱいです。');
  const checked = checkShelfProgram(input);
  if (!checked.ok) {
    // 記録には、理由の分類だけを残す（番組や投稿の断片は、「…」に伏せる）
    console.error(`[room] 差し出された番組を断りました（${shortCode(code)}）: ${maskFragments(checked.reason ?? checked.error)}`);
    throw new PublicError(422, checked.error);
  }
  storeProgram(room, date, { ...checked.program, source: 'device' });
  sendJson(res, 200, { ok: true });
}

// /api/room 以下の入口を、道筋と方法で振り分ける
async function handleRoom(req, res, pathname, url) {
  const segs = pathname.split('/').slice(3); // ['', 'api', 'room', ...] の、room より後ろ
  if (segs.length > 0 && segs.some((s) => s === '')) throw new PublicError(404, '見つかりません。');
  const isRead = req.method === 'GET';
  // 送り元ごとの回数の上限。コードの総当たりを防ぐため、部屋を探す前（コードが合うかを答える前）に数える
  const ip = clientIp(req);
  const bucket = isRead ? roomReadHits : roomWriteHits;
  if (!takeHit(bucket, ip, isRead ? ROOM_READS_PER_MINUTE : ROOM_WRITES_PER_MINUTE, 60_000)) throw new PublicError(429, TOO_MANY);
  if (isRead || req.method === 'DELETE') checkOrigin(req);

  const [code, part, third] = segs;
  const expect = (...methods) => {
    if (!methods.includes(req.method)) throw new PublicError(405, BAD_REQUEST);
  };
  if (segs.length === 0) {
    expect('POST');
    return createRoom(req, res, ip);
  }
  if (segs.length === 1) {
    expect('GET');
    return getRoom(url, code, res);
  }
  if (part === 'posts' && segs.length === 2) {
    expect('POST');
    return addPost(req, code, res);
  }
  if (part === 'posts' && segs.length === 3) {
    expect('DELETE');
    return deletePost(req, code, third, res);
  }
  if (part === 'news' && segs.length === 2) {
    expect('POST');
    return makeRoomNews(req, code, res);
  }
  if (part === 'shelf' && segs.length === 2) {
    expect('GET');
    return getShelf(url, code, res);
  }
  if (part === 'shelf' && segs.length === 3) {
    expect('PUT');
    return putShelf(req, code, third, res);
  }
  throw new PublicError(404, '見つかりません。');
}

async function handleStatic(pathname, res) {
  const entry = STATIC_FILES[pathname];
  const file = entry ? STATIC_CACHE.get(pathname) : undefined;
  if (!file) throw new PublicError(404, '見つかりません。');
  // 送りが進まない接続は切る。この応答の間だけの設定（次の要求が来ると、Node が接続の待ち時間を戻す）
  res.setTimeout(STATIC_SEND_TIMEOUT_MS, () => res.destroy());
  res.writeHead(200, {
    'Content-Type': entry[1],
    // フォントは大きい（約2MB）うえに変わらないので、1日は端末に保存させる。ほかは、起動し直して直したものがすぐ届くよう保存させない
    'Cache-Control': entry[1].startsWith('font/') ? 'public, max-age=86400' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...SECURITY_HEADERS,
  });
  res.end(file);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host)) throw new PublicError(403, '送り方が正しくありません。');
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      throw new PublicError(404, '見つかりません。');
    }
    const pathname = url.pathname;
    if (pathname === '/api/news') {
      // 公開の形では、1台実演用の入口は出さない（だれでも Claude を呼べてしまうため）
      if (PUBLIC) throw new PublicError(404, '見つかりません。');
      if (req.method !== 'POST') throw new PublicError(405, '送り方が正しくありません。');
      await handleNews(req, res);
    } else if (pathname === '/api/room' || pathname.startsWith('/api/room/')) {
      await handleRoom(req, res, pathname, url);
    } else if (req.method === 'GET') {
      await handleStatic(pathname, res);
    } else {
      throw new PublicError(405, '送り方が正しくありません。');
    }
  } catch (err) {
    if (err instanceof PublicError) {
      if (!res.headersSent) sendJson(res, err.status, { error: err.message, ...err.extra });
      return;
    }
    // 想定外のエラーは中身を画面に出さず、サーバーの記録にだけ残す
    console.error('[server] 想定外のエラー:', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'うまく動きませんでした。もう一度お試しください。' });
  }
});

// ゆっくり送って接続を握り続けるやり方を防ぐため、受け取りの待ち時間を短くする
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;

// 部屋の掃除。タイマーは、これだけでは終了を止めないようにしておく（unref）
setInterval(sweep, SWEEP_MS).unref();

server.listen(PORT, HOST, () => {
  console.log(PUBLIC
    ? `ちゃのま: 公開の形で待ち受けています（ポート ${PORT}、許可する Origin ${PUBLIC_ORIGINS.size} 件）。/api/news は出しません`
    : `ちゃのま: http://${HOST}:${PORT}/ で待ち受けています`);
  // どこに送るかを、起動のたびに見えるようにする（撮影の前に、本物の API だと確かめられる）
  const isReal = API_BASE === 'https://api.anthropic.com';
  console.log(isReal ? '送り先: 本物の Anthropic API' : `送り先: テスト用の接続先（${API_BASE}）。本物の API ではありません`);
});
