// ── Lightbox with swipe + pinch zoom ──
let lbImages = [], lbIndex = 0, lbScale = 1, lbInitDist = 0, lbTouchStartX = 0;

function openLightbox(src) {
  // Check if tapped image is inside a broadcast strip — collect all strip images
  const stripImg = document.querySelector(`.bc-media-strip img[data-full="${src}"]`);
  if (stripImg) {
    const strip = stripImg.closest('.bc-media-strip');
    lbImages = Array.from(strip.querySelectorAll('img[data-full]')).map(i => i.dataset.full).filter(Boolean);
    lbIndex = lbImages.indexOf(src);
    if (lbIndex < 0) { lbImages = [src]; lbIndex = 0; }
  } else {
    lbImages = Array.from(document.querySelectorAll('#chat-messages .bubble-img'))
      .map(i => i.dataset.full).filter(Boolean);
    lbIndex = lbImages.indexOf(src);
    if (lbIndex < 0) { lbImages = [src]; lbIndex = 0; }
  }
  lbScale = 1;
  showLbImage();
  document.getElementById('lightbox').classList.add('open');
}
function showLbImage() {
  const img = document.getElementById('lb-img');
  img.src = lbImages[lbIndex];
  img.style.transform = 'scale(1)';
  lbScale = 1;
  document.getElementById('lb-counter').textContent = lbImages.length > 1 ? `${lbIndex + 1} / ${lbImages.length}` : '';
}
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }

const _lb = document.getElementById('lightbox');
const _lbImg = document.getElementById('lb-img');
_lb.addEventListener('click', e => { if (e.target === _lb || e.target.id === 'lb-close') closeLightbox(); });
document.getElementById('lb-save').addEventListener('click', () => {
  if (lbImages[lbIndex]) saveMedia(lbImages[lbIndex]);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
_lb.addEventListener('touchstart', e => {
  if (e.touches.length === 1) lbTouchStartX = e.touches[0].clientX;
  else if (e.touches.length === 2)
    lbInitDist = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
}, { passive: true });
_lb.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && lbInitDist) {
    const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
    lbScale = Math.min(4, Math.max(1, lbScale * (d / lbInitDist)));
    lbInitDist = d;
    _lbImg.style.transform = `scale(${lbScale})`;
    e.preventDefault();
  }
}, { passive: false });
_lb.addEventListener('touchend', e => {
  if (e.changedTouches.length === 1 && lbScale <= 1.05) {
    const dx = e.changedTouches[0].clientX - lbTouchStartX;
    if (dx < -50 && lbIndex < lbImages.length - 1) { lbIndex++; showLbImage(); }
    else if (dx > 50 && lbIndex > 0) { lbIndex--; showLbImage(); }
  }
  lbInitDist = 0;
});
