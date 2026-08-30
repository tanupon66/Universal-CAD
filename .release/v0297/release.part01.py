from pathlib import Path
import json

def edit(path, pairs):
    p=Path(path); s=p.read_text()
    for old,new in pairs:
        if old not in s: raise SystemExit(f'anchor missing in {path}: {old[:80]!r}')
        s=s.replace(old,new,1)
    p.write_text(s)

# Custcel detector shared by normalized model + editor.
p=Path('custcel-population.js'); s=p.read_text()
a="""function rowReferences(row) {
  if (Array.isArray(row?.references)) return row.references.map(String).map((item) => item.trim()).filter(Boolean);
  const value = row?.location ?? row?.reference ?? row?.refDes ?? '';
  return String(value).split(/[\\s,;]+/).map((item) => item.trim()).filter(looksLikeReference);
}
"""
b=a+"""
function componentReferenceCandidates(component = {}) {
  const metadata = component?.metadata && typeof component.metadata === 'object' ? component.metadata : {};
  const sourceMetadata = component?.sourceMetadata && typeof component.sourceMetadata === 'object' ? component.sourceMetadata : {};
  return [
    component.reference, component.refDes, component.name, component.id,
    metadata.reference, metadata.refDes, metadata.name,
    sourceMetadata.reference, sourceMetadata.refDes, sourceMetadata.name,
  ].map(normalizeRef).filter(Boolean);
}

/** Return components that are explicitly listed as NONPOP by the active Custcel
 * file. This accepts both normalized Universal CAD components (reference) and
 * CAD Editor components (name/id), so every workspace uses the same population
 * decision. */
export function findCustcelPopulationComponents(components = [], parsed = null) {
  const requested = new Set((parsed?.nonPopRefs || []).map(normalizeRef).filter(Boolean));
  if (!requested.size) return [];
  return (components || []).filter((component) => componentReferenceCandidates(component).some((ref) => requested.has(ref)));
}

export function isCustcelNonPopComponent(component, parsed = null) {
  return findCustcelPopulationComponents([component], parsed).length === 1;
}
"""
if a not in s: raise SystemExit('custcel anchor')
s=s.replace(a,b,1)
s=s.replace("const removing = components.filter((component) => requested.has(normalizeRef(component.reference || component.id)));","const removing = findCustcelPopulationComponents(components, parsed);",1)
s=s.replace("const removedReferences = new Set(removing.map((component) => normalizeRef(component.reference || component.id)));","const removedReferences = new Set(removing.flatMap((component) => componentReferenceCandidates(component)));",1)
s=s.replace("""  const matched = new Set(removing.map((component) => normalizeRef(component.reference || component.id)));
  const unmatchedRefs = (parsed?.nonPopRefs || []).filter((ref) => !matched.has(normalizeRef(ref)));
""","""  const matched = new Set();
  for (const component of removing) {
    const candidates = new Set(componentReferenceCandidates(component));
    for (const ref of requested) if (candidates.has(ref)) matched.add(ref);
  }
  const unmatchedRefs = (parsed?.nonPopRefs || []).filter((ref) => !matched.has(normalizeRef(ref)));
""",1)
p.write_text(s)

p=Path('app.js'); s=p.read_text()
s=s.replace("import { applyCustcelPopulation, parseCustcelText } from './custcel-population.js';","import { applyCustcelPopulation, findCustcelPopulationComponents, parseCustcelText } from './custcel-population.js';",1)
s=s.replace("  pendingCustcel: null,\n};","  pendingCustcel: null,\n  activeCustcel: null,\n};",1)
s=s.replace("async function applyPendingCustcelPopulation(pending = state.pendingCustcel) {","async function applyPendingCustcelPopulation(pending = state.pendingCustcel || state.activeCustcel) {",1)
s=s.replace("  if (!pending?.parsed?.recognized) return { applied: false, pending: false };\n  const file = activeCadFile();","  if (!pending?.parsed?.recognized) return { applied: false, pending: false };\n  state.activeCustcel = pending;\n  const file = activeCadFile();",1)
s=s.replace("  if (!result.removedComponentCount) {\n    state.pendingCustcel = null;","  if (!result.removedComponentCount) {\n    state.pendingCustcel = null;\n    file.populationProfile = pending;",1)
s=s.replace("    model: result.model,\n    changes: [{","    model: result.model,\n    enforcePopulation: false,\n    changes: [{",1)
s=s.replace("  state.pendingCustcel = null;\n  return { ...result, applied: true, pending: false, revision: commit.revision };","  state.pendingCustcel = null;\n  file.populationProfile = pending;\n  return { ...result, applied: true, pending: false, revision: commit.revision };",1)
s=s.replace("  const pending = { fileName: file.name, parsed };\n  state.pendingCustcel = pending;","  const pending = { fileName: file.name, parsed };\n  state.activeCustcel = pending;\n  state.pendingCustcel = pending;",1)
