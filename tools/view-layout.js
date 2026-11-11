export const viewIds = ['axial', 'coronal', 'sagittal', '3d'];
export function normaliseViewLayout(value) {
  const order = [...new Set([...(Array.isArray(value?.order) ? value.order.filter(id => viewIds.includes(id)) : []), ...viewIds])];
  const visible = order.filter(id => Array.isArray(value?.visible) && value.visible.includes(id));
  const ratio = n => typeof n === 'number' && Number.isFinite(n) ? Math.min(0.75, Math.max(0.25, n)) : 0.5;
  return { order, visible: visible.length ? visible : [...order], x: ratio(value?.x), y: ratio(value?.y) };
}
export function installViewLayout({ document, refresh, blocked }) {
  const win = document.defaultView, grid = document.querySelector('.views');
  const menu = document.getElementById('viewLayoutMenu'), controls = menu.querySelector('div');
  const panes = viewIds.map(id => grid.querySelector(`[data-view-pane="${id}"]`));
  let state = normaliseViewLayout(), frame = 0, drag = null, moving = null, suppressClickUntil = 0;
  const announcement = document.createElement('span');
  announcement.className = 'workspace-message'; announcement.setAttribute('role', 'status');
  document.body.append(announcement);
  const canReorder = () => !blocked() && !grid.querySelector('.maximized') && state.visible.length > 1;
  function swap(source, target) {
    if (!canReorder() || source === target || !state.visible.includes(source) || !state.visible.includes(target)) return;
    const a = state.order.indexOf(source), b = state.order.indexOf(target);
    [state.order[a], state.order[b]] = [state.order[b], state.order[a]];
    state = normaliseViewLayout(state); render();
    announcement.textContent = 'Posiciones intercambiadas. Guarda o actualiza el espacio para conservar el orden.';
  }
  function finishMove(cancel) {
    if (!moving) return;
    const old = moving; moving = null;
    panes.forEach(pane => pane.classList.remove('view-drag-source', 'view-drop-target'));
    if (old.header.hasPointerCapture(old.id)) old.header.releasePointerCapture(old.id);
    if (old.started) {
      suppressClickUntil = Date.now() + 400;
      if (!cancel && old.target) swap(old.source, old.target);
      else announcement.textContent = 'Movimiento cancelado. Se conserva el orden anterior.';
      old.header.focus({ preventScroll: true });
    }
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && moving) { event.preventDefault(); event.stopImmediatePropagation(); finishMove(true); }
  }, true);
  win.addEventListener('blur', () => finishMove(true));
  win.addEventListener('resize', () => finishMove(true));
  const labels = ['Axial', 'Coronal', 'Sagital', '3D'];
  const checks = [], closes = [];
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; refresh(); }); };
  function setVisible(id, visible) {
    if (blocked()) { render(); return; }
    const ids = new Set(state.visible);
    if (visible) ids.add(id); else ids.delete(id);
    if (!ids.size) return;
    state.visible = state.order.filter(value => ids.has(value));
    const pane = panes[viewIds.indexOf(id)];
    if (!visible) {
      pane.classList.remove('maximized');
      if (pane.contains(document.activeElement)) menu.querySelector('summary').focus();
    }
    render();
  }
  panes.forEach((pane, i) => {
    const header = pane.querySelector('h2');
    if (header) {
      header.tabIndex = 0; header.classList.add('view-drag-header');
      header.title = 'Arrastra sobre otra vista para intercambiar posiciones. Teclado: Alt + flechas. Doble clic: maximizar.';
      header.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown');
      header.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !canReorder() || drag || moving || event.target.closest('button,input,select')) return;
        event.preventDefault(); header.focus({ preventScroll: true }); header.setPointerCapture(event.pointerId);
        moving = { id: event.pointerId, source: viewIds[i], header, x: event.clientX, y: event.clientY, started: false, target: null };
      });
      header.addEventListener('pointermove', event => {
        if (!moving || moving.id !== event.pointerId) return;
        if (!canReorder()) { finishMove(true); return; }
        if (!moving.started && Math.hypot(event.clientX-moving.x, event.clientY-moving.y) < 6) return;
        moving.started = true; pane.classList.add('view-drag-source');
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.pane[data-view-pane]');
        moving.target = target && target !== pane && grid.contains(target) && state.visible.includes(target.dataset.viewPane) ? target.dataset.viewPane : null;
        panes.forEach(item => item.classList.toggle('view-drop-target', item.dataset.viewPane === moving.target));
      });
      header.addEventListener('pointerup', event => { if (moving?.id === event.pointerId) finishMove(false); });
      header.addEventListener('pointercancel', () => finishMove(true));
      header.addEventListener('lostpointercapture', () => finishMove(true));
      for (const type of ['click', 'dblclick']) header.addEventListener(type, event => {
        if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); }
      });
      header.addEventListener('keydown', event => {
        if (!event.altKey || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) || !canReorder()) return;
        event.preventDefault(); event.stopPropagation();
        const delta = ['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1;
        const target = state.visible[state.visible.indexOf(viewIds[i]) + delta];
        if (target) { swap(viewIds[i], target); header.focus({ preventScroll: true }); }
      });
    }
    const label = document.createElement('label'), check = document.createElement('input');
    check.type = 'checkbox';
    check.addEventListener('change', () => setVisible(viewIds[i], check.checked));
    label.append(check, ' ' + labels[i]); controls.append(label); checks.push(check);
    const close = document.createElement('button'); close.type = 'button'; close.className = 'pane-hide';
    close.textContent = '×'; close.title = 'Ocultar vista ' + labels[i]; close.setAttribute('aria-label', close.title);
    close.addEventListener('click', () => setVisible(viewIds[i], false));
    pane.append(close); closes.push(close);
  });
  const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Restablecer distribución';
  reset.addEventListener('click', () => { if (!blocked()) { state = normaliseViewLayout(); render(); } }); controls.append(reset);
  const handles = ['x', 'y'].map(axis => {
    const handle = document.createElement('div'); handle.className = 'view-divider divider-' + axis;
    handle.tabIndex = 0; handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-label', axis === 'x' ? 'Anchura de las vistas' : 'Altura de las vistas');
    handle.setAttribute('aria-orientation', axis === 'x' ? 'vertical' : 'horizontal');
    handle.setAttribute('aria-valuemin', '25'); handle.setAttribute('aria-valuemax', '75');
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || blocked()) return;
      event.preventDefault(); handle.focus(); handle.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, axis, original: state[axis], handle };
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId || drag.axis !== axis) return;
      const rect = grid.getBoundingClientRect();
      const position = axis === 'x' ? event.clientX - rect.left : event.clientY - rect.top;
      const size = axis === 'x' ? rect.width : rect.height;
      state[axis] = Math.min(0.75, Math.max(0.25, (position - 11) / Math.max(1, size - 22)));
      render();
    });
    const finish = cancel => {
      if (!drag || drag.axis !== axis) return;
      const old = drag; drag = null;
      if (cancel) { state[axis] = old.original; render(); }
      if (handle.hasPointerCapture(old.id)) handle.releasePointerCapture(old.id);
    };
    handle.addEventListener('pointerup', () => finish(false));
    handle.addEventListener('pointercancel', () => finish(true));
    handle.addEventListener('lostpointercapture', () => finish(true));
    handle.addEventListener('keydown', event => {
      if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); finish(true); return; }
      if (blocked()) return;
      const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -0.02 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 0.02 : 0;
      if (!step && event.key !== 'Home') return;
      event.preventDefault(); state[axis] = event.key === 'Home' ? 0.5 : Math.min(0.75, Math.max(0.25, state[axis] + step)); render();
    });
    grid.append(handle); return handle;
  });
  function render() {
    const currentOrder = [...grid.querySelectorAll(':scope > .pane')].map(pane => pane.dataset.viewPane);
    if (currentOrder.some((id, i) => id !== state.order[i])) {
      for (const id of state.order) grid.append(panes[viewIds.indexOf(id)]);
    }
    const count = state.visible.length;
    grid.dataset.viewCount = String(count);
    grid.style.setProperty('--view-cols', count === 1 ? 'minmax(0, 1fr)' : `minmax(0, ${state.x}fr) minmax(0, ${1-state.x}fr)`);
    grid.style.setProperty('--view-rows', count <= 2 ? 'minmax(0, 1fr)' : `minmax(0, ${state.y}fr) minmax(0, ${1-state.y}fr)`);
    panes.forEach((pane, i) => {
      const index = state.visible.indexOf(viewIds[i]), visible = index !== -1;
      pane.dataset.layoutHidden = String(!visible);
      pane.style.setProperty('--view-area', count === 3 && index === 2 ? '2 / 1 / 3 / 3' : `${Math.floor(index / 2)+1} / ${index%2+1}`);
      checks[i].checked = visible; checks[i].disabled = closes[i].disabled = visible && count === 1;
    });
    handles.forEach((handle, i) => {
      handle.hidden = i === 0 ? count < 2 : count < 3;
      handle.setAttribute('aria-valuenow', String(Math.round(state[i === 0 ? 'x' : 'y']*100)));
    });
    handles[0].style.left = `calc(6px + (100% - 22px) * ${state.x})`;
    handles[0].style.height = count === 3 ? `calc((100% - 22px) * ${state.y})` : 'calc(100% - 12px)';
    handles[1].style.top = `calc(6px + (100% - 22px) * ${state.y})`;
    schedule();
  }
  // Una vista guardada o una acción que maximiza una vista debe poder recuperarla.
  new win.MutationObserver(() => {
    let changed = false;
    panes.forEach((pane, i) => {
      if (pane.classList.contains('maximized') && !state.visible.includes(viewIds[i])) { state.visible.push(viewIds[i]); changed = true; }
    });
    if (changed) { state = normaliseViewLayout(state); render(); }
  }).observe(grid, { subtree: true, attributes: true, attributeFilter: ['class'] });
  function positionMenu() {
    if (!menu.open) return;
    const rect = menu.querySelector('summary').getBoundingClientRect();
    controls.style.left = Math.max(8, Math.min(rect.left, document.documentElement.clientWidth - controls.offsetWidth - 8)) + 'px';
    controls.style.top = Math.max(8, Math.min(rect.bottom + 6, win.innerHeight - controls.offsetHeight - 8)) + 'px';
  }
  menu.addEventListener('toggle', positionMenu);
  win.addEventListener('resize', positionMenu);
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) menu.open = false; });
  menu.addEventListener('keydown', event => { if (event.key === 'Escape') { menu.open = false; menu.querySelector('summary').focus(); } });
  render();
  return { capture: () => normaliseViewLayout(state), apply: value => {
    finishMove(true);
    state = normaliseViewLayout(value);
    panes.forEach((pane, i) => { if (!state.visible.includes(viewIds[i])) pane.classList.remove('maximized'); });
    render();
  } };
}
