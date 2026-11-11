const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
const api=import(pathToFileURL(path.join(__dirname,'../tools/view-layout.js')));
test('Distribución: datos antiguos, incompletos o inválidos conservan al menos una vista',async()=>{
 const {normaliseViewLayout:n}=await api;
 assert.deepEqual(n(),{order:['axial','coronal','sagittal','3d'],visible:['axial','coronal','sagittal','3d'],x:.5,y:.5});
 for(const visible of [[],null,42,{includes:3},['unknown']])assert.equal(n({visible}).visible.length,4);
 assert.deepEqual(n({visible:['3d','3d','unknown'],x:2,y:-1}),{order:['axial','coronal','sagittal','3d'],visible:['3d'],x:.75,y:.25});
 assert.equal(n({x:'0.7',y:NaN}).x,.5);
});
async function fixture(){
 const {installViewLayout,viewIds}=await api;
 const dom=new JSDOM(`<body><details id="viewLayoutMenu"><summary>Vistas</summary><div></div></details><div class="views">${viewIds.map(id=>`<section class="pane" data-view-pane="${id}"><h2>${id}</h2></section>`).join('')}</div></body>`,{pretendToBeVisual:true});
 let blocked=false;
 const controller=installViewLayout({document:dom.window.document,refresh:()=>{},blocked:()=>blocked});
 return{dom,d:dom.window.document,controller,block:()=>blocked=true};
}
test('Ocultar, recuperar y proteger última vista; bloquear durante US',async()=>{
 const f=await fixture(),buttons=f.d.querySelectorAll('.pane-hide');
 for(let i=0;i<3;i++)buttons[i].click();assert.deepEqual(f.controller.capture().visible,['3d']);assert.ok(buttons[3].disabled);
 buttons[3].click();assert.deepEqual(f.controller.capture().visible,['3d']);
 const check=f.d.querySelector('input');check.checked=true;check.dispatchEvent(new f.dom.window.Event('change'));assert.deepEqual(f.controller.capture().visible,['axial','3d']);
 f.block();buttons[0].click();assert.deepEqual(f.controller.capture().visible,['axial','3d']);f.dom.window.close();
});
test('Separador por teclado, captura y aplicación no comparten arrays',async()=>{
 const f=await fixture(),divider=f.d.querySelector('.divider-x');
 divider.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(f.controller.capture().x,.52);
 const saved=f.controller.capture();saved.visible.pop();assert.equal(f.controller.capture().visible.length,4);
 f.controller.apply(saved);assert.equal(f.controller.capture().visible.length,3);
 divider.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Home'}));assert.equal(f.controller.capture().x,.5);f.dom.window.close();
});
test('ESLint del controlador de distribución',async()=>{const {ESLint}=require('eslint'),globals=require('globals');const lint=new ESLint({overrideConfigFile:true,overrideConfig:{languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:globals.browser},rules:{'no-undef':'error','no-unused-vars':['error',{args:'none'}]}}});const [r]=await lint.lintText(fs.readFileSync(path.join(__dirname,'../tools/view-layout.js'),'utf8'),{filePath:'layout.js'});assert.equal(r.errorCount,0,JSON.stringify(r.messages));});
test('Maximizar una vista oculta la recupera sin dejarla invisible',async()=>{
 const f=await fixture();f.controller.apply({visible:['3d'],x:.6,y:.4});
 const axial=f.d.querySelector('[data-view-pane="axial"]');axial.classList.add('maximized');
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(f.controller.capture().visible.includes('axial'));assert.equal(axial.dataset.layoutHidden,'false');f.dom.window.close();
});
test('Orden: repara duplicados e identificadores desconocidos y respeta visibilidad',async()=>{
 const {normaliseViewLayout:n}=await api;
 const state=n({order:['3d','unknown','3d','sagittal'],visible:['axial','3d']});
 assert.deepEqual(state.order,['3d','sagittal','axial','coronal']);assert.deepEqual(state.visible,['3d','axial']);
});
test('Teclado intercambia vistas y captura recupera el orden; maximizada no se reordena',async()=>{
 const f=await fixture(),h=f.d.querySelector('[data-view-pane="axial"] h2');
 h.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true}));
 assert.deepEqual(f.controller.capture().order,['coronal','axial','sagittal','3d']);
 const saved=f.controller.capture();f.controller.apply();f.controller.apply(saved);
 assert.equal(f.d.querySelector('.views > .pane').dataset.viewPane,'coronal');
 h.parentElement.classList.add('maximized');h.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true}));assert.deepEqual(f.controller.capture().order,saved.order);f.dom.window.close();
});
test('Arrastrar intercambia al soltar; Escape cancela sin cambiar el orden',async()=>{
 const f=await fixture(),h=f.d.querySelector('[data-view-pane="axial"] h2'),target=f.d.querySelector('[data-view-pane="3d"]');
 h.setPointerCapture=()=>{};h.hasPointerCapture=()=>false;f.d.elementFromPoint=()=>target;
 const pointer=(type,x)=>h.dispatchEvent(new f.dom.window.MouseEvent(type,{button:0,clientX:x,clientY:0,bubbles:true}));
 pointer('pointerdown',0);pointer('pointermove',50);assert.ok(target.classList.contains('view-drop-target'));
 f.d.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(f.controller.capture().order[0],'axial');assert.equal(target.classList.contains('view-drop-target'),false);
 pointer('pointerdown',0);pointer('pointermove',50);pointer('pointerup',50);assert.equal(f.controller.capture().order[0],'3d');assert.equal(f.controller.capture().order[3],'axial');f.dom.window.close();
});
