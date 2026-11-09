const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const espree=require('espree');const {ESLint}=require('eslint');const globals=require('globals');
const THREE=require('three');const {JSDOM}=require('jsdom');
const path=require('node:path');
const input=process.argv[2]||path.join(__dirname,'../mpr.html');
const original=process.argv[3]?fs.readFileSync(process.argv[3],'utf8'):null;
const updated=fs.readFileSync(input,'utf8');
function moduleOf(html){return [...html.matchAll(/<script\b[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)][0][1];}
let tested=0;
function suite(html){
 const code=moduleOf(html),ast=espree.parse(code,{ecmaVersion:'latest',sourceType:'module',range:true});
 const funcs=new Map(ast.body.filter(n=>n.type==='FunctionDeclaration').map(n=>[n.id.name,code.slice(...n.range)]));
 function run(name, globals = {}, dependencies = []) {
   const context = vm.createContext({THREE, TextDecoder, Uint8Array, ArrayBuffer, Set, Map, Number, Math, structuredClone, ...globals});
   vm.runInContext([...dependencies, name].map((key) => funcs.get(key)).join("\n"), context);
   return {fn: context[name], context};
 }
 const errors=[];
 async function test(name,fn){try{await fn();tested++;}catch(e){errors.push({name,message:e.message.slice(0,500)});}}
 return {run,test,errors,code,ast};
}
async function check(html, additionalTests = false){const s=suite(html);const {run,test}=s;
 const buffer=(lines)=>new TextEncoder().encode('NRRD0005\ndimension: 3\nspace: right-anterior-superior\nsizes: 2 3 4\nspace origin: (10,20,30)\nspace directions: (1,0,0) (0,2,0) (0,0,3)\n'+lines+'\n\n').buffer;
 await test('Geometría RAS válida y centro físico',()=>{const g=run('parseNrrdGeometry').fn(buffer(''));assert.deepEqual(g.centerRAS.toArray(),[10.5,22,34.5]);});
 await test('Geometría LPS convertida a RAS',()=>{const a=new TextDecoder().decode(buffer('')).replace('right-anterior-superior','left-posterior-superior');const g=run('parseNrrdGeometry').fn(new TextEncoder().encode(a).buffer);assert.deepEqual(g.centerRAS.toArray(),[-10.5,-22,34.5]);});
 for(const [field,value] of [['sizes','2 3'],['sizes','2 0 4'],['sizes','2 3 NaN'],['space origin','(0,NaN,1)'],['space directions','(1,0,0) (0,2,0)'],['dimension','4']]){
  await test('Rechaza cabecera inválida: '+field+'='+value,()=>{let text=new TextDecoder().decode(buffer('')).replace(new RegExp('^'+field+':.*$','m'),field+': '+value);assert.throws(()=>run('parseNrrdGeometry').fn(new TextEncoder().encode(text).buffer));});
 }
 await test('NRRD inválido no borra el trabajo actual',async()=>{let changes=0;const {fn}=run('loadNrrdData',{contentHash:async()=> 'new',volumeContentHash:'old',lastUsEntryPoint:{},usTargetPoint:{},resetTrajectory:()=>{changes++},clearModelAnnotations:()=>{changes++},clearMeasurements:()=>{changes++},navMarker:{visible:true},$:()=>({textContent:''}),parseNrrdGeometry:()=>{throw Error('Geometría inválida')},NRRDLoader:class {}});await assert.rejects(fn(new ArrayBuffer(0),'broken'));assert.equal(changes,0);});
 await test('Recursos gráficos anidados y compartidos liberados una sola vez',()=>{const root=new THREE.Group(),nested=new THREE.Group();root.add(nested);const geo=new THREE.BoxGeometry(),tex=new THREE.Texture(),mat=new THREE.MeshBasicMaterial({map:tex});nested.add(new THREE.Mesh(geo,mat),new THREE.Mesh(geo,mat));let a=0,b=0,c=0;geo.addEventListener('dispose',()=>a++);mat.addEventListener('dispose',()=>b++);tex.addEventListener('dispose',()=>c++);run('clearRoot').fn(root);assert.equal(root.children.length,0);assert.deepEqual([a,b,c],[1,1,1]);});
 await test('La selección de rama sólo cuenta descendientes visibles', () => {
   const row = (id, parent, keys, key) => ({node: {id, parent, key}, keys: () => keys, selection: {}, visibility: {}});
   const branch = row('branch', null, ['A', 'B']);
   const layers = new Map([['A', {visible: {checked: true}}], ['B', {visible: {checked: false}}]]);
   run('syncTreeRows', {
     treeRows: [branch, row('a', 'branch', ['A'], 'A'), row('b', 'branch', ['B'], 'B')],
     layerControls: layers,
     selectedStructures: new Set(['A']),
   }).fn();
   assert.equal(branch.selection.checked, true);
   assert.equal(branch.selection.indeterminate, false);
   assert.equal(branch.visibility.indeterminate, true);
 });
 await test('No se duplica una pareja de flechas ya instalada',()=>{run('addRangeStepper').fn({parentElement:{classList:{contains:()=>true}}});});
 await test('Configuración nula produce error controlado',()=>{assert.throws(()=>run('validateConfig').fn(null),e=>e.message==='Configuración inválida.');});
 await test('Validador común rechaza vistas nulas y flags incorrectos',()=>{const {fn}=run('validateSavedView',{validateConfig:()=>{}});assert.throws(()=>fn(null));assert.throws(()=>fn({name:'Test',config:{},includeInPresentation:'no'}));assert.doesNotThrow(()=>fn({name:'Test',config:{}}));});
 await test('Identificadores vacíos del árbol rechazados',()=>{assert.throws(()=>run('validateNodes',{layerControls:new Map()}).fn([{id:'',type:'group',name:'A',parent:null}]));});
 await test('Migración v1 inválida no modifica la jerarquía',()=>{const {fn,context}=run('applyHierarchy',{structureGroups:['original'],structureRelations:[],validateTree:g=>g,validateStructureRelations:()=>{throw Error('invalid')},applyNodes:()=>{},uid:()=>''});assert.throws(()=>fn([{id:'new'}],[]));assert.deepEqual(context.structureGroups,['original']);});
 await test('Migración v1 válida conserva referencias',()=>{let i=0,saved;const {fn}=run('applyHierarchy',{structureGroups:[],structureRelations:[],validateTree:g=>g,validateStructureRelations:r=>r,validateNodes:n=>n,applyNodes:n=>saved=n,uid:()=>String(++i)});fn([{id:'g',name:'Group',parent:null,members:['A']}],[{parent:'A',child:'B'}]);assert.equal(saved.length,3);assert.equal(saved[1].key,'A');assert.equal(saved[2].parent,saved[1].id);});
 await test('Expansión v1 excesiva se detiene sin modificar el árbol',()=>{let i=0;const {fn,context}=run('applyHierarchy',{structureGroups:['original'],structureRelations:[],validateTree:g=>g,validateStructureRelations:r=>r,validateNodes:n=>n,applyNodes:()=>assert.fail('No debe confirmar'),uid:()=>String(++i)});assert.throws(()=>fn([{id:'g',name:'Group',parent:null,members:Array(10001).fill('A')}],[]));assert.deepEqual(context.structureGroups,['original']);});
 await test('Ángulos 3D paralelos y perpendiculares al plano',()=>{const f=run('trajectoryAngle').fn;assert.equal(f(new THREE.Vector3(),new THREE.Vector3(5,0,0),new THREE.Vector3(0,0,1)),0);assert.equal(f(new THREE.Vector3(),new THREE.Vector3(0,0,5),new THREE.Vector3(0,0,1)),90);});
 await test('Marco US ortonormal conserva la distancia al foco',()=>{const f=run('usCutFrame').fn;for(const axis of [[10,0,0],[0,10,0],[0,0,10],[3,-4,5]])for(const angle of [0,.8,Math.PI]){const probe=new THREE.Vector3(1,2,3),focus=probe.clone().add(new THREE.Vector3(...axis));const frame=f(probe,focus,angle,.2);assert.ok(Math.abs(frame.down.dot(frame.right))<1e-12);assert.ok(Math.abs(frame.normal.length()-1)<1e-12);assert.ok(Math.abs(frame.focus.distanceTo(probe)-focus.distanceTo(probe))<1e-10);}});
 for (const name of ['downloadWithProgress','loadNrrdParts','loadPublishedStructureTree','loadPublishedViews','autoLoadCase']) {
  await test('Credenciales limitadas al mismo origen: '+name,()=>{
   const node=s.ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);
   assert.ok(node,'Función de descarga presente');
   const source=s.code.slice(...node.range);
   assert.match(source,/credentials: "same-origin"/);
   assert.doesNotMatch(source,/credentials: "(?:omit|include)"/);
  });
 }
 await test('Descarga progresiva conserva opciones, bytes y credenciales same-origin',async()=>{
  for(const url of ['/modelos/10.glb','https://external.example/10.glb']){
   let request;const progress=[];
   const {fn}=run('downloadWithProgress',{fetch:async(input,options)=>{request={input,options};return {ok:true,headers:{get:()=> '3'},body:null,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};}});
   const bytes=await fn(url,(...values)=>progress.push(values),{cache:'no-cache'});
   assert.equal(request.input,url);assert.equal(request.options.credentials,'same-origin');
   assert.equal(request.options.cache,'no-cache');assert.deepEqual([...bytes],[1,2,3]);assert.deepEqual(progress,[[3,3]]);
  }
 });
 await test('Una sola descarga del NRRD en la alternativa sin fragmentos',()=>{assert.ok(!s.code.includes("fetch(nrrdURL,{credentials:'omit'})")&&!/fetch\(nrrdURL,\s*\{/.test(s.code));});

 await test('Flechas horizontal, vertical y estado disabled',async()=>{const dom=new JSDOM('<label for="r">Posición</label><input id="r" type="range" min="0" max="10" value="5" step="1"><input id="v" type="range" min="-10" max="10" value="0" aria-orientation="vertical">');const d=dom.window.document;const f=run('addRangeStepper',{document:d,MutationObserver:dom.window.MutationObserver,Event:dom.window.Event}).fn;const r=d.getElementById('r'),v=d.getElementById('v');f(r);f(v);f(r);assert.equal(d.querySelectorAll('.range-stepper').length,2);let inputEvents=0;r.addEventListener('input',()=>inputEvents++);const buttons=r.parentElement.querySelectorAll('button');buttons[1].click();assert.equal(r.value,'6');buttons[0].click();assert.equal(r.value,'5');assert.equal(inputEvents,2);v.parentElement.querySelector('button').click();assert.equal(v.value,'1');r.disabled=true;await new Promise(resolve=>setTimeout(resolve,0));assert.ok([...buttons].every(b=>b.disabled));r.disabled=false;await new Promise(resolve=>setTimeout(resolve,0));assert.ok([...buttons].every(b=>!b.disabled));dom.window.close();});
 await test('Volumen de un solo corte no ofrece índices inexistentes',()=>{const dom=new JSDOM('<input id="rx" type="range"><input id="ry" type="range"><input id="rz" type="range">');const d=dom.window.document;const {fn}=run('initSlices',{document:d,$:id=>d.getElementById(id),obliqueRotation:new THREE.Quaternion(),obliqueShift:new THREE.Vector3(),clearRoot:()=>{},planesRoot:{add:()=>{}},volume:{RASDimensions:[1,2,3],extractSlice:()=>({mesh:{}})},paint:()=>{},updatePlaneVisibility:()=>{},fit:()=>{}});fn();assert.equal(d.getElementById('rx').max,'0');assert.equal(d.getElementById('rx').value,'0');dom.window.close();});
 await test('Configuración válida y rechazo de capas duplicadas/cortes fraccionarios',()=>{const signature={sizes:[2,2,2],origin:[0,0,0],structures:['A','B']};const config={format:'mpr-viewer',version:1,caseSignature:signature,window:[70,350],camera:{position:[1,2,3],target:[0,0,0],up:[0,0,1],near:.1,far:100},views:Object.fromEntries(['x','y','z'].map(a=>[a,{zoom:1,x:0,y:0}])),slices:{x:0,y:0,z:0},flags:Object.fromEntries(['planes','planeX','planeY','planeZ','showmodel','syncNav','showCross','show3DMarker','fillSegments','clipEnabled','clipReverse'].map(k=>[k,true])),fillOpacity:20,clipPosition:100,clipAxis:'z',layers:['A','B'].map(key=>({key,color:'#ffffff',opacity:100,visible:true,contour:true})),referencePoint:null};const f=run('validateConfig',{volume:{},model:{},validateMeasurements:()=>{},configData:()=>({caseSignature:signature}),$:()=>({max:1}),layerControls:new Map([['A',{}],['B',{}]])}).fn;assert.doesNotThrow(()=>f(config));let invalid=structuredClone(config);invalid.layers[1]=invalid.layers[0];assert.throws(()=>f(invalid));invalid=structuredClone(config);invalid.slices.x=.5;assert.throws(()=>f(invalid));invalid=structuredClone(config);invalid.maximizedPane='bad';assert.throws(()=>f(invalid));});
 if (additionalTests) {
   await checkStructureLabels(s);
   await checkStructureTree(s);
 }
 return s;
}

async function checkStructureLabels({run, test}) {
  await test('Etiquetas: recalcula sólo tras cambios y respeta la pausa de cámara', () => {
    const camera = new THREE.PerspectiveCamera();
    const structureNameRoot = { visible: true };
    const structureLabelView = {
      position: camera.position.clone(),
      rotation: camera.quaternion.clone(),
      projection: camera.projectionMatrix.clone(),
      changedAt: -Infinity,
      layoutDirty: true,
      meshData: {},
    };
    const cachedMeshes = structureLabelView.meshData;
    const toggle = { checked: true };
    let now = 0;
    let layouts = 0;
    const {fn: invalidate} = run('invalidateStructureNames', { structureLabelView });
    const {fn: update, context} = run('updateStructureNames', {
      $: () => toggle,
      camera,
      structureNameRoot,
      modelRoot: { visible: true },
      structureLabelView,
      structureLabelSettleMs: 140,
      presentationCameraFlight: null,
      performance: { now: () => now },
      layoutStructureNames: () => layouts++,
    });
    update();
    now = 1000;
    update();
    update(true);
    assert.equal(layouts, 1);

    camera.position.x = 2;
    update();
    assert.equal(structureNameRoot.visible, false);
    now += 139;
    update();
    assert.equal(layouts, 1);
    now++;
    update();
    assert.equal(structureNameRoot.visible, true);
    assert.equal(layouts, 2);
    assert.equal(structureLabelView.meshData, cachedMeshes);

    invalidate();
    update();
    assert.equal(layouts, 3);
    assert.equal(structureLabelView.meshData, cachedMeshes);
    toggle.checked = false;
    update();
    assert.equal(structureNameRoot.visible, false);
    invalidate(true);
    assert.equal(structureLabelView.meshData, null);
    update();
    assert.equal(layouts, 3);
    toggle.checked = true;
    context.presentationCameraFlight = {};
    update();
    assert.equal(layouts, 3);
    update(true);
    assert.equal(structureNameRoot.visible, true);
    assert.equal(layouts, 4);
  });

  await test('Etiquetas: oclusión, recorte, opacidad y líneas con mallas sintéticas', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 10;
    const modelRoot = new THREE.Group();
    const structureNameRoot = new THREE.Group();
    function layer(size, z) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, 1), new THREE.MeshBasicMaterial());
      mesh.position.z = z;
      modelRoot.add(mesh);
      const sprite = new THREE.Sprite();
      const leader = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
      );
      sprite.userData = {
        leader,
        labelPixels: [100, 30],
        layer: { items: [{ mesh }], nameCheck: { checked: true } },
      };
      structureNameRoot.add(sprite, leader);
      return { mesh, sprite, leader };
    }
    const front = layer(4, 2);
    const rear = layer(1, 0);
    const structureLabelView = { meshData: null };
    const {fn: collect} = run('collectStructureLabelMeshes', { modelRoot, structureNameRoot });
    const {fn: hitMaterial, context: hitContext} = run('structureHitMaterial', { clipPlane: null });
    const {fn: projectBounds} = run('projectStructureBounds', { camera });
    const {fn: anchor} = run('visibleStructureAnchor', {
      camera, structureHitMaterial: hitMaterial, projectStructureBounds: projectBounds,
    });
    let meshCollections = 0;
    const {fn: layout} = run('layoutStructureNames', {
      $: () => ({ clientWidth: 500, clientHeight: 500 }),
      camera,
      structureLabelView,
      collectStructureLabelMeshes: () => {
        meshCollections++;
        return collect();
      },
      visibleStructureAnchor: anchor,
      projectStructureBounds: projectBounds,
      packNameColumn: run('packNameColumn').fn,
    });
    const {fn: invalidate} = run('invalidateStructureNames', { structureLabelView });
    layout();
    assert.equal(front.sprite.visible, true);
    assert.equal(front.leader.visible, true);
    assert.equal(rear.sprite.visible, false);
    assert.equal(rear.leader.visible, false);
    camera.position.x = 0.2;
    layout();
    assert.equal(meshCollections, 1);
    assert.equal(rear.sprite.visible, false);

    hitContext.clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1);
    layout();
    assert.equal(meshCollections, 1);
    assert.equal(front.sprite.visible, false);
    assert.equal(rear.sprite.visible, true);
    assert.equal(rear.leader.visible, true);
    const line = rear.leader.geometry.getAttribute('position');
    assert.ok(Math.abs(line.getZ(0) - 0.5) < 1e-6);
    assert.notEqual(line.getX(0), line.getX(1));

    hitContext.clipPlane = null;
    Object.assign(front.mesh.material, { opacity: 0.5, transparent: true, depthWrite: false });
    invalidate(true);
    layout();
    assert.equal(meshCollections, 2);
    assert.equal(front.sprite.visible, true);
    assert.equal(rear.sprite.visible, true);
    function screenBounds(sprite) {
      // Las etiquetas son sprites orientados hacia una cámara sin rotación en esta escena.
      const start = sprite.position.clone().project(camera);
      const end = sprite.position
        .clone()
        .add(new THREE.Vector3(sprite.scale.x, sprite.scale.y, 0))
        .project(camera);
      return new THREE.Box2(
        new THREE.Vector2(start.x, start.y),
        new THREE.Vector2(end.x, end.y)
      );
    }
    assert.equal(screenBounds(front.sprite).intersectsBox(screenBounds(rear.sprite)), false);
    front.mesh.visible = false;
    invalidate(true);
    layout();
    assert.equal(meshCollections, 3);
    assert.equal(front.leader.visible, false);
    assert.equal(rear.leader.visible, true);
  });
}

