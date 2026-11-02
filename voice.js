// 音声入力。ブラウザの音声認識（SpeechRecognition）を使う補助の機能。
// 声は保存しない。文字にした結果を入力欄に入れるだけで、送るかどうかは画面側で人が決める。

// 使える音声認識の部品を、使う直前に探す（ブラウザによって名前が違う）
const recognitionClass = () => window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupported = () => Boolean(recognitionClass());

// 聞き取りを始める。止めるための関数を返す。
// onResult には文字にした結果、onError には理由の種類（not-allowed など）、onEnd には終わった合図が届く
export function listen({ onResult, onError, onEnd }) {
  const Recognition = recognitionClass();
  const r = new Recognition();
  r.lang = 'ja-JP';
  r.interimResults = false;
  r.continuous = false;
  r.maxAlternatives = 1;
  r.onresult = (e) => {
    const text = e.results?.[0]?.[0]?.transcript;
    if (typeof text === 'string') onResult(text);
  };
  r.onerror = (e) => onError(typeof e?.error === 'string' ? e.error : 'unknown');
  r.onend = () => onEnd();
  r.start();
  return () => r.stop();
}
