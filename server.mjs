// ちゃのまのサーバー。画面のファイルを配り、POST /api/news で Claude に番組を組んでもらう。
// 外部ライブラリは使わず、Node の標準モジュールと組み込みの fetch だけで書く。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// 1台での実演が前提なので、ほかのパソコンからは届かないように 127.0.0.1 だけで待ち受ける
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8787;
// テストでは偽の API サーバーに向けられるように、送り先を環境変数で差し替えられるようにしている
const API_BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const MODEL = 'claude-opus-5-5';
const SYSTEM_PROMPT = await readFile(path.join(ROOT, 'prompt.txt'), 'utf8');

// 配ってよいファイルだけを並べる。.env やサーバーのコードを URL から読まれないようにするため
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/safe.js': ['safe.js', 'text/javascript; charset=utf-8'],
};

const MAX_BODY_BYTES = 16 * 1024;
const MAX_POSTS = 30;
const TODAY_TOPICS = ['ごはん', 'そら', 'したこと', 'みつけた'];
const NEXT_TOPICS = ['なにしたい', 'どこ行きたい', 'なに食べたい'];
const HEADLINES = ['うれしかった', 'おいしかった', 'びっくり', 'なつかしい'];
const ANIMALS = ['ねこ', 'いぬ', 'うさぎ', 'くま', 'すずめ', 'かめ'];
// 放送の順番。この並びより前に戻るコーナーがあれば、番組として受け取らない
const CORNERS = ['ひとこと', 'むかし', 'つぎ'];
const MAX_HOST_CHARS = 80;
const MAX_GREETING_CHARS = 100;

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
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      // 上限を超えたら中身は捨てて読み終わるのを待つ。途中で切ると返事が届かないため
      if (size > MAX_BODY_BYTES) tooLarge = true;
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(new PublicError(413, '投稿の量が多すぎます。ひとことを短くして、もう一度お試しください。'));
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

// 任意の文字列項目。空や未指定なら undefined を返し、長すぎれば弾く
function optionalText(value, max, label) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) {
    throw new PublicError(400, `${label}は${max}文字以内の文字で入力してください。`);
  }
  return value.trim() || undefined;
}

function optionalChoice(value, choices, label) {
  if (value === undefined || value === null || value === '') return undefined;
  if (!choices.includes(value)) throw new PublicError(400, `${label}の値が正しくありません。`);
  return value;
}

// 画面から届いた投稿を検査し、決まった項目だけを持つ新しいオブジェクトに作り直す。
// 余計な項目を Claude に渡さないため
function cleanRequest(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.posts)) {
    throw new PublicError(400, '投稿の形が正しくありません。');
  }
  if (input.posts.length === 0 || input.posts.length > MAX_POSTS) {
    throw new PublicError(400, `投稿は1件以上、${MAX_POSTS}件以内にしてください。`);
  }
  const ids = new Set();
  const posts = input.posts.map((p) => {
    if (!p || typeof p !== 'object') throw new PublicError(400, '投稿の形が正しくありません。');
    if (typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(p.id) || ids.has(p.id)) {
      throw new PublicError(400, '投稿のIDが正しくありません。');
    }
    ids.add(p.id);
    const who = optionalText(p.who, 20, 'よびかた');
    if (!who) throw new PublicError(400, 'よびかたを入れてください。');
    const topic = optionalChoice(p.topic, [...TODAY_TOPICS, ...NEXT_TOPICS], 'お題');
    if (!topic) throw new PublicError(400, 'お題を選んでください。');
    const post = {
      id: p.id,
      who,
      name: optionalText(p.name, 20, 'ニックネーム'),
      animal: optionalChoice(p.animal, ANIMALS, 'どうぶつ'),
      topic,
      card: optionalText(p.card, 30, '札'),
      headline: optionalChoice(p.headline, HEADLINES, '見出し'),
      text: optionalText(p.text, 200, 'ひとこと'),
    };
    // 未指定の項目は JSON.stringify で消えるので、Claude には入っている項目だけが届く
    return post;
  });
  let nextDate;
  if (input.nextDate !== undefined && input.nextDate !== null && input.nextDate !== '') {
    if (typeof input.nextDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.nextDate)) {
      throw new PublicError(400, 'つぎに会う日の日付が正しくありません。');
    }
    nextDate = input.nextDate;
  }
  return { posts, nextDate };
}

