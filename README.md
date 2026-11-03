# Chanoma (ちゃのま)

**A 7 p.m. family news show.** Grandparents, parents and grandchildren each post a short line during the day. At 7 p.m. a host character, "Tele-kichi" (テレ吉), lets Claude arrange everyone's posts into a TV program and plays it on a retro CRT television.

Built for *Built with Claude: Japan 2026*. All code, pixel art and sound effects in this repository were created during the event period (from 2026-11-02). No code, pictures or sounds from the author's earlier works were used.

## Rooms: one show, on everyone's own device

A family connects through a **room**. Everyone opens the same room on their own phone or PC, posts there, and watches the same program at 7 p.m.

- **Create or join.** Press "部屋に入る (join a room)", then "新しく部屋を作る (create a new room)", or type a room code yourself. The server makes the code: 22 random letters and digits (about 131 bits). It works like a key, so share it only with your family. One IP address can create 5 rooms a day.
- **Invite link.** Once you are in a room, "家族に送る (send to family)" opens the phone's share sheet (or copies the link). The link looks like `https://<your-host>/#r=<room code>`. Send it to your family by chat. If someone opens a link for a different room, the app asks before switching, and keeps the old room's posts and shelf on that device.
- **Posts.** Posts go to the room (up to 30 a day per room). If the server cannot be reached, the post stays on the device and is sent the next time the app is opened. While the screen is visible, the app checks for new posts every 20 seconds. The screen shows only "n posts today". It never shows who has read or who has not.
- **7 p.m.** Anyone can press "make it 7 p.m." and the server makes the program from the room's posts of that day. If the program already exists, everyone gets the same one, and Claude is not called twice. Posts that arrive after the program was made are listed below the TV as "words that arrived after the program".
- **Shelf.** Every device keeps the programs it has watched in its own "shelf" (up to 60 programs, 2 MB). When a device enters a room, devices swap their shelves through the server, so a family member who joins later can watch past programs too. Programs that come back this way are marked "returned from a device", and are checked again on arrival.
- **Without a room**, the app still works on one device, as before.

## How to try it

You need Node.js 20.19 or later (`AbortSignal.any` is used; tested with v24 only). There are no npm dependencies.

### On your own computer

1. Open a terminal and **set the API key only in that window** (never write it into a file), then start the server.

   Windows (PowerShell):
   ```powershell
   cd chanoma
   $s = Read-Host "Paste your API key" -AsSecureString
   $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
   $env:ANTHROPIC_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
   [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b); Remove-Variable s, b
   node server.mjs
   ```

   macOS / Linux (bash or zsh). `read -s` does not echo the key and keeps it out of the shell history:
   ```sh
   cd chanoma
   printf "Paste your API key: "; read -rs ANTHROPIC_API_KEY; echo
   export ANTHROPIC_API_KEY
   node server.mjs
   ```

   When you are done, close this window. Do not start other tools from the window that holds the key. `.env.example` only shows the name of the variable; do not put a real key in a file.
2. Open <http://127.0.0.1:8787/> in a browser.
3. Switch between the family members at the top, pick a topic and a card, and press **おくる (send)**. Add posts for two or three people. You can also choose an animal character, a nickname, a date you want to meet, and rename each person.
4. Press **夜7時にする (make it 7 p.m.)**. The room gets dark and the TV plays the program. Press **つぎへ (next)** to move on.

**No API key?** The app still starts. You can press "見本の番組をみる (watch the sample program)" to see a built-in program made from made-up posts. It is clearly marked as a sample and does not call Claude. A real program needs the key.

### On a public host (for example Render)

The public form serves the app and the room API only. It does **not** serve the one-device `POST /api/news`.

