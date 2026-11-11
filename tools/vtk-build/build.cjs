const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const result=await require('esbuild').build({absWorkingDir:__dirname,entryPoints:['entry.js'],bundle:true,format:'esm',minify:true,outfile:'../vendor/vtk-reader.js',metafile:true});
 const packages=new Set();
 for(const input of Object.keys(result.metafile.inputs)){
  let dir=path.dirname(path.resolve(__dirname,input));
  while(dir!==path.dirname(dir)){if(fs.existsSync(path.join(dir,'package.json'))){packages.add(dir);break;}dir=path.dirname(dir);}
 }
 const notices=[];
 for(const dir of [...packages].sort()){
  const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  const licenses=fs.readdirSync(dir).filter(f=>/^(license|licence|copyright|copying)(\.|$)/i.test(f)&&fs.statSync(path.join(dir,f)).isFile());
  notices.push(`${pkg.name} ${pkg.version} (${pkg.license||'see license'})\n`+licenses.map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n'));
 }
 fs.writeFileSync(path.join(__dirname,'../vendor/THIRD-PARTY-NOTICES.txt'),notices.join('\n\n----------------------------------------\n\n'));
})();
