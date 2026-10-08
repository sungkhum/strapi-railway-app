import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {gzipSync} from 'node:zlib';
const {preprocessEpub}=createRequire(import.meta.url)('./dist/processor.cjs');
const [source,out]=process.argv.slice(2);
if(!source||!out) throw new Error('Usage: node --expose-gc benchmark.mjs input-directory output-directory');
if(path.resolve(source)===path.resolve(out)) throw new Error('Use a separate output directory to preserve originals');
await fs.mkdir(out,{recursive:true});const records=[],assets={};
for(const filename of ['src/vendor/aksara/km_frequency_dictionary.json','src/vendor/aksara/km_kcc_tagger.json','src/font-repair-data.json','dist/processor.cjs']) {
 const bytes=await fs.readFile(new URL(filename,import.meta.url));assets[path.basename(filename)]={bytes:bytes.length,gzipBytes:gzipSync(bytes).length};
}
let peakObservedRssBytes=process.memoryUsage().rss;
for(const name of (await fs.readdir(source)).filter(name=>name.toLowerCase().endsWith('.epub'))) {
 const before=process.memoryUsage(),result=await preprocessEpub(await fs.readFile(path.join(source,name))),after=process.memoryUsage();
 peakObservedRssBytes=Math.max(peakObservedRssBytes,after.rss);await fs.writeFile(path.join(out,name),result.bytes);
 const record={book:name,processed:result.processed,reason:result.reason,...result.stats,heapBeforeBytes:before.heapUsed,heapAfterBytes:after.heapUsed,rssAfterBytes:after.rss};records.push(record);
 console.log(JSON.stringify({book:name,processed:result.processed,seconds:result.stats.elapsedMs/1000,inputBytes:result.stats.inputBytes,outputBytes:result.stats.outputBytes}));global.gc?.();
}
await fs.writeFile(path.join(out,'benchmark.json'),JSON.stringify({environment:{node:process.version,platform:process.platform,arch:process.arch,icu:process.versions.icu},assets,peakObservedRssBytes,records},null,2));
