import {BufferGeometry,BufferAttribute,Matrix4,MeshBVH,Triangle,Vector3} from './vendor/distance-bvh.js';
export function computeSurfaceDistance(first,second){
 const geometries=[];
 try{
  for(const positions of [first,second]){
   if(!(positions instanceof Float64Array)||!positions.length||positions.length%9||positions.length>9000000||positions.some(n=>!Number.isFinite(n)))throw new Error('Superficie inválida o demasiado grande (máximo un millón de triángulos por estructura).');
   const geometry=new BufferGeometry();geometries.push(geometry);geometry.setAttribute('position',new BufferAttribute(positions,3));geometry.boundsTree=new MeshBVH(geometry,{targetLeafSize:8});
  }
  const a={},b={};const result=geometries[0].boundsTree.closestPointToGeometry(geometries[1],new Matrix4(),a,b,Number.MIN_VALUE);
  if(!result||!Number.isFinite(a.distance)||!a.point||!b.point)throw new Error('No se pudo calcular la distancia entre las superficies.');
  if(a.distance===0){
   const triangles=geometries.map((g,i)=>{
    const face=(i?b:a).faceIndex,points=[0,1,2].map(j=>new Vector3().fromBufferAttribute(g.attributes.position,g.index.getX(face*3+j)));
    return new Triangle(...points);
   });
   const tolerance=Math.max(1e-9,Number.EPSILON*64*Math.max(...triangles.flatMap(t=>[t.a.length(),t.b.length(),t.c.length()])));
   if(triangles.some(t=>t.closestPointToPoint(a.point,new Vector3()).distanceTo(a.point)>tolerance)){
    // La biblioteca devuelve (0,0,0) para intersecciones coplanares.
    // Recortar los triángulos en su plano para localizar un contacto real.
    const normal=triangles[0].getNormal(new Vector3()),axis=[Math.abs(normal.x),Math.abs(normal.y),Math.abs(normal.z)];
    const drop=axis.indexOf(Math.max(...axis)),axes=['x','y','z'].filter((_,i)=>i!==drop),[x,y]=axes;
    const clip=[triangles[1].a,triangles[1].b,triangles[1].c];
    const side=(p,u,v)=>(v[x]-u[x])*(p[y]-u[y])-(v[y]-u[y])*(p[x]-u[x]);
    const sign=Math.sign(side(clip[2],clip[0],clip[1]));let polygon=[triangles[0].a,triangles[0].b,triangles[0].c];
    for(let i=0;i<3&&polygon.length;i++){
     const u=clip[i],v=clip[(i+1)%3],out=[];let previous=polygon.at(-1),ps=sign*side(previous,u,v);
     for(const point of polygon){const cs=sign*side(point,u,v);if((ps>=0)!==(cs>=0))out.push(previous.clone().lerp(point,ps/(ps-cs)));if(cs>=0)out.push(point);previous=point;ps=cs;}polygon=out;
    }
    if(!polygon.length||triangles.some(t=>t.closestPointToPoint(polygon[0],new Vector3()).distanceTo(polygon[0])>tolerance))throw new Error('No se pudo localizar con precisión el contacto entre superficies.');
    a.point.copy(polygon[0]);b.point.copy(polygon[0]);
   }
  }
  const distance=a.point.distanceTo(b.point);
  if(!Number.isFinite(distance))throw new Error('El cálculo produjo coordenadas no válidas.');
  return{distance,a:a.point.toArray(),b:b.point.toArray(),triangles:[first.length/9,second.length/9]};
 }finally{geometries.forEach(g=>g.dispose());}
}
