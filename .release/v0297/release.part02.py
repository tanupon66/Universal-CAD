s=s.replace("      if (state.pendingCustcel && shouldActivate) custcelApplied = await applyPendingCustcelPopulation();","      if (state.activeCustcel && shouldActivate) custcelApplied = await applyPendingCustcelPopulation(state.activeCustcel);",1)
s=s.replace("    cadEditor: createCadEditorState(),\n    pendingCustcel: null,\n  });","    cadEditor: createCadEditorState(),\n    pendingCustcel: null,\n    activeCustcel: null,\n  });",1)
s=s.replace("""function cadEditorNonPopComponents() {
  return findNonPopComponents(state.cadEditor.model?.components || []);
}
""","""function cadEditorPopulationInfo(component) {
  const embedded = populationInfo(component);
  if (embedded.nonPop) return embedded;
  const profile = state.activeCustcel;
  if (profile?.parsed?.recognized && findCustcelPopulationComponents([component], profile.parsed).length) {
    return { nonPop: true, field: 'Custcel', value: 'NONPOP', reason: `Custcel ${profile.fileName || ''}`.trim() };
  }
  return embedded;
}
function cadEditorNonPopComponents() {
  const components = state.cadEditor.model?.components || [];
  const matches = new Set(findNonPopComponents(components));
  const profile = state.activeCustcel;
  if (profile?.parsed?.recognized) for (const component of findCustcelPopulationComponents(components, profile.parsed)) matches.add(component);
  return [...matches];
}
""",1)
s=s.replace("    const info = populationInfo(component);","    const info = cadEditorPopulationInfo(component);",1)
s=s.replace("    const population = populationInfo(primary);","    const population = cadEditorPopulationInfo(primary);",1)
s=s.replace("    const nonPopSelected = selected.filter((component) => populationInfo(component).nonPop).length;","    const nonPopSelected = selected.filter((component) => cadEditorPopulationInfo(component).nonPop).length;",1)
s=s.replace('No Non-Pop components were detected from Variation / Population metadata.','No Non-Pop components were detected from Custcel or CAD population metadata.')
s=s.replace("async function commitNpiModelChange({ label = 'NPI model update', model, changes = [] } = {}) {","async function commitNpiModelChange({ label = 'NPI model update', model, changes = [], enforcePopulation = true } = {}) {",1)
s=s.replace("""  try {
    const candidate = cloneCadValue(model);
    const validation = validateUniversalCad(candidate,""","""  try {
    let candidate = cloneCadValue(model);
    if (enforcePopulation && state.activeCustcel?.parsed?.recognized) {
      candidate = applyCustcelPopulation(candidate, state.activeCustcel.parsed, { fileName: state.activeCustcel.fileName }).model;
    }
    const validation = validateUniversalCad(candidate,""",1)
s=s.replace("""    file.lastValidation = validation;
    file.mappingDirty = false;
    file.viewerDirty = true;
    if (state.activeCadRole === file.role) {
""","""    file.lastValidation = validation;
    file.mappingDirty = false;
    file.viewerDirty = true;
    if (state.activeCustcel?.parsed?.recognized) file.populationProfile = state.activeCustcel;
    if (state.activeCadRole === file.role) {
""",1)
s=s.replace("""      state.cadEditor.model = file.editorModel;
      normalizeMappings();
      state.selected = null;
      state.preview = null;
      state.page = 1;
      populateComponents(BOARD_VIEW);
      renderTable();
      draw();
      updateStats();
      if (!els.cadEditorOverlay.classList.contains('hidden')) renderCadEditor();
""","""      state.cadEditor.model = file.editorModel;
      state.viewerSpatialIndex = null;
      state.cadInspector.audit = null;
      state.cadCompare.result = null;
      resetHistogramState();
      normalizeMappings();
      state.selected = null;
      state.preview = null;
      state.page = 1;
      state.selectedComponentId = BOARD_VIEW;
      state.duplicateView.selectedName = '';
      populateComponents(BOARD_VIEW);
      renderTable();
      renderTeachPanel();
      refreshDuplicateControls();
      draw();
      renderHistogram();
      updateStats();
      updateCadCompareControls();
      if (canCompareCad()) rebuildCadComparison();
      if (!els.cadEditorOverlay.classList.contains('hidden')) renderCadEditor();
""",1)
# Editor apply records the active profile as part of the same revision state.
s=s.replace("""    file.mappingDirty = false;
    file.viewerDirty = true;
    file.renames = new Map();
""","""    file.mappingDirty = false;
    file.viewerDirty = true;
    if (state.activeCustcel?.parsed?.recognized) file.populationProfile = state.activeCustcel;
    file.renames = new Map();
""",1)
s=s.replace('0.29.6','0.29.7')
p.write_text(s)

for name in ['index.html','manifest.webmanifest','sw.js']:
    p=Path(name); p.write_text(p.read_text().replace('0.29.6','0.29.7'))
