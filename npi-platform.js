import { validateUniversalCad } from './validation-center.js';
import { cloneCadValue, normalizeRotation } from './universal-cad-model.js';

const norm = (v) => String(v ?? '').trim().toUpperCase();
const finite = (v) => Number.isFinite(Number(v));
const round = (v, p = 6) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(p)) : null;

export const BUILTIN_EXPORT_PROFILES = Object.freeze([
  { id: 'inspection-xml', name: 'Inspection XML', format: 'inspection-xml', extension: '.xml', encoding: 'utf-8', lineEnding: 'CRLF', precision: 3, required: ['board','components','lands'] },
  { id: 'gencad-1.4', name: 'CAD ASCII 1.4', format: 'gencad-1.4', extension: '.cad', encoding: 'utf-8', lineEnding: 'CRLF', precision: 5, required: ['board','components','lands'] },
  { id: 'fabmaster-ascii', name: 'Manufacturing ASCII', format: 'fabmaster-ascii', extension: '.fab', encoding: 'utf-8', lineEnding: 'CRLF', precision: 5, required: ['board','components','lands'] },
  { id: 'placement-csv', name: 'Placement CSV', format: 'placement-csv', extension: '.csv', encoding: 'utf-8', lineEnding: 'CRLF', precision: 4, required: ['components'] },
  { id: 'bom-xlsx', name: 'BOM Excel', format: 'bom-xlsx', extension: '.xlsx', encoding: 'binary', lineEnding: null, precision: 4, required: ['components'] },
]);

export function getExportProfiles(custom = []) {
  const byId = new Map(BUILTIN_EXPORT_PROFILES.map((p) => [p.id, cloneCadValue(p)]));
  for (const item of custom || []) if (item?.id) byId.set(String(item.id), { ...byId.get(String(item.id)), ...cloneCadValue(item) });
  return [...byId.values()];
}

function counts(model) {
  return {
    components: model?.components?.length || 0, packages: model?.packages?.length || 0, lands: model?.lands?.length || 0,
    nets: model?.nets?.length || 0, layers: model?.layers?.length || 0, holes: model?.holes?.length || 0,
    fiducials: model?.fiducials?.length || 0, bom: model?.bom?.length || 0, panelInstances: model?.panelInstances?.length || 0,
  };
}

export function evaluateFormatCompatibility(model, profile) {
  const target = profile || BUILTIN_EXPORT_PROFILES[0];
  const c = counts(model);
  const issues = [];
  if (target.required?.includes('board') && !model?.boardDefinition) issues.push({ level: 'blocking', code: 'BOARD_REQUIRED', message: 'Board definition is required.' });
  if (target.required?.includes('components') && !c.components) issues.push({ level: 'blocking', code: 'COMPONENTS_REQUIRED', message: 'At least one component is required.' });
  if (target.required?.includes('lands') && !c.lands) issues.push({ level: 'blocking', code: 'LANDS_REQUIRED', message: 'At least one land is required.' });
  if (target.format === 'gencad-1.4' && (c.nets || c.holes || c.layers)) issues.push({ level: 'warning', code: 'PARTIAL_CAD_ASCII', message: 'Electrical/layer records may be reduced because the current writer focuses on placement and land geometry.' });
  if (target.format === 'fabmaster-ascii' && (c.nets || c.layers)) issues.push({ level: 'warning', code: 'PARTIAL_MANUFACTURING_ASCII', message: 'Trace, via, and full layer-stack records are preserved only when represented in the working model.' });
  const validation = validateUniversalCad(model || {});
  for (const item of validation.issues || []) if (item.level === 'blocking-error') issues.push({ level: 'blocking', code: item.code, message: item.message });
  const blocking = issues.filter((i) => i.level === 'blocking').length;
  return { profile: target, compatible: blocking === 0, status: blocking ? 'not-ready' : issues.some((i) => i.level === 'warning') ? 'ready-with-warnings' : 'ready', issues, counts: c };
}