| Setting | Value |
|---|---|
| Start Command | `node server.mjs` |
| Build Command | none |
| `CHANOMA_PUBLIC` | `1` (listen on `0.0.0.0`, rooms only) |
| `CHANOMA_ORIGIN` | the public address of the app, for example `https://your-service.onrender.com`. The server refuses to start without it (it is used to allow only requests from that origin) |
| `PORT` | given by the host. The default is 8787 |
| `CHANOMA_TRUSTED_HOPS` | optional, default 1. Which value of `X-Forwarded-For`, counted from the right, is taken as the client IP: the number of proxies in front of the server. Used only in the public form |
| `CHANOMA_ROOMS_PER_HOUR` | optional, default 20. How many rooms the whole server may create in an hour, whatever the IP. Above that, creating a room returns 429 |
| `CHANOMA_LOG_XFF` | optional, not set by default. When set to `1`, the server logs how many values `X-Forwarded-For` has, for the first 5 requests only (the IP values themselves are not logged). For checking the hop count |
| `ANTHROPIC_API_KEY` | type it yourself into the host's environment-variable screen. Do not put it in the repository or give it to a tool |

Behind a proxy, the server takes the client IP for its per-IP limits from `X-Forwarded-For`, counting `CHANOMA_TRUSTED_HOPS` values from the right (default 1; set it to the number of proxies in front of the server; on Render's free tier the header held 3 values for a request that sent none, on 2026-11-04, so this deployment sets 3, and which value is the real client was not directly checked). Values a client prepends to that header are ignored, but if the hop count is wrong the per-IP limits (5 rooms a day, 60 reads and 60 writes a minute) can be bypassed or shared, so treat them as a guide. The caps that protect the cost do not depend on the IP: the shared program limits (10 a minute, 100 a day, 3 at once, 3 tries per room per day) and the server-wide room-creation limit (`CHANOMA_ROOMS_PER_HOUR`, default 20 an hour).

Tests: `node --test`.

## What Claude does

Claude (model `claude-opus-5-5`) is called from the server, with the posts wrapped in `<posts>` tags as **data**; instructions inside the posts are not followed. Claude only does these things:

1. **Orders** the posts into three corners ("きょうの一言", "むかし話コーナー", "つぎに会う日").
2. Writes the host's **lead-in lines** as Tele-kichi.
3. Picks tonight's **feature name** (for example "そら特集") from a fixed list, and for each corner picks the **reason** it was arranged that way (for example "the same topic was chosen by several people") from a fixed list. The conditions are checked by code too.

Claude never rewrites anyone's words. The reply is JSON that points to posts by ID, and Claude is not asked for any HTML or SVG. The server and the browser both validate the reply (types, lengths, IDs, banned words, names or words that are not in the posts, feature and reason against the posts). If a reply fails the check, the server asks once more with a short fixed hint (never with the text of the failed reply) and checks again. If it fails again, the program is not shown. The screen shows the original posts, not text from Claude. Lead-in lines, feature names and reasons are shown with the host's "Tele-kichi" label, and a note under the TV always says that Tele-kichi's words are written by AI (Claude); screen readers read the label as "Tele-kichi (words written by AI)".

### How Claude Code was used in development

The app was built with Claude Code using subagents with separate roles: a designer, an attacker-minded reviewer (looks for ways to abuse rooms, the shelf and the rate limits), a rules reviewer (checks the event rules and licenses), an implementer, and a blind reader (reads only the screen, not the code, to check that text is understandable). A separate step judged their findings. The author made the decisions.

## Where your data goes

```
your device  ->  the Chanoma server  ->  Anthropic API (Claude)
```

| | Sent | Not sent |
|---|---|---|
| Device -> Chanoma server | post text, cards you chose, how each person is called in the family, the optional nickname, the animal, the optional wish date; a hash of this device's random key; the room code | your voice; the device key itself (except over plain `http`, see below) |
| Chanoma server -> Anthropic | the day's posts of the room, wrapped in `<posts>`, only when a program is made | the room code, the device key |

- **Voice input** is optional and only a helper: you check the text before sending. The app shows: 「声は保存しません。音声認識はブラウザの機能で、提供元のサーバーに送られる場合があります。整えるために話の文章はClaudeに送ります。」 The speech recognition is the browser's own feature, and the browser's provider may receive the voice.
- **Posts** are served by the server only for that day. From 4:00 JST the next morning they are no longer shown, and the server removes them from memory within the following hour. They stay on the device that wrote them.
- **Programs** include a copy of that day's posts (text, cards, how each person is called, nickname, animal, wish date). A program stays on the server until the room has not been used for 3 days (each room keeps up to 30 programs; the oldest is dropped first), and can come back from a family member's device through the shelf. So the words in a program stay on the server as long as the room is in use. If every device has deleted a program and the server has forgotten it, it is gone.
- **At Anthropic**: the server sends the posts to the Claude API with the model `claude-opus-5-5`. Anthropic's API documentation (retrieved 2026-11-04; <https://platform.claude.com/docs/en/manage-claude/api-and-data-retention>) states that conversation content (prompts and Claude's outputs) is not retained by default, with the exception of "Covered Models" (Claude Fable 5.1, Mythos 5.1, Fable 5 and Mythos 5), which require 30-day retention; `claude-opus-5-5` is not on that list. Anthropic's commercial data retention policy (dated 2026-07-01, retrieved 2026-11-04; <https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data>) states that API inputs and outputs are automatically deleted from its backend within 30 days, and that content flagged by its automated trust-and-safety systems as a Usage Policy violation may be retained for up to 2 years. This project does **not** use zero data retention (ZDR). The request also enables Anthropic's server-side fallback (`fallbacks: "default"`): only if Claude Opus 5.5 declines the request on safety grounds, the API retries it once on another Claude model that Anthropic recommends for that case. Which model that is, is not published by Anthropic, and we have not verified it; the server does not record which model answered.
- **Purpose**: the posts are used only to make the program. They are not used for anything else, and there are no rankings, ads or public pages.
- **Server location**: if you host on Render, the server runs outside Japan (Singapore), and the hosting company may keep access logs. The Chanoma server logs only the first 4 letters of a room code and never the posts.

