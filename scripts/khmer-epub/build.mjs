import { build } from 'esbuild';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
await mkdir('dist', {recursive:true});
await build({entryPoints:['src/processor.mjs'],bundle:true,platform:'node',target:'node22',format:'cjs',outfile:'dist/processor.cjs',minify:true,legalComments:'eof'});
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const licenses=['SBBIC Khmer / Aksara\n'+await readFile('src/vendor/aksara/LICENSE','utf8')];
for(const directory of Object.keys(lock.packages).filter(name=>name.startsWith('node_modules/'))) {
  let names;try{names=await readdir(directory);}catch{continue;}
  for(const name of names.filter(name=>/^licen[sc]e(?:$|[.-])|^copying$/i.test(name))) {
    licenses.push(directory+' / '+name+'\n'+await readFile(directory+'/'+name,'utf8'));
  }
}
await writeFile('dist/THIRD_PARTY_LICENSES.txt',licenses.join('\n\n'));
