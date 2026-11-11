import {zip,unzip,strToU8,strFromU8} from './vendor/fflate.module.js';
export const MAX_PORTABLE_BYTES=512*1024*1024;
const paths=['manifest.json','case.json','model.glb','volume.nrrd'];
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export function validatePortableGLB(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length<20||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.length||view.getUint32(16,true)!==0x4e4f534a)throw new Error('GLB no válido.');
 const end=20+view.getUint32(12,true);if(end>bytes.length)throw new Error('GLB incompleto.');
 const doc=JSON.parse(strFromU8(bytes.subarray(20,end)));
 for(const item of [...(doc.buffers||[]),...(doc.images||[])])if(item.uri&&!item.uri.startsWith('data:'))throw new Error('El GLB depende de archivos externos. Exporta un GLB autocontenido antes de crear el caso portátil.');
}
export async function createPortableCase({model,volume,session,modelName,volumeName}){
 if(model.byteLength+volume.byteLength>MAX_PORTABLE_BYTES)throw new Error('El caso supera el límite de 512 MB.');
 validatePortableGLB(model);
 const [modelHash,volumeHash]=await Promise.all([hash(model),hash(volume)]);
 const key='mpr-named-views-v1:'+volumeHash+':'+modelHash;
 if(session?.format!=='mpr-complete-case'||session.version!==1||session.caseKey!==key)throw new Error('El estado no corresponde a los archivos cargados.');
 const state=strToU8(JSON.stringify(session));if(state.length>25000000)throw new Error('La configuración supera 25 MB.');
 const manifest={format:'mpr-portable-case',version:1,modelName,volumeName,files:{'model.glb':{size:model.length,sha256:modelHash},'volume.nrrd':{size:volume.length,sha256:volumeHash},'case.json':{size:state.length,sha256:await hash(state)}}};
 return new Promise((resolve,reject)=>zip({'manifest.json':strToU8(JSON.stringify(manifest)), 'case.json':state,'model.glb':model,'volume.nrrd':volume},{level:0},(error,data)=>error?reject(error):resolve(data)));
}
export async function readPortableCase(bytes){
 if(bytes.byteLength>MAX_PORTABLE_BYTES+26000000)throw new Error('El ZIP supera el tamaño admitido.');
 let total=0;const seen=new Set();
 const files=await new Promise((resolve,reject)=>{
  try{unzip(bytes,{filter:entry=>{
   if(!paths.includes(entry.name))throw new Error('Contenido inesperado en el ZIP: '+entry.name);
   if(seen.has(entry.name))throw new Error('Archivo duplicado: '+entry.name);seen.add(entry.name);
   total+=entry.originalSize;
   if(total>MAX_PORTABLE_BYTES+26000000||entry.originalSize>(entry.name==='manifest.json'?10000:entry.name==='case.json'?25000000:MAX_PORTABLE_BYTES))throw new Error('El contenido del ZIP supera el tamaño admitido.');
   return true;
  }},(error,result)=>error?reject(error):resolve(result));}catch(error){reject(error);}
 });
 if(paths.some(p=>!files[p]))throw new Error('El ZIP no contiene todos los archivos del caso portátil.');
 const manifest=JSON.parse(strFromU8(files['manifest.json']));
 if(manifest?.format!=='mpr-portable-case'||manifest.version!==1)throw new Error('Formato o versión de caso portátil no admitido.');
 for(const name of ['modelName','volumeName'])if(typeof manifest[name]!=='string'||manifest[name].length>255)throw new Error('Nombre de archivo inválido.');
 for(const name of paths.slice(1)){
  const expected=manifest.files?.[name];
  if(!expected||expected.size!==files[name].length||expected.sha256!==await hash(files[name]))throw new Error('Archivo incompleto o modificado: '+name);
 }
 if(files['model.glb'].length+files['volume.nrrd'].length>MAX_PORTABLE_BYTES)throw new Error('Los datos del caso superan 512 MB.');
 validatePortableGLB(files['model.glb']);
 const session=JSON.parse(strFromU8(files['case.json']));
 const caseKey='mpr-named-views-v1:'+manifest.files['volume.nrrd'].sha256+':'+manifest.files['model.glb'].sha256;
 if(session?.format!=='mpr-complete-case'||session.version!==1||session.caseKey!==caseKey)throw new Error('La configuración no corresponde al contenido del ZIP.');
 return{manifest,session,model:files['model.glb'],volume:files['volume.nrrd']};
}
