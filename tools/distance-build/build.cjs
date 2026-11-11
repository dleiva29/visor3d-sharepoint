require('esbuild').build({absWorkingDir:__dirname,entryPoints:['entry.js'],bundle:true,format:'esm',minify:true,outfile:'../vendor/distance-bvh.js'}).catch(()=>process.exit(1));
