# Chanoma (ちゃのま)

**A 7 p.m. family news show.** Grandparents, parents and grandchildren each post a short line during the day. At 7 p.m. a host character, "Tele-kichi" (テレ吉), lets Claude arrange everyone's posts into a TV program and plays it on a retro CRT television.

Built for *Built with Claude: Japan 2026*. All code, pixel art and sound effects in this repository were created during the event period (from 2026-11-02).

## How to try it

You need Node.js (tested with v24) and an Anthropic API key. There are no npm dependencies.

1. Open a terminal, **set the API key only in that window** (never write it into a file), and start the server:
   ```powershell
   cd chanoma
   $s = Read-Host "Paste your API key" -AsSecureString
   $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
   $env:ANTHROPIC_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
   [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b); Remove-Variable s, b
   node server.mjs
   ```
   When you are done, close this window. Do not start other tools from the window that holds the key.
2. Open <http://127.0.0.1:8787/> in a browser.
3. Switch between the family members at the top, pick a topic and a card, and press **おくる (send)**. Add posts for two or three people. You can also choose an animal character, a nickname, a date you want to meet, and rename each person.
4. Press **夜7時にする (make it 7 p.m.)**. The room gets dark and the TV plays the program. Press **つぎへ (next)** to move on.

Tests: `node --test` (unit tests for the validation code).

## What Claude does

`POST /api/news` sends the posts to Claude (model `claude-opus-5-5`) as data inside `<posts>` tags. Claude only **orders** the posts into corners and writes the host's lead-in lines, returned as JSON that refers to posts by ID. It never rewrites anyone's words. The server and the browser both validate the reply (types, lengths, IDs, banned words, names that are not in the posts), and the screen shows the original posts, not text from Claude. Lead-in lines are labelled "AI" on screen.

## Third-party materials

| Item | Details |
|---|---|
| **Reggae One** (headings) | Copyright 2020 The Reggae Project Authors (<https://github.com/fontworks-fonts/Reggae>). SIL Open Font License 1.1. File `fonts/ReggaeOne-Regular.ttf`, unmodified. Source: <https://github.com/google/fonts/tree/main/ofl/reggaeone> at commit `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5`. SHA-256 `aebe62598732d76036f30ec11bb0ec5f68938e373a06d1b4ceb6b9cf1abf3db2`. License text: `fonts/OFL-ReggaeOne.txt` |
| **DotGothic16** (dot-style text) | Copyright 2020 The DotGothic16 Project Authors (<https://github.com/fontworks-fonts/DotGothic16>). SIL Open Font License 1.1. File `fonts/DotGothic16-Regular.ttf`, unmodified. Source: <https://github.com/google/fonts/tree/main/ofl/dotgothic16> at commit `9a6cc6b8ce992aff77b69c857c46af0b42cdff76`. SHA-256 `3ad9af88726d42b40f7f365f0dcac785af73cf20ea6f1d5b44e57cc21150b8f1`. License text: `fonts/OFL-DotGothic16.txt` |
| Body text | Fonts already installed on the user's device (none are bundled). |
| Claude API | The server calls the Anthropic API only from `POST /api/news`. |
| Browser speech recognition | Optional voice input uses the browser's Web Speech API. |

There are no other external libraries, data, images or audio files. All pixel art is drawn in code from text maps (`sprites.js`), and all sound effects are synthesized with the Web Audio API (`sound.js`). The scene transitions are drawn on a canvas in code (`effects.js`) and the waiting screen is built with CSS; neither uses an external effect library, image or sound.

Voice input note shown in the app: 「声は保存しません。音声認識はブラウザの機能で、提供元のサーバーに送られる場合があります。整えるために話の文章はClaudeに送ります。」

## Design rules

No read receipts, no nagging, no rankings, and no health or loneliness claims. Posts are only the family's own words. The app is meant as a small starting point for conversation.

---

# ちゃのま

**夜7時の、かぞくニュース。** 祖父母・親・孫が、昼のあいだに、それぞれ一言ずつ投稿します。夜7時になると、司会の「テレ吉」が、Claude にみんなの投稿を番組に並べてもらい、昭和のブラウン管テレビで放送します。

「Built with Claude: Japan 2026」のために作りました。このリポジトリのコード、ドット絵、効果音は、すべて開催期間中（2026年11月2日以降）に新しく作ったものです。

## 試しかた

Node.js（v24 で確認）と、Anthropic の API キーが必要です。npm のパッケージは使っていません。

1. ターミナルを開き、**そのウィンドウだけに** API キーを設定して（ファイルには書かないでください）、サーバーを起動します。
   ```powershell
   cd chanoma
   $s = Read-Host "APIキーを貼り付けてEnter" -AsSecureString
   $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
   $env:ANTHROPIC_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
   [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b); Remove-Variable s, b
   node server.mjs
   ```
   終わったら、このウィンドウを閉じてください。キーを設定したウィンドウでは、ほかの道具を起動しないでください。
2. ブラウザで <http://127.0.0.1:8787/> を開きます。
3. 上のボタンで家族の人を切り替え、お題と札を選んで「おくる」を押します。2〜3人分の投稿を入れてください。動物のキャラ、ニックネーム、会いたい日、よびかたの変更もできます。
4. 「夜7時にする」を押すと、部屋が暗くなり、テレビで番組が始まります。「つぎへ」で進みます。

テスト：`node --test`（検査用のコードの単体テスト）

## Claude の役割

`POST /api/news` が、投稿を `<posts>` で囲んだ「データ」として Claude（`claude-opus-5-5`）に渡します。Claude がするのは、投稿をコーナーに**並べる**ことと、司会のつなぎの言葉を書くことだけです。返事は、投稿をIDで指す JSON で、誰かの言葉を書き換えることはありません。返事は、サーバーとブラウザの両方で検査します（型、長さ、ID、禁止された言葉、投稿にない名前など）。画面に出す本文は、Claude の返事ではなく、元の投稿です。つなぎの言葉には、画面で「AI」と表示します。

## 外部の素材

上の英語の表のとおりです。同梱したフォントは Reggae One と DotGothic16 の2つで、どちらも SIL Open Font License 1.1 です。加工せず、配布元のファイルのまま配っています。ライセンス全文は `fonts/` に置いています。本文のフォントは端末にあるものを使うだけで、同梱していません。外部のライブラリ、データ、画像、音声ファイルはありません。ドット絵は `sprites.js` の文字の地図からコードで描き、効果音は Web Audio API で合成しています。場面の切り替えの演出は canvas（`effects.js`）、待ち画面は CSS で、どちらもコードから作っています。外部の演出ライブラリ・画像・音声は使っていません。

## 設計のルール

既読表示、催促、ランキング、健康効果や孤独の解消をうたう表現は、作りません。投稿は、家族自身の言葉だけです。「家族の会話のきっかけ」になる小さな道具を目指しています。