export function buildConversionLossReport(model, targetFormat) {
  const c = counts(model); const preserved = []; const reduced = []; const omitted = [];
  ['components','packages','lands'].forEach((key) => preserved.push({ category: key, count: c[key], status: 'preserved' }));
  if (targetFormat === 'inspection-xml') {
    if (c.nets) omitted.push({ category: 'nets', count: c.nets, reason: 'The inspection XML writer does not serialize electrical nets.' });
    if (c.layers) reduced.push({ category: 'layers', count: c.layers, reason: 'Layer detail is reduced to placement side information.' });
    if (c.holes) omitted.push({ category: 'holes', count: c.holes, reason: 'Hole records are not represented by the current inspection XML writer.' });
  } else if (['gencad-1.4','fabmaster-ascii'].includes(targetFormat)) {
    if (c.nets) reduced.push({ category: 'nets', count: c.nets, reason: 'Only records represented in the normalized model can be written.' });
    if (c.layers) reduced.push({ category: 'layers', count: c.layers, reason: 'Layer stack metadata may be simplified.' });
    if (c.holes) reduced.push({ category: 'holes', count: c.holes, reason: 'Drill/hole coverage depends on normalized source records.' });
  }
  const total = Object.values(c).reduce((a,b)=>a+b,0) || 1;
  const lost = omitted.reduce((s,i)=>s+i.count,0) + reduced.reduce((s,i)=>s+i.count*0.25,0);
  return { targetFormat, preserved, reduced, omitted, lossPercent: round(lost / total * 100, 2), generatedAt: new Date().toISOString() };
}

function rectSignature(lands = []) {
  const usable = lands.filter((l) => finite(l.geometry?.width) && finite(l.geometry?.height));
  const dims = usable.map((l) => `${round(l.geometry.width,3)}x${round(l.geometry.height,3)}`).sort();
  return `${usable.length}|${dims.slice(0,12).join(',')}`;
}

export function buildPackageLibrary(model) {
  const landsByPackage = new Map();
  for (const land of model?.lands || []) { const key=String(land.packageId||''); if(!landsByPackage.has(key)) landsByPackage.set(key,[]); landsByPackage.get(key).push(land); }
  return (model?.packages || []).map((pkg) => {
    const lands = landsByPackage.get(String(pkg.id)) || [];
    return { id: pkg.id, name: pkg.name || pkg.id, revision: pkg.revision || '', usageCount: Number(pkg.usageCount || 0), landCount: lands.length, signature: rectSignature(lands), recognition: recognizePackagePattern(pkg, lands) };
  });
}

export function recognizePackagePattern(pkg, lands = []) {
  const count = lands.length; if (!count) return { family: 'Empty', confidence: 0, reason: 'No lands' };
  const centers = lands.map((l)=>l.center).filter((p)=>finite(p?.x)&&finite(p?.y));
  const xs=[...new Set(centers.map(p=>round(p.x,3)))], ys=[...new Set(centers.map(p=>round(p.y,3)))];
  const grid = xs.length * ys.length === count;
  if (grid && xs.length >= 3 && ys.length >= 3) return { family: count >= 64 ? 'BGA/LGA grid' : 'Grid array', confidence: .9, reason: `${ys.length}×${xs.length} regular grid` };
  if (count === 2) return { family: 'Two-terminal passive', confidence: .86, reason: 'Two-land footprint' };
  if (count >= 8 && count % 2 === 0 && (xs.length <= 4 || ys.length <= 4)) return { family: 'Dual-row package', confidence: .72, reason: 'Even land count with two dominant rows/columns' };
  if (count >= 16 && count % 4 === 0) return { family: 'Perimeter package', confidence: .58, reason: 'Land count is compatible with a four-side package' };
  return { family: 'Custom footprint', confidence: .35, reason: 'No high-confidence geometric pattern' };
}

