const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
async function fixture({storage,ask,confirm,alert}={}){
 const dom=new JSDOM(`<body><select id="workspacePreset"><option value="">Personalizado</option><option value="exploration">Exploración</option><option value="measurement">Medición</option><option value="presentation">Presentación</option></select><button id="saveWorkspace"></button><button id="updateWorkspace" disabled></button><button id="deleteWorkspace" disabled></button><button id="restoreWorkspace" disabled></button><span id="workspaceMessage"></span><span id="workspacePresentationActions" hidden></span><nav id="viewerTools"></nav><aside id="generalPanel"><details class="sidebar-subgroup" id="section-structures" open></details><details class="sidebar-subgroup" id="section-toolbox"><details class="sidebar-subgroup" id="section-tools"><details class="sidebar-subgroup" id="menu-measurements"></details></details></details><details class="sidebar-subgroup" id="other" open></details></aside></body>`);
 const d=dom.window.document;let blocked=false,refreshes=0;
 const {installWorkspacePresets}=await import(pathToFileURL(path.join(__dirname,'../tools/workspace-presets.js')));
 installWorkspacePresets({document:d,setPanelFolded:v=>d.body.classList.toggle('panel-folded',v),toggleTools:()=>d.getElementById('viewerTools').hidden=!d.getElementById('viewerTools').hidden,refresh:()=>refreshes++,blocked:()=>blocked,storage,ask,confirm,alert});
 return{d,choose:v=>{d.getElementById('workspacePreset').value=v;d.getElementById('workspacePreset').dispatchEvent(new dom.window.Event('change'));},block:v=>blocked=v,refreshes:()=>refreshes};
}
test('Medición abre su jerarquía y recuperar restaura secciones y desplazamiento',async()=>{const {d,choose}=await fixture();d.getElementById('generalPanel').scrollTop=73;choose('measurement');for(const id of ['section-toolbox','section-tools','menu-measurements'])assert.ok(d.getElementById(id).open);assert.equal(d.getElementById('section-structures').open,false);d.getElementById('restoreWorkspace').click();assert.ok(d.getElementById('section-structures').open);assert.ok(d.getElementById('other').open);assert.equal(d.getElementById('generalPanel').scrollTop,73);assert.ok(d.getElementById('restoreWorkspace').disabled);});
test('Presentación oculta panel y barra; Exploración y volver recuperan cada distribución',async()=>{const {d,choose}=await fixture();choose('presentation');assert.ok(d.body.classList.contains('panel-folded'));assert.ok(d.getElementById('viewerTools').hidden);assert.equal(d.getElementById('workspacePresentationActions').hidden,false);choose('exploration');assert.equal(d.getElementById('viewerTools').hidden,false);assert.ok(d.getElementById('section-structures').open);d.getElementById('restoreWorkspace').click();assert.ok(d.body.classList.contains('panel-folded'));assert.equal(d.getElementById('workspacePreset').value,'presentation');});
test('No cambia la distribución durante US o presentación de vistas',async()=>{const {d,choose,block,refreshes}=await fixture();choose('measurement');block(true);choose('presentation');d.getElementById('restoreWorkspace').click();assert.equal(refreshes(),1);assert.equal(d.getElementById('workspacePreset').value,'measurement');assert.match(d.getElementById('workspaceMessage').textContent,/modo US/);block(false);d.getElementById('restoreWorkspace').click();assert.equal(refreshes(),2);});
test('ESLint del controlador de espacios',async()=>{const {ESLint}=require('eslint'),globals=require('globals');const lint=new ESLint({overrideConfigFile:true,overrideConfig:{languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:globals.browser},rules:{'no-undef':'error','no-unused-vars':['error',{args:'none'}]}}});const [r]=await lint.lintText(fs.readFileSync(path.join(__dirname,'../tools/workspace-presets.js'),'utf8'),{filePath:'spaces.js'});assert.equal(r.errorCount,0,JSON.stringify(r.messages));});
function memory(){const values=new Map();return{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};}
test('Guarda, recupera tras recargar y actualiza solo la distribución',async()=>{
 const store=memory(),f=await fixture({storage:()=>store,ask:()=> 'Mi espacio',confirm:()=>true});
 f.choose('measurement');f.d.getElementById('generalPanel').scrollTop=42;f.d.getElementById('saveWorkspace').click();
 const id=f.d.getElementById('workspacePreset').value;
 assert.match(id,/^custom-/);assert.equal(f.d.getElementById('updateWorkspace').disabled,false);
 const g=await fixture({storage:()=>store,confirm:()=>true});g.choose(id);
 assert.ok(g.d.getElementById('menu-measurements').open);assert.equal(g.d.getElementById('generalPanel').scrollTop,42);
 g.d.body.classList.add('panel-folded');g.d.getElementById('viewerTools').hidden=true;g.d.getElementById('updateWorkspace').click();
 const h=await fixture({storage:()=>store});h.choose(id);assert.ok(h.d.body.classList.contains('panel-folded'));assert.ok(h.d.getElementById('viewerTools').hidden);
 const item=JSON.parse(store.getItem('mpr-workspaces-v1')).items[0];assert.deepEqual(Object.keys(item).sort(),['id','name','folded','toolsHidden','presentationActions','scroll','sections'].sort());
});
test('Eliminar conserva la distribución y recuperar tolera espacios eliminados',async()=>{
 const store=memory(),f=await fixture({storage:()=>store,ask:()=> 'Presentación propia',confirm:()=>true});
 f.choose('presentation');f.d.getElementById('saveWorkspace').click();const id=f.d.getElementById('workspacePreset').value;
 f.choose('exploration');f.choose(id);f.d.getElementById('deleteWorkspace').click();
 assert.ok(f.d.body.classList.contains('panel-folded'));assert.equal(f.d.getElementById('workspacePreset').value,'');
 assert.equal(JSON.parse(store.getItem('mpr-workspaces-v1')).items.length,0);
 f.d.getElementById('restoreWorkspace').click();assert.equal(f.d.body.classList.contains('panel-folded'),false);
});
test('Cancelación, nombres duplicados y fallo de almacenamiento no sobrescriben espacios',async()=>{
 const store=memory(),alerts=[];let answer=null,fail=false;
 const f=await fixture({storage:()=>({getItem:store.getItem,setItem:(k,v)=>{if(fail)throw Error('quota');store.setItem(k,v);}}),ask:()=>answer,confirm:()=>true,alert:t=>alerts.push(t)});
 f.d.getElementById('saveWorkspace').click();assert.equal(store.getItem('mpr-workspaces-v1'),null);
 answer='Uno';f.d.getElementById('saveWorkspace').click();const saved=store.getItem('mpr-workspaces-v1');
 answer=' uno ';f.d.getElementById('saveWorkspace').click();assert.equal(store.getItem('mpr-workspaces-v1'),saved);
 fail=true;f.d.getElementById('deleteWorkspace').click();assert.equal(store.getItem('mpr-workspaces-v1'),saved);assert.equal(f.d.getElementById('deleteWorkspace').disabled,false);assert.equal(alerts.length,2);
});
test('Almacenamiento dañado o inaccesible no impide utilizar los espacios predefinidos',async()=>{
 for(const storage of [()=>({getItem:()=>'{broken'}),()=>{throw Error('blocked');}]){
 const f=await fixture({storage,ask:()=> 'No guardar',alert:()=>{}});f.choose('measurement');assert.ok(f.d.getElementById('menu-measurements').open);f.d.getElementById('saveWorkspace').click();assert.equal(f.d.querySelectorAll('optgroup option').length,0);
 }
});
