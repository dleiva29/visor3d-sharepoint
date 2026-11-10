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
   const context = vm.createContext({THREE, TextDecoder, Uint8Array, ArrayBuffer, Set, Map, Number, Math, structuredClone, requestSceneRender:()=>{}, clipManualOffset:0, savedViewTracker:null, selectedMeasurement:null, hoveredMeasurement:null, hoveredAnnotation:null, selectedAnnotation:null, arrowPlacementPreview:null, arrowPlacementPlane:null, ...globals});
   vm.runInContext([...dependencies, name].map((key) => funcs.get(key)).join("\n"), context);
   return {fn: context[name], context};
 }
 const errors=[];
 async function test(name,fn){try{await fn();tested++;}catch(e){errors.push({name,message:e.message.slice(0,500)});}}
 return {run,test,errors,code,ast};
}
async function check(html, additionalTests = false){const s=suite(html);const {run,test}=s;
 await test('Menús de cabecera: caben en horizontal y se recolocan al girar la pantalla',()=>{
  const content={style:{},offsetWidth:260};
  const anchor={left:760,bottom:151};
  const menu={querySelector:selector=>selector==='summary'?{getBoundingClientRect:()=>anchor}:content};
  const viewport={clientWidth:844,clientHeight:390};
  const document={documentElement:viewport,querySelectorAll:()=>[menu]};
  const {fn}=run('positionHeaderMenus',{document});
  fn();assert.equal(content.style.left,'576px');assert.equal(content.style.maxHeight,'231px');
  viewport.clientWidth=390;viewport.clientHeight=844;anchor.left=18;anchor.bottom=274;
  fn();assert.equal(content.style.left,'18px');assert.equal(content.style.top,'274px');assert.equal(content.style.maxHeight,'420px');
 });
 await test('Selección de superposiciones: línea completa, tolerancia táctil y ocultas',()=>{
  const m={axis:null,a:new THREE.Vector3(0,0,0),b:new THREE.Vector3(100,0,0)};
  const globals={measurements:[m],modelAnnotations:[],annotationRoot:{visible:false},screenEndpoint:p=>({x:p.x,y:p.y})};
  const {fn}=run('nearestOverlay',globals,['segmentDistance']);
  assert.equal(fn({clientX:50,clientY:8},null,{}).item,m);
  assert.equal(fn({clientX:50,clientY:18},null,{}),null);
  assert.equal(fn({clientX:50,clientY:18,pointerType:'touch'},null,{}).item,m);
  m.visible=false;assert.equal(fn({clientX:50,clientY:0},null,{}),null);
 });
 await test('Selección MPR: excluye otro corte y otra orientación',()=>{
  const m={axis:'z',index:3,a:new THREE.Vector3(0,0,0),b:new THREE.Vector3(100,0,0)};
  const globals={measurements:[m],slices:{z:{}},$:()=>({value:3}),slicePixelBasis:()=>({u:new THREE.Vector3(1,0,0),v:new THREE.Vector3(0,1,0),origin:new THREE.Vector3()}),screenEndpoint:p=>({x:p.x,y:p.y})};
  const {fn}=run('nearestOverlay',globals,['segmentDistance']);
  assert.equal(fn({clientX:50,clientY:0},'z',{}).item,m);
  m.index=2;assert.equal(fn({clientX:50,clientY:0},'z',{}),null);
  m.index=3;m.a.z=2;assert.equal(fn({clientX:50,clientY:0},'z',{}),null);
 });
 await test('Recorte: pasar a manual conserva el plano oblicuo, ambos lados y posiciones exteriores',()=>{
  for(const reverse of [false,true]) for(const level of [1.234567,25,-25]) {
   const ids=['clipSyncTc','clipPosition','rotateClip','clipRotationConstraint','clipLeft','clipRight','clipUp','clipDown','alignClip','resetClipRotation','clipEnabled','clipAxis','clipReverse','clipStatus'];
   const elements=Object.fromEntries(ids.map(id=>[id,{checked:false,value:50}]));elements.clipEnabled.checked=true;elements.clipAxis.value='z';elements.clipReverse.checked=reverse;
   const normal=new THREE.Vector3(1,2,3).normalize();if(reverse)normal.negate();
   const before=new THREE.Plane(normal,level);
   const {fn,context}=run('preserveClipAsManual',{$:id=>elements[id],model:new THREE.Mesh(new THREE.BoxGeometry(10,10,10),new THREE.MeshBasicMaterial()),clipPlane:before.clone(),clipRotation:new THREE.Quaternion(),clipGuide:new THREE.Object3D(),volume:null,volumeInfo:null,activeTool:'navigate',invalidateStructureNames:()=>{}},['orientClip','updateClip']);
   fn();assert.ok(context.clipPlane.normal.distanceTo(before.normal)<1e-10);assert.ok(Math.abs(context.clipPlane.constant-before.constant)<1e-10);assert.equal(elements.clipStatus.textContent,'Recorte manual');
  }
 });
 await test('Plano por tres puntos: desactiva sincronización antes de orientar el recorte',()=>{
  const elements={toolHint:{},clipAxis:{value:'x'},clipSyncTc:{checked:true},clipEnabled:{checked:false}};
  let oriented=false;
  const {fn}=run('addPlanePoint',{$:id=>elements[id],planePoints:[],planePointRoot:new THREE.Group(),volumeInfo:null,clipRotation:new THREE.Quaternion(),orientClip:(rotation,center)=>{assert.equal(elements.clipSyncTc.checked,false);assert.equal(elements.clipAxis.value,'z');assert.ok(center.distanceTo(new THREE.Vector3(1/3,1/3,2))<1e-10);oriented=true;},setTool:()=>{},syncPaneToggles:()=>{},repaintAll:()=>{}});
  [new THREE.Vector3(0,0,1),new THREE.Vector3(1,0,2),new THREE.Vector3(0,1,3)].forEach(fn);
  assert(oriented);assert.equal(elements.clipEnabled.checked,true);
 });
 await test('Trayectoria: Esc restaura extremo y controles sin emitir guardado',()=>{
  const path={a:new THREE.Vector3(5,6,7),b:new THREE.Vector3(20,0,0)},original=new THREE.Vector3(1,2,3),controls={enabled:false};let emitted=0,released=0;
  const hint={};const canvas={style:{cursor:'grabbing'},hasPointerCapture:()=>true,releasePointerCapture:()=>released++};
  const {fn,context}=run('cancelTrajectoryInteraction',{measurementDrag:{m:path,end:'a',original,canvas,pointerId:1,orbitEnabled:true,cursor:'grab',isTrajectory:true},controls,down3D:{},$:()=>hint,renderTrajectory:()=>{},repaintAll:()=>{},document:{dispatchEvent:()=>emitted++}},['endMeasurementDrag']);
  const event={key:'Escape',preventDefault(){this.defaultPrevented=true},stopPropagation(){this.stopped=true}};fn(event);
  assert(path.a.equals(original));assert.equal(context.measurementDrag,null);assert(controls.enabled);assert(event.stopped);assert.equal(released,1);assert.equal(emitted,0);assert.match(hint.textContent,/cancelado/);
 });
 await test('Trayectoria: extremos con margen táctil y elección del más cercano',()=>{
  const path={a:new THREE.Vector3(0,0,0),b:new THREE.Vector3(100,0,0)};
  const {fn}=run('nearestTrajectoryEnd',{trajectory:path,screenEndpoint:p=>({x:p.x,y:p.y})});
  assert.equal(fn({clientX:20,clientY:0},null,{}),null);
  assert.equal(fn({clientX:20,clientY:0,pointerType:'touch'},null,{}).end,'a');
  assert.equal(fn({clientX:90,clientY:0,pointerType:'touch'},null,{}).end,'b');
 });
 await test('Ventana: preajustes, valores decimales coherentes y restauración',()=>{
  const preset={options:[{value:'custom'},{value:'70,350'},{value:'-600,1500'},{value:'400,1800'}]};
  const elements={wl:{value:70},ww:{value:350},windowPreset:preset},volume={};let paints=0;
  const {fn}=run('setWindow',{$:id=>elements[id],volume,repaintAll:()=>paints++},['syncWindowPreset']);
  fn(-600,1500);assert.equal(preset.value,'-600,1500');assert.equal(volume.windowLow,-1350);
  fn(70.25,350.5);assert.equal(preset.value,'custom');assert.equal(elements.wl.value,70.25);assert.equal(volume.windowHigh-volume.windowLow,350.5);
  fn(70,350);assert.equal(preset.value,'70,350');assert.equal(paints,3);
  fn(NaN,350);assert.equal(paints,3);
 });
 const buffer=(lines)=>new TextEncoder().encode('NRRD0005\ndimension: 3\nspace: right-anterior-superior\nsizes: 2 3 4\nspace origin: (10,20,30)\nspace directions: (1,0,0) (0,2,0) (0,0,3)\n'+lines+'\n\n').buffer;
 function workHarness(storage = new Map()) {
  const dom = new JSDOM('<div id="host"></div>', {url:'https://viewer.test/mpr.html'});
  const timers = new Map(); let timerId=0, key='volume-A:model-A', state={slice:4,camera:[1,2,3]}, blocked=false, writes=0, controlEnd=()=>{};
  const adapter={key:()=>key,capture:()=>structuredClone(state),validate:value=>{if(!value||!Number.isInteger(value.slice))throw Error('Estado inválido');},restore:value=>{state=structuredClone(value);},blocked:()=>blocked,onChange:fn=>controlEnd=fn};
  const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>{writes++;storage.set(k,v);},removeItem:k=>storage.delete(k)};
  const controller=run('installLocalWorkState',{document:dom.window.document,window:dom.window,localStorage,setTimeout:f=>{timers.set(++timerId,f);return timerId;},clearTimeout:id=>timers.delete(id)}).fn(adapter,dom.window.document.getElementById('host'));
  const document=dom.window.document;
  return {dom,document,controller,storage,localStorage,controlEnd:()=>controlEnd({target:{}}),get state(){return state;},set state(v){state=v;},set key(v){key=v;},set blocked(v){blocked=v;},get writes(){return writes;},buttons:Object.fromEntries([...document.querySelectorAll('[data-work]')].map(b=>[b.dataset.work,b])),auto:document.querySelector('input'),message:document.querySelector('[aria-live]'),event:()=>document.dispatchEvent(new dom.window.Event('case-state-change')),flush:()=>{const callbacks=[...timers.values()];timers.clear();callbacks.forEach(f=>f());}};
 }
 await test('Trabajo local: guardado, recuperación tras recarga y protección frente a sobrescritura automática',()=>{
  const a=workHarness();a.controller.save(true);a.controlEnd();a.flush();assert.equal(a.writes,1);
  const b=workHarness(a.storage);assert.equal(b.buttons.restore.disabled,false);assert.match(b.message.textContent,/disponible/);
  b.state={slice:9,camera:[9,9,9]};b.event();b.flush();assert.equal(b.writes,0);
  b.controller.restore();assert.equal(b.state.slice,4);
  b.state={slice:6,camera:[3,2,1]};b.event();b.flush();assert.equal(b.writes,1);
  assert.equal(JSON.parse([...b.storage.values()][0]).state.slice,6);
  b.event();b.flush();assert.equal(b.writes,1);a.dom.window.close();b.dom.window.close();
 });
 await test('Trabajo local: aísla casos, pausa antes de reemplazar archivos y conserva el caso anterior',()=>{
  const h=workHarness();h.controller.save(true);h.state={slice:7};h.controller.pause();
  assert.equal(JSON.parse([...h.storage.values()][0]).state.slice,7);
  h.key='volume-B:model-A';h.state={slice:1};h.controller.sync();assert.equal(h.buttons.restore.disabled,true);
  h.event();h.flush();assert.equal(h.storage.size,1);h.controller.save(true);assert.equal(h.storage.size,2);
  h.key='volume-A:model-A';h.controller.sync();h.controller.restore();assert.equal(h.state.slice,7);h.dom.window.close();
 });
 await test('Trabajo local: errores de cuota y JSON inválido no alteran el trabajo abierto',()=>{
  const h=workHarness();h.localStorage.setItem=()=>{throw Error('QuotaExceeded');};h.controller.save(true);
  assert.match(h.message.textContent,/No se pudo guardar/);assert.equal(h.state.slice,4);assert.equal(h.buttons.restore.disabled,true);
  h.event();h.flush();assert.equal(h.storage.size,0);h.dom.window.close();
  const bad=workHarness(new Map([['mpr-work-state-v1:volume-A:model-A','{"version":1}']]));
  assert.match(bad.message.textContent,/No se pudo leer/);assert.equal(bad.buttons.restore.disabled,true);assert.equal(bad.state.slice,4);bad.buttons.delete.click();assert.equal(bad.storage.size,0);bad.dom.window.close();
 });
 await test('Trabajo local: exclusión de presentación, desactivación, borrado y guardado al salir',()=>{
  const h=workHarness();h.controller.save(true);h.state={slice:8};h.blocked=true;h.event();h.flush();h.controller.save();assert.equal(h.writes,1);
  h.blocked=false;h.auto.checked=false;h.auto.onchange();assert.equal(h.writes,2);h.state={slice:9};h.event();h.flush();assert.equal(h.writes,2);
  h.auto.checked=true;h.auto.onchange();h.state={slice:10};h.dom.window.dispatchEvent(new h.dom.window.Event('pagehide'));assert.equal(JSON.parse([...h.storage.values()][0]).state.slice,10);
  h.buttons.delete.click();assert.equal(h.storage.size,0);assert.equal(h.buttons.restore.disabled,true);assert.equal(h.state.slice,10);h.event();h.flush();assert.equal(h.storage.size,0);h.dom.window.close();
 });
 await test('Mediciones: filas accesibles, selección y eliminación por identidad',()=>{
  const dom=new JSDOM('<p id="measurementEmpty"></p><p id="measurementHint"></p><ol id="measurementList"></ol>');
  const m={axis:null,index:null,a:new THREE.Vector3(),b:new THREE.Vector3(3,4,0)},n={...m};
  const measurements=[m,n];let located=null;
  const {fn,context}=run('updateMeasurementList',{document:dom.window.document,Event:dom.window.Event,$:id=>dom.window.document.getElementById(id),measurements,selectedMeasurement:m,updateMeasurementHint:()=>{},locateMeasurement:(v,edit)=>{located=[v,edit];},renderMeasure3D:()=>{},repaintAll:()=>{}},['setTreeIcon']);
  fn();const rows=dom.window.document.querySelectorAll('li');const name=rows[0].querySelector('input');name.value='Diámetro de lesión';name.dispatchEvent(new dom.window.Event('input'));assert.equal(m.name,'Diámetro de lesión');name.value=' ';name.dispatchEvent(new dom.window.Event('input'));assert.equal(m.name,undefined);assert.match(rows[0].textContent,/5.0 mm.*3D/);assert.ok(rows[0].classList.contains('selected'));const toggle=rows[0].querySelector('input[type=checkbox]');assert.equal(toggle.checked,true);toggle.click();assert.equal(m.visible,false);toggle.click();assert.equal(m.visible,true);
  rows[0].querySelector('button').click();assert.equal(located[0],m);assert.equal(rows[0].querySelector('button').getAttribute('aria-pressed'),'true');
  rows[0].querySelectorAll('button')[1].click();assert.equal(located[1],true);
  rows[0].querySelectorAll('button')[2].click();assert.equal(measurements.length,1);assert.equal(measurements[0],n);assert.equal(context.selectedMeasurement,null);dom.window.close();
 });
 await test('Mediciones: localizar centra cámara y rechaza planos incompatibles',()=>{
  const dom=new JSDOM('<div class="pane" data-view-pane="3d"></div><input id="rx" value="2"><p id="measurementHint"></p>');
  const m={axis:null,a:new THREE.Vector3(2,2,2),b:new THREE.Vector3(4,4,4)};const camera={position:new THREE.Vector3(10,10,10)},controls={target:new THREE.Vector3(),update:()=>{}};
  let tool=null;const {fn,context}=run('locateMeasurement',{document:dom.window.document,Event:dom.window.Event,$:id=>dom.window.document.getElementById(id),measurements:[m],camera,controls,setTool:v=>tool=v,updateMeasurementList:()=>{},renderMeasure3D:()=>{},repaintAll:()=>{},paint:()=>{},slicePixelBasis:()=>({u:new THREE.Vector3(0,1,0),v:new THREE.Vector3(0,0,1),origin:new THREE.Vector3()}),viewStates:{},viewAppliers:{}});
  fn(m,true);assert.equal(tool,'editMeasure');assert.deepEqual(controls.target.toArray(),[3,3,3]);assert.deepEqual(camera.position.toArray(),[13,13,13]);assert.equal(context.selectedMeasurement,m);
  m.axis='x';m.index=5;fn(m);assert.equal(dom.window.document.getElementById('rx').value,'2');assert.match(dom.window.document.getElementById('measurementHint').textContent,/otra orientación/);dom.window.close();
 });
 await test('Mediciones: plano oblicuo se serializa, valida y recupera; compatibilidad anterior',()=>{
  const plane={pivot:[1,2,3],rotation:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.4).toArray(),shift:[4,5,6]};
  const items=[{axis:'z',index:3,a:[0,0,0],b:[1,2,3],plane,name:'Distancia al vaso',visible:false}];
  const validate=run('validateMeasurements',{$:()=>({max:20})}).fn;validate(items);assert.throws(()=>validate([{...items[0],visible:'false'}]),/Visibilidad/);assert.throws(()=>validate([{...items[0],name:'a'.repeat(61)}]),/Nombre/);assert.throws(()=>validate([{...items[0],name:42}]),/Nombre/);validate([{...items[0],name:undefined,plane:undefined}]);validate([{...items[0],plane:null}]);
  assert.throws(()=>validate([{...items[0],plane:{...plane,rotation:[0,0,0,0]}}]),/Orientación/);
  assert.throws(()=>validate([{...items[0],axis:null,index:null}]),/Orientación/);
  const measurements=[];const {fn,context}=run('restoreMeasurements',{measurements,updateMeasurementList:()=>{},renderMeasure3D:()=>{}},['measurementData']);fn(items);
  assert.deepEqual(JSON.parse(JSON.stringify(context.measurementData())),items);assert.notEqual(measurements[0].plane,plane);
  const restored=run('applyMeasurementPlane',{obliquePivot:null,obliqueRotation:new THREE.Quaternion(),obliqueShift:new THREE.Vector3(),obliqueActive:()=>true},['measurementPlaneState']);
  restored.fn(plane);assert.deepEqual(JSON.parse(JSON.stringify(restored.context.measurementPlaneState())),plane);
  restored.fn(null);assert.equal(restored.context.obliquePivot,null);assert.equal(restored.context.obliqueRotation.w,1);assert.deepEqual(restored.context.obliqueShift.toArray(),[0,0,0]);
 });
 await test('Anotaciones: lista compacta delega edición sin modificar texto',()=>{
  const dom=new JSDOM('<div id="modelAnnotationList"></div><p id="modelAnnotationEmpty"></p><p id="annotationHint"></p>');const item={kind:'label',text:'Original',color:'#ff0000',a:[1,2,3]},modelAnnotations=[item];let located=null,edited=null;
  const {fn}=run('renderAnnotationList',{document:dom.window.document,Event:dom.window.Event,$:id=>dom.window.document.getElementById(id),modelAnnotations,renderAnnotations:()=>{},locateAnnotation:v=>located=v,openAnnotationEditor:(draft,original)=>edited=original},['setTreeIcon']);fn();
  const card=dom.window.document.querySelector('.annotation-card');assert.equal(card.querySelector('textarea'),null);assert.equal(card.querySelector('strong').textContent,'Original');const toggle=card.querySelector('[type=checkbox]');toggle.click();assert.equal(item.visible,false);
  card.querySelector('[aria-label="Localizar Etiqueta 1"]').click();assert.equal(located,item);assert.equal(toggle.checked,true);
  card.querySelector('[aria-label="Editar Etiqueta 1"]').click();assert.equal(edited,item);assert.equal(item.text,'Original');dom.window.close();
 });
 await test('Anotaciones: colocar abre borrador; flecha necesita dos puntos diferentes',()=>{
  const modelAnnotations=[],message={};let draft=null;const {fn,context}=run('pickAnnotation',{modelAnnotations,$:()=>message,camera:{getWorldDirection:v=>v.set(0,0,-1)},activeTool:'annotation',annotationEditorColor:'#ff0000',pendingArrow:null,renderAnnotations:()=>{},openAnnotationEditor:d=>draft=d});
  fn(new THREE.Vector3(1,2,3));assert.equal(draft.kind,'label');assert.equal(draft.text,'');assert.equal(modelAnnotations.length,0);
  context.activeTool='arrow';draft=null;fn(new THREE.Vector3());assert.equal(draft,null);fn(new THREE.Vector3());assert.equal(draft,null);fn(new THREE.Vector3(1,0,0));assert.equal(draft.kind,'arrow');assert.deepEqual(Array.from(draft.a),[1,0,0]);assert.deepEqual(Array.from(draft.b),[0,0,0]);assert.equal(context.arrowPlacementPlane.distanceToPoint(new THREE.Vector3(5,8,0)),0);assert.equal(modelAnnotations.length,0);
 });
 await test('Anotaciones: localizar muestra y centra la flecha conservando la distancia de cámara',()=>{
  const dom=new JSDOM('<input id="showAnnotations" type="checkbox"><div id="modelAnnotationList"></div><p id="annotationHint"></p>');const item={kind:'arrow',a:[0,0,0],b:[4,6,8],visible:false};const camera={position:new THREE.Vector3(10,10,10)},controls={target:new THREE.Vector3(),update:()=>{}};
  const {fn,context}=run('locateAnnotation',{document:dom.window.document,Event:dom.window.Event,$:id=>dom.window.document.getElementById(id),modelAnnotations:[item],camera,controls,setTool:()=>{},renderAnnotations:()=>{}});fn(item);assert.equal(item.visible,true);assert.equal(context.selectedAnnotation,item);assert.deepEqual(controls.target.toArray(),[2,3,4]);assert.deepEqual(camera.position.toArray(),[12,13,14]);assert.equal(dom.window.document.getElementById('showAnnotations').checked,true);dom.window.close();
 });
 await test('Vistas: aviso de cambios, actualización y copia sin sobrescribir original',()=>{
  const dom=new JSDOM('<p id="activeSavedViewStatus"></p><div id="activeSavedViewState"></div><button id="updateActiveSavedView"></button><button id="saveAsNewView"></button><section id="casePresentation" hidden></section><dialog id="usDialog"></dialog><details id="newNamedView"></details><input id="namedViewName"><textarea id="namedViewNotes"></textarea>');const $=id=>dom.window.document.getElementById(id);
  let config={camera:{x:1},measurements:[]},writes=0;const view={name:'Vista A',notes:'Nota',config:structuredClone(config)};
  const {fn}=run('installSavedViewTracker',{document:dom.window.document,$,activeNamedView:view,namedViews:[view],namedCaseKey:'case',presentationCameraFlight:null,configData:()=>config,controls:{addEventListener:()=>{}},setTimeout:()=>1,clearTimeout:()=>{},persistNamedViews:()=>writes++,uniqueViewName:n=>n},['savedViewSignature']);const tracker=fn();tracker.accept(view);tracker.refresh();assert.match($('activeSavedViewStatus').textContent,/Sin cambios/);
  config.measurements.push({name:'Lesión',visible:false});tracker.refresh();assert.match($('activeSavedViewStatus').textContent,/Cambios sin guardar/);assert.equal($('updateActiveSavedView').disabled,false);
  $('saveAsNewView').click();assert.equal(view.config.measurements.length,0);assert.equal($('namedViewName').value,'Vista A · copia');
  $('updateActiveSavedView').click();assert.equal(writes,1);assert.equal(view.config.measurements.length,1);assert.match($('activeSavedViewStatus').textContent,/Sin cambios/);config.camera.x=4;tracker.refresh();assert.equal(view.config.camera.x,1);assert.equal($('updateActiveSavedView').disabled,false);dom.window.close();
 });
 await test('Vistas: comparación independiente de orden y ruido numérico',()=>{
  const signature=run('savedViewSignature').fn;assert.equal(signature({b:2,a:1}),signature({a:1,b:2}));assert.equal(signature({x:1}),signature({x:1+1e-9}));assert.notEqual(signature({x:1}),signature({x:1.01}));
 });
 await test('Ficha 3D: selección activa, múltiple, vacía y volumen no disponible',()=>{
  const elements=Object.fromEntries(['selectionCard','selectionCardCenter','selectionCardClear','selectionCardName','selectionCardDetail'].map(id=>[id,{}]));
  const selected=new Set(['A']);
  const layers=new Map([['A',{volumeML:12}],['B',{volumeML:null}]]);
  const {fn,context}=run('updateSelectionCard',{$:id=>elements[id],layerControls:layers,selectedStructures:selected,selectedStructure:'A',syncMprNavigation:()=>{},formatVolume:n=>n+' mL'});
  fn(); assert.equal(elements.selectionCard.hidden,false);assert.equal(elements.selectionCardName.textContent,'A');assert.match(elements.selectionCardDetail.textContent,/12 mL/);
  selected.add('B');fn();assert.match(elements.selectionCardName.textContent,/2 estructuras/);
  assert.match(elements.selectionCardDetail.textContent,/A \(activa\): 12 mL/);
  assert.match(elements.selectionCardDetail.textContent,/B: Volumen no disponible/);
  assert.match(elements.selectionCardDetail.textContent,/Subtotal calculable: 12 mL/);
  layers.get('B').volumeML=8;fn();assert.match(elements.selectionCardDetail.textContent,/Volumen total: 20 mL/);
  selected.delete('A');context.selectedStructure='B';fn();assert.equal(elements.selectionCardName.textContent,'B');assert.doesNotMatch(elements.selectionCardDetail.textContent,/A:/);
  layers.get('B').volumeML=null;
  context.selectedStructure='B';fn();assert.match(elements.selectionCardDetail.textContent,/no disponible/);
  selected.clear();fn();assert.equal(elements.selectionCard.hidden,true);assert.equal(elements.selectionCardCenter.disabled,true);assert.equal(elements.selectionCardName.textContent,'');
 });
 await test('Avisos de ventanas: cuatro segundos, reinicio y ocultación al seleccionar herramienta',()=>{
  const dom=new JSDOM('<p id="toolHint">Selecciona una estructura</p>');
  const indicators=[{indicator:{hidden:true}},{indicator:{hidden:true}}];
  const timers=new Map();let id=0;
  const {fn,context}=run('createPaneHintController',{document:dom.window.document,$:key=>dom.window.document.getElementById(key),activeTool:'select',hideStructureHover:()=>{},setTimeout:(f,ms)=>{assert.equal(ms,4000);timers.set(++id,f);return id;},clearTimeout:key=>timers.delete(key)});
  const refresh=fn(indicators);refresh();assert.ok(indicators.every(r=>!r.indicator.hidden));
  refresh();assert.equal(timers.size,1);
  [...timers.values()][0]();assert.ok(indicators.every(r=>r.indicator.hidden));
  refresh();dom.window.document.dispatchEvent(new dom.window.Event('mpr-tool-change'));
  assert.ok(indicators.every(r=>r.indicator.hidden));assert.equal(timers.size,0);
  context.activeTool='navigate';refresh();assert.equal(timers.size,0);
  context.activeTool='select';dom.window.document.getElementById('toolHint').textContent=' ';refresh();assert.equal(timers.size,0);
  dom.window.close();
 });
 await test('Navegación MPR: guarda y recupera cortes, zoom, referencia y orientación; aísla casos',()=>{
  const elements=Object.fromEntries(['saveMprPosition','restoreMprPosition','centerMprSelection','resetMprViews','navPoint','show3DMarker','rx','ry','rz'].map(id=>[id,{value:'3',max:'10',checked:true,textContent:'Posición guardada'}]));
  const views=Object.fromEntries(['x','y','z'].map(a=>[a,{zoom:2,x:10,y:-5}]));
  let paints=0,applied=0,fits=0;
  const {fn,context}=run('saveMprPosition',{$:id=>elements[id],volume:{},volumeInfo:{},volumeContentHash:'v1',modelContentHash:'m1',savedMprPosition:null,camera:{zoom:3},fit:()=>fits++,setTool:()=>{},selectedStructures:new Set(['A']),selectedStructure:'A',layerControls:new Map([['A',{}]]),viewStates:views,viewAppliers:Object.fromEntries(['x','y','z'].map(a=>[a,()=>applied++])),obliquePivot:new THREE.Vector3(1,2,3),obliqueRotation:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.4),obliqueShift:new THREE.Vector3(4,5,6),selectedWorldPoint:new THREE.Vector3(7,8,9),navMarker:{visible:true,position:new THREE.Vector3()},status:{},paint:()=>paints++,document:{dispatchEvent:()=>{}},Event:class{}},['mprPositionCaseKey','syncMprNavigation','restoreMprPosition','resetMprViews']);
  fn(); const saved=context.savedMprPosition;
  views.x.zoom=9;elements.rx.value='8';context.obliqueShift.set(0,0,0);
  context.restoreMprPosition();assert.equal(views.x.zoom,2);assert.equal(elements.rx.value,3);assert.deepEqual(context.obliqueShift.toArray(),[4,5,6]);assert.equal(paints,3);
  context.resetMprViews();assert.equal(views.x.zoom,1);assert.equal(views.x.x,0);assert.equal(elements.rx.value,5);assert.equal(context.obliqueRotation.equals(new THREE.Quaternion()),true);assert.equal(context.obliquePivot,null);assert.deepEqual(context.obliqueShift.toArray(),[0,0,0]);assert.equal(context.selectedWorldPoint,null);assert.equal(context.navMarker.visible,false);assert.equal(context.camera.zoom,1);assert.equal(fits,1);assert.equal(applied,6);assert.ok(context.selectedStructures.has('A'));assert.equal(context.savedMprPosition,saved);
  context.modelContentHash='m2';context.restoreMprPosition();assert.equal(context.savedMprPosition,null);assert.equal(elements.restoreMprPosition.disabled,true);
 });
 await test('Centrado MPR conserva cámara 3D y selección',()=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2));let focused=0;const message={};
  const rect=()=>({left:0,top:0,width:100,height:100});
  const elements={};for(const a of ['x','y','z']){elements['r'+a]={max:10};elements['ct'+a]={width:100,parentElement:{getBoundingClientRect:rect},getBoundingClientRect:rect};}
  const {fn}=run('focusStructure',{$:id=>elements[id],volume:{},volumeInfo:{},layerControls:new Map([['A',{items:[{mesh}]}]]),model:{updateWorldMatrix:()=>{}},physicalCoordinateAt:(a,i)=>i===0?-10:10,selectedStructures:new Set(['A']),viewStates:Object.fromEntries(['x','y','z'].map(a=>[a,{x:0,y:0}])),viewAppliers:{x:()=>{},y:()=>{},z:()=>{}},applyReferencePoint:()=>focused++,worldToPixel:()=>({x:50,y:50}),slicePixelBasis:()=>({}),camera:new Proxy({},{get(){throw Error('Camera touched')}}),status:message,document:{dispatchEvent:()=>{}},Event:class{}});
  fn('A',false,false,true);assert.equal(focused,1);assert.match(message.textContent,/Cámara 3D conservada/);
 });
 await test('Iconos: categorías por nombre original, acentos, inglés y prioridades',()=>{
  const classify=run('suggestedStructureIcon').fn;
  for(const [name,icon] of [['Vena porta','vein'],['portal_vein','vein'],['renal artery','artery'],['lesión junto a vena porta','lesion'],['Tumour','lesion'],['metástasis','lesion'],['HÍGADO','liver'],['Riñón izquierdo','kidney'],['lung_right','lung'],['vértebra L3','bone'],['RIB_02','bone'],['Segmento 7','generic']]) assert.equal(classify(name),icon,name);
 });
 await test('Barra común: conserva controles, acciones, opciones locales y acceso por teclado',()=>{
  const dom=new JSDOM(html);const document=dom.window.document,$=id=>document.getElementById(id);dom.window.HTMLElement.prototype.scrollIntoView=()=>{};let action=0;
  const position=$('saveMprPosition');position.onclick=()=>action++;
  const menus=[...document.querySelectorAll('.views > .pane')].map((pane,i)=>{
    const toolbar=document.createElement('div');toolbar.className='pane-quick-tools';
    for(const tool of ['navigate','select','zoom','window','measure2d','measure3d','editMeasure','deleteMeasure','threePoints','oblique','trajectory','cut']){const b=document.createElement('button');b.dataset.tool=tool;b.onclick=()=>action++;toolbar.append(b);}
    const center=document.createElement('button');center.setAttribute('aria-label','Centrar');toolbar.append(center);
    const panel=document.createElement('div'),trigger=document.createElement('button'),maximize=document.createElement('button');panel.className='pane-menu';panel.hidden=true;pane.append(toolbar,panel,trigger);
    return {pane,toolbar,panel,trigger,maximize,sceneView:i===3};
  });
  const {fn,context}=run('organizeViewerTools',{document,$,activeTool:'navigate',centerAllViews:()=>{},resetMprViews:()=>{},create3DSliceControls:()=>document.createElement("section"),highlightSidebarSection:()=>{},button:(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.onclick=fn;return b;}},['setTreeIcon','syncActiveToolLabel','openSidebarSection']);
  fn(menus);
  assert.equal(document.querySelectorAll('.pane-quick-tools').length,0);
  assert.equal(document.querySelectorAll('.pane-maximize').length,4);
  assert.equal(document.querySelectorAll('#viewerTools [data-tool="select"]').length,1);
  assert.ok($('section-case').closest('#headerCaseActions'));assert.equal($('section-case').closest('#generalPanel'),null);assert.equal($('section-case').querySelector('summary').textContent,'Abrir');assert.equal($('caseLocalFiles').hidden,false);
  assert.equal($('saveMprPosition'),position);position.disabled=false;position.click();assert.equal(action,1);
  assert.ok($('menu-scene').closest('#section-visual'));
  assert.deepEqual([...$('section-toolbox').querySelector('.sidebar-body').children].map(el=>el.id),['section-visual','section-tools','section-trajectory']);
  assert.ok($('section-toolbox').querySelector(':scope > summary svg[aria-hidden="true"]'));
  for(const id of ['section-visual','section-tools','section-trajectory']){assert.equal($(id).className,'sidebar-subgroup');assert.ok($(id).querySelector(':scope > summary svg'));}
  assert.equal($('section-toolbox').open,false);context.openSidebarSection('menu-annotations');assert.equal($('section-toolbox').open,true);
  assert.ok($('addModelLabel').closest('#viewerTools'));
  assert.deepEqual([...document.querySelectorAll('.shared-tool-family')].map(el=>el.getAttribute('aria-label')),['Planos y orientación','Apariencia','Referencias','Trayectoria y ecografía','Capturas e informe']);
  assert.equal(document.querySelector('#viewerTools [data-tool="trajectory"]').closest('section').getAttribute('aria-label'),'Trayectoria y ecografía');
  assert.equal(document.querySelectorAll('.pane-menu').length,1);assert.equal(document.querySelectorAll('.pane-menu-trigger').length,1);menus[3].trigger.click();assert.equal(menus[3].panel.hidden,false);menus[3].trigger.click();assert.equal(menus[3].panel.hidden,true);assert.ok($('centerAllViews').closest('#viewerTools'));
  assert.equal([...document.querySelectorAll('.shared-tool-family')].find(el=>el.getAttribute('aria-label')==='Apariencia').querySelector('button').textContent,'Ajustes de imagen MPR');
  const drop=document.querySelector('#viewerTools .shared-dropdown');drop.open=true;
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(drop.open,false);
  dom.window.close();
 });
 await test('Barra común: plegar no oculta cabeceras ni cambia la herramienta activa',()=>{
  const dom=new JSDOM('<button id="togglePaneHeaders"></button><nav id="viewerTools"><details open><summary>Medir</summary></details></nav><section class="pane"><h2>Axial</h2></section>');
  const document=dom.window.document,$=id=>document.getElementById(id);let resized=0;
  const {fn}=run('toggleViewerTools',{document,$,resize3D:()=>resized++,repaintAll:()=>{}});
  fn();assert.equal($('viewerTools').hidden,true);assert.equal($('togglePaneHeaders').getAttribute('aria-expanded'),'false');assert.equal($('viewerTools').querySelector('details').open,false);
  assert.equal(document.body.classList.contains('pane-headers-collapsed'),false);assert.equal(document.querySelector('.pane h2').hidden,false);
  fn();assert.equal($('viewerTools').hidden,false);assert.equal($('togglePaneHeaders').getAttribute('aria-label'),'Ocultar barra de herramientas');assert.equal(resized,2);dom.window.close();
 });
 await test('Carga: oculta el éxito tras diez segundos, conserva errores y cancela al empezar otra carga',()=>{
  const dom=new JSDOM('<div id="loadingPanel"><div id="loadingTrack"><div id="loadingFill"></div></div><span id="loadingTitle"></span><span id="loadingDetail"></span></div>');
  const $=id=>dom.window.document.getElementById(id), timers=new Map();let id=0;
  const {fn,context}=run('finishProgress',{$,progressPanel:$('loadingPanel'),progressTrack:$('loadingTrack'),progressFill:$('loadingFill'),progressDismissTimer:null,setTimeout:(fn,ms)=>{assert.equal(ms,10000);timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key)},['showProgress']);
  fn(true,'Preparado');assert.equal(timers.size,1);assert.equal($('loadingPanel').hidden,false);
  [...timers.values()][0]();assert.equal($('loadingPanel').hidden,true);timers.clear();
  fn(true);context.showProgress('Nueva carga',.2);assert.equal(timers.size,0);assert.equal($('loadingPanel').hidden,false);
  fn(true);fn(false,'Error');assert.equal(timers.size,0);assert.equal($('loadingPanel').hidden,false);assert.equal($('loadingTitle').textContent,'Error de carga');
  dom.window.close();
 });
 await test('Distribución inicial: nueva cabecera y grupos están en HTML antes de ejecutar módulos',()=>{
  const dom=new JSDOM(html),document=dom.window.document;
  assert.ok(document.querySelector('#viewerTools[aria-busy="true"][inert]'));
  assert.ok(document.querySelector('#headerCaseActions #section-case'));
  assert.equal(document.querySelector('#generalPanel #section-case'),null);
  assert.deepEqual([...document.querySelector('#section-toolbox > .sidebar-body').children].map(n=>n.id),['section-visual','section-tools','section-trajectory']);
  assert.equal(document.querySelector('#section-visual > summary').textContent,'Apariencia y referencia');
  assert.equal(document.querySelector('#section-tools > summary').textContent,'Mediciones y anotaciones');
  assert.ok(document.querySelector('#mprNavigation[hidden]'));dom.window.close();
 });
 await test('Centrar todo conserva zoom, orientación y cortes, desplazando solo el encuadre',()=>{
  const states=Object.fromEntries(['x','y','z'].map(a=>[a,{zoom:2,x:40,y:-20}]));
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2));mesh.position.set(10,20,30);
  const camera={position:new THREE.Vector3(50,60,70),up:new THREE.Vector3(0,0,1),zoom:3};
  const controls={target:new THREE.Vector3(0,0,0),update:()=>{}};
  const {fn}=run('centerAllViews',{viewStates:states,viewAppliers:{x:()=>{},y:()=>{},z:()=>{}},model:mesh,planesRoot:{children:[]},camera,controls,status:{},document:{dispatchEvent:()=>{}},Event:class{}});
  fn();assert.deepEqual(camera.position.toArray(),[60,80,100]);assert.deepEqual(controls.target.toArray(),[10,20,30]);assert.equal(camera.zoom,3);assert.deepEqual(camera.up.toArray(),[0,0,1]);
  for(const a of ['x','y','z'])assert.deepEqual(states[a],{zoom:2,x:0,y:0});
 });
 await test('Panel lateral: resalta cuatro segundos solo la sección abierta y reinicia el aviso',()=>{
  const dom=new JSDOM('<details id="a"><summary>A</summary></details><details id="b"><summary>B</summary></details>');
  const document=dom.window.document,timers=new Map();let id=0;
  const {fn}=run('highlightSidebarSection',{document,setTimeout:(fn,ms)=>{assert.equal(ms,4000);timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key)});
  const a=document.getElementById('a'),b=document.getElementById('b');
  fn(a);assert.equal(a.classList.contains('sidebar-highlight'),true);
  fn(b);assert.equal(a.classList.contains('sidebar-highlight'),false);assert.equal(b.classList.contains('sidebar-highlight'),true);assert.equal(timers.size,1);
  fn(b);assert.equal(timers.size,1);[...timers.values()][0]();assert.equal(b.classList.contains('sidebar-highlight'),false);dom.window.close();
 });
 await test('Recorte TC: sigue los tres ejes con coordenadas RAS anisótropas y orientación oblicua',()=>{
  const elements={rx:{value:2},ry:{value:3},rz:{value:4}};
  const volume={extractPerpendicularPlane:(axis,index)=>({sliceAccess:(i,j)=>axis==='x'?[index,i,j]:axis==='y'?[i,index,j]:[i,j,index]}),reverseAccess:v=>v};
  const {fn,context}=run('tcClipGeometry',{$:id=>elements[id],volume,volumeInfo:{originRAS:[10,20,30],directionsRAS:[[2,0,0],[0,-3,0],[0,0,4]]},obliqueActive:()=>false,obliquePivot:new THREE.Vector3(1,2,3),obliqueRotation:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.4),obliqueShift:new THREE.Vector3(5,6,7)});
  for(const [axis,value] of [['x',14],['y',11],['z',46]]){const g=fn(axis);assert.ok(Math.abs(g.normal[axis]-1)<1e-10);assert.equal(g.point[axis],value);}
  const base=fn('z');context.obliqueActive=()=>true;const tilted=fn('z');
  const expected=base.point.clone().sub(context.obliquePivot).applyQuaternion(context.obliqueRotation).add(context.obliquePivot).add(context.obliqueShift);
  assert.ok(tilted.point.distanceTo(expected)<1e-10);assert.ok(tilted.normal.distanceTo(base.normal.applyQuaternion(context.obliqueRotation))<1e-10);
  elements.rz.value=6;assert.ok(Math.abs(fn('z').point.distanceTo(tilted.point)-8)<1e-10);
 });
 await test('Recorte TC: inversión de lado, bloqueo manual y retorno al recorte independiente',()=>{
  const ids=['clipSyncTc','clipPosition','rotateClip','clipRotationConstraint','clipLeft','clipRight','clipUp','clipDown','alignClip','resetClipRotation','clipEnabled','clipAxis','clipReverse'];
  const elements=Object.fromEntries(ids.map(id=>[id,{checked:false,value:50,disabled:false}]));elements.clipSyncTc.checked=true;elements.clipEnabled.checked=true;elements.clipAxis.value='z';
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(10,10,10),new THREE.MeshStandardMaterial());let paints=0;
  const {fn,context}=run('updateClip',{$:id=>elements[id],model:mesh,volume:{},volumeInfo:{},clipPlane:null,clipRotation:new THREE.Quaternion(),clipGuide:new THREE.Object3D(),activeTool:'rotateClip',batchRestore:false,invalidateStructureNames:()=>{},paint:()=>paints++,tcClipGeometry:()=>({point:new THREE.Vector3(0,0,2),normal:new THREE.Vector3(0,0,1)})});
  fn({repaint:false});assert.equal(paints,0);assert.equal(elements.clipPosition.disabled,true);assert.equal(context.clipGuide.visible,false);assert.equal(context.clipPlane.distanceToPoint(new THREE.Vector3(0,0,2)),5);assert.equal(context.clipPlane.distanceToPoint(new THREE.Vector3(0,0,-3)),0);assert.ok(context.clipPlane.distanceToPoint(new THREE.Vector3(0,0,-4))<0);
  elements.clipReverse.checked=true;fn({repaint:false});assert.equal(context.clipPlane.distanceToPoint(new THREE.Vector3(0,0,2)),5);assert.equal(context.clipPlane.distanceToPoint(new THREE.Vector3(0,0,7)),0);assert.ok(context.clipPlane.distanceToPoint(new THREE.Vector3(0,0,8))<0);
  elements.clipSyncTc.checked=false;elements.clipReverse.checked=false;fn();assert.equal(elements.clipPosition.disabled,false);assert.equal(elements.rotateClip.disabled,false);assert.equal(paints,3);assert.ok(Math.abs(context.clipPlane.constant)<1e-10);
 });
 await test('Planos TC en 3D: controles reflejan cortes MPR, límites y disponibilidad',async()=>{
  const dom=new JSDOM('<input type="range" id="rx" min="0" max="10" value="3"><input type="range" id="ry" min="0" max="20" value="4"><input type="range" id="rz" min="0" max="30" value="5"><input type="checkbox" id="planes" checked><input type="checkbox" id="planeX" checked><input type="checkbox" id="planeY" checked><input type="checkbox" id="planeZ" checked>');
  const document=dom.window.document,$=id=>document.getElementById(id);let inputs=0;
  $('rz').oninput=()=>inputs++;
  const {fn,context}=run('create3DSliceControls',{document,$,MutationObserver:dom.window.MutationObserver,Event:dom.window.Event},['sync3DSliceControl','syncPaneToggles']);
  document.body.append(fn());
  const axial=document.querySelector('.scene-slice-controls button[data-pane-toggle="planeZ"]');assert.equal(axial.textContent,'Axial');assert.equal(axial.getAttribute('aria-pressed'),'true');axial.click();assert.equal($('planeZ').checked,false);assert.equal(axial.getAttribute('aria-pressed'),'false');axial.click();assert.equal($('planeZ').checked,true);assert.equal(document.querySelectorAll('.scene-slice-controls button').length,3);
  assert.equal($('sceneSlicez').max,'30');assert.equal($('sceneSlicez').value,'5');
  $('sceneSlicez').value='12';$('sceneSlicez').dispatchEvent(new dom.window.Event('input'));assert.equal($('rz').value,'12');assert.equal(inputs,1);assert.equal($('sceneSliceValuez').textContent,'12');
  $('rz').value='8';context.sync3DSliceControl('z');assert.equal($('sceneSlicez').value,'8');
  $('rx').disabled=true;$('ry').max='40';await new Promise(r=>setTimeout(r,0));assert.equal($('sceneSlicex').disabled,true);assert.equal($('sceneSliceValuex').textContent,'—');assert.equal($('sceneSlicey').max,'40');dom.window.close();
 });
 await test('Repintado MPR: agrupa entradas por fotograma, conserva el último valor y descarta otro caso',()=>{
  const frames=new Map(),painted=[];let id=0,clips=0;const inputs={z:3,x:1};
  const {fn,context}=run('scheduleSlicePaint',{slices:{},pendingSliceFrame:null,pendingSliceTarget:null,pendingSliceAxes:new Set(),batchRestore:false,$:()=>({checked:false}),model:{},volumeInfo:{},requestAnimationFrame:f=>{frames.set(++id,f);return id;},cancelAnimationFrame:key=>frames.delete(key),updateClip:()=>clips++,paint:(axis,options)=>painted.push({axis,value:inputs[axis],options})});
  const flush=()=>{const [key,callback]=frames.entries().next().value;frames.delete(key);callback();};
  fn('z');inputs.z=9;fn('z');fn('x');assert.equal(frames.size,1);flush();assert.deepEqual(painted.map(p=>[p.axis,p.value]),[['z',9],['x',1]]);assert.equal(painted[0].options.reuseImage,true);assert.equal(context.pendingSliceTarget,null);
  painted.length=0;context.$=()=>({checked:true});fn('z');flush();assert.equal(clips,1);assert.deepEqual(painted.map(p=>p.axis),['x','y','z']);
  painted.length=0;fn('z');context.slices={};fn('x');assert.equal(frames.size,1);context.$=()=>({checked:false});flush();assert.deepEqual(painted.map(p=>p.axis),['x']);
  painted.length=0;fn('z');context.slices={};flush();assert.equal(painted.length,0);
 });
 await test('Raster MPR: reutiliza solo imágenes válidas e invalida corte, ventana, umbral, volumen y oblicuidad',()=>{
  let count=0,resamples=0;const slider={value:1},volume={data:new Uint8Array(8),windowLow:0,windowHigh:100,lowerThreshold:0,upperThreshold:100};
  const slice={mesh:new THREE.Object3D(),repaint:()=>count++};
  const {fn,context}=run('updateSliceRaster',{$:()=>slider,slices:{z:slice},volume,volumeInfo:{},obliqueActive:()=>false,obliquePivot:new THREE.Vector3(),obliqueRotation:new THREE.Quaternion(),obliqueShift:new THREE.Vector3(),slicePixelBasis:()=>({}),resampleOblique:()=>resamples++});
  fn('z');fn('z',true);assert.equal(count,1);slider.value=2;fn('z',true);assert.equal(count,2);
  volume.windowHigh=200;fn('z',true);volume.lowerThreshold=10;fn('z',true);volume.data=new Uint8Array(8);fn('z',true);context.volumeInfo={};fn('z',true);assert.equal(count,6);
  context.obliqueActive=()=>true;fn('z',true);fn('z',true);assert.equal(resamples,1);
  context.obliqueRotation.setFromAxisAngle(new THREE.Vector3(0,1,0),.2);fn('z',true);assert.equal(resamples,2);
  context.obliqueShift.x=4;fn('z',true);assert.equal(resamples,3);
  context.obliqueActive=()=>false;fn('z',true);assert.equal(count,10);
  fn('z');assert.equal(count,11);
 });
 await test('Escena 3D: no renderiza en reposo, reacciona a cambios y mantiene animaciones y etiquetas pendientes',()=>{
  let renders=0,updates=0,labels=0;
  const {fn,context}=run('renderSceneFrame',{sceneRenderDirty:true,presentationCameraFlight:null,controls:{update:()=>updates++},$:()=>({checked:false}),modelRoot:{visible:true},structureLabelView:{layoutDirty:false},updateStructureNames:()=>labels++,updateAnnotationScale:()=>{},renderer:{render:()=>renders++},scene:{},camera:{}},['requestSceneRender']);
  assert.equal(fn(),true);assert.equal(fn(),false);assert.equal(renders,1);assert.equal(updates,2);
  context.requestSceneRender();assert.equal(fn(),true);assert.equal(renders,2);
  context.presentationCameraFlight={};assert.equal(fn(),true);assert.equal(fn(),true);assert.equal(renders,4);
  context.presentationCameraFlight=null;context.$=()=>({checked:true});context.structureLabelView.layoutDirty=true;assert.equal(fn(),true);assert.equal(labels,5);
  context.structureLabelView.layoutDirty=false;assert.equal(fn(),false);
 });
 await test('Remuestreo oblicuo: reutiliza el buffer, limpia píxeles exteriores y cambia al redimensionar',()=>{
  let allocations=0,last;
  const ctx={createImageData:(width,height)=>{allocations++;return {width,height,data:new Uint8ClampedArray(width*height*4)};},putImageData:image=>last=image};
  const canvas={width:1,height:1,getContext:()=>ctx};
  const {fn}=run('resampleVolume',{resampleBuffers:new WeakMap(),volumeInfo:{directionsRAS:[[1,0,0],[0,1,0],[0,0,1]],originRAS:[0,0,0],sizes:[2,2,2]},volume:{windowLow:0,windowHigh:100,data:new Uint8Array(8).fill(100)}},['resampleImageData']);
  const basis={origin:new THREE.Vector3(0,0,0),u:new THREE.Vector3(1,0,0),v:new THREE.Vector3(0,1,0),sx:1,sy:1};
  fn(canvas,basis);const first=last;assert.deepEqual([...last.data],[255,255,255,255]);
  basis.origin.x=-2;fn(canvas,basis);assert.equal(allocations,1);assert.equal(last,first);assert.deepEqual([...last.data],[0,0,0,255]);
  canvas.width=2;fn(canvas,basis);assert.equal(allocations,2);assert.notEqual(last,first);
 });
 await test('Contornos: reutiliza vértices mundiales y conserva intersecciones al transformar o editar geometría',()=>{
  const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(2,0,0),new THREE.Vector3(0,2,0)]);geometry.setIndex([0,1,2]);
  const mesh=new THREE.Mesh(geometry);mesh.position.set(10,20,30);mesh.updateWorldMatrix(true,true);
  const {fn,context}=run('meshPlaneSegments',{meshVertexBuffers:new WeakMap(),tmpV1:new THREE.Vector3(),tmpV2:new THREE.Vector3(),tmpV3:new THREE.Vector3()},['meshPlaneVertices']);
  const project=p=>({x:p.x,y:p.y});let segments=fn(mesh,new THREE.Plane(new THREE.Vector3(1,0,0),-10.5),project);
  assert.equal(segments.length,1);assert.deepEqual(Array.from(segments[0],p=>[p.x,p.y]),[[10.5,20],[10.5,21.5]]);
  const first=context.meshPlaneVertices(mesh);assert.equal(context.meshPlaneVertices(mesh),first);
  mesh.position.x=11;mesh.updateWorldMatrix(true,true);assert.notEqual(context.meshPlaneVertices(mesh),first);
  mesh.position.x=10;geometry.attributes.position.setXYZ(1,4,0,0);geometry.attributes.position.needsUpdate=true;mesh.updateWorldMatrix(true,true);
  segments=fn(mesh,new THREE.Plane(new THREE.Vector3(1,0,0),-10.5),project);assert.deepEqual(Array.from(segments[0],p=>[p.x,p.y]),[[10.5,20],[10.5,21.75]]);
 });
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
        syncMprNavigation: () => {},
        updateStructureSelection: () => context.syncTreeRows(),
        focusStructure: (...args) => focusCalls.push(args),
      }, [
        'structureIconOptions', 'suggestedStructureIcon', 'structureCategoryIcon', 'redoTreeChange', 'undoTreeChange', 'indexStructureNodes', 'validateNodes', 'validateTree', 'validateStructureRelations',
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

  await test('Árbol: iconos editables conservan color, JSON, deshacer y compatibilidad anterior', withTree(({context, $, layerControls}) => {
    context.applyNodes([group('g'),{...segment('a','A','g'),name:'Alias'}],{persist:false});
    const icon=()=> $('structureTree').querySelector('[data-node="a"] .structure-category-icon');
    assert.equal(icon().dataset.category,'generic');
    const color=layerControls.get('A').picker.value;
    context.treeEditing=true;context.renderTree();
    const actions=$('structureTree').querySelector('[data-node="a"] select');actions.value='icon';actions.onchange();
    $('nodeCategoryIcon').value='vein';
    [...$('groupEditor').querySelectorAll('button')].find(b=>b.textContent==='Guardar').click();
    assert.equal(icon().dataset.category,'vein');assert.equal(layerControls.get('A').picker.value,color);
    const exported=JSON.parse(JSON.stringify(context.exportStructureTree()));
    context.importStructureTree(exported);assert.equal(context.treeIndex.byId.get('a').icon,'vein');
    assert.throws(()=>context.applyNodes([{...segment('bad','B'),icon:'<script>'}]),/Nodo inválido/);
    context.applyNodes(context.structureNodes.map(n=>n.id==='a'?{...n,icon:'lesion'}:n));
    context.undoTreeChange();assert.equal(icon().dataset.category,'vein');
    delete exported.nodes.find(n=>n.id==='a').icon;
    context.importStructureTree(exported);assert.equal(icon().dataset.category,'generic');
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
