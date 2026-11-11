// Coordenadas mundiales del visor: mm. No se aplican visibilidad ni recorte visual.
export async function structureSurface(items,{cancelled=()=>false,yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
 const chunks=[];let total=0;
 for(const {mesh} of items){
  if(mesh.isSkinnedMesh||mesh.geometry.morphAttributes.position?.length)throw new Error('No se admiten estructuras con deformación esquelética o morph targets.');
  mesh.updateWorldMatrix(true,false);
  const geometry=mesh.geometry,position=geometry.attributes.position,index=geometry.index,count=index?index.count:position?.count;
  if(!position||position.itemSize!==3||!count||count%3)throw new Error('La estructura no contiene triángulos válidos.');
  total+=count/3;if(total>1000000)throw new Error('Máximo un millón de triángulos por estructura.');
  chunks.push({position,index,count,matrix:mesh.matrixWorld.clone()});
 }
 if(!total)throw new Error('La estructura no contiene superficies.');
 const output=new Float64Array(total*9);let cursor=0,processed=0;
 for(const {position,index,count,matrix} of chunks){
  const e=matrix.elements;
  for(let i=0;i<count;i+=3){
   if(processed++%8192===0){await yieldTask();if(cancelled())throw new Error('Cálculo cancelado.');}
   const triangle=[];
   for(let j=0;j<3;j++){
    const n=index?index.getX(i+j):i+j;
    if(!Number.isInteger(n)||n<0||n>=position.count)throw new Error('Índice de vértice no válido.');
    const x=position.getX(n),y=position.getY(n),z=position.getZ(n);
    const w=1/(e[3]*x+e[7]*y+e[11]*z+e[15]);
    triangle.push((e[0]*x+e[4]*y+e[8]*z+e[12])*w,(e[1]*x+e[5]*y+e[9]*z+e[13])*w,(e[2]*x+e[6]*y+e[10]*z+e[14])*w);
   }
   if(triangle.some(n=>!Number.isFinite(n)))throw new Error('Coordenadas no válidas.');
   const u=[triangle[3]-triangle[0],triangle[4]-triangle[1],triangle[5]-triangle[2]],v=[triangle[6]-triangle[0],triangle[7]-triangle[1],triangle[8]-triangle[2]];
   if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])===0)continue;
   output.set(triangle,cursor);cursor+=9;
  }
 }
 if(!cursor)throw new Error('La estructura solo contiene triángulos degenerados.');
 return cursor===output.length?output:output.slice(0,cursor);
}