export function packageLevelMapping(sourceModel, targetModel) {
  const source = buildPackageLibrary(sourceModel); const target = buildPackageLibrary(targetModel); const matches=[];
  for (const a of source) {
    let best=null;
    for (const b of target) {
      let score=0; const fields=[];
      if (norm(a.name) && norm(a.name) === norm(b.name)) { score += .55; fields.push('name'); }
      if (a.landCount === b.landCount) { score += .25; fields.push('land-count'); }
      if (a.signature === b.signature) { score += .2; fields.push('geometry-signature'); }
      if (!best || score > best.score) best={sourcePackageId:a.id,targetPackageId:b.id,sourceName:a.name,targetName:b.name,score:round(score,3),fields};
    }
    if (best) matches.push(best);
  }
  return matches;
}

function componentKey(c) { return norm(c.reference); }
export function reconcileNpiData(model, bomRows = [], placementRows = []) {
  const components=model?.components||[]; const cad=new Map(components.map(c=>[componentKey(c),c])); const issues=[];
  const readRefs=(r)=>Array.isArray(r.references)?r.references:String(r.reference||r.refDes||r.location||'').split(/[\s,;]+/).filter(Boolean);
  const bom=new Map(); for(const r of bomRows||[]) for(const ref of readRefs(r)) bom.set(norm(ref),r);
  const xy=new Map(); for(const r of placementRows||[]) for(const ref of readRefs(r)) xy.set(norm(ref),r);
  for (const [ref,c] of cad) {
    if (bom.size && !bom.has(ref)) issues.push({type:'CAD_ONLY',severity:'warning',reference:c.reference,message:'Reference exists in CAD but not BOM.'});
    if (xy.size && !xy.has(ref)) issues.push({type:'CAD_MISSING_PLACEMENT',severity:'warning',reference:c.reference,message:'Reference exists in CAD but not placement data.'});
    const b=bom.get(ref); if(b){ const pn=String(b.partNumber||b.mpn||''); if(pn&&c.partNumber&&norm(pn)!==norm(c.partNumber)) issues.push({type:'PART_NUMBER_CONFLICT',severity:'error',reference:c.reference,message:`Part number differs: CAD ${c.partNumber} / BOM ${pn}`}); }
    const p=xy.get(ref); if(p){ if(finite(p.rotation)&&finite(c.rotation)&&Math.abs(normalizeRotation(p.rotation)-normalizeRotation(c.rotation))>.1) issues.push({type:'ROTATION_CONFLICT',severity:'warning',reference:c.reference,message:`Rotation differs: CAD ${c.rotation} / placement ${p.rotation}`}); }
  }
  for(const [ref,r] of bom) if(!cad.has(ref)) issues.push({type:'BOM_ONLY',severity:'warning',reference:ref,message:'Reference exists in BOM but not CAD.'});
  for(const [ref,r] of xy) if(!cad.has(ref)) issues.push({type:'PLACEMENT_ONLY',severity:'warning',reference:ref,message:'Reference exists in placement data but not CAD.'});
  return { issues, counts:{cad:cad.size,bom:bom.size,placement:xy.size,errors:issues.filter(i=>i.severity==='error').length,warnings:issues.filter(i=>i.severity==='warning').length} };
}

