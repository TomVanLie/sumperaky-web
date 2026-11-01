// Zvětšení fotky nebo pohledu z ulice (obrázky s třídou zoomable).
// Pohled z Mapy.com se rovnou otevře v interaktivním prohlížeči (panoviewer.js).

import { isMapyPano, mountPano } from './panoviewer.js';

let box;
let pano = null;

const $ = (sel) => box.querySelector(sel);

const stopPano = () => {
  pano?.destroy();
  pano = null;
};

const build = () => {
  box = document.createElement('dialog');
  box.className = 'lightbox';
  box.innerHTML = `
    <div class="lightbox-stage"><img alt="" /></div>
    <div class="lightbox-bar"><button type="button" class="btn btn-sm lightbox-close">Zavřít ✕</button></div>`;
  document.body.append(box);
  $('.lightbox-close').addEventListener('click', () => box.close());
  box.addEventListener('click', (e) => e.target === box && box.close());
  box.addEventListener('close', stopPano);
};

export const openLightbox = (src, alt) => {
  if (!box) build();
  stopPano();
  const url = new URL(src, location.href);
  const isPano = isMapyPano(url);
  box.classList.toggle('is-pano', isPano);
  $('.lightbox-stage img').alt = alt || '';
  if (isPano) {
    // Než se načte prohlížeč, je vidět statický snímek ve větším rozlišení.
    url.searchParams.set('width', '1024');
    url.searchParams.set('height', '640');
  }
  $('.lightbox-stage img').src = url.toString();
  if (!box.open) box.showModal();
  if (isPano) pano = mountPano($('.lightbox-stage'), url);
};

document.addEventListener('click', (e) => {
  const img = e.target.closest?.('img.zoomable');
  if (!img || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  openLightbox(img.dataset.full || img.currentSrc || img.src, img.alt);
});
