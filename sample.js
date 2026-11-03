// 見本の番組。API が使えないときや、画面のボタンで選んだときだけ流す。
// 架空の家族3人分の投稿と、その番組。実在の地名・人名・日付は使わない（数字も使わない）。
// 司会の文は、アプリに入っている決まった文（Claude は使わない）。
// 本物の番組と同じ形（feature・opening・segments・lineup・closing）で持つ。使う前に、本物と同じ検査（safe.js）に通す。
// nextDate（つぎに会う日）と wishDate（会いたい日）は持たない。日付を使わないため。

// よびかたは初めの名前（safe.js の DEFAULT_ROLES）だけ。ニックネームはなし
export const SAMPLE_POSTS = [
  { id: 's1', who: 'おばあちゃん', animal: 'かめ', topic: 'したこと', card: 'おそうじ', headline: 'なつかしい', text: 'おしいれを片づけたら、むかしあんだ手ぶくろが出てきた' },
  { id: 's2', who: 'まご', animal: 'うさぎ', topic: 'そら', card: 'はれ', headline: 'びっくり', text: 'かえり道で、魚の形をしたくもを見つけた' },
  { id: 's3', who: 'おかあさん', animal: 'いぬ', topic: 'そら', card: 'おつきさま', text: 'ベランダから、まるいお月さまが見えた' },
  { id: 's4', who: 'おかあさん', animal: 'いぬ', topic: 'ごはん', card: 'おかず', headline: 'おいしかった', text: 'ひさしぶりに、だし巻きたまごを作った' },
  { id: 's5', who: 'おばあちゃん', animal: 'かめ', topic: 'どこ行きたい', card: 'こうえん' },
  { id: 's6', who: 'まご', animal: 'うさぎ', topic: 'どこ行きたい', card: 'こうえん' },
];

export const SAMPLE_NEWS = {
  // そら のお題が2件ある
  feature: 'そら特集',
  opening: 'こんばんは、テレ吉です。かぞくニュースの時間です。',
  segments: [
    { corner: 'ひとこと', from: 's3', host: 'さいしょは、そらのお話です。おかあさんからです。' },
    { corner: 'ひとこと', from: 's2', host: 'つぎも、そらのお話です。まごからです。' },
    { corner: 'ひとこと', from: 's4', host: 'つづいては、ごはんのお話です。' },
    { corner: 'むかし', from: 's1', host: 'ここからは、むかし話のコーナーです。おばあちゃんのお話です。' },
    { corner: 'つぎ', from: 's5', host: '最後は、つぎに会う日の希望です。おばあちゃんからです。' },
    { corner: 'つぎ', from: 's6', host: 'まごからも、行きたい所の希望です。' },
  ],
  lineup: [
    // 違う人（まごとおかあさん）が、同じお題 そら を選んでいる
    { corner: 'ひとこと', reason: '同じお題をえらんだ人がいます' },
    // s1 は見出しで なつかしい を選んでいる
    { corner: 'むかし', reason: '「なつかしい」をえらんだ投稿です' },
    // 違う人（おばあちゃんとまご）が、同じ札 こうえん を選んでいる
    { corner: 'つぎ', reason: '同じ札をえらんだ人がいます' },
  ],
  closing: '今夜のかぞくニュースは、ここまでです。おやすみなさい。',
};