Nothing here makes the service completely private. Please post only what your family is comfortable sharing with these services.

## Known limits

These are known and not fixed. They are listed so that you can decide whether Chanoma suits your family.

- **Shared rate limits.** The limits for making programs (10 a minute, 100 a day, 3 at once) are shared by all rooms, to cap the cost. If someone uses them up, no room can make a program that day. Each room can try to make a program 3 times a day, and failed tries count.
- **Anyone with the room code can post under any name.** The family's own way of calling each other is free text, so the app cannot tell who is who. Share the code only with your family.
- **The program is fixed when someone presses the button.** If someone presses "make it 7 p.m." in the morning, that day's program is made from the posts so far. The screen shows "today's program is already made". Later posts go below the TV.
- **The invite link stays in history.** The link (which contains the room code) remains in chat history (such as LINE) and in the browser history.
- **Open it in the same browser.** Saved data (room, device key, shelf) belongs to one browser on one device. The in-app browser of a chat app and Safari or Chrome may keep separate saves, so the same person may look like a new device. Always open the link in the browser you normally use.
- **A program can disappear.** If every device has deleted it and the server has forgotten the room, it is gone.
- **Returned programs cannot be verified.** A program that comes back through the shelf is checked by the same rules, but it has no signature, so it cannot be told apart from one that a room member rebuilt. It is marked "returned from a device".
- **The first person to choose sets the "next meeting" values.** In the "つぎに会う日" corner, the first value chosen is shown.
- **Children should use it with a parent or guardian.** The app does not ask for ages.
- **Plain `http` (for example on a home Wi-Fi) is not protected.** The device key then travels in plain text. Use `https` for anything other than trying it out on your own network.
- **A late reply can land in the wrong shelf.** Right after you switch rooms, a delayed reply from the previous room can be saved into the new room's shelf.
- **The free host may sleep.** The server keeps rooms in memory. If the host stops it, the server forgets, and the devices bring the programs back later.
- **Per-IP limits are a guide.** The client IP comes from `X-Forwarded-For`, so it depends on the proxy setup (see above). The cost caps do not depend on it.
- **A program keeps the day's posts.** The posts' text is deleted from the server the next morning, but the program made from them keeps a copy for as long as the room is used (see "Where your data goes").
- **Memory on a free host is not measured.** With 100 rooms × 30 programs the server was measured at about 285 MB on a development machine. The free tier of Render shows a memory limit of 512 MB, but its dashboard does not show the actual use on a free instance, so the use on the host is not verified.
- **More than 30 saved posts on one device.** The room accepts 30 posts a day, but a device can also hold older posts that were written before it joined the room. When the saved list would pass 30, the app drops the oldest posts that the room cannot see, so that the saved data stays readable. Those posts are removed from the device without a message.