export function buildSmartRevisionCompare(project, fromRevision = null, toRevision = null) {
  const revisions=project?.revisions||[]; if(!revisions.length) return {rows:[],summary:{}};
  const from=fromRevision==null?revisions[Math.max(0,revisions.length-2)]:revisions.find(r=>Number(r.number)===Number(fromRevision));
  const to=toRevision==null?revisions[revisions.length-1]:revisions.find(r=>Number(r.number)===Number(toRevision));
  if(!from||!to) return {rows:[],summary:{}};
  const a=new Map((from.model?.components||[]).map(c=>[componentKey(c),c])); const b=new Map((to.model?.components||[]).map(c=>[componentKey(c),c])); const rows=[];
  for(const [ref,ca] of a){ const cb=b.get(ref); if(!cb){rows.push({reference:ca.reference,status:'removed'});continue;} const moved=Math.hypot(Number(ca.position?.x||0)-Number(cb.position?.x||0),Number(ca.position?.y||0)-Number(cb.position?.y||0))>1e-6; const rotated=normalizeRotation(ca.rotation)!==normalizeRotation(cb.rotation); const packageChanged=String(ca.packageId)!==String(cb.packageId); const partChanged=norm(ca.partNumber)!==norm(cb.partNumber); rows.push({reference:ca.reference,status:moved||rotated||packageChanged||partChanged?'changed':'unchanged',moved,rotated,packageChanged,partChanged}); }
  for(const [ref,cb] of b) if(!a.has(ref)) rows.push({reference:cb.reference,status:'added'});
  return {fromRevision:from.number,toRevision:to.number,rows,summary:{added:rows.filter(r=>r.status==='added').length,removed:rows.filter(r=>r.status==='removed').length,changed:rows.filter(r=>r.status==='changed').length,unchanged:rows.filter(r=>r.status==='unchanged').length}};
}

export function buildThreeWayCompare(project) {
  const parsed=project?.parsedSourceModel, working=project?.workingModel, exported=project?.exportSnapshots?.at?.(-1)?.model || null;
  const summarize=(a,b)=>{ if(!a||!b)return null; const ac=new Map((a.components||[]).map(c=>[componentKey(c),c])); const bc=new Map((b.components||[]).map(c=>[componentKey(c),c])); let added=0,removed=0,moved=0,changed=0; for(const[k,v]of ac){const n=bc.get(k);if(!n){removed++;continue;} if(Math.hypot(Number(v.position?.x||0)-Number(n.position?.x||0),Number(v.position?.y||0)-Number(n.position?.y||0))>1e-6)moved++; if(String(v.packageId)!==String(n.packageId)||norm(v.partNumber)!==norm(n.partNumber)||normalizeRotation(v.rotation)!==normalizeRotation(n.rotation))changed++;} for(const k of bc.keys())if(!ac.has(k))added++; return {added,removed,moved,changed,from:counts(a),to:counts(b)};};
  return {sourceToWorking:summarize(parsed,working),workingToExport:summarize(working,exported),hasExport:Boolean(exported)};
}

function tagInventory(xml='') { const tags=new Map(); for(const m of String(xml).matchAll(/<([A-Za-z_][\w:.-]*)(\s[^<>]*?)?>/g)){if(m[0].startsWith('</'))continue; const name=m[1]; const attrs=[...String(m[2]||'').matchAll(/([A-Za-z_:][\w:.-]*)\s*=/g)].map(x=>x[1]).sort(); const item=tags.get(name)||{count:0,attributes:new Set()}; item.count++; attrs.forEach(a=>item.attributes.add(a)); tags.set(name,item);} return tags; }
export function analyzeGoldenTemplate(xmlText='') {
  const inv=tagInventory(xmlText); const decimals=[...String(xmlText).matchAll(/[-+]?\d+\.(\d+)/g)].map(m=>m[1].length); return {root:String(xmlText).match(/<([A-Za-z_][\w:.-]*)\b/)?.[1]||'',tags:[...inv].map(([name,v])=>({name,count:v.count,attributes:[...v.attributes]})),maxDecimals:decimals.length?Math.max(...decimals):0,lineEnding:String(xmlText).includes('\r\n')?'CRLF':'LF'};
}
export function compareExportToGolden(generatedXml, goldenXml) {
  const a=analyzeGoldenTemplate(generatedXml), b=analyzeGoldenTemplate(goldenXml); const ga=new Map(a.tags.map(t=>[t.name,t])), gb=new Map(b.tags.map(t=>[t.name,t])); const missing=[],extra=[],attributeDifferences=[];
  for(const[name,t]of gb){if(!ga.has(name))missing.push(name);else{const aa=new Set(ga.get(name).attributes);const mm=t.attributes.filter(x=>!aa.has(x));if(mm.length)attributeDifferences.push({tag:name,missingAttributes:mm});}}
  for(const name of ga.keys())if(!gb.has(name))extra.push(name);
  return {compatible:a.root===b.root&&!missing.length&&!attributeDifferences.length,rootMatch:a.root===b.root,generated:a,golden:b,missingTags:missing,extraTags:extra,attributeDifferences};
}

