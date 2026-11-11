// Los espacios solo organizan la interfaz: no reciben ni modifican el estado del caso.
export function installWorkspacePresets({ document, setPanelFolded, toggleTools, refresh, blocked }) {
  const get = id => document.getElementById(id);
  const select = get('workspacePreset'), restore = get('restoreWorkspace');
  const message = get('workspaceMessage'), panel = get('generalPanel');
  const sections = [...panel.querySelectorAll('details.sidebar-group, details.sidebar-subgroup')];
  let previous = null;
  const capture = () => ({
    folded: document.body.classList.contains('panel-folded'),
    toolsHidden: get('viewerTools').hidden,
    sections: sections.map(node => ({ node, open: node.open, hidden: node.hidden })),
    scroll: panel.scrollTop,
    preset: select.dataset.applied || '',
  });
  function apply(state) {
    setPanelFolded(state.folded);
    if (get('viewerTools').hidden !== state.toolsHidden) toggleTools();
    for (const { node, open, hidden } of state.sections) { node.open = open; node.hidden = hidden; }
    panel.scrollTop = state.scroll;
    select.value = select.dataset.applied = state.preset;
    get('workspacePresentationActions').hidden = state.preset !== 'presentation';
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
    if (!['exploration', 'measurement', 'presentation'].includes(preset) || !canChange()) return;
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
  restore.addEventListener('click', () => {
    if (!previous || !canChange()) return;
    apply(previous);
    previous = null;
    restore.disabled = true;
    message.textContent = 'Distribución anterior recuperada.';
  });
}
