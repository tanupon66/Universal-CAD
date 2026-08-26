import { cloneCadValue, normalizeRotation } from './universal-cad-model.js';
import { recognizePackagePattern, packageLevelMapping } from './npi-platform.js';

const norm=(v)=>String(v??'').trim().toUpperCase();
const finite=(v)=>Number.isFinite(Number(v));

export function proposePackageAliases(model) {
  const results=[]; const landsByPackage=new Map();
  for(const land of model?.lands||[]){const k=String(land.packageId||'');if(!landsByPackage.has(k))landsByPackage.set(k,[]);landsByPackage.get(k).push(land);}
  for(const pkg of model?.packages||[]){const recognition=recognizePackagePattern(pkg,landsByPackage.get(String(pkg.id))||[]);results.push({packageId:pkg.id,currentName:pkg.name||'',suggestedFamily:recognition.family,confidence:recognition.confidence,reason:recognition.reason});}
  return results;
}

export function proposeRotationNormalization(model, options = {}) {
  const allowed=(options.allowedAngles||[0,90,180,270]).map(Number); const tolerance=Math.abs(Number(options.tolerance??2)); const proposals=[];
  for(const c of model?.components||[]){if(!finite(c.rotation))continue;const r=normalizeRotation(c.rotation);let best=allowed[0],delta=Infinity;for(const a of allowed){const d=Math.min(Math.abs(r-a),360-Math.abs(r-a));if(d<delta){delta=d;best=a;}}if(delta>0&&delta<=tolerance)proposals.push({componentId:c.id,reference:c.reference,from:r,to:best,delta});}
  return proposals;
}

export function carryForwardMappings(previousMappings = [], previousModel, nextModel) {
  const nextByRef=new Map((nextModel?.components||[]).map((c)=>[norm(c.reference),c])); const nextLandsByComponent=new Map();
  for(const land of nextModel?.lands||[]){const k=String(land.componentId);if(!nextLandsByComponent.has(k))nextLandsByComponent.set(k,[]);nextLandsByComponent.get(k).push(land);}
  const prevComponents=new Map((previousModel?.components||[]).map((c)=>[String(c.id),c])); const prevLands=new Map((previousModel?.lands||[]).map((l)=>[String(l.id),l])); const carried=[],conflicts=[];
  for(const mapping of previousMappings||[]){const oldLand=prevLands.get(String(mapping.targetRecordId||mapping.landId||''));const oldComp=oldLand?prevComponents.get(String(oldLand.componentId)):null;if(!oldLand||!oldComp){conflicts.push({...mapping,reason:'Previous target no longer exists.'});continue;}const newComp=nextByRef.get(norm(oldComp.reference));if(!newComp){conflicts.push({...mapping,reason:'Component was removed or renamed.'});continue;}const candidates=nextLandsByComponent.get(String(newComp.id))||[];const newLand=candidates.find((l)=>norm(l.name)===norm(oldLand.name));if(!newLand){conflicts.push({...mapping,reason:'Land name no longer exists in the matched component.'});continue;}carried.push({...cloneCadValue(mapping),targetRecordId:newLand.id,revision:nextModel?.revision??null,carriedForward:true});}
  return {carried,conflicts,summary:{carried:carried.length,conflicts:conflicts.length}};
}

export function proposePackageMappings(sourceModel,targetModel,threshold=.7){return packageLevelMapping(sourceModel,targetModel).filter((m)=>Number(m.score)>=Number(threshold));}

export function runSmartNpiAutomation(model, options = {}) {
  return {packageRecognition:proposePackageAliases(model),rotationNormalization:proposeRotationNormalization(model,options.rotation||{}),generatedAt:new Date().toISOString()};
}