## Third-party materials

| Item | Details |
|---|---|
| **ChanomaDot** (title lettering) | Made by ynihility with Claude Code (AI) during the event period. A 12×16 dot typeface with 51 characters, used only for the app name and the headings on the TV. **Not licensed for reuse** (see `fonts/LICENSE-ChanomaDot.txt`). File `fonts/ChanomaDot-Regular.ttf` (15,644 bytes). SHA-256 `5a0462f27872e3d72c451ea49ea86d4646bd9ef269674f0b1e0fb5b050ea6f53` |
| **Reggae One** (other headings) | Copyright 2020 The Reggae Project Authors (<https://github.com/fontworks-fonts/Reggae>). SIL Open Font License 1.1. File `fonts/ReggaeOne-Regular.ttf`, unmodified. Source: <https://github.com/google/fonts/tree/main/ofl/reggaeone> at commit `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5`. SHA-256 `aebe62598732d76036f30ec11bb0ec5f68938e373a06d1b4ceb6b9cf1abf3db2`. License text: `fonts/OFL-ReggaeOne.txt` |
| **DotGothic16** (dot-style text) | Copyright 2020 The DotGothic16 Project Authors (<https://github.com/fontworks-fonts/DotGothic16>). SIL Open Font License 1.1. File `fonts/DotGothic16-Regular.ttf`, unmodified. Source: <https://github.com/google/fonts/tree/main/ofl/dotgothic16> at commit `9a6cc6b8ce992aff77b69c857c46af0b42cdff76`. SHA-256 `3ad9af88726d42b40f7f365f0dcac785af73cf20ea6f1d5b44e57cc21150b8f1`. License text: `fonts/OFL-DotGothic16.txt` |
| Body text | Fonts already installed on the user's device (none are bundled). |
| Claude API | The server calls the Anthropic API to make programs. |
| Browser speech recognition | Optional voice input uses the browser's Web Speech API. |

ChanomaDot was made for this project (with Claude Code), so it is not a third-party material, but it is listed here because it is a bundled font. Reggae One is used for the headings that contain characters ChanomaDot does not have.

There are no other external libraries, data, images or audio files. All pixel art is drawn in code from text maps (`sprites.js`), and all sound effects are synthesized with the Web Audio API (`sound.js`). The short beeps that play along with Tele-kichi's lines (his cue sounds) are electronic tones made the same way; they are not a voice, and no audio files or speech synthesis are used. The scene transitions are drawn on a canvas in code (`effects.js`) and the waiting screen is built with CSS; neither uses an external effect library, image or sound.

## License

The **code** is released under the MIT License (see `LICENSE`, Copyright (c) 2026 ynihility).

The MIT License covers the code only. These are **not** licensed for reuse:

- the pixel art, including the picture maps in `sprites.js`
- the character "Tele-kichi" (テレ吉)
- the title typeface ChanomaDot (`fonts/ChanomaDot-Regular.ttf`)

The fonts Reggae One and DotGothic16 keep their own license (SIL Open Font License 1.1).

## Design rules

No read receipts, no nagging, no rankings, nothing public, and no health or loneliness claims. Posts are only the family's own words. The app is meant as a small starting point for conversation.

---

# ちゃのま

**夜7時の、かぞくニュース。** 祖父母・親・孫が、昼のあいだに、それぞれ一言ずつ投稿します。夜7時になると、司会の「テレ吉」が、Claude にみんなの投稿を番組に並べてもらい、昭和のブラウン管テレビで放送します。

「Built with Claude: Japan 2026」のために作りました。このリポジトリのコード、ドット絵、効果音は、すべて開催期間中（2026年11月2日以降）に新しく作ったものです。作者の過去の作品のコード・絵・音は使っていません。

## 部屋：それぞれの端末で、同じ番組を見る

家族は「部屋」でつながります。みんなが、自分のスマホやパソコンで同じ部屋を開き、そこに投稿し、夜7時に同じ番組を見ます。

- **作る・入る。** 「部屋に入る」を押し、「新しく部屋を作る」で作るか、部屋のコードを手で入力して入ります。コードはサーバーが作る、英数字22字の乱数（約131ビット）です。鍵の代わりなので、家族だけに伝えてください。1つの IP アドレスから作れる部屋は、1日5つまでです。
- **招待リンク。** 部屋に入ると出てくる「家族に送る」を押すと、スマホの共有画面が開きます（なければ、リンクをコピーします）。リンクは `https://<置き場所>/#r=<部屋のコード>` の形です。LINE などで家族に送ってください。別の部屋のリンクを開いたときは、切り替える前に確かめます。いまの部屋の投稿と本棚は、その端末に残ります。
- **投稿。** 投稿は部屋に送られます（1部屋1日30件まで）。サーバーに届かないときは、端末に残しておき、次に開いたときに送ります。画面が見えているあいだは、20秒ごとに新しい投稿を取りに行きます。画面に出るのは「きょうの投稿 n 件」だけです。だれが読んだか、だれがまだかは出しません。
- **夜7時。** だれかが「夜7時にする」を押すと、サーバーが、その日の部屋の投稿から番組を作ります。番組がすでにあれば、全員が同じ番組を受け取り、Claude は二重に呼ばれません。番組を作ったあとに届いた投稿は、テレビの下に「番組のあとに届いた一言」として並びます。
- **本棚。** 各端末は、見た番組を自分の「本棚」に残します（60本、2MBまで）。部屋に入ると、端末どうしがサーバーを通して本棚を持ち寄るので、あとから入った家族も、過去の番組を見られます。持ち寄りで戻った番組には「端末から戻した番組です」と出し、受け取るときにもう一度検査します。
- **部屋に入らなくても**、今までどおり、1台の中だけで使えます。

## 試しかた

Node.js 20.19 以上が必要です（`AbortSignal.any` を使うため。確認したのは v24 だけです）。npm のパッケージは使っていません。

### 自分のパソコンで

1. ターミナルを開き、**そのウィンドウだけに** API キーを設定して（ファイルには書かないでください）、サーバーを起動します。

   Windows（PowerShell）:
   ```powershell
   cd chanoma
   $s = Read-Host "APIキーを貼り付けてEnter" -AsSecureString
   $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
   $env:ANTHROPIC_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
   [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b); Remove-Variable s, b
   node server.mjs
   ```

   macOS / Linux（bash か zsh）。`read -s` は、キーを画面に出さず、シェルの履歴にも残しません。
   ```sh
   cd chanoma
   printf "Paste your API key: "; read -rs ANTHROPIC_API_KEY; echo
   export ANTHROPIC_API_KEY
   node server.mjs
   ```

   終わったら、このウィンドウを閉じてください。キーを設定したウィンドウでは、ほかの道具を起動しないでください。`.env.example` は変数の名前を示すだけです。本物のキーはファイルに書かないでください。
2. ブラウザで <http://127.0.0.1:8787/> を開きます。
3. 上のボタンで家族の人を切り替え、お題と札を選んで「おくる」を押します。2〜3人分の投稿を入れてください。動物のキャラ、ニックネーム、会いたい日、よびかたの変更もできます。
4. 「夜7時にする」を押すと、部屋が暗くなり、テレビで番組が始まります。「つぎへ」で進みます。

**API キーがなくても**、アプリは起動します。「見本の番組をみる」を押すと、作り物の投稿でできた見本の番組が見られます。見本だと分かる印がつき、Claude は呼びません。本物の番組を作るには、キーが必要です。

### 公開の置き場所で（たとえば Render）

公開の形では、アプリと部屋の入口だけを出します。1台実演用の `POST /api/news` は**出しません**。

| 設定 | 値 |
|---|---|
| Start Command | `node server.mjs` |
| Build Command | なし |
| `CHANOMA_PUBLIC` | `1`（`0.0.0.0` で待ち受け、部屋だけを出す） |
| `CHANOMA_ORIGIN` | アプリの公開アドレス。例: `https://your-service.onrender.com`。ないと起動しません（このアドレスからの要求だけを許すために使います） |
| `PORT` | 置き場所が渡します。既定は 8787 |
| `CHANOMA_TRUSTED_HOPS` | 任意。既定 1。`X-Forwarded-For` の右から何番目の値を、送り元の IP とするか。サーバーの前にある中継の段数です。公開の形のときだけ効きます |
| `CHANOMA_ROOMS_PER_HOUR` | 任意。既定 20。サーバー全体で、1時間に作れる部屋の数です。IP に頼りません。超えると、部屋を作る要求は 429 を返します |
| `CHANOMA_LOG_XFF` | 任意。ふだんは設定しません。`1` にすると、最初の5リクエストだけ、`X-Forwarded-For` の値の数を記録します（IP の値は記録しません）。段数の確認用です |
| `ANTHROPIC_API_KEY` | 置き場所の環境変数の画面に、自分で入力します。リポジトリに入れたり、道具に渡したりしないでください |

プロキシの後ろでは、IP ごとの上限に使うクライアントの IP を、`X-Forwarded-For` の右から `CHANOMA_TRUSTED_HOPS` 番目（既定 1。サーバーの前にある中継の数を入れます。Render の無料枠では、2026年11月4日に、ヘッダーを付けずに送った通信で、ヘッダーに3つの値が入っていました。そのため、この置き場所では 3 にしています。3つのうちどれが本当のお客さんの IP かは、直接は確かめていません）から取ります。送る側がこのヘッダーの先頭に足した値は無視しますが、段数の設定が違うと IP ごとの上限（1日5部屋、1分60回の読み書き）は回避や共有が起こりうるので、目安と考えてください。費用を守る上限は IP に頼りません。全体の番組の枠（1分10回、1日100回、同時3つ、部屋ごと1日3回）と、サーバー全体の部屋作成の上限（`CHANOMA_ROOMS_PER_HOUR`、既定1時間20室）です。

テスト：`node --test`

## Claude の役割

サーバーから Claude（`claude-opus-5-5`）を呼びます。投稿は `<posts>` で囲んだ「データ」として渡し、投稿の中の指示には従いません。Claude がするのは、次のことだけです。

1. 投稿を3つのコーナー（「きょうの一言」「むかし話コーナー」「つぎに会う日」）に**並べる**。
2. 司会テレ吉の**つなぎの言葉**を書く。
3. 今夜の**特集名**（たとえば「そら特集」）と、コーナーごとの**編成のわけ**（たとえば「同じお題をえらんだ人がいます」）を、決まった一覧の中から選ぶ。条件に合うかは、コードでも確かめます。

誰かの言葉を書き換えることはありません。返事は、投稿をIDで指す JSON で、HTML や SVG は作らせません。返事は、サーバーとブラウザの両方で検査します（型、長さ、ID、禁止された言葉、投稿にない名前や言葉、特集名と編成のわけが投稿に合うか、など）。検査に落ちたときは、決まった短いヒントだけを添えて（落ちた返事の文章は渡しません）、1回だけ作り直してもらい、もう一度検査します。それでも落ちたら、番組は出しません。画面に出す本文は、Claude の返事ではなく、元の投稿です。つなぎの言葉・特集名・わけは、司会「テレ吉」の札で示し、テレ吉の言葉を AI（Claude）が考えていることを、テレビの下の注記で常に示します（画面の読み上げでは「テレ吉（AI が考えた言葉）」と読みます）。

### 開発での Claude Code の使い方

役割を分けたサブエージェントで作りました。設計役、攻め役（部屋・本棚・回数の上限の抜け道を、悪用する人の目で探す）、規約役（大会の決まりとライセンスを確かめる）、実装役、目かくし読み（コードを見ず、画面だけを読んで、文が分かるかを確かめる）です。出た指摘は、別の段階で判定しました。決めたのは作者です。

## データの行き先

```
あなたの端末  ->  ちゃのまのサーバー  ->  Anthropic の API（Claude）
```

| | 送るもの | 送らないもの |
|---|---|---|
| 端末 -> ちゃのまのサーバー | 投稿の文、選んだ札、家族でのよびかた、任意のニックネーム、動物、任意の会いたい日。この端末の乱数の鍵のハッシュ。部屋のコード | 声。端末の鍵そのもの（ただし、下の `http` の場合を除く） |
| ちゃのまのサーバー -> Anthropic | 番組を作るときだけ、その日の部屋の投稿（`<posts>` で囲む） | 部屋のコード、端末の鍵 |

- **音声入力**は、任意の補助です。送る前に、必ず文字で確かめます。アプリには「声は保存しません。音声認識はブラウザの機能で、提供元のサーバーに送られる場合があります。整えるために話の文章はClaudeに送ります。」と出します。音声認識はブラウザ自身の機能で、声はブラウザの提供元が受け取ることがあります。
- **投稿**は、サーバーがその日のあいだだけ返します。翌朝4:00（日本時間）からは画面に出なくなり、サーバーのメモリからは、そのあと1時間以内に消します。書いた端末には残ります。
- **番組**には、その日の投稿の写し（文、札、よびかた、ニックネーム、動物、会いたい日）が入ります。番組は、部屋が3日使われないまでサーバーに残り（1部屋30本まで。古いものから消えます）、家族の端末から本棚を通して戻ることもあります。つまり、番組になった投稿の文は、部屋が使われているあいだサーバーに残ります。すべての端末から消え、サーバーも忘れたら、その番組はなくなります。
- **Anthropic では**：サーバーは投稿を、モデル `claude-opus-5-5` を指定して Claude API に送ります。Anthropic の API の説明（2026年11月4日に取得。<https://platform.claude.com/docs/en/manage-claude/api-and-data-retention>）では、会話の内容（入力と Claude の出力）は既定では保存されない、ただし「Covered Models」（Claude Fable 5.1、Mythos 5.1、Fable 5、Mythos 5）は30日の保持が必要、とされています。`claude-opus-5-5` はこの一覧にありません。Anthropic の商用データ保持の方針（2026年7月1日の日付。2026年11月4日に取得。<https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data>）では、API の入力と出力は受け取りから30日以内に自動で削除される、ただし自動の安全の仕組みが利用規約違反と判定したものは最長2年保持されることがある、とされています。このプロジェクトは、ゼロデータ保持（ZDR）では**ありません**。また、Anthropic のサーバー側フォールバック（`fallbacks: "default"`）を有効にしています。Claude Opus 5.5 が安全上の理由で断ったときだけ、Anthropic が推奨する別の Claude モデルで1回やり直されます。どのモデルかは Anthropic が公開しておらず、確かめていません。答えたモデルの名前は、サーバーの記録に残していません。
- **利用の目的**：投稿は、番組を作ることだけに使います。ほかの目的には使いません。ランキング、広告、公開のページはありません。
- **サーバーの場所**：Render に置くと、サーバーは日本の外（シンガポール）にあり、運営側にアクセスの記録が残ることがあります。ちゃのまのサーバーは、記録に部屋のコードの先頭4字だけを出し、投稿の文は出しません。

ここまでのことで、完全に私的になるわけではありません。投稿は、これらのサービスに預けても家族が納得できる内容にしてください。

## 既知の制限

分かっていて、まだ直していないことです。ちゃのまが家族に合うかを決める助けにしてください。

- **回数の枠は全部屋で共有。** 番組を作る回数の上限（1分10回、1日100回、同時3つ）は、費用を抑えるため、全部屋で共有しています。だれかが使い切ると、その日はどの部屋も番組を作れません。また、1つの部屋が番組を作ろうとできるのは1日3回までで、失敗した回も数えます。
- **部屋のコードを知る人は、どの名前でも投稿できます。** 家族のよびかたは自由な文字なので、アプリでは、だれが書いたかを見分けられません。コードは家族だけに伝えてください。
- **ボタンを押した時点で、番組が決まります。** 朝に「夜7時にする」を押すと、その時点までの投稿でその日の番組ができます。画面には「きょうの番組はもうできています」と出ます。あとの投稿は、テレビの下に並びます。
- **招待リンクは履歴に残ります。** リンク（部屋のコードを含む）は、LINE などのトーク履歴と、ブラウザの履歴に残ります。
- **同じブラウザで開いてください。** 部屋・端末の鍵・本棚は、1つの端末の1つのブラウザに保存されます。アプリの中のブラウザ（LINE など）と Safari・Chrome では、保存が別になることがあり、同じ人が新しい端末に見えることがあります。いつも使うブラウザでリンクを開いてください。
- **番組が消えることがあります。** すべての端末から消え、サーバーも部屋を忘れたら、その番組はなくなります。
- **戻った番組は、本物かどうか確かめられません。** 本棚から戻った番組も同じ検査を通しますが、署名がないので、部屋の人が作り直したものと見分けられません。「端末から戻した」の印をつけています。
- **「つぎに会う日」は、最初に選んだ人の値が出ます。**
- **子どもは、保護者と一緒に使ってください。** 年齢は聞きません。
- **`http`（家の Wi-Fi など）では守られません。** 端末の鍵が、そのまま（平文で）流れます。自分のネットワークで試すとき以外は、`https` を使ってください。
- **部屋を切り替えた直後の遅れた返事が、新しい部屋の本棚に入ることがあります。**
- **無料の置き場所は、止まることがあります。** サーバーは部屋をメモリに置いています。置き場所がサーバーを止めると、サーバーは忘れ、番組はあとで端末から戻ります。
- **IP ごとの上限は目安です。** クライアントの IP は `X-Forwarded-For` から取るので、中継の設定に依存します（上の説明）。費用の上限は IP に頼りません。
- **番組には、その日の投稿の写しが残ります。** 投稿の文は翌朝サーバーから消えますが、それから作った番組は、部屋が使われるあいだ写しを持ちます（「データの行き先」を参照）。
- **無料の置き場所のメモリは測っていません。** 100部屋×30本で、開発に使うパソコンでは約285MBと測定しました。Render の無料枠のメモリの上限は 512MB と表示されますが、無料の枠では実際の使用量が管理画面に出ないため、置き場所での使用量は未確認です。
- **1台の端末に30件を超えて保存されるとき。** 部屋で受け付けるのは1日30件ですが、端末には、部屋に入る前に書いた古い投稿も残ります。保存する一覧が30件を超えそうなときは、保存したデータが読めなくならないよう、部屋から見えない古い投稿から消します。消えた投稿について、画面にお知らせは出ません。

## 外部の素材

上の英語の表のとおりです。同梱したフォントは3つです。ChanomaDot は、ynihility がこのプロジェクトのために Claude Code（AI）と一緒に作ったもので、再利用は許可していません（ライセンスは `fonts/LICENSE-ChanomaDot.txt`）。Reggae One と DotGothic16 は、SIL Open Font License 1.1 で、加工せず、配布元のファイルのまま配っています。ライセンス全文は `fonts/` に置いています。Reggae One は、ChanomaDot にない字を含む見出しに使っています。本文のフォントは端末にあるものを使うだけで、同梱していません。外部のライブラリ、データ、画像、音声ファイルはありません。ドット絵は `sprites.js` の文字の地図からコードで描き、効果音は Web Audio API で合成しています。テレ吉の言葉に合わせて鳴る短い音（合図の音）も、同じ方法で作った電子音です。声ではなく、音声ファイルや音声合成は使っていません。場面の切り替えの演出は canvas（`effects.js`）、待ち画面は CSS で、どちらもコードから作っています。外部の演出ライブラリ・画像・音声は使っていません。

## ライセンス

**コード**は、MIT ライセンスです（`LICENSE`。Copyright (c) 2026 ynihility）。

MIT の対象は、コードだけです。次のものは、再利用を許可しません。

- ドット絵（`sprites.js` の絵の地図を含む）
- キャラクター「テレ吉」
- 題字の書体 ChanomaDot（`fonts/ChanomaDot-Regular.ttf`）

フォントの Reggae One と DotGothic16 は、それぞれの SIL Open Font License 1.1 に従います。

## 設計のルール

既読表示、催促、ランキング、公開、健康効果や孤独の解消をうたう表現は、作りません。投稿は、家族自身の言葉だけです。「家族の会話のきっかけ」になる小さな道具を目指しています。
