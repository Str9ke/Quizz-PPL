/**
 * img-zoom.js — Visionneuse plein écran avec pincer-zoomer / déplacer, pour les images de
 * question, d'explication et de note personnelle (cartes VOR, photos d'instruments, etc.).
 * Signalé : impossible de zoomer sur ces images dans l'app pour lire les détails (relèvements,
 * graduations...). Écoute les clics en délégation sur document — aucune modification requise
 * dans quiz.js/echecs.html/epreuve.html/historique.html/search.html, qui partagent déjà les
 * mêmes classes de conteneur (.question-image / .explication-block / .personal-note-block).
 */
(function() {
  'use strict';

  var overlay, imgEl, closeBtn;
  var scale = 1, tx = 0, ty = 0;
  var lastTapTime = 0;
  var pointers = new Map();
  var pinchStartDist = 0, pinchStartScale = 1;
  var dragStart = null, dragStartTx = 0, dragStartTy = 0;
  var MIN_SCALE = 1, MAX_SCALE = 5;

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'imgZoomOverlay';
    overlay.innerHTML = '<button id="imgZoomClose" aria-label="Fermer" title="Fermer">✕</button><img id="imgZoomImg" alt="">';
    document.body.appendChild(overlay);
    imgEl = overlay.querySelector('#imgZoomImg');
    closeBtn = overlay.querySelector('#imgZoomClose');
    closeBtn.addEventListener('click', closeZoom);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeZoom(); });
    overlay.addEventListener('pointerdown', onPointerDown);
    overlay.addEventListener('pointermove', onPointerMove);
    overlay.addEventListener('pointerup', onPointerUp);
    overlay.addEventListener('pointercancel', onPointerUp);
    overlay.addEventListener('wheel', onWheel, { passive: false });
  }

  function applyTransform() {
    imgEl.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';
  }

  function resetTransform() {
    scale = 1; tx = 0; ty = 0;
    applyTransform();
  }

  function openZoom(src) {
    ensureOverlay();
    imgEl.src = src;
    resetTransform();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeZoom() {
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    pointers.clear();
    dragStart = null;
    pinchStartDist = 0;
  }

  function dist(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  function clampScale(s) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  }

  function onPointerDown(e) {
    if (e.target === closeBtn) return;
    if (overlay.setPointerCapture) { try { overlay.setPointerCapture(e.pointerId); } catch (err) {} }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      var pts = Array.from(pointers.values());
      pinchStartDist = dist(pts[0], pts[1]);
      pinchStartScale = scale;
      dragStart = null;
    } else if (pointers.size === 1) {
      var now = Date.now();
      if (now - lastTapTime < 300) {
        // Double-tap : bascule zoomé / normal.
        if (scale > 1) {
          resetTransform();
        } else {
          scale = 2.5;
          applyTransform();
        }
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;
      if (scale > 1) {
        dragStart = { x: e.clientX, y: e.clientY };
        dragStartTx = tx; dragStartTy = ty;
      }
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      var pts = Array.from(pointers.values());
      var d = dist(pts[0], pts[1]);
      if (pinchStartDist > 0) {
        scale = clampScale(pinchStartScale * (d / pinchStartDist));
        applyTransform();
      }
    } else if (pointers.size === 1 && dragStart) {
      tx = dragStartTx + (e.clientX - dragStart.x);
      ty = dragStartTy + (e.clientY - dragStart.y);
      applyTransform();
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = 0;
    if (pointers.size === 0) dragStart = null;
    if (scale <= 1.02) { scale = 1; tx = 0; ty = 0; applyTransform(); }
  }

  function onWheel(e) {
    e.preventDefault();
    scale = clampScale(scale + (e.deltaY < 0 ? 0.15 : -0.15));
    if (scale <= 1.02) { scale = 1; tx = 0; ty = 0; }
    applyTransform();
  }

  document.addEventListener('click', function(e) {
    var img = e.target.closest('.question-image img, .explication-block img, .personal-note-block img');
    if (img && img.src) openZoom(img.src);
  });
})();
