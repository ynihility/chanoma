// ちゃのまのドット絵。すべてこのファイルの文字列から描く（画像ファイルは使わない）
// 1文字が1ドット。文字は PALETTE のキー、'.' は透明。キャラ1体は6色以内に収める

// 全体パレット（15色）。輪郭は黒ではなく濃い茶で統一する
export const PALETTE = {
  k: '#2A1810', // 輪郭・文字
  s: '#4A2E1E', // 影
  w: '#6B3F26', // 木・濃
  b: '#A8693A', // 木・明
  g: '#8E9650', // 畳・濃
  G: '#B9B872', // 畳・明
  e: '#D9B98A', // 壁
  p: '#F3E9D2', // 紙
  r: '#C8402A', // 朱
  a: '#7FB8A5', // 浅葱（家電の差し色）
  y: '#F0B31C', // 山吹
  L: '#BFE8D0', // ブラウン管・光
  d: '#10211A', // ブラウン管・地
  o: '#E07B24', // みかん色
  P: '#E89A8C', // 桃（耳の内側・ほお）
};

export const SPRITES = {
  // ねこ: 三角の耳、しま模様、ピンクのほお
  'ねこ': {
    w: 16, h: 16, rows: [
      '................',
      '..k..........k..',
      '..kk........kk..',
      '..kPk......kPk..',
      '..kPyk....kyPk..',
      '..kyyykkkkyyyk..',
      '.kyyyyyyyyyyyyk.',
      '.kyyoyyyyyyoyyk.',
      '.kyykkyyyykkyyk.',
      '.kyykkyyyykkyyk.',
      '.kPyyyppppyyyPk.',
      '.kyyyppPPppyyyk.',
      '..kyyppkkppyyk..',
      '..kyyyyyyyyyyk..',
      '..kyoyyyyyyoyk..',
      '..kkkkkkkkkkkk..',
    ],
  },
  // いぬ: たれた濃い耳、赤い舌と首輪
  'いぬ': {
    w: 16, h: 16, rows: [
      '................',
      '....kkkkkkkk....',
      '..kkbbbbbbbbkk..',
      '.kwwbbbbbbbbwwk.',
      'kwwwbbbbbbbbwwwk',
      'kwwwbkkbbkkbwwwk',
      'kwwwbkkbbkkbwwwk',
      'kwwbbbbbbbbbbwwk',
      'kwwbbppppppbbwwk',
      '.kwbpppkkpppbwk.',
      '.kkbppppppppbkk.',
      '...kbppkkppbk...',
      '...kbbprrpbbk...',
      '....kbbbbbbk....',
      '...krrrrrrrrk...',
      '...kkkkkkkkkk...',
    ],
  },
  // うさぎ: 長い耳、白い毛、桃色のほお
  'うさぎ': {
    w: 16, h: 16, rows: [
      '...kk......kk...',
      '..kpPk....kPpk..',
      '..kpPk....kPpk..',
      '..kpPk....kPpk..',
      '..kpPk....kPpk..',
      '..kppk....kppk..',
      '..kppkkkkkkppk..',
      '.kppppppppppppk.',
      'kppppppppppppppk',
      'kppkkppppppkkppk',
      'kppkkppppppkkppk',
      'kPPppppPPppppPPk',
      '.kppppkppkppppk.',
      '..keppppppppek..',
      '...keeppppeek...',
      '....kkkkkkkk....',
    ],
  },
  // くま: 丸い耳、こげ茶の毛、明るい鼻まわりと胸
  'くま': {
    w: 16, h: 16, rows: [
      '................',
      '.kkk........kkk.',
      'kwbwk......kwbwk',
      'kwbwkkkkkkkkwbwk',
      '.kwwwwwwwwwwwwk.',
      'kwwwwwwwwwwwwwwk',
      'kwwkpwwwwwwkpwwk',
      'kwwkkwwwwwwkkwwk',
      'kwwwwwbbbbwwwwwk',
      'kwwwwbbkkbbwwwwk',
      'kwwwwbbbbbbwwwwk',
      '.kwwwwbkkbwwwwk.',
      '..kwwwwwwwwwwk..',
      '.kwwwwwbbwwwwwk.',
      '.kwwwwbbbbwwwwk.',
      '.kkkkkkkkkkkkkk.',
    ],
  },
  // すずめ: 横向き。茶色の頭、黒いほおの点、山吹のくちばしと足
  'すずめ': {
    w: 16, h: 16, rows: [
      '................',
      '.....kkkkk......',
      '....kwwwwwk.....',
      '...kwwwwwwwk....',
      '..kwkwwwwwwwk...',
      '.yykppwwwwwwbk..',
      '..kpkppbbwbbbbk.',
      '..kppppbwbbwbbbk',
      '..kppppbbwbbwbbk',
      '..kpppppbbwbbbbk',
      '...kpppppbbbkwwk',
      '....kppppppkkwwk',
      '.....kkkkkk..kk.',
      '......y..y......',
      '.....yy.yy......',
      '................',
    ],
  },
  // かめ: 横向き。畳色の甲羅、山吹のふち、右に頭
  'かめ': {
    w: 16, h: 16, rows: [
      '................',
      '................',
      '................',
      '................',
      '....kkkkkk......',
      '...kgGggGgk.kkk.',
      '..kgGGggGGgkGGGk',
      '.kgggggGgggkGkGk',
      '.kgGGgggGGgkGGGk',
      'kgggggGGgggggkk.',
      'kyyyyyyyyyyyyk..',
      '.kGGk....kGGk...',
      '.kkkk....kkkk...',
      '................',
      '................',
      '................',
    ],
  },
  // テレ吉: ブラウン管テレビの頭をした司会者。画面に笑顔、右につまみ、上にアンテナ
  'テレ吉': {
    w: 24, h: 24, rows: [
      '........................',
      '.....k............k.....',
      '......k..........k......',
      '.......k........k.......',
      '........k......k........',
      '.........kyyyyk.........',
      '.kkkkkkkkkkkkkkkkkkkkkk.',
      '.kbbbbbbbbbbbbbbbbbbbbk.',
      '.kbkkkkkkkkkkkkkbbbbbbk.',
      '.kbkLLLLLLLLLLLkbyybbbk.',
      '.kbkLLdLLLLLdLLkbyybbbk.',
      '.kbkLLdLLLLLdLLkbbbbbbk.',
      '.kbkLLLLLLLLLLLkbyybbbk.',
      '.kbkLdLLLLLLLdLkbyybbbk.',
      '.kbkLLdddddddLLkbbbbbbk.',
      '.kbkLLLLLLLLLLLkbkkkkbk.',
      '.kbkkkkkkkkkkkkkbkkkkbk.',
      '.kbbbbbbbbbbbbbbbbbbbbk.',
      '.kkkkkkkkkkkkkkkkkkkkkk.',
      '.....krrrrryyrrrrrk.....',
      '....krrrrrkyykrrrrrk....',
      '....krrrrrrkkrrrrrrk....',
      '....krrrrrrrrrrrrrrk....',
      '....kkkkkkkkkkkkkkkk....',
    ],
  },
  // 装飾: 柱時計（文字盤は7時を指す）
  '柱時計': {
    w: 16, h: 24, rows: [
      '...kkkkkkkkkk...',
      '..kwwwwwwwwwwk..',
      '.kwbbbbbbbbbbwk.',
      'kwbkkkkkkkkkkbwk',
      'kwbkpppkppppkbwk',
      'kwbkpppkppppkbwk',
      'kwbkpppkppppkbwk',
      'kwbkpppkppppkbwk',
      'kwbkppkkppppkbwk',
      'kwbkpkppppppkbwk',
      'kwbkppppppppkbwk',
      'kwbkppppppppkbwk',
      'kwbkkkkkkkkkkbwk',
      'kwbksssyyssskbwk',
      'kwbksssyyssskbwk',
      'kwbksssyyssskbwk',
      'kwbksssyyssskbwk',
      'kwbksssyyssskbwk',
      'kwbkssyyyysskbwk',
      'kwbkssyyyysskbwk',
      'kwbksssssssskbwk',
      'kwbkkkkkkkkkkbwk',
      '.kwwwwwwwwwwwwk.',
      '..kkkkkkkkkkkk..',
    ],
  },
  // 装飾: みかん
  'みかん': {
    w: 12, h: 12, rows: [
      '.....wgg....',
      '...kkwkkk...',
      '..kooooook..',
      '.kooyoooook.',
      'koyyoooooook',
      'koyooooooook',
      'kooooooooook',
      'kooooooooook',
      'koooooooosok',
      '.kooooooosk.',
      '..koooossk..',
      '...kkkkkk...',
    ],
  },
  // 装飾: 湯呑（浅葱色、お茶は畳色）
  '湯呑': {
    w: 12, h: 12, rows: [
      '............',
      '............',
      '.kkkkkkkkkk.',
      '.kggggggggk.',
      '.kaaaaaaaak.',
      '.kppppppppk.',
      '.kaaaaaaaak.',
      '..kaaaaaak..',
      '..kaaaaaak..',
      '..kssssssk..',
      '...kkkkkk...',
      '............',
    ],
  },
};
