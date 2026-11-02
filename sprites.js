// ちゃのまのドット絵。すべてこのファイルの文字列から描く（画像ファイルは使わない）
// 1文字が1ドット。文字は PALETTE のキー、'.' は透明。キャラ1体は7色以内（輪郭を除く）に収める
// 光は左上から当てる。明るい色は左上寄り、影は右下と下側に置く

// 全体パレット（20色）。輪郭は黒ではなく濃い茶で統一する
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
  c: '#D08A3E', // 茶トラ（ねこの体の基本色）
  h: '#EDC184', // 明るい黄土（ねこ・すずめのハイライト）
  m: '#C78852', // 明るい茶（いぬのハイライト）
  W: '#FFF8E8', // 生成り（うさぎのハイライト）
  v: '#5F6B36', // 深緑（かめの甲羅の影と亀甲の線）
};

export const SPRITES = {
  // ねこ: 茶トラ。三角の耳、額のしま、細いつり目、ピンクの鼻とほお
  'ねこ': {
    w: 16, h: 16, rows: [
      '................',
      '..k..........k..',
      '..kk........kk..',
      '..khk......kck..',
      '..khPk....kPbk..',
      '..kcPckkkkcPbk..',
      '.khhcccwwccccbk.',
      '.khckccccccckbk.',
      '.kcccGkcckGccbk.',
      '.kwPccpPPpccPbk.',
      '.kcccppkkppcbbk.',
      '.kccccppppccbbk.',
      '..kcccppppcbbk..',
      '...kbccccbbbk...',
      '....kkkkkkkk....',
      '................',
    ],
  },
  // いぬ: たれた濃い耳、まる目（光つき）、まゆの明るい点、赤い舌と首輪
  'いぬ': {
    w: 16, h: 16, rows: [
      '................',
      '....kkkkkkkk....',
      '..kkmmmbbbbbkk..',
      '.kkmmbbbbbbbbkk.',
      'kbwkmebbbbebkwsk',
      'kwwkbbbbbbbbkwsk',
      'kwwkbpkbbpkbkwsk',
      'kwwkbkkbbkkbkwsk',
      'kwskbbppppbbkssk',
      '.kskbppkkppbwks.',
      '..kbppkppkpbwk..',
      '..kbbpprrpewwk..',
      '...kbbeeeewwk...',
      '...krrrrrrrrk...',
      '....kkkkkkkk....',
      '................',
    ],
  },
  // うさぎ: 片方の耳が折れた長い耳、縦長のやさしい目、桃色のほおと鼻
  'うさぎ': {
    w: 16, h: 16, rows: [
      '...kk......kkk..',
      '..kWpk....kWppk.',
      '..kWPk....kpPeek',
      '..kWPk....kpPkkk',
      '..kpPk....kPek..',
      '..kpPk....kPek..',
      '..kpPkkkkkkPek..',
      '.kWWpppppppppek.',
      'kWWpppppppppppek',
      'kWppkppppppkpeek',
      'kWppkppppppkpeek',
      'kpPPpppPPpppPPek',
      '.kpppppkkpppeek.',
      '..kpppppppeeek..',
      '...keeeeeeeek...',
      '....kkkkkkkk....',
    ],
  },
  // くま: 丸い耳、こげ茶の毛、明るい鼻まわりと胸
  'くま': {
    w: 16, h: 16, rows: [
      '................',
      '.kkk........kkk.',
      'kwbwk......kwbwk',
      'kwbwkkkkkkkkwbsk',
      '.kwbbwwwwwwwwsk.',
      'kwbwwwwwwwwwwwsk',
      'kwwkpwwwwwwkpwsk',
      'kwwkkwwwwwwkkwsk',
      'kwwwwwbbbbwwwwsk',
      'kwwwwbbkkbbwwwsk',
      'kwwwwbbbbbbwwwsk',
      '.kwwwwbkkbwwwsk.',
      '..kwwwwwwwwwsk..',
      '.kwwwwwbbwwwwsk.',
      '.kssssbbbbssssk.',
      '.kkkkkkkkkkkkkk.',
    ],
  },
  // すずめ: 横向き（左向き）。茶色の頭、白いほおに黒い点、小さな目とまぶたの線
  'すずめ': {
    w: 16, h: 16, rows: [
      '................',
      '................',
      '.....kkkkk......',
      '....khhwwwk.....',
      '...khwwwwwsk....',
      '..khwsswwwwsk...',
      'sskppkppwhhbsk..',
      '..kkpppkphbbbsk.',
      '..kkppppbbwbbbsk',
      '..kpppppbbbwbbsk',
      '...kppppppbbwsk.',
      '....keeeeeesswwk',
      '.....kkkkkkkkkkk',
      '.......b..b.....',
      '......bb.bb.....',
      '................',
    ],
  },
  // かめ: 横向き（右向き）。六角の亀甲もようの甲羅、生成りのふち、右に頭
  'かめ': {
    w: 16, h: 16, rows: [
      '................',
      '................',
      '................',
      '...kkkkkk.......',
      '.kkGGvvvgkk.....',
      '.kGGvGGgvggk.kk.',
      'kGGgvGggvgvkkGGk',
      'kGggvgggvgvkGkGk',
      'kgvvgvvvgvvkGGgk',
      'kggvggggvgvkggk.',
      'kppppppppeekkk..',
      '.kGgk...kGgk....',
      '.kkkk...kkkk....',
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
