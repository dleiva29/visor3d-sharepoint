const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{JSDOM}=require('jsdom');
const api=import(pathToFileURL(path.join(__dirname,'../tools/ct-plane-drag.js')));
test('Proyección de arrastre: dirección, límite y eje casi frontal',async()=>{const {projectedSliceIndex:f}=await api;assert.equal(f(10,20,10,{x:2,y:1},0,100),20);assert.equal(f(10,20,0,{x:-2,y:0},0,100),0);assert.equal(f(10,1000,0,{x:2,y:0},0,30),30);assert.equal(f(10,100,100,{x:.01,y:.01},0,30),10);assert.equal(f(10,0,20,{x:2,y:0},0,30),10);});
test('Arrastre bloquea cámara; Escape restaura índice y estado de cámara',async()=>{
 const dom=new JSDOM('<button id="toggle"></button><div id="host"></div>'),d=dom.window.document;let index=10,orbit=true;
 const {installCtPlaneDrag}=await api;
 const c=installCtPlaneDrag({document:d,host:d.getElementById('host'),toggle:d.getElementById('toggle'),frame:()=>({visible:true,index,min:0,max:50,x:20,y:20,vector:{x:2,y:0}}),setIndex:(_,v)=>index=v,orbit:{get:()=>orbit,set:v=>orbit=v},activate:()=>{},hint:()=>{}});
 d.getElementById('toggle').click();const b=d.querySelector('.ct-plane-handle');b.setPointerCapture=()=>{};b.hasPointerCapture=()=>false;
 const pointer=(type,x)=>b.dispatchEvent(new dom.window.MouseEvent(type,{button:0,clientX:x,clientY:10,bubbles:true}));
 pointer('pointerdown',10);assert.equal(orbit,false);pointer('pointermove',30);assert.equal(index,20);
 d.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(index,10);assert.equal(orbit,true);assert.equal(c.dragging,false);
 b.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(index,11);
 d.dispatchEvent(new dom.window.Event('mpr-tool-change'));assert.ok(b.hidden);dom.window.close();
});
test('ESLint del arrastre TC',async()=>{const {ESLint}=require('eslint'),globals=require('globals');const lint=new ESLint({overrideConfigFile:true,overrideConfig:{languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:globals.browser},rules:{'no-undef':'error','no-unused-vars':['error',{args:'none'}]}}});const [r]=await lint.lintText(fs.readFileSync(path.join(__dirname,'../tools/ct-plane-drag.js'),'utf8'),{filePath:'drag.js'});assert.equal(r.errorCount,0,JSON.stringify(r.messages));});
