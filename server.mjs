// ちゃのまのサーバー。画面のファイルを配り、POST /api/news で Claude に番組を組んでもらう。
// 外部ライブラリは使わず、Node の標準モジュールと組み込みの fetch だけで書く。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// 投稿と番組の検査は、画面でも使う safe.js に一本化している
import { CORNERS, cleanPosts, checkNews } from './safe.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// 1台での実演が前提なので、ほかのパソコンからは届かないように 127.0.0.1 だけで待ち受ける
const HOST = '127.0.0.1';
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
  // 同梱フォントと、そのライセンス全文（OFL では、フォントと一緒にライセンスを配る決まり）
  '/fonts/ReggaeOne-Regular.ttf': ['fonts/ReggaeOne-Regular.ttf', 'font/ttf'],
  '/fonts/DotGothic16-Regular.ttf': ['fonts/DotGothic16-Regular.ttf', 'font/ttf'],
  '/fonts/OFL-ReggaeOne.txt': ['fonts/OFL-ReggaeOne.txt', 'text/plain; charset=utf-8'],
  '/fonts/OFL-DotGothic16.txt': ['fonts/OFL-DotGothic16.txt', 'text/plain; charset=utf-8'],
};

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
// Claude を呼んだ時刻（ミリ秒）を古い順に持つ。24時間より前のものは捨てる
const callTimes = [];

// 上限の中なら今回の分を数えて true、上限を超えるなら数えずに false を返す
function takeRateSlot(now = Date.now()) {
  while (callTimes.length > 0 && callTimes[0] <= now - 86_400_000) callTimes.shift();
  const lastMinute = callTimes.filter((t) => t > now - 60_000).length;
  if (callTimes.length >= RATE_PER_DAY || lastMinute >= RATE_PER_MINUTE) return false;
  callTimes.push(now);
  return true;
}
// 自分のアドレスあてのリクエストだけ受ける。外のサイトの名前が一時的に自分のパソコンを指すようにして
// 呼びつける攻撃（DNS リバインディング）では、Host がそのサイト名になるので弾ける
const ALLOWED_HOSTS = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);

// Claude に返してもらう番組の形。本文は返させず、from で元の投稿を指してもらう
const NEWS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['opening', 'segments', 'closing'],
  properties: {
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
    closing: { type: 'string' },
  },
};

// 理由をつけて処理を止めるための例外。message は画面にそのまま出してよい文だけにする
class PublicError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // 大きすぎる本文を送られたときは、返事を返したあとで接続を閉じて、残りを読み続けない
    ...(status === 413 ? { Connection: 'close' } : {}),
  });
  res.end(JSON.stringify(data));
}

const TOO_LARGE = '投稿の量が多すぎます。ひとことを短くして、もう一度お試しください。';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (done) return;
      // 上限を超えたら、すぐ断る。届いた分は捨てて、これ以上ためない
      if (size > MAX_BODY_BYTES) {
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

// signal は、画面側が途中でやめたときに Claude への問い合わせも止めるためのもの
async function askClaude(data, signal) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[news] ANTHROPIC_API_KEY が設定されていません');
    throw new PublicError(500, 'サーバーの準備ができていません。管理する人に確認してください。');
  }
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
        content: `今夜の番組の材料です。\n<posts>\n${postsJson}\n</posts>`,
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
      signal: AbortSignal.any([AbortSignal.timeout(90_000), signal]),
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
  if (!checked.ok) {
    // 理由は投稿の中身を含まないので、サーバーの記録には残す。画面には出さない
    console.error(`[news] 返ってきた番組が決まりに合いませんでした: ${checked.reason}`);
    throw new PublicError(502, '番組をうまく組み立てられませんでした。もう一度お試しください。');
  }
  console.log(`[news] 番組を作りました（${checked.news.segments.length}件、出力 ${result.usage?.output_tokens ?? '?'} トークン）`);
  return checked.news;
}

async function handleNews(req, res) {
  // JSON 以外を断ると、ほかのサイトからフォーム送信で呼ばれるのも防げる
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    throw new PublicError(415, '送り方が正しくありません。');
  }
  // ブラウザから送られるときは Origin が付く。自分の画面以外から来たものは断る
  const origin = req.headers.origin;
  if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) throw new PublicError(403, '送り方が正しくありません。');
  // 本文の大きさを先に申告してくるので、上限を超えるなら読み始める前に断る
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw new PublicError(413, TOO_LARGE);
  const raw = await readBody(req);
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new PublicError(400, '投稿の形が正しくありません。');
  }
  const data = cleanPosts(input);
  if (!data.ok) throw new PublicError(400, data.error);
  if (inFlight >= MAX_IN_FLIGHT) throw new PublicError(429, '番組の準備が混み合っています。少し待ってから、もう一度お試しください。');
  // 同時数の確認のあとに数える。混雑で断った分は、回数に入れない
  if (!takeRateSlot()) throw new PublicError(429, RATE_LIMITED);
  // 画面側が途中でやめた（接続が切れた）ら、Claude への問い合わせも止める
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });
  inFlight++;
  try {
    sendJson(res, 200, await askClaude(data, abort.signal));
  } finally {
    inFlight--;
  }
}

async function handleStatic(pathname, res) {
  const entry = STATIC_FILES[pathname];
  if (!entry) throw new PublicError(404, '見つかりません。');
  let file;
  try {
    file = await readFile(path.join(ROOT, entry[0]));
  } catch {
    throw new PublicError(404, '見つかりません。');
  }
  res.writeHead(200, {
    'Content-Type': entry[1],
    // フォントは大きい（約2MB）うえに変わらないので、1日は端末に保存させる。ほかは、直したらすぐ反映されるよう保存させない
    'Cache-Control': entry[1].startsWith('font/') ? 'public, max-age=86400' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(file);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host)) throw new PublicError(403, '送り方が正しくありません。');
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      throw new PublicError(404, '見つかりません。');
    }
    if (pathname === '/api/news') {
      if (req.method !== 'POST') throw new PublicError(405, '送り方が正しくありません。');
      await handleNews(req, res);
    } else if (req.method === 'GET') {
      await handleStatic(pathname, res);
    } else {
      throw new PublicError(405, '送り方が正しくありません。');
    }
  } catch (err) {
    if (err instanceof PublicError) {
      if (!res.headersSent) sendJson(res, err.status, { error: err.message });
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

server.listen(PORT, HOST, () => {
  console.log(`ちゃのま: http://${HOST}:${PORT}/ で待ち受けています`);
  // どこに送るかを、起動のたびに見えるようにする（撮影の前に、本物の API だと確かめられる）
  const isReal = API_BASE === 'https://api.anthropic.com';
  console.log(isReal ? '送り先: 本物の Anthropic API' : `送り先: テスト用の接続先（${API_BASE}）。本物の API ではありません`);
});
