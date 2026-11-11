// Los espacios solo organizan la interfaz: no reciben ni modifican el estado del caso.
export function installWorkspacePresets({ document, setPanelFolded, toggleTools, refresh, blocked, viewLayout, storage = () => document.defaultView.localStorage,
  ask = text => document.defaultView.prompt(text), confirm = text => document.defaultView.confirm(text),
  alert = text => document.defaultView.alert(text) }) {
  const get = id => document.getElementById(id);
  const select = get('workspacePreset'), restore = get('restoreWorkspace');
  const message = get('workspaceMessage'), panel = get('generalPanel');
  const sections = [...panel.querySelectorAll('details.sidebar-group, details.sidebar-subgroup')];
  const save = get('saveWorkspace'), update = get('updateWorkspace'), remove = get('deleteWorkspace');
  const key = 'mpr-workspaces-v1';
  let previous = null, custom = [], storageReadable = true;
  const group = document.createElement('optgroup');
  group.label = 'Mis espacios';
  select.append(group);
  const knownIds = new Set(sections.map(node => node.id));
  function valid(item) {
    return item && typeof item.id === 'string' && /^custom-[a-z0-9-]+$/.test(item.id) &&
      typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 80 &&
      typeof item.folded === 'boolean' && typeof item.toolsHidden === 'boolean' &&
      typeof item.presentationActions === 'boolean' && Number.isFinite(item.scroll) && item.scroll >= 0 &&
      Array.isArray(item.sections) && item.sections.length <= 100 && item.sections.every(section =>
        section && typeof section.id === 'string' && typeof section.open === 'boolean');
  }
  try {
    const raw = storage().getItem(key);
    if (raw !== null) {
      const data = JSON.parse(raw);
      if (data.version !== 1 || !Array.isArray(data.items) || data.items.length > 20 ||
          !data.items.every(valid) || new Set(data.items.map(item => item.id)).size !== data.items.length) {
        throw new Error('Invalid workspaces');
      }
      custom = data.items;
    }
  } catch {
    storageReadable = false;
    message.textContent = 'No se pudieron leer los espacios guardados. Los espacios predefinidos siguen disponibles.';
  }
  function sync() {
    const selected = custom.some(item => item.id === select.value);
    update.disabled = remove.disabled = !selected;
  }
  function options(value = select.value) {
    group.replaceChildren();
    for (const item of custom) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      group.append(option);
    }
    group.disabled = custom.length === 0;
    select.value = value;
    sync();
  }
  function persist(items) {
    try {
      if (!storageReadable) throw new Error('Unreadable storage');
      storage().setItem(key, JSON.stringify({ version: 1, items }));
      custom = items;
      return true;
    } catch {
      alert('No se pudo guardar el cambio en este navegador. Comprueba el almacenamiento disponible. Los espacios anteriores no se han modificado.');
      return false;
    }
  }
  options();
  const capture = () => ({
    folded: document.body.classList.contains('panel-folded'),
    toolsHidden: get('viewerTools').hidden,
    sections: sections.map(node => ({ node, open: node.open, hidden: node.hidden })),
    scroll: panel.scrollTop,
    preset: select.dataset.applied || '',
    presentationActions: !get('workspacePresentationActions').hidden,
    ...(viewLayout ? { viewLayout: viewLayout.capture() } : {}),
  });
  function apply(state) {
    viewLayout?.apply(state.viewLayout);
    setPanelFolded(state.folded);
    if (get('viewerTools').hidden !== state.toolsHidden) toggleTools();
    for (const { node, open, hidden } of state.sections) { node.open = open; node.hidden = hidden; }
    panel.scrollTop = state.scroll;
    const preset = [...select.options].some(option => option.value === state.preset) ? state.preset : '';
    select.value = select.dataset.applied = preset;
    sync();
    get('workspacePresentationActions').hidden = !(state.presentationActions ?? state.preset === 'presentation');
    refresh();
  }
  function canChange() {
    if (!blocked()) return true;
    message.textContent = 'Sal de la presentación de vistas o del modo US antes de cambiar de espacio.';
    select.value = select.dataset.applied || '';
    return false;
  }
  select.addEventListener('change', () => {
    const preset = select.value;
    const saved = custom.find(item => item.id === preset);
    if ((!saved && !['exploration', 'measurement', 'presentation'].includes(preset)) || !canChange()) return;
    if (saved) {
      previous = capture();
      apply({ ...saved, preset, sections: sections.map(node => ({ node, hidden: node.hidden,
        open: saved.sections.find(section => section.id === node.id)?.open ?? node.open })) });
      restore.disabled = false;
      message.textContent = 'Espacio ' + saved.name + ' aplicado. El estado del caso se conserva.';
      return;
    }
    previous = capture();
    const opened = preset === 'exploration' ? ['section-structures'] :
      preset === 'measurement' ? ['section-toolbox', 'section-tools', 'menu-measurements'] : [];
    apply({ folded: preset === 'presentation', toolsHidden: preset === 'presentation',
      sections: sections.map(node => ({ node, open: opened.includes(node.id), hidden: node.hidden })),
      scroll: 0, preset });
    const target = get(preset === 'measurement' ? 'menu-measurements' : 'section-structures');
    if (preset !== 'presentation') {
      panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8;
    }
    restore.disabled = false;
    message.textContent = 'Espacio ' + select.selectedOptions[0].textContent + ' aplicado. El estado del caso se conserva.';
  });
  function serialise(id, name) {
    const state = capture();
    return { id, name, folded: state.folded, toolsHidden: state.toolsHidden,
      ...(viewLayout ? { viewLayout: state.viewLayout } : {}),
      presentationActions: state.presentationActions, scroll: Math.max(0, state.scroll),
      sections: state.sections.filter(({ node }) => knownIds.has(node.id)).map(({ node, open }) => ({ id: node.id, open })) };
  }
  save.addEventListener('click', () => {
    if (!canChange()) return;
    if (custom.length >= 20) { alert('Puedes guardar hasta 20 espacios. Elimina uno antes de añadir otro.'); return; }
    const answer = ask('Nombre del nuevo espacio (máximo 80 caracteres):');
    if (answer === null) return;
    const name = answer.trim();
    if (!name || name.length > 80) { alert('Introduce un nombre de entre 1 y 80 caracteres.'); return; }
    if (custom.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      alert('Ya existe un espacio con ese nombre. Selecciónalo y usa Actualizar espacio.'); return;
    }
    const id = 'custom-' + document.defaultView.crypto.randomUUID();
    if (!persist([...custom, serialise(id, name)])) return;
    options(id);
    select.dataset.applied = id;
    message.textContent = 'Espacio ' + name + ' guardado en este navegador.';
  });
  update.addEventListener('click', () => {
    const item = custom.find(entry => entry.id === select.value);
    if (!item || !canChange() || !confirm('¿Actualizar «' + item.name + '» con la distribución actual?')) return;
    if (!persist(custom.map(entry => entry === item ? serialise(item.id, item.name) : entry))) return;
    message.textContent = 'Espacio ' + item.name + ' actualizado.';
  });
  remove.addEventListener('click', () => {
    const item = custom.find(entry => entry.id === select.value);
    if (!item || !canChange() || !confirm('¿Eliminar el espacio «' + item.name + '»?')) return;
    if (!persist(custom.filter(entry => entry !== item))) return;
    options('');
    select.dataset.applied = '';
    message.textContent = 'Espacio eliminado. La distribución actual se conserva.';
  });
  restore.addEventListener('click', () => {
    if (!previous || !canChange()) return;
    apply(previous);
    previous = null;
    restore.disabled = true;
    message.textContent = 'Distribución anterior recuperada.';
  });
}