export function estimateCoordinateCalibration(pairs = [], options = {}) {
  const valid=pairs.filter(p=>finite(p.source?.x)&&finite(p.source?.y)&&finite(p.target?.x)&&finite(p.target?.y)); if(!valid.length) throw new RangeError('At least one valid point pair is required.');
  if(valid.length===1){const p=valid[0];return {translation:{x:Number(p.target.x)-Number(p.source.x),y:Number(p.target.y)-Number(p.source.y)},rotation:0,scale:1,mirror:false,rms:0};}
  const a=valid[0], b=valid[1]; const as={x:Number(b.source.x)-Number(a.source.x),y:Number(b.source.y)-Number(a.source.y)}, at={x:Number(b.target.x)-Number(a.target.x),y:Number(b.target.y)-Number(a.target.y)};
  const lenS=Math.hypot(as.x,as.y)||1, lenT=Math.hypot(at.x,at.y)||1; const scale=options.allowScale===false?1:lenT/lenS; const rotation=(Math.atan2(at.y,at.x)-Math.atan2(as.y,as.x))*180/Math.PI; const r=rotation*Math.PI/180; const sx=Number(a.source.x)*scale, sy=Number(a.source.y)*scale; const rx=sx*Math.cos(r)-sy*Math.sin(r), ry=sx*Math.sin(r)+sy*Math.cos(r); const tx=Number(a.target.x)-rx, ty=Number(a.target.y)-ry;
  let sum=0; for(const p of valid){const x=Number(p.source.x)*scale,y=Number(p.source.y)*scale;const px=x*Math.cos(r)-y*Math.sin(r)+tx,py=x*Math.sin(r)+y*Math.cos(r)+ty;sum+=(px-Number(p.target.x))**2+(py-Number(p.target.y))**2;}
  return {translation:{x:round(tx),y:round(ty)},rotation:round(rotation),scale:round(scale,9),mirror:false,rms:round(Math.sqrt(sum/valid.length),6),pointCount:valid.length};
}

export function createPanelArray(model, settings = {}) {
  const rows=Math.max(1,Math.trunc(Number(settings.rows)||1)), columns=Math.max(1,Math.trunc(Number(settings.columns)||1)); const dx=Number(settings.pitchX??model?.boardDefinition?.width??0),dy=Number(settings.pitchY??model?.boardDefinition?.height??0); const out=[];
  for(let r=0;r<rows;r++)for(let c=0;c<columns;c++)out.push({id:`panel:${r+1}:${c+1}`,boardId:model?.boardDefinition?.id||'board:main',row:r,column:c,translation:{x:round(c*dx),y:round(r*dy)},rotation:normalizeRotation(settings.rotation||0),mirror:Boolean(settings.mirror)});
  return out;
}

export function buildRevisionTimeline(project) { return (project?.revisions||[]).map(r=>({revision:r.number,createdAt:r.createdAt,validationStatus:r.validationStatus||'not-run',changeSet:(project.changeSets||[]).find(c=>c.id===r.changeSetId)||null,componentCount:r.model?.components?.length||0,landCount:r.model?.lands?.length||0})).reverse(); }

export function calculateCadHealth(model, options = {}) {
  const validation=options.validation||validateUniversalCad(model||{}, {bom:options.bom||model?.bom||[]}); const c=counts(model); let score=100;
  score-=validation.issues.filter(i=>i.level==='blocking-error').length*18; score-=validation.issues.filter(i=>i.level==='error').length*8; score-=validation.issues.filter(i=>i.level==='warning').length*2; if(!c.components)score=0; score=Math.max(0,Math.min(100,score));
  return {score,grade:score>=95?'Excellent':score>=85?'Good':score>=70?'Review':'Action required',counts:c,validation,summary:`${score}/100 · ${validation.counts['blocking-error']||0} blocking · ${validation.counts.error||0} errors · ${validation.counts.warning||0} warnings`};
}

