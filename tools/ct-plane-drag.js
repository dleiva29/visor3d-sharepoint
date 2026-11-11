// Desplazamiento en índices a partir de la proyección de la normal del plano.
export function projectedSliceIndex(start, dx, dy, vector, min, max) {
  const length2 = vector.x * vector.x + vector.y * vector.y;
  if (!Number.isFinite(length2) || length2 < 0.0225) return start;
  return Math.max(min, Math.min(max, Math.round(start + (dx * vector.x + dy * vector.y) / length2)));
}
export function installCtPlaneDrag({ document, host, toggle, frame, setIndex, orbit, activate, hint }) {
  const names = { z: 'Axial', y: 'Coronal', x: 'Sagital' };
  let enabled = false, drag = null;
  const handles = Object.entries(names).map(([axis, name]) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'ct-plane-handle'; button.dataset.axis = axis;
    button.textContent = '↔ ' + name; button.hidden = true;
    button.setAttribute('aria-label', 'Desplazar plano ' + name.toLowerCase());
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !enabled) return;
      const state = frame(axis);
      if (!state?.visible) return;
      event.preventDefault(); event.stopPropagation();
      if (Math.hypot(state.vector.x, state.vector.y) < 0.15) {
        hint('Gira un poco la vista 3D o utiliza el deslizador: este plano se desplaza hacia la cámara.'); return;
      }
      button.focus(); button.setPointerCapture(event.pointerId);
      drag = { axis, state, id: event.pointerId, x: event.clientX, y: event.clientY, button, orbit: orbit.get() };
      orbit.set(false); button.classList.add('is-dragging');
    });
    button.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId || drag.axis !== axis) return;
      event.preventDefault(); event.stopPropagation();
      const { state } = drag;
      setIndex(axis, projectedSliceIndex(state.index, event.clientX-drag.x, event.clientY-drag.y, state.vector, state.min, state.max));
    });
    button.addEventListener('pointerup', event => { if (drag?.id === event.pointerId) finish(false); });
    button.addEventListener('pointercancel', () => finish(true));
    button.addEventListener('lostpointercapture', () => finish(true));
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    button.addEventListener('dblclick', event => event.stopPropagation());
    button.addEventListener('keydown', event => {
      if (drag || !enabled) return;
      const step = ['ArrowUp','ArrowRight'].includes(event.key) ? 1 : ['ArrowDown','ArrowLeft'].includes(event.key) ? -1 : 0;
      if (!step) return;
      const state = frame(axis); if (!state?.visible) return;
      event.preventDefault(); event.stopPropagation();
      setIndex(axis, Math.max(state.min, Math.min(state.max, state.index + step)));
    });
    host.append(button); return button;
  });
  function finish(cancel) {
    if (!drag) return;
    const old = drag; drag = null;
    if (cancel) setIndex(old.axis, old.state.index);
    orbit.set(old.orbit); old.button.classList.remove('is-dragging');
    if (old.button.hasPointerCapture(old.id)) old.button.releasePointerCapture(old.id);
  }
  function disable() {
    finish(true); enabled = false; toggle.setAttribute('aria-pressed', 'false');
    handles.forEach(button => { button.hidden = true; });
  }
  toggle.addEventListener('click', () => {
    if (enabled) { disable(); return; }
    activate(); enabled = true; toggle.setAttribute('aria-pressed','true');
    hint('Arrastra un tirador para mover su corte. Las flechas ajustan un corte; Esc cancela el arrastre. Los planos deben estar visibles y ser ortogonales.');
    update();
  });
  document.addEventListener('mpr-tool-change', disable);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !enabled) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (drag) finish(true); else disable();
  }, true);
  document.defaultView.addEventListener('blur', () => finish(true));
  function update() {
    if (!enabled) return;
    handles.forEach(button => {
      const state = frame(button.dataset.axis), visible = !!state?.visible;
      if (!visible && drag?.axis === button.dataset.axis) finish(true);
      button.hidden = !visible;
      if (!visible) return;
      const left = state.x + 'px', top = state.y + 'px';
      if (button.style.left !== left) button.style.left = left;
      if (button.style.top !== top) button.style.top = top;
      const title = names[button.dataset.axis] + ' · Corte ' + state.index + ' · Arrastrar o usar flechas';
      if (button.title !== title) button.title = title;
    });
  }
  return { update, disable, get dragging() { return !!drag; } };
}
