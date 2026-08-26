import { cloneCadValue, normalizeLegacyCad } from './universal-cad-model.js';

const finite = (value) => Number.isFinite(Number(value));
const round = (value, p=6) => finite(value) ? Number(Number(value).toFixed(p)) : null;
const key = (value) => String(value ?? '').trim().toUpperCase();

function componentMap(model) { return new Map((model?.components || []).map((item)=>[key(item.reference || item.id), item])); }
function landsByComponent(model) { const out=new Map(); for(const land of model?.lands||[]){const id=String(land.componentId||''); if(!out.has(id))out.set(id,[]); out.get(id).push(land);} return out; }

export function compareModelSemantics(sourceModel = {}, exportedModel = {}, options = {}) {
  const tolerance = Math.max(0, Number(options.coordinateTolerance ?? 0.002));
  const sourceComponents = componentMap(sourceModel); const targetComponents = componentMap(exportedModel);
  const sourceLands = landsByComponent(sourceModel); const targetLands = landsByComponent(exportedModel);
  const issues = []; let matchedComponents=0, matchedLands=0;
  for (const [ref, source] of sourceComponents) {
    const target = targetComponents.get(ref);
    if (!target) { issues.push({level:'error',code:'EXPORT_COMPONENT_MISSING',message:`Component ${source.reference || source.id} is missing after export.`}); continue; }
    matchedComponents += 1;
    const dx=Math.abs(Number(source.position?.x)-Number(target.position?.x)); const dy=Math.abs(Number(source.position?.y)-Number(target.position?.y));
    if (finite(dx)&&finite(dy)&&(dx>tolerance||dy>tolerance)) issues.push({level:'error',code:'EXPORT_COMPONENT_MOVED',message:`Component ${source.reference || source.id} changed position by ${round(Math.hypot(dx,dy),6)}.`});
    const sourceItems=sourceLands.get(String(source.id))||[]; const targetItems=targetLands.get(String(target.id))||[];
    const targetByName=new Map(targetItems.map((land)=>[key(land.name),land]));
    for(const land of sourceItems){ const match=targetByName.get(key(land.name)); if(!match){issues.push({level:'warning',code:'EXPORT_LAND_MISSING',message:`Land ${source.reference || source.id}/${land.name || land.id} is missing after export.`});continue;} matchedLands+=1; const dx2=Math.abs(Number(land.center?.x)-Number(match.center?.x)); const dy2=Math.abs(Number(land.center?.y)-Number(match.center?.y)); if(finite(dx2)&&finite(dy2)&&(dx2>tolerance||dy2>tolerance))issues.push({level:'warning',code:'EXPORT_LAND_MOVED',message:`Land ${source.reference || source.id}/${land.name || land.id} changed position.`}); }
  }
  const sourceCounts={components:sourceModel.components?.length||0,lands:sourceModel.lands?.length||0,layers:sourceModel.layers?.length||0,nets:sourceModel.nets?.length||0};
  const targetCounts={components:exportedModel.components?.length||0,lands:exportedModel.lands?.length||0,layers:exportedModel.layers?.length||0,nets:exportedModel.nets?.length||0};
  const blocking=issues.filter((item)=>item.level==='error').length;
  return { status:blocking?'failed':issues.length?'passed-with-warnings':'passed', passed:blocking===0, issues, matchedComponents, matchedLands, sourceCounts, targetCounts, coordinateTolerance:tolerance, verifiedAt:new Date().toISOString() };
}

export function verifyExportedLegacyCad(sourceModel, exportedLegacyCad, options = {}) {
  const target = normalizeLegacyCad(exportedLegacyCad, { projectId: sourceModel?.projectId, sourceFormat: options.sourceFormat || 'verification' });
  // Electrical/layer records are intentionally not required for placement-format verification unless explicitly requested.
  return compareModelSemantics(sourceModel, target, options);
}

export function summarizeExportVerification(report = {}) {
  const label = report.status === 'passed' ? 'Verified' : report.status === 'passed-with-warnings' ? 'Verified with warnings' : 'Verification failed';
  return `${label} · ${report.matchedComponents || 0}/${report.sourceCounts?.components || 0} components · ${report.matchedLands || 0}/${report.sourceCounts?.lands || 0} lands · ${report.issues?.length || 0} issue(s)`;
}

export function exportVerificationSnapshot(report = {}) { return cloneCadValue({ ...report, issues:(report.issues||[]).slice(0,500) }); }
