import * as THREE from 'three';
import {vtkXMLPolyDataReader, unzipSync} from './vendor/vtk-reader.js';
const LIMIT=200*1024*1024;
const palette=['#d7a177','#589cda','#d65b69','#67b389','#b38bd2','#e4bd57','#70bdc6'];
function pathOf(value){
 if(/^(?:[a-z]+:|\/)/i.test(value))throw new Error('No se admiten rutas externas: '+value);
 const parts=[];
 for(const part of value.replace(/\\/g,'/').split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)throw new Error('Ruta fuera de la carpeta seleccionada: '+value);parts.pop();}else parts.push(part);}
 return parts.join('/');
}
export async function collectVTKFiles(files){
 const entries=new Map();let size=0;
 const add=(name,bytes)=>{name=pathOf(name);if(!/\.(vtm|vtp)$/i.test(name))return;if(entries.has(name))throw new Error('Archivo duplicado: '+name);size+=bytes.byteLength;if(size>LIMIT)throw new Error('Los VTM/VTP descomprimidos superan 200 MB.');entries.set(name,bytes);};
 if(files.reduce((n,f)=>n+f.size,0)>LIMIT)throw new Error('Los archivos seleccionados superan 200 MB.');
 for(const file of files){
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(/\.zip$/i.test(file.name)){
   let expanded=size;
   const extracted=unzipSync(bytes,{filter:entry=>{if(!/\.(vtm|vtp)$/i.test(entry.name))return false;pathOf(entry.name);expanded+=entry.originalSize;if(expanded>LIMIT)throw new Error('El ZIP descomprimido supera 200 MB.');return true;}});
   for(const [name,data] of Object.entries(extracted))add(name,data);
  }else add(file.webkitRelativePath||file.name,bytes);
 }
 if(!entries.size)throw new Error('Selecciona VTM y sus VTP, una carpeta o un ZIP que los contenga.');
 return entries;
}
function xml(text,name){
 if(/<!DOCTYPE/i.test(text))throw new Error('DOCTYPE no admitido: '+name);
 const doc=new DOMParser().parseFromString(text,'application/xml');
 if(doc.querySelector('parsererror'))throw new Error('XML no válido: '+name);
 return doc;
}
function resolve(entries,from,ref){
 const path=pathOf(from.slice(0,from.lastIndexOf('/')+1)+ref);
 if(entries.has(path))return path;
 // Seleccionar archivos sueltos pierde la ruta; solo resolver nombres inequívocos.
 const base=path.split('/').pop(),matches=[...entries.keys()].filter(k=>k.split('/').pop()===base);
 if(matches.length===1)return matches[0];
 throw new Error(matches.length?'Referencia ambigua: '+ref+'. Selecciona la carpeta completa o un ZIP.':'Falta '+ref+' (referenciado por '+from+'). Selecciona también su carpeta.');
}
function cellTriangles(values,points,strips=false){
 const indices=[];
 for(let cursor=0;cursor<values.length;){
  const count=values[cursor++];
  if(!Number.isSafeInteger(count)||count<3||cursor+count>values.length)throw new Error('Polígono VTP no válido.');
  const ids=Array.from(values.slice(cursor,cursor+count));cursor+=count;
  if(ids.some(id=>!Number.isSafeInteger(id)||id<0||id>=points.length/3))throw new Error('Índice de vértice fuera de rango.');
  if(strips){for(let i=2;i<ids.length;i++)indices.push(...(i%2?[ids[i-1],ids[i-2],ids[i]]:[ids[i-2],ids[i-1],ids[i]]));continue;}
  if(count===3){indices.push(...ids);continue;}
  // Proyectar sobre el plano dominante para triangular también polígonos cóncavos.
  const normal=[0,0,0];
  for(let i=0;i<count;i++){const a=ids[i]*3,b=ids[(i+1)%count]*3;normal[0]+=(points[a+1]-points[b+1])*(points[a+2]+points[b+2]);normal[1]+=(points[a+2]-points[b+2])*(points[a]+points[b]);normal[2]+=(points[a]-points[b])*(points[a+1]+points[b+1]);}
  const drop=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))),axes=[0,1,2].filter(a=>a!==drop);
  const contour=ids.map(id=>new THREE.Vector2(points[id*3+axes[0]],points[id*3+axes[1]]));
  const faces=THREE.ShapeUtils.triangulateShape(contour,[]);
  if(faces.length!==count-2)throw new Error('No se pudo triangular una superficie VTP.');
  for(const face of faces)indices.push(...face.map(i=>ids[i]));
 }
 return indices;
}
// vtk.js espera las etiquetas raw en líneas separadas; normalizar solo las
// etiquetas XML, manteniendo intactos los bytes y offsets de los datos.
function normalizeRawVTK(bytes){
 const text=new TextDecoder('latin1').decode(bytes);
 const opening=/<AppendedData\b[^>]*encoding=["']raw["'][^>]*>\s*_/.exec(text);
 if(!opening)return bytes;
 const end=text.lastIndexOf('</AppendedData>');
 if(end<opening.index+opening[0].length)throw new Error('AppendedData raw incompleto.');
 const encoder=new TextEncoder(),parts=[bytes.subarray(0,opening.index),encoder.encode('\n<AppendedData encoding="raw">_'),bytes.subarray(opening.index+opening[0].length,end),encoder.encode('\n</AppendedData>'),bytes.subarray(end+15)];
 const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;
 for(const part of parts){result.set(part,offset);offset+=part.length;}
 return result;
}
export async function prepareVTMConversion(files,metersPerUnit){
 if(!Number.isFinite(metersPerUnit)||metersPerUnit<=0)throw new Error('Escala no válida.');
 const entries=await collectVTKFiles(files),manifests=new Map(),referenced=new Set(),used=new Set(),names=new Set();
 const decoder=new TextDecoder();
 for(const [name,bytes] of entries)if(/\.vtm$/i.test(name)){
  const doc=xml(decoder.decode(bytes),name);
  if(doc.documentElement.getAttribute('type')!=='vtkMultiBlockDataSet')throw new Error('El VTM no es vtkMultiBlockDataSet: '+name);
  for(const node of doc.querySelectorAll('DataSet[file]'))referenced.add(resolve(entries,name,node.getAttribute('file')));
  manifests.set(name,doc);
 }
 const root=new THREE.Group();root.name='Segmentaciones';root.userData.viewerMmPerUnit=1000;root.userData.sourceMetersPerUnit=metersPerUnit;
 let meshCount=0,triangles=0;const warnings=new Set();
 function unique(base){let name=base,n=2;while(names.has(name))name=base+' ('+(n++)+')';names.add(name);return name;}
 function surface(path,parent,label){
  used.add(path);const bytes=entries.get(path),reader=vtkXMLPolyDataReader.newInstance();
  // El lector admite ASCII, binary y appended (raw/base64), con zlib.
  const prefix=decoder.decode(bytes.subarray(0,Math.min(bytes.length,4096)));
  if(/<!DOCTYPE/i.test(prefix))throw new Error('DOCTYPE no admitido: '+path);
  if(!/<VTKFile\b[^>]*type=["']PolyData["']/.test(prefix))throw new Error('Se esperaba PolyData en '+path);
  if(/byte_order=["']BigEndian/.test(prefix))throw new Error('VTP BigEndian no admitido: '+path+'. Exporta en LittleEndian.');
  const compressor=/compressor=["']([^"']+)/.exec(prefix)?.[1];
  if(compressor&&compressor!=='vtkZLibDataCompressor')throw new Error('Compresión VTP no admitida: '+compressor+'. Utiliza zlib o sin compresión.');
  try{
   reader.parseAsArrayBuffer(normalizeRawVTK(bytes).slice().buffer);
   let pieces=0;
   for(let p=0;p<reader.get('output').output.length;p++){
    const data=reader.getOutputData(p);if(!data)continue;
    const points=data.getPoints().getData();
    if(data.getPoints().getNumberOfComponents()!==3||!points.length||points.length%3||points.some(v=>!Number.isFinite(v)))throw new Error('Coordenadas VTP no válidas: '+path);
    const indices=[...cellTriangles(data.getPolys().getData(),points),...cellTriangles(data.getStrips().getData(),points,true)];
    if(data.getLines().getData().length||data.getVerts().getData().length)warnings.add('Se omiten líneas y puntos aislados: solo se exportan superficies.');
    if(!indices.length)continue;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.setIndex(indices);geometry.scale(metersPerUnit,metersPerUnit,metersPerUnit);geometry.computeVertexNormals();
    const material=new THREE.MeshStandardMaterial({color:palette[meshCount%palette.length],roughness:.85,metalness:0,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geometry,material);mesh.name=unique(label||path.split('/').pop().replace(/\.vtp$/i,''));mesh.userData.sourceFile=path;parent.add(mesh);meshCount++;pieces++;triangles+=indices.length/3;
   }
   if(!pieces)throw new Error('El VTP no contiene superficies: '+path);
  }finally{reader.delete();}
 }
 function visit(path,parent,label,stack=[]){
  if(stack.includes(path)||stack.length>64)throw new Error('Referencias VTM cíclicas o demasiado profundas: '+path);
  used.add(path);
  if(/\.vtp$/i.test(path)){surface(path,parent,label);return;}
  const doc=manifests.get(path);if(!doc)throw new Error('Formato referenciado no admitido: '+path);
  const group=new THREE.Group();group.name=label||path.split('/').pop().replace(/\.vtm$/i,'');parent.add(group);
  function nodes(element,target){for(const node of element.children){
   if(node.tagName==='Block'){const child=new THREE.Group();child.name=node.getAttribute('name')||'Grupo '+(node.getAttribute('index')||'');target.add(child);nodes(node,child);}
   else if(node.tagName==='DataSet'){const ref=node.getAttribute('file');if(!ref)throw new Error('DataSet sin archivo en '+path);visit(resolve(entries,path,ref),target,node.getAttribute('name'),[...stack,path]);}
   else nodes(node,target);
  }}
  nodes(doc.documentElement,group);
 }
 try{
  const roots=[...manifests.keys()].filter(k=>!referenced.has(k));
  if(manifests.size&&!roots.length)throw new Error('Los VTM contienen referencias cíclicas.');
  if(roots.length)for(const path of roots)visit(path,root);
  else for(const path of entries.keys())surface(path,root);
  if([...manifests.keys()].some(k=>!used.has(k)))throw new Error('Hay VTM desconectados o con referencias cíclicas.');
  const unused=[...entries.keys()].filter(k=>!used.has(k));if(unused.length)warnings.add(unused.length+' VTP no referenciados por los VTM no se han incluido.');
  if(!meshCount)throw new Error('No se encontraron superficies para convertir.');
  warnings.add('Se asignan colores provisionales; no se convierten colores ni atributos científicos del VTP.');
  return{root,meshCount,triangles,warnings:[...warnings]};
 }catch(error){root.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});throw error;}
}
