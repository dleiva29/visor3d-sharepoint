// Solo declaraciones explícitas; nunca inferir orientación por geometría o nombre.
const coordinateKeys=new Set(['coordinatesystem','coordinatespace','space']);
const unitKeys=new Set(['units','lengthunit','lengthunits','spatialunits']);
const keyOf=value=>value.toLowerCase().replace(/[_\s-]/g,'');
function orientation(value){const v=value.trim().toUpperCase();return ({LPS:'LPS',RAS:'RAS','LEFT-POSTERIOR-SUPERIOR':'LPS','RIGHT-ANTERIOR-SUPERIOR':'RAS'})[v]||null;}
function units(value){return ({mm:.001,millimeter:.001,millimeters:.001,millimetre:.001,millimetres:.001,cm:.01,centimeter:.01,centimeters:.01,m:1,meter:1,meters:1,metre:1,metres:1})[value.trim().toLowerCase()]??null;}
export function inspectCoordinateMetadata(name,text){
 const spaces=new Set(),scales=new Set(),unsupported=[];
 function add(key,value){key=keyOf(key);if(!coordinateKeys.has(key)&&!unitKeys.has(key))return;value=value.trim().replace(/^['"]|['"]$/g,'');const parsed=coordinateKeys.has(key)?orientation(value):units(value);if(parsed===null)unsupported.push(key+': '+value);else(coordinateKeys.has(key)?spaces:scales).add(parsed);}
 if(/\.(vtm|vtp)$/i.test(name)){
  // No pasar el bloque binario raw al parser XML.
  const header=text.split(/<AppendedData\b/)[0];
  const content=header===text?text:header+'</VTKFile>';
  const doc=new DOMParser().parseFromString(content,'application/xml');
  if(!doc.querySelector('parsererror')){
   for(const node of [doc.documentElement,...doc.querySelectorAll('PolyData,vtkMultiBlockDataSet')])for(const attr of node.attributes)add(attr.name,attr.value);
   for(const array of doc.querySelectorAll('FieldData > Array,FieldData > DataArray')){
    const name=array.getAttribute('Name')||'',format=array.getAttribute('format');
    if(format&&format!=='ascii')continue;
    if(!/string/i.test(array.getAttribute('type')||''))continue;
    let value=array.textContent.trim();
    // vtkStringArray ASCII puede codificar caracteres como enteros terminados en 0.
    if(/^\d+(\s+\d+)*$/.test(value)){const codes=value.split(/\s+/).map(Number);if(codes.some(c=>c>127))continue;value=codes.filter(c=>c!==0).map(c=>String.fromCharCode(c)).join('');}
    add(name,value);
   }
  }
 }else if(/\.obj$/i.test(name)){
  for(const line of text.split(/\r?\n/)){const match=/^\s*#\s*([\w -]+)\s*[:=]\s*(.*?)\s*$/.exec(line);if(match)add(match[1],match[2]);}
 }
 return{name,spaces:[...spaces],scales:[...scales],unsupported};
}
export function summarizeCoordinateMetadata(files){
 const spaces=[...new Set(files.flatMap(f=>f.spaces))],scales=[...new Set(files.flatMap(f=>f.scales))];
 const conflict=spaces.length>1||scales.length>1||files.some(f=>f.unsupported.length);
 return{files,conflict,space:spaces.length===1?spaces[0]:null,scale:scales.length===1?scales[0]:null,completeSpace:files.length>0&&files.every(f=>f.spaces.length===1),completeScale:files.length>0&&files.every(f=>f.scales.length===1)};
}
