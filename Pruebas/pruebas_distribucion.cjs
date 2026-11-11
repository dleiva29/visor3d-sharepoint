const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
const api=import(pathToFileURL(path.join(__dirname,'../tools/view-layout.js')));
test('Distribución: datos antiguos, incompletos o inválidos conservan al menos una vista',async()=>{
 const {normaliseViewLayout:n}=await api;
 assert.deepEqual(n(),{visible:['axial','coronal','sagittal','3d'],x:.5,y:.5});
 for(const visible of [[],null,42,{includes:3},['unknown']])assert.equal(n({visible}).visible.length,4);
 assert.deepEqual(n({visible:['3d','3d','unknown'],x:2,y:-1}),{visible:['3d'],x:.75,y:.25});
 assert.equal(n({x:'0.7',y:NaN}).x,.5);
});
async function fixture(){
 const {installViewLayout,viewIds}=await api;
 const dom=new JSDOM(`<body><details id="viewLayoutMenu"><summary>Vistas</summary><div></div></details><div class="views">${viewIds.map(id=>`<section class="pane" data-view-pane="${id}"></section>`).join('')}</div></body>`,{pretendToBeVisual:true});
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
