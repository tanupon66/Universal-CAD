const decode=(s)=>String(s||'');
function count(text,regex){return [...decode(text).matchAll(regex)].length;}
export function analyzeIpc2581Coverage(xmlText='') {
  const text=decode(xmlText); return {
    format:'ipc-2581',
    components:count(text,/<(?:\w+:)?Component(?:\s|\/?>)/gi),
    packages:count(text,/<(?:\w+:)?Package(?:Definition)?(?:\s|\/?>)/gi),
    layers:count(text,/<(?:\w+:)?Layer(?:\s|\/?>)/gi),
    nets:count(text,/<(?:\w+:)?Net(?:\s|\/?>)/gi),
    vias:count(text,/<(?:\w+:)?Via(?:\s|\/?>)/gi),
    holes:count(text,/<(?:\w+:)?Hole(?:\s|\/?>)/gi),
    features:count(text,/<(?:\w+:)?(?:Feature|Polyline|Polygon|Arc)(?:\s|\/?>)/gi),
  };
}
export function analyzeOdbCoverage(paths=[]) {
  const normalized=(paths||[]).map((v)=>String(v).replace(/\\/g,'/').toLowerCase()); const has=(r)=>normalized.some((p)=>r.test(p)); return {format:'odb++',matrix:has(/matrix\/matrix(?:\.z)?$/),profile:has(/steps\/[^/]+\/profile(?:\.z)?$/),componentsTop:has(/layers\/comp_\+_top\/components/),componentsBottom:has(/layers\/comp_\+_bot\/components/),edaData:has(/eda\/data(?:\.z)?$/),netlists:normalized.filter((p)=>/net|eda/.test(p)).length,layers:new Set(normalized.map((p)=>p.match(/layers\/([^/]+)/)?.[1]).filter(Boolean)).size};
}
