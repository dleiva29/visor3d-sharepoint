const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {deflateSync}=require('node:zlib');
const {JSDOM}=require('jsdom');
const dom=new JSDOM();global.DOMParser=dom.window.DOMParser;global.Node=dom.window.Node;
const source=fs.readFileSync(path.join(__dirname,'../tools/vtm-loader.js'),'utf8').replace("'three'",JSON.stringify(pathToFileURL(require.resolve('three').replace('three.cjs','three.module.js')).href)).replace("'./vendor/vtk-reader.js'",JSON.stringify(pathToFileURL(path.join(__dirname,'../tools/vendor/vtk-reader.js')).href));
const loader=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const file=(name,text,relative='')=>{const b=Buffer.from(text);return{name,webkitRelativePath:relative,size:b.length,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.length)};};
const manifest=body=>`<VTKFile type="vtkMultiBlockDataSet"><vtkMultiBlockDataSet>${body}</vtkMultiBlockDataSet></VTKFile>`;
function array(name,type,values,binary=false,compressed=false){
 let data=values.join(' ');
 if(binary){const raw=Buffer.alloc(values.length*4);values.forEach((v,i)=>type==='Float32'?raw.writeFloatLE(v,i*4):raw.writeInt32LE(v,i*4));
  if(compressed){const zipped=deflateSync(raw),head=Buffer.alloc(16);[1,raw.length,raw.length,zipped.length].forEach((v,i)=>head.writeUInt32LE(v,i*4));data=head.toString('base64')+zipped.toString('base64');}
  else{const head=Buffer.alloc(4);head.writeUInt32LE(raw.length);data=Buffer.concat([head,raw]).toString('base64');}}
 return `<DataArray type="${type}" Name="${name}" NumberOfComponents="${name==='Points'?3:1}" format="${binary?'binary':'ascii'}">${data}</DataArray>`;
}
function vtp({binary=false,compressed=false,ids=[0,1,2],points=[0,0,0,10,0,0,0,10,0],strips=false,pieces=1}={}){
 const cell=strips?'Strips':'Polys';const piece=`<Piece NumberOfPoints="${points.length/3}" NumberOfPolys="${strips?0:1}" NumberOfStrips="${strips?1:0}" NumberOfVerts="0" NumberOfLines="0"><PointData/><CellData/><Points>${array('Points','Float32',points,binary,compressed)}</Points><${cell}>${array('connectivity','Int32',ids,binary,compressed)}${array('offsets','Int32',[ids.length],binary,compressed)}</${cell}></Piece>`;
 return `<VTKFile type="PolyData" byte_order="LittleEndian" ${compressed?'compressor="vtkZLibDataCompressor"':''}><PolyData>${piece.repeat(pieces)}</PolyData></VTKFile>`;
}
const convert=async files=>(await loader).prepareVTMConversion(files,.001);
const meshes=r=>{const a=[];r.root.traverse(o=>{if(o.isMesh)a.push(o);});return a;};
test('VTM y carpeta: nombres, jerarquía, escala y triángulos',async()=>{
 const r=await convert([file('case.vtm',manifest('<Block name="Órganos"><DataSet name="Hígado" file="case/liver.vtp"/></Block>')),file('liver.vtp',vtp(),'case/liver.vtp')]);
 assert.equal(r.meshCount,1);assert.equal(r.triangles,1);assert.equal(meshes(r)[0].name,'Hígado');assert.equal(meshes(r)[0].parent.name,'Órganos');assert.ok(Math.abs(meshes(r)[0].geometry.attributes.position.getX(1)-.01)<1e-8);
});
test('Archivos sueltos: referencia por nombre único',async()=>{assert.equal((await convert([file('a.vtm',manifest('<DataSet file="folder/a.vtp"/>')),file('a.vtp',vtp())])).triangles,1);});
test('VTM anidados y múltiples piezas no pierden superficies',async()=>{const r=await convert([file('a.vtm',manifest('<DataSet file="nested/b.vtm"/>')),file('b.vtm',manifest('<DataSet file="b.vtp"/>'),'nested/b.vtm'),file('b.vtp',vtp({pieces:2}),'nested/b.vtp')]);assert.equal(r.meshCount,2);assert.equal(r.triangles,2);});
for(const compressed of [false,true])test('VTP binario '+(compressed?'zlib':'sin comprimir'),async()=>{assert.equal((await convert([file('a.vtp',vtp({binary:true,compressed}))])).triangles,1);});
test('Polígono cóncavo y triangle strips',async()=>{const r=await convert([file('polygon.vtp',vtp({ids:[0,1,2,3,4],points:[0,0,0,2,0,0,2,2,0,1,1,0,0,2,0]})),file('strip.vtp',vtp({strips:true,ids:[0,1,2,3],points:[0,0,0,1,0,0,0,1,0,1,1,0]}))]);assert.equal(r.triangles,5);});
test('Falta un VTP: rechaza en lugar de exportar incompleto',async()=>{await assert.rejects(convert([file('a.vtm',manifest('<DataSet file="missing.vtp"/>'))]),/Falta missing/);});
test('Nombres repetidos en carpetas: no adivina',async()=>{await assert.rejects(convert([file('a.vtm',manifest('<DataSet file="missing/x.vtp"/>')),file('x.vtp',vtp(),'one/x.vtp'),file('x.vtp',vtp(),'two/x.vtp')]),/ambigua/);});
test('Ciclos y rutas externas se rechazan',async()=>{await assert.rejects(convert([file('a.vtm',manifest('<DataSet file="a.vtm"/>'))]),/cíclicas/);await assert.rejects(convert([file('a.vtm',manifest('<DataSet file="../../bad.vtp"/>'))]),/fuera/);});
test('Índices corruptos, XML corrupto y BigEndian dan error',async()=>{await assert.rejects(convert([file('a.vtp',vtp({ids:[0,1,99]}))]),/fuera de rango/);await assert.rejects(convert([file('a.vtm','<bad>')]),/XML/);await assert.rejects(convert([file('a.vtp',vtp().replace('LittleEndian','BigEndian'))]),/BigEndian/);});
test('No duplica VTP referenciados; avisa sobre los no referenciados',async()=>{const r=await convert([file('a.vtm',manifest('<DataSet file="a.vtp"/>')),file('a.vtp',vtp()),file('b.vtp',vtp())]);assert.equal(r.meshCount,1);assert.ok(r.warnings.some(w=>w.includes('no referenciados')));});
// ZIP almacenado mínimo; el lector debe resolver las carpetas internas.
function zip(entries){const chunks=[],directory=[];let offset=0;for(const [name,text] of Object.entries(entries)){const n=Buffer.from(name),data=Buffer.from(text),head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(n.length,26);chunks.push(head,n,data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);directory.push(c,n);offset+=head.length+n.length+data.length;}const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,central,end]);}
test('ZIP con VTM, subcarpetas y archivos ajenos',async()=>{const r=await convert([file('case.zip',zip({'root/case.vtm':manifest('<DataSet name="Tumor" file="data/a.vtp"/>'),'root/data/a.vtp':vtp(),'readme.txt':'ignored'}))]);assert.equal(meshes(r)[0].name,'Tumor');});
test('ZIP con ruta insegura y archivos duplicados se rechaza',async()=>{await assert.rejects(convert([file('x.zip',zip({'../x.vtp':vtp()}))]),/fuera/);await assert.rejects(convert([file('x.vtp',vtp()),file('x.vtp',vtp())]),/duplicado/);});
function appendedVTP(raw,compressed){
 let text=vtp({binary:true,compressed}),offset=0;const blocks=[];
 text=text.replace(/<DataArray([^>]+)format="binary">([^<]+)<\/DataArray>/g,(_,attrs,b64)=>{
  // VTK codifica cabecera y datos comprimidos en segmentos base64 independientes.
  const bytes=compressed?Buffer.concat([Buffer.from(b64.slice(0,24),'base64'),Buffer.from(b64.slice(24),'base64')]):Buffer.from(b64,'base64');
  const block=raw?bytes:Buffer.from(b64);const at=offset;offset+=block.length;blocks.push(block);
  return `<DataArray${attrs}format="appended" offset="${at}"/>`;
 });
 const end=`\n</AppendedData></VTKFile>`;
 return Buffer.concat([Buffer.from(text.replace('</VTKFile>',`<AppendedData encoding="${raw?'raw':'base64'}">_`)),...blocks,Buffer.from(end)]);
}
for(const raw of [false,true])for(const compressed of [false,true])test(`VTP appended ${raw?'raw':'base64'} ${compressed?'zlib':'sin comprimir'}`,async()=>{assert.equal((await convert([file('a.vtp',appendedVTP(raw,compressed))])).triangles,1);});
test('ESLint del conversor y lector VTM',async()=>{
 const {ESLint}=require('eslint'),globals=require('globals');
 const lint=new ESLint({overrideConfigFile:true,overrideConfig:{languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:globals.browser},rules:{'no-undef':'error','no-unreachable':'error','no-dupe-args':'error','no-dupe-keys':'error','no-func-assign':'error','no-unsafe-optional-chaining':'error','valid-typeof':'error','no-unused-vars':['error',{args:'none',caughtErrors:'none'}]}}});
 const html=fs.readFileSync(path.join(__dirname,'../tools/convertir_glb.html'),'utf8');
 for(const code of [source,fs.readFileSync(path.join(__dirname,'../tools/coordinate-metadata.js'),'utf8'),fs.readFileSync(path.join(__dirname,'../tools/structure-review.js'),'utf8'),html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]]){const [result]=await lint.lintText(code,{filePath:'converter.js'});assert.equal(result.errorCount,0,JSON.stringify(result.messages));}
});
const review=import(pathToFileURL(path.join(__dirname,'../tools/structure-review.js')).href);
const THREE=require('three');
function reviewMesh(file,name='original'){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));g.setAttribute('color',new THREE.Float32BufferAttribute([1,0,0,1,0,0,1,0,0],3));
 const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:'#ff0000',vertexColors:true}));m.name=name;if(file)m.userData.sourceFile=file;return m;
}
test('Revisión común: nombres de archivo y sufijos para varias piezas',async()=>{
 const {describeStructures}=await review,root=new THREE.Group();root.add(reviewMesh('folder/liver.vtp','Hígado'),reviewMesh('folder/liver.vtp','Hígado 2'));
 const rows=describeStructures(root,'vtm');assert.deepEqual(rows.map(r=>r.name),['liver','liver (2)']);assert.equal(rows[0].originalName,'Hígado');
 const obj=new THREE.Group();obj.add(reviewMesh(),reviewMesh());assert.deepEqual(describeStructures(obj,'obj','case.obj').map(r=>r.name),['case','case (2)']);
});
test('Varios OBJ: una fila por archivo aplica nombre/color a todas las partes',async()=>{
 const {describeStructures,applyStructureChoices}=await review,root=new THREE.Group(),part=new THREE.Group();part.userData.sourceFile='liver.obj';part.add(reviewMesh(),reviewMesh());root.add(part);
 const rows=describeStructures(root,'multiobj');assert.equal(rows.length,1);applyStructureChoices(rows,[{name:'Hígado',color:'#00ff00'}]);
 assert.equal(part.children[0].name,'Hígado');assert.equal(part.children[1].name,'Hígado · parte 2');for(const mesh of part.children){assert.equal(mesh.material.color.getHexString(),'00ff00');assert.equal(mesh.material.vertexColors,false);assert.equal(mesh.geometry.getAttribute('color'),undefined);}
});
test('Nombre vacío o repetido no modifica parcialmente el modelo',async()=>{
 const {describeStructures,applyStructureChoices}=await review,root=new THREE.Group();root.add(reviewMesh('a.stl'),reviewMesh('b.stl'));const rows=describeStructures(root,'stl');
 assert.throws(()=>applyStructureChoices(rows,[{name:'a',color:'#000000'},{name:' ',color:'#ffffff'}]),/necesita/);
 assert.throws(()=>applyStructureChoices(rows,[{name:'a',color:'#000000'},{name:'a',color:'#ffffff'}]),/repetidos/);assert.equal(root.children[0].name,'original');
});
const metadata=import(pathToFileURL(path.join(__dirname,'../tools/coordinate-metadata.js')).href);
test('Metadatos explícitos VTP y comentarios OBJ, sin inferir por nombres',async()=>{
 const {inspectCoordinateMetadata:inspect}=await metadata;
 assert.deepEqual(inspect('liver.vtp','<VTKFile coordinate_system="LPS" units="mm"/>').spaces,['LPS']);
 assert.deepEqual(inspect('liver.vtp','<VTKFile coordinate_system="LPS" units="mm"/>').scales,[.001]);
 assert.deepEqual(inspect('x.obj','# coordinate_system: RAS\n# units: cm\nv 0 0 0').spaces,['RAS']);
 assert.deepEqual(inspect('RAS_mm.stl','solid RAS mm').spaces,[]);
 assert.deepEqual(inspect('RAS.obj','# RAS model exported by Slicer').spaces,[]);
});
test('FieldData String ASCII, incluidas cadenas codificadas por VTK',async()=>{
 const {inspectCoordinateMetadata:inspect}=await metadata;
 const r=inspect('x.vtp','<VTKFile><PolyData><FieldData><Array type="String" Name="CoordinateSystem" format="ascii">82 65 83 0</Array><Array type="String" Name="LengthUnit" format="ascii">mm</Array></FieldData></PolyData></VTKFile>');
 assert.deepEqual(r.spaces,['RAS']);assert.deepEqual(r.scales,[.001]);
 assert.deepEqual(inspect('x.vtp','<VTKFile><FieldData><Array type="String" Name="CoordinateSystem" format="binary">RAS</Array></FieldData></VTKFile>').spaces,[]);
});
test('Metadatos parciales no se presentan como detección de todo el conjunto',async()=>{
 const {inspectCoordinateMetadata:i,summarizeCoordinateMetadata:s}=await metadata;
 const r=s([i('a.vtm','<VTKFile space="RAS" units="mm"/>'),i('a.vtp','<VTKFile/>')]);assert.equal(r.space,'RAS');assert.equal(r.completeSpace,false);assert.equal(r.completeScale,false);assert.equal(r.conflict,false);
});
test('Se bloquean coordenadas/unidades mezcladas y declaraciones no admitidas',async()=>{
 const {inspectCoordinateMetadata:i,summarizeCoordinateMetadata:s}=await metadata;
 assert.equal(s([i('a.vtp','<VTKFile space="RAS"/>'),i('b.vtp','<VTKFile space="LPS"/>')]).conflict,true);
 assert.equal(s([i('a.vtp','<VTKFile units="mm"/>'),i('b.vtp','<VTKFile units="m"/>')]).conflict,true);
 assert.equal(s([i('a.vtp','<VTKFile space="RAI"/>')]).conflict,true);
});