// Claude の返事を検査する。投稿にないIDや、使われなかった投稿があれば番組として受け取らない。
// 投稿にない人物や言葉が host に足されていないかの細かい検査は、画面側の safe.js で行う
function checkNews(news, posts) {
  if (!news || typeof news !== 'object' || !Array.isArray(news.segments)) return false;
  for (const key of ['opening', 'closing']) {
    const s = news[key];
    if (typeof s !== 'string' || s.trim() === '' || s.length > MAX_GREETING_CHARS) return false;
  }
  const byId = new Map(posts.map((p) => [p.id, p]));
  const used = new Set();
  let lastCorner = 0;
  for (const seg of news.segments) {
    if (!seg || typeof seg !== 'object') return false;
    const post = byId.get(seg.from);
    if (!post || used.has(seg.from)) return false;
    used.add(seg.from);
    const cornerIndex = CORNERS.indexOf(seg.corner);
    if (cornerIndex < lastCorner) return false;
    lastCorner = cornerIndex;
    // つぎに会う日の希望は「つぎ」コーナーにだけ、今日の投稿はそれ以外にだけ入る
    if (NEXT_TOPICS.includes(post.topic) !== (seg.corner === 'つぎ')) return false;
    if (typeof seg.host !== 'string' || seg.host.trim() === '' || seg.host.length > MAX_HOST_CHARS) return false;
  }
  if (used.size !== posts.length) return false;
  return {
    opening: news.opening,
    segments: news.segments.map((s) => ({ corner: s.corner, from: s.from, host: s.host })),
    closing: news.closing,
  };
}

async function askClaude(data) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[news] ANTHROPIC_API_KEY が設定されていません');
    throw new PublicError(500, 'サーバーの準備ができていません。管理する人に確認してください。');
  }
  // 投稿の中に </posts> と書かれていても囲みが崩れないように、< を JSON のエスケープに置き換える
  const postsJson = JSON.stringify(data).replace(/</g, '\\u003c');
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
      signal: AbortSignal.timeout(90_000),
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

  const result = await apiRes.json();
  if (result.stop_reason !== 'end_turn') {
    console.error(`[news] 番組が最後まで作られませんでした: ${result.stop_reason}`);
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
  if (!checked) {
    console.error('[news] 返ってきた番組が決まりに合いませんでした');
    throw new PublicError(502, '番組をうまく組み立てられませんでした。もう一度お試しください。');
  }
  console.log(`[news] 番組を作りました（${checked.segments.length}件、出力 ${result.usage?.output_tokens ?? '?'} トークン）`);
  return checked;
}

async function handleNews(req, res) {
  // JSON 以外を断ると、ほかのサイトからフォーム送信で呼ばれるのも防げる
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    throw new PublicError(415, '送り方が正しくありません。');
  }
  const raw = await readBody(req);
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new PublicError(400, '投稿の形が正しくありません。');
  }
  const data = cleanRequest(input);
  const news = await askClaude(data);
  sendJson(res, 200, news);
}

async function handleStatic(req, res) {
  const entry = STATIC_FILES[new URL(req.url, 'http://localhost').pathname];
  if (!entry) throw new PublicError(404, '見つかりません。');
  let file;
  try {
    file = await readFile(path.join(ROOT, entry[0]));
  } catch {
    throw new PublicError(404, '見つかりません。');
  }
  res.writeHead(200, {
    'Content-Type': entry[1],
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(file);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/news') {
      if (req.method !== 'POST') throw new PublicError(405, '送り方が正しくありません。');
      await handleNews(req, res);
    } else if (req.method === 'GET') {
      await handleStatic(req, res);
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

server.listen(PORT, HOST, () => {
  console.log(`ちゃのま: http://${HOST}:${PORT}/ で待ち受けています`);
});
