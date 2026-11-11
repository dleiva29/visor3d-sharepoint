// Una fila por estructura: varios OBJ agrupan sus partes; VTP conserva cada pieza.
export function describeStructures(root,mode,fallback='Estructura'){
 const targets=[];
 if(mode==='multiobj')targets.push(...root.children);
 else root.traverse(object=>{if(object.isMesh)targets.push(object);});
 const used=new Set();
 return targets.map(target=>{
  const meshes=[];target.traverse(object=>{if(object.isMesh)meshes.push(object);});
  const source=target.userData.sourceFile||fallback;
  const base=source.replace(/\\/g,'/').split('/').pop().replace(/\.[^.]+$/,'')||'Estructura';
  let name=base,n=2;while(used.has(name))name=base+' ('+(n++)+')';used.add(name);
  const material=Array.isArray(meshes[0].material)?meshes[0].material[0]:meshes[0].material;
  return{target,meshes,source,originalName:target.name||target.userData.structureName||'',name,color:'#'+material.color.getHexString()};
 });
}
export function applyStructureChoices(rows,choices){
 if(rows.length!==choices.length)throw new Error('La lista de estructuras ha cambiado. Revisa de nuevo los archivos.');
 const names=new Set();
 const normalized=choices.map(({name,color})=>{
  name=name.trim();
  if(!name)throw new Error('Cada estructura necesita un nombre.');
  if(names.has(name))throw new Error('Hay nombres repetidos: '+name+'. Usa un nombre distinto para cada estructura.');
  if(!/^#[0-9a-f]{6}$/i.test(color))throw new Error('Color no válido para '+name+'.');
  names.add(name);return{name,color};
 });
 const meshNames=new Set();
 rows.forEach((row,i)=>{
  const {name,color}=normalized[i];
  row.target.userData.structureName=name;
  row.meshes.forEach((mesh,j)=>{
   const base=j?name+' · parte '+(j+1):name;let unique=base,n=2;while(meshNames.has(unique))unique=base+' ('+(n++)+')';meshNames.add(unique);mesh.name=unique;
   mesh.geometry.deleteAttribute('color');
   for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){material.color.set(color);material.vertexColors=false;material.needsUpdate=true;}
  });
 });
}
