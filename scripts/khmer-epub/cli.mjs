import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const {preprocessEpub}=createRequire(import.meta.url)('./dist/processor.cjs');
if(process.argv.length!==4) {console.error('Usage: node cli.mjs input.epub output.epub');process.exit(1);}
if(path.resolve(process.argv[2])===path.resolve(process.argv[3])) throw new Error('Use a separate output file to preserve the source EPUB');
const result=await preprocessEpub(await readFile(process.argv[2]));
await writeFile(process.argv[3],result.bytes);
console.log(JSON.stringify({processed:result.processed,reason:result.reason,...result.stats},null,2));
