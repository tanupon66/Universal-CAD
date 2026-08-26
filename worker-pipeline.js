import { WorkerError } from './cad-errors.js';

export function transferablesFrom(value) {
  const output=[]; const seen=new Set();
  const walk=(v)=>{if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);if(v instanceof ArrayBuffer)output.push(v);else if(ArrayBuffer.isView(v))output.push(v.buffer);else if(Array.isArray(v))v.forEach(walk);else Object.values(v).forEach(walk);}; walk(value); return [...new Set(output)];
}

export async function processInChunks(items = [], worker, options = {}) {
  if (typeof worker !== 'function') throw new TypeError('Chunk worker must be a function.');
  const source=Array.from(items||[]); const chunkSize=Math.max(1,Math.trunc(Number(options.chunkSize)||500)); const results=[]; const started=performance?.now?.()??Date.now();
  for(let i=0;i<source.length;i+=chunkSize){if(options.signal?.aborted)throw new DOMException('Operation aborted','AbortError');const chunk=source.slice(i,i+chunkSize);const value=await worker(chunk,{offset:i,total:source.length,signal:options.signal});if(Array.isArray(value))results.push(...value);else if(value!==undefined)results.push(value);options.onProgress?.({completed:Math.min(source.length,i+chunk.length),total:source.length,percent:source.length?Math.round(Math.min(source.length,i+chunk.length)/source.length*100):100});if(options.yieldToUi!==false)await new Promise((resolve)=>setTimeout(resolve,0));}
  return {results,durationMs:(performance?.now?.()??Date.now())-started};
}

export function createBrowserTaskWorker(handlerSource) {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return null;
  const source=`self.onmessage=async(e)=>{try{const fn=(${handlerSource});const result=await fn(e.data.payload);self.postMessage({id:e.data.id,result});}catch(error){self.postMessage({id:e.data.id,error:{name:error?.name||'Error',message:error?.message||String(error)}});}};`;
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})); const worker=new Worker(url); let seq=0; const pending=new Map();
  worker.onmessage=(event)=>{const item=pending.get(event.data.id);if(!item)return;pending.delete(event.data.id);event.data.error?item.reject(new WorkerError(event.data.error.message,{stage:'worker-task'})):item.resolve(event.data.result);};
  return {run(payload,transfer=[]){const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,payload},transfer);});},terminate(){for(const item of pending.values())item.reject(new WorkerError('Worker terminated.',{stage:'worker-task'}));pending.clear();worker.terminate();URL.revokeObjectURL(url);}};
}