export function buildVisualValidationMarkers(validation) { return (validation?.issues||[]).filter(i=>i.context?.componentId||i.context?.landId).map(i=>({id:i.id,level:i.level,code:i.code,message:i.message,componentId:i.context?.componentId||null,landId:i.context?.landId||null})); }

export function buildProjectWorkspaceSummary(project) {
  return {projectId:project?.projectId||'',name:project?.name||'Untitled Project',revision:Number(project?.appliedRevision||0),sourceCount:project?.sourceFiles?.length||0,revisionCount:project?.revisions?.length||0,changeSetCount:project?.changeSets?.length||0,exportCount:project?.exportSnapshots?.length||0,current:counts(project?.currentModel||{}),updatedAt:project?.updatedAt||''};
}

export function mergeGeneratedIntoGoldenTemplate(goldenXml = '', generatedXml = '') {
  const golden = String(goldenXml || ''); const generated = String(generatedXml || '');
  if (!golden.trim() || !generated.trim()) throw new TypeError('Golden and generated XML are required.');
  const goldenAnalysis = analyzeGoldenTemplate(golden), generatedAnalysis = analyzeGoldenTemplate(generated);
  if (!goldenAnalysis.root || goldenAnalysis.root !== generatedAnalysis.root) throw new RangeError(`XML root mismatch: ${goldenAnalysis.root || 'unknown'} vs ${generatedAnalysis.root || 'unknown'}.`);
  const sections = ['InspectionProjectXml','InspectionRegionCollectionSetXml','ComponentInformationCollectionXml','ComponentNumberCollectionXml'];
  let output = golden;
  for (const tag of sections) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`<${escaped}\\b[\\s\\S]*?<\\/${escaped}>`, 'i');
    const replacement = generated.match(rx)?.[0];
    if (replacement && rx.test(output)) output = output.replace(rx, replacement);
  }
  return output;
}

export function applyCoordinateCalibrationToModel(model, calibration) {
  if (!model || !calibration) throw new TypeError('Model and calibration are required.');
  const scale = Number(calibration.scale || 1); const angle = Number(calibration.rotation || 0) * Math.PI / 180;
  const tx = Number(calibration.translation?.x || 0), ty = Number(calibration.translation?.y || 0); const cos=Math.cos(angle), sin=Math.sin(angle);
  const point=(x,y)=>({x:(Number(x)*scale*cos-Number(y)*scale*sin)+tx,y:(Number(x)*scale*sin+Number(y)*scale*cos)+ty});
  for(const component of model.components||[]){if(finite(component.position?.x)&&finite(component.position?.y)){const p=point(component.position.x,component.position.y);component.position.x=round(p.x);component.position.y=round(p.y);}component.rotation=normalizeRotation(Number(component.rotation||0)+Number(calibration.rotation||0));}
  for(const land of model.lands||[]){if(finite(land.center?.x)&&finite(land.center?.y)){const p=point(land.center.x,land.center.y);land.center.x=round(p.x);land.center.y=round(p.y);}const g=land.geometry||{};if(finite(g.left)&&finite(g.top)){const p=point(g.left,g.top);g.left=round(p.x);g.top=round(p.y);}if(finite(g.width))g.width=round(Number(g.width)*scale);if(finite(g.height))g.height=round(Number(g.height)*scale);g.rotation=normalizeRotation(Number(g.rotation||0)+Number(calibration.rotation||0));}
  model.transformations = [...(model.transformations||[]), { type:'coordinate-calibration', ...cloneCadValue(calibration), appliedAt:new Date().toISOString() }];
  return model;
}
