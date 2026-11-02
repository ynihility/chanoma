// 札(.card)を0.065秒(65ミリ秒)ずつずらして、下からふわっと現れさせる
const { animate, stagger } = anime;

animate('.card', {
  opacity: [0, 1],
  translateY: [20, 0],
  duration: 400,
  ease: 'outQuad',
  delay: stagger(65),
});