async function checkStructureTree({run, test}) {
  const group = (id, parent = null) => ({id, type: 'group', name: id, parent});
  const segment = (id, key, parent = null) => ({id, type: 'segment', key, parent});
  const nodes = [
    segment('child', 'B', 'reference-1'),
    group('left'),
    segment('reference-1', 'A', 'left'),
    group('right'),
    segment('reference-2', 'A', 'right'),
    segment('extra', 'C', 'reference-2'),
  ];

  function withTree(check) {
    return async () => {
      const dom = new JSDOM(`
        <div id="structureTree"></div><input id="structureSearch">
        <p id="structureSearchEmpty"></p><p id="treeMessage"></p>
        <button id="redoTree"></button><button id="undoTree"></button><button id="treeMode"></button><button id="createGroup"></button>
        <div id="treeRootDrop"></div><div id="groupEditor"></div>
        <section id="independentStructures"><p id="catalogEditHint"></p><div id="modelLayers"></div></section>
      `, {url: 'http://localhost/'});
      const { document, Event, localStorage } = dom.window;
      dom.window.HTMLElement.prototype.scrollIntoView = () => {};
      const $ = (id) => document.getElementById(id);
      const layerControls = new Map();
      const selectedStructures = new Set();
      const focusCalls = [];
      const changes = [];
      for (const key of ['A', 'B', 'C']) {
        const card = document.createElement('div');
        card.innerHTML = '<div class="layer-header"></div>';
        $('modelLayers').append(card);
        const visible = document.createElement('input');
        visible.type = 'checkbox';
        visible.checked = true;
        visible.addEventListener('change', () => changes.push(key));
        layerControls.set(key, {card, visible, picker: {value: '#123456'}});
      }
      let id = 0;
      const {context} = run('applyNodes', {
        $, document, Event, localStorage, Option: dom.window.Option, layerControls, selectedStructures,
        URL, modelContentHash: 'synthetic-model', treeCaseKey: null, treeLocalOverride: false,
        treeOpenNodes: new Set(), treeSearchOpen: null, treeRedoHistory: [], treeUndoHistory: [], treeRows: [], structureNodes: [], structureGroups: [], structureRelations: [],
        treeEditing: false, batchRestore: false, uid: () => 'new-' + ++id,
        updateStructureSelection: () => context.syncTreeRows(),
        focusStructure: (...args) => focusCalls.push(args),
      }, [
        'redoTreeChange', 'undoTreeChange', 'indexStructureNodes', 'validateNodes', 'validateTree', 'validateStructureRelations',
        'loadTreeExpansion', 'saveTreeExpansion', 'applyHierarchy', 'loadTree', 'saveTree', 'exportStructureTree', 'importStructureTree',
        'loadPublishedStructureTree', 'nodeKeys', 'visibilityClosure', 'setSynchronizedVisibility',
        'syncTreeRows', 'treeControls', 'button', 'renderTree', 'bindTreeDrop', 'moveTreeNode', 'treeNodeActions', 'setTreeIcon', 'editNode',
        'addStructureReference', 'removeTreeReference', 'renderStructureCatalog', 'filterTree', 'setTreeExpanded',
      ]);
      try {
        context.loadTree();
        await check({context, $, changes, layerControls, selectedStructures, focusCalls});
      } finally {
        dom.window.close();
      }
    };
  }

  await test('Árbol: admite gran profundidad y rechaza padres ausentes y ciclos físicos o compartidos', withTree(({context}) => {
    const deep = Array.from({length: 3000}, (_, i) => group('g' + i, i ? 'g' + (i - 1) : null));
    assert.equal(context.validateNodes(deep.reverse()).length, 3000);
    assert.throws(() => context.validateNodes([group('g', 'missing')]), /padre inexistente/);
    assert.throws(() => context.validateNodes([group('a', 'b'), group('b', 'a')]), /Ciclo/);
    assert.throws(() => context.validateNodes([segment('a', 'A'), group('g', 'a'), segment('aa', 'A', 'g')]), /sí misma/);
    assert.throws(() => context.validateNodes([...nodes, segment('b', 'B'), segment('a', 'A', 'b')]), /ciclo entre segmentaciones/);
    assert.equal(context.validateNodes(nodes).length, nodes.length);
  }));

  await test('Árbol: referencias comparten selección y visibilidad de sus ramas', withTree(({context, changes, selectedStructures, layerControls, focusCalls}) => {
    context.applyNodes(nodes);
    const row = (id) => context.treeRows.find(({node}) => node.id === id);
    row('reference-1').selection.click();
    assert.deepEqual([...selectedStructures].sort(), ['A', 'B']);
    assert.equal(row('reference-2').selection.indeterminate, true);
    row('left').visibility.click();
    assert.deepEqual([...changes].sort(), ['A', 'B', 'C']);
    assert.equal(selectedStructures.size, 0);
    assert.equal(row('reference-2').selection.disabled, true);
    assert.equal(row('reference-2').visibility.checked, false);
    row('reference-2').title.click();
    assert.deepEqual(focusCalls, [['A', false, false]]);
    assert.equal(layerControls.get('A').visible.checked, false);
    row('right').visibility.click();
    assert.equal(row('reference-1').visibility.checked, true);
    assert.equal(row('reference-1').selection.disabled, false);
  }));

  await test('Árbol: arrastra desde el catálogo, mueve a la raíz y retira solo la referencia', withTree(({context, $, layerControls}) => {
    context.applyNodes(nodes);
    context.treeEditing = true;
    context.renderTree();
    const details = (id) => $('structureTree').querySelector('[data-node="' + id + '"]');
    const row = (id) => details(id).firstElementChild;
    const drag = (from, to) => {
      const data = new Map();
      const event = {
        preventDefault() {}, stopPropagation() {},
        dataTransfer: {setData: (key, value) => data.set(key, value), getData: (key) => data.get(key) || ''},
      };
      from.ondragstart(event);
      to.ondrop(event);
    };
    drag(layerControls.get('B').card.firstElementChild, row('right'));
    assert.equal(context.treeIndex.references.get('B').length, 2);
    assert.equal(details('right').open, true);
    drag(row('reference-1'), $('treeRootDrop'));
    assert.equal(context.treeIndex.byId.get('reference-1').parent, null);
    assert.equal(details('left').open, true);
    drag(row('reference-1'), $('independentStructures'));
    assert.equal(context.treeIndex.byId.has('reference-1'), false);
    assert.equal(context.treeIndex.byId.get('child').parent, null);
    assert.equal(context.treeIndex.byId.has('reference-2'), true);
    assert.equal(layerControls.get('A').card.parentElement, $('modelLayers'));
  }));

  await test('Árbol: ordenar, mover ramas y rechazar ciclos sin mutación parcial', withTree(({context}) => {
    context.applyNodes([group('a'), group('b'), group('c'), group('child', 'a')]);
    context.moveTreeNode('c', 'a', 'before');
    assert.deepEqual(Array.from(context.treeIndex.children.get(null), n => n.id), ['c','a','b']);
    context.moveTreeNode('c', 'b', 'after');
    assert.deepEqual(Array.from(context.treeIndex.children.get(null), n => n.id), ['a','b','c']);
    const before = JSON.stringify(context.structureNodes);
    assert.throws(() => context.moveTreeNode('a', 'child', 'inside'), /Ciclo/);
    assert.equal(JSON.stringify(context.structureNodes), before);
    context.moveTreeNode('a', 'b', 'inside');
    assert.equal(context.treeIndex.byId.get('child').parent, 'a');
    const exported = context.exportStructureTree();
    context.importStructureTree(JSON.parse(JSON.stringify(exported)));
    assert.equal(context.treeIndex.byId.get('a').parent, 'b');
  }));

  await test('Árbol: acciones permiten ordenar y quitar conservando hijos', withTree(({context, $}) => {
    context.applyNodes([group('a'), group('b'), group('child','a')]);
    context.treeEditing = true;
    context.renderTree();
    const actions = id => $('structureTree').querySelector('[data-node="'+id+'"] > summary select');
    const select = actions('b');
    select.value = 'up'; select.onchange();
    assert.deepEqual(Array.from(context.treeIndex.children.get(null), n => n.id), ['b','a']);
    const remove = actions('a'); remove.value = 'remove'; remove.onchange();
    assert.equal(context.treeIndex.byId.has('a'), false);
    assert.equal(context.treeIndex.byId.get('child').parent, null);
  }));

  await test('Árbol: renombrar conserva orden y soltar en bordes reordena', withTree(({context, $}) => {
    context.applyNodes([group('a'), group('b'), group('c')]);
    context.treeEditing = true; context.renderTree();
    const actions = $('structureTree').querySelector('[data-node="b"] > summary select');
    actions.value = 'rename'; actions.onchange();
    $('nodeDisplayName').value = 'Nuevo nombre';
    Array.from($('groupEditor').querySelectorAll('button')).find(b => b.textContent === 'Guardar').click();
    assert.equal(context.treeIndex.byId.get('b').name, 'Nuevo nombre');
    assert.deepEqual(Array.from(context.treeIndex.children.get(null), n => n.id), ['a','b','c']);
    const target = $('structureTree').querySelector('[data-node="a"] > summary');
    target.getBoundingClientRect = () => ({top: 100, height: 40});
    target.ondrop({clientY: 101, preventDefault(){}, stopPropagation(){}, dataTransfer:{types:['application/x-mpr-tree-node'],getData: type => type === 'application/x-mpr-tree-node' ? 'c' : ''}});
    assert.deepEqual(Array.from(context.treeIndex.children.get(null), n => n.id), ['c','a','b']);
  }));

  await test('Árbol: deshacer recupera eliminación, orden y nombres sin cambiar visibilidad', withTree(({context, $, layerControls}) => {
    context.applyNodes(nodes, {persist:false});
    context.removeTreeReference('reference-1');
    assert.equal(context.treeIndex.byId.get('child').parent, 'left');
    context.undoTreeChange();
    assert.equal(context.treeIndex.byId.get('child').parent, 'reference-1');
    assert.equal(JSON.stringify(context.structureNodes), JSON.stringify(context.validateNodes(nodes)));
    const before = JSON.stringify(context.structureNodes);
    context.moveTreeNode('right','left','before');
    context.applyNodes(context.structureNodes.map(n => n.id === 'right' ? {...n,name:'Nuevo'} : n));
    layerControls.get('A').visible.checked = false;
    context.undoTreeChange();
    assert.equal(context.treeIndex.byId.get('right').name, 'right');
    context.undoTreeChange();
    assert.equal(JSON.stringify(context.structureNodes), before);
    assert.equal(layerControls.get('A').visible.checked, false);
    assert.equal($('undoTree').disabled, true);
    const saved = JSON.parse(context.localStorage.getItem(context.treeCaseKey));
    assert.equal(JSON.stringify(saved.nodes), before);
  }));
  await test('Árbol: historial limitado, operaciones inválidas y cambio de modelo', withTree(({context, $}) => {
    context.applyNodes([group('a')], {persist:false});
    for(let i=0;i<25;i++) context.applyNodes([{...group('a'),name:'Nombre '+i}]);
    assert.equal(context.treeUndoHistory.length,20);
    assert.throws(() => context.applyNodes([group('bad','missing')]));
    assert.equal(context.treeUndoHistory.length,20);
    for(let i=0;i<20;i++) context.undoTreeChange();
    assert.equal(context.treeIndex.byId.get('a').name,'Nombre 4');
    context.applyNodes([group('b')]);
    context.modelContentHash = 'otro-modelo'; context.loadTree();
    assert.equal(context.treeUndoHistory.length,0);
    assert.equal($('undoTree').disabled,true);
    context.undoTreeChange();
    assert.equal(context.structureNodes.length,0);
  }));

  await test('Árbol: rehacer recupera varios cambios, persiste y conserva visibilidad', withTree(({context, $, layerControls}) => {
    context.applyNodes(nodes, {persist:false});
    context.moveTreeNode('right','left','before');
    const moved = JSON.stringify(context.structureNodes);
    context.removeTreeReference('reference-1');
    const removed = JSON.stringify(context.structureNodes);
    context.undoTreeChange(); context.undoTreeChange();
    assert.equal($('redoTree').disabled,false);
    layerControls.get('A').visible.checked = false;
    context.redoTreeChange();
    assert.equal(JSON.stringify(context.structureNodes),moved);
    context.redoTreeChange();
    assert.equal(JSON.stringify(context.structureNodes),removed);
    assert.equal($('redoTree').disabled,true);
    assert.equal(layerControls.get('A').visible.checked,false);
    assert.equal(JSON.stringify(JSON.parse(context.localStorage.getItem(context.treeCaseKey)).nodes),removed);
    context.undoTreeChange();
    assert.equal(JSON.stringify(context.structureNodes),moved);
  }));
  await test('Árbol: edición nueva borra rehacer; error y operación idéntica lo conservan', withTree(({context, $}) => {
    context.applyNodes([group('a')],{persist:false});
    context.applyNodes([group('b')]); context.undoTreeChange();
    assert.throws(()=>context.applyNodes([group('bad','missing')]));
    context.applyNodes(context.structureNodes);
    assert.equal(context.treeRedoHistory.length,1);
    context.applyNodes([group('c')]);
    assert.equal(context.treeRedoHistory.length,0);
    context.redoTreeChange(); assert.equal(context.structureNodes[0].id,'c');
    context.undoTreeChange();
    context.modelContentHash = 'otro'; context.loadTree();
    assert.equal(context.treeRedoHistory.length,0);
    assert.equal($('redoTree').disabled,true);
    context.redoTreeChange(); assert.equal(context.structureNodes.length,0);
  }));

  await test('Árbol: deshacer y rehacer solo visibles en edición sin perder historial', withTree(({context, $}) => {
    context.applyNodes([group('a')],{persist:false});
    assert.equal($('undoTree').hidden,true);
    assert.equal($('redoTree').hidden,true);
    context.treeEditing = true; context.renderTree();
    assert.equal($('undoTree').hidden,false);
    assert.equal($('redoTree').hidden,false);
    context.applyNodes([group('b')]); context.undoTreeChange();
    context.treeEditing = false; context.renderTree();
    assert.equal($('undoTree').hidden,true);
    assert.equal($('redoTree').hidden,true);
    context.treeEditing = true; context.renderTree();
    assert.equal($('redoTree').hidden,false);
    assert.equal($('redoTree').disabled,false);
    context.redoTreeChange();
    assert.equal(context.structureNodes[0].id,'b');
  }));

  await test('Árbol: busca alias y clave original y restaura expansión tras búsquedas y render', withTree(({context, $}) => {
    context.applyNodes([group('root'), {...segment('ref','A','root'),name:'Nombre visible'},group('other')],{persist:false});
    const row = id => context.treeRows.find(r => r.node.id === id);
    row('other').details.open = true;
    $('structureSearch').value = 'nombre visible'; context.filterTree();
    assert.equal(row('ref').details.hidden,false);
    assert.equal(row('root').details.open,true);
    $('structureSearch').value = 'A'; context.filterTree();
    assert.equal(row('ref').details.hidden,false);
    context.renderTree();
    $('structureSearch').value = 'sin coincidencias'; context.filterTree();
    assert.equal($('structureSearchEmpty').hidden,false);
    $('structureSearch').value = ''; context.filterTree();
    assert.equal(row('root').details.open,false);
    assert.equal(row('other').details.open,true);
    assert.equal(row('ref').details.hidden,false);
    assert.equal(context.treeSearchOpen,null);
  }));
  await test('Árbol: expandir y contraer terminan búsqueda sin cambiar organización ni historial', withTree(({context, $}) => {
    context.applyNodes(nodes,{persist:false});
    const before = JSON.stringify(context.structureNodes);
    $('structureSearch').value = 'A'; context.filterTree();
    context.setTreeExpanded(false);
    assert.equal($('structureSearch').value,'');
    assert.ok(context.treeRows.every(r => !r.details.open && !r.details.hidden));
    context.setTreeExpanded(true);
    assert.ok(context.treeRows.every(r => r.details.open));
    assert.equal(JSON.stringify(context.structureNodes),before);
    assert.equal(context.treeUndoHistory.length,0);
    $('structureSearch').value = 'B'; context.filterTree();
    context.modelContentHash = 'otro'; context.loadTree();
    assert.equal(context.treeSearchOpen,null);
    assert.equal($('structureSearch').value,'');
  }));

  await test('Árbol: iconos accesibles y acciones nativas por nodo', withTree(({context, $}) => {
    context.applyNodes([group('a')],{persist:false});
    assert.equal($('treeMode').getAttribute('aria-label'),'Editar árbol');
    assert.ok($('treeMode').querySelector('svg[aria-hidden="true"]'));
    context.treeEditing = true; context.renderTree();
    assert.equal($('treeMode').getAttribute('aria-label'),'Terminar edición');
    const wrapper = $('structureTree').querySelector('.tree-actions-wrap');
    assert.ok(wrapper.querySelector('svg'));
    assert.equal(wrapper.querySelector('select').getAttribute('aria-label'),'Acciones de a');
    assert.equal(wrapper.querySelectorAll('option').length,6);
  }));

  await test('Árbol: referencias compartidas muestran contador y explicación accesible', withTree(({context, $}) => {
    context.applyNodes(nodes,{persist:false});
    const badge = id => $('structureTree').querySelector('[data-node="'+id+'"] > summary .tree-shared');
    assert.equal(badge('reference-1').textContent,'↗ 2');
    assert.equal(badge('reference-2').textContent,'↗ 2');
    assert.match(badge('reference-1').getAttribute('aria-label'),/2 lugares.*visibilidad.*descendientes/);
    assert.equal(badge('child'),null);
    assert.equal(badge('left'),null);
    const control = context.treeRows.find(r => r.node.id === 'left').visibility;
    assert.match(control.title,/otras ramas/);
    assert.match(control.getAttribute('aria-label'),/left/);
    context.treeEditing = true; context.renderTree();
    assert.equal(badge('reference-1').textContent,'↗ 2');
    context.removeTreeReference('reference-2');
    assert.equal(badge('reference-1'),null);
    context.undoTreeChange();
    assert.equal(badge('reference-1').textContent,'↗ 2');
  }));

  await test('Árbol: recuerda expansión por modelo y no guarda apertura temporal de búsqueda', withTree(({context, $}) => {
    context.applyNodes(nodes);
    const row = id => context.treeRows.find(r => r.node.id === id);
    row('left').details.open = true;
    row('left').details.dispatchEvent(new context.Event('toggle'));
    assert.deepEqual(JSON.parse(context.localStorage.getItem('mpr-tree-open-v1:synthetic-model')),['left']);
    $('structureSearch').value = 'C'; context.filterTree();
    context.saveTreeExpansion();
    assert.deepEqual(JSON.parse(context.localStorage.getItem('mpr-tree-open-v1:synthetic-model')),['left']);
    context.treeCaseKey = null; context.loadTree();
    assert.equal(row('left').details.open,true);
    assert.equal(row('right').details.open,false);
    context.modelContentHash = 'otro'; context.loadTree();
    context.applyNodes(nodes);
    assert.ok(context.treeRows.every(r => !r.details.open));
    context.modelContentHash = 'synthetic-model'; context.loadTree();
    assert.equal(row('left').details.open,true);
    context.setTreeExpanded(false);
    assert.deepEqual(JSON.parse(context.localStorage.getItem('mpr-tree-open-v1:synthetic-model')),[]);
  }));
  await test('Árbol: expansión tolera datos corruptos y almacenamiento no disponible', withTree(({context}) => {
    context.localStorage.setItem('mpr-tree-open-v1:synthetic-model','{roto');
    context.treeCaseKey = null;
    assert.doesNotThrow(()=>context.loadTree());
    context.localStorage = {getItem(){throw Error('blocked')},setItem(){throw Error('full')}};
    assert.doesNotThrow(()=>context.loadTreeExpansion());
    context.applyNodes(nodes,{persist:false});
    assert.doesNotThrow(()=>context.setTreeExpanded(true));
    assert.ok(context.treeRows.every(r => r.details.open));
  }));

  await test('Árbol: round-trip v2, migración v1 y preferencia por la edición local', withTree(async ({context}) => {
    context.applyNodes(nodes);
    const exported = JSON.parse(JSON.stringify(context.exportStructureTree()));
    assert.equal(exported.version, 2);
    assert.equal(exported.format, 'mpr-structure-tree');
    context.treeCaseKey = null;
    context.loadTree();
    assert.equal(JSON.stringify(context.structureNodes), JSON.stringify(exported.nodes));
    context.fetch = async () => ({ok: true, text: async () => JSON.stringify({...exported, nodes: []})});
    await context.loadPublishedStructureTree('synthetic', 'http://localhost/');
    assert.equal(context.structureNodes.length, nodes.length);
    delete exported.groups;
    delete exported.relations;
    context.importStructureTree(exported);
    assert.equal(context.treeIndex.byId.get('child').parent, 'reference-1');
    context.importStructureTree({
      format: exported.format, version: 1, modelHash: exported.modelHash,
      groups: [{...group('legacy'), members: ['A']}],
      relations: [{parent: 'A', child: 'B'}],
    });
    assert.deepEqual(Array.from(context.nodeKeys('legacy')).sort(), ['A', 'B']);
  }));
}

(async()=>{const before=original?await check(original):{errors:[]},previousTotal=tested,after=await check(updated,true);const lint=new ESLint({overrideConfigFile:true,overrideConfig:{languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:globals.browser},rules:{'no-undef':'error','no-unreachable':'error','no-dupe-args':'error','no-dupe-keys':'error','no-func-assign':'error','no-unsafe-optional-chaining':'error','valid-typeof':'error','no-unused-vars':['error',{args:'none',caughtErrors:'none'}]}}});const [result]=await lint.lintText(after.code,{filePath:'mpr.js'});const report={beforeFailures:before.errors,afterFailures:after.errors,lint:result.messages,totalExecutions:tested+before.errors.length+after.errors.length};fs.writeFileSync(path.join(__dirname,'resultado_pruebas.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pruebas:tested-previousTotal+after.errors.length,fallos:after.errors,lint:result.messages,comparacionOriginal:original?before.errors.length:null},null,2));if(after.errors.length||result.errorCount)process.exitCode=1;})();
