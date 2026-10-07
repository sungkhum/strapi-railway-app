'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {prepareFile} = require('./client');
function isEpub(file) {
  return !!file && (/\.epub$/i.test(file.originalFilename || file.name || '') || file.mimetype==='application/epub+zip');
}
async function withPreparedFiles(files,callback,{log=()=>{},processor=prepareFile}={}) {
  const list=Array.isArray(files) ? files : [files];
  const directories=[];
  try {
    const prepared=[];
    try {
    for(const file of list) {
      if(!isEpub(file)) {prepared.push(file);continue;}
      if(!file.filepath) throw new Error('EPUB upload has no temporary file path');
      if((await fs.stat(file.filepath)).size>50*1024*1024) {
        log('EPUB preprocessing skipped: compressed input exceeds 50 MiB; uploading original bytes');
        prepared.push(file);continue;
      }
      const result=await processor(file.filepath);
      if(!result.processed) {
        if(result.reason==='processing-limit') log(`EPUB preprocessing skipped: ${result.limit}; uploading original bytes`);
        prepared.push(file);continue;
      }
      const directory=await fs.mkdtemp(path.join(os.tmpdir(),'plovpit-epub-'));directories.push(directory);
      const filepath=path.join(directory,'prepared.epub');await fs.writeFile(filepath,result.bytes);
      // The upload service calculates persisted size and selects the storage
      // provider from this file. Never edit the user's original upload in place.
      prepared.push({...file,filepath,size:result.bytes.length});
      log(`Prepared Khmer EPUB: ${result.stats.words} words, ${Math.round(result.stats.elapsedMs)} ms, ${result.bytes.length} bytes`);
    }
    } catch(error) { error.epubPreparation=true; throw error; }
    return await callback(Array.isArray(files) ? prepared : prepared[0]);
  } finally {
    await Promise.all(directories.map(directory=>fs.rm(directory,{recursive:true,force:true})));
  }
}
module.exports={isEpub,withPreparedFiles};
