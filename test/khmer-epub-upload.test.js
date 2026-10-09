'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {withPreparedFiles,isEpub}=require('../src/lib/khmer-epub/upload');
const {prepare,stop}=require('../src/lib/khmer-epub/client');
const extendUpload=require('../src/extensions/upload/strapi-server');
test('only EPUB files reach the processor; other uploads keep their objects',async()=>{
 const pdf={originalFilename:'book.pdf'},photo={originalFilename:'photo.jpg'};
 assert.ok(isEpub({originalFilename:'BOOK.EPUB'}));assert.ok(isEpub({mimetype:'application/epub+zip'}));
 await withPreparedFiles([pdf,photo],files=>assert.deepEqual(files,[pdf,photo]),{processor(){throw Error('must not be called');}});
});
test('prepared bytes and size reach storage while originals stay unchanged; temporary files are removed',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'epub-test-'));
 const original=path.join(directory,'original.epub');await fs.writeFile(original,'original');
 let preparedPath;
 try {
 await withPreparedFiles({originalFilename:'book.epub',filepath:original,size:8},async file=>{
  preparedPath=file.filepath;assert.notEqual(preparedPath,original);assert.equal(file.size,9);assert.equal(await fs.readFile(preparedPath,'utf8'),'processed');
 },{processor:async()=>({processed:true,bytes:Buffer.from('processed'),stats:{words:5,elapsedMs:10}})});
 assert.equal(await fs.readFile(original,'utf8'),'original');await assert.rejects(fs.stat(preparedPath),{code:'ENOENT'});
 } finally {await fs.rm(directory,{recursive:true,force:true});}
});
test('non-Khmer EPUBs pass the original file to storage',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'epub-test-'));const filepath=path.join(directory,'english.epub');await fs.writeFile(filepath,'english');
 const file={originalFilename:'english.epub',filepath,size:7};
 try {await withPreparedFiles(file,processed=>assert.equal(processed,file),{processor:async()=>({processed:false})});}
 finally {await fs.rm(directory,{recursive:true,force:true});}
});
test('oversized uploads bypass processing and preprocessing limits preserve original file objects',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'epub-test-')),filepath=path.join(directory,'large.epub');
 const handle=await fs.open(filepath,'w');await handle.truncate(50*1024*1024+1);await handle.close();
 const file={originalFilename:'english.epub',filepath},messages=[];
 try {
  await withPreparedFiles(file,prepared=>assert.equal(prepared,file),{log:message=>messages.push(message),processor(){throw Error('must not read large input');}});
  await fs.truncate(filepath,1);
  await withPreparedFiles(file,prepared=>assert.equal(prepared,file),{log:message=>messages.push(message),processor:async()=>({processed:false,reason:'processing-limit',limit:'resource count'})});
  assert.equal(messages.length,2);assert.ok(messages.every(message=>message.includes('uploading original bytes')));
 } finally {await fs.rm(directory,{recursive:true,force:true});}
});
test('temporary files are removed when the storage provider fails',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'epub-test-'));const filepath=path.join(directory,'book.epub');await fs.writeFile(filepath,'original');let preparedPath;
 try {
 await assert.rejects(withPreparedFiles({originalFilename:'book.epub',filepath},async file=>{preparedPath=file.filepath;throw Error('storage failure');},{processor:async()=>({processed:true,bytes:Buffer.from('processed'),stats:{words:5,elapsedMs:10}})}),/storage failure/);
 await assert.rejects(fs.stat(preparedPath),{code:'ENOENT'});
 } finally {await fs.rm(directory,{recursive:true,force:true});}
});
test('Strapi extension preserves service methods and upload/replace arguments for other file types',async()=>{
 const calls=[],data={fileInfo:{name:'book'}},opts={user:{id:1}},file={originalFilename:'book.pdf'};
 const original={async upload(args,options){calls.push(['upload',args,options]);return 'uploaded';},async replace(id,args,options){calls.push(['replace',id,args,options]);return 'replaced';},getSettings(){return 'settings';}};
 const plugin=extendUpload({services:{upload:()=>original}}),service=plugin.services.upload({strapi:{log:{info(){}}}});
 assert.equal(await service.upload({data,files:file},opts),'uploaded');assert.equal(await service.replace(12,{data,file},opts),'replaced');assert.equal(service.getSettings(),'settings');
 assert.deepEqual(calls,[['upload',{data,files:file},opts],['replace',12,{data,file},opts]]);
});
test('worker rejects invalid EPUBs and remains available for the next upload',async()=>{
 try {await assert.rejects(prepare(Buffer.from('bad zip')),/zip/i);await assert.rejects(prepare(Buffer.from('another bad zip')),/zip/i);}
 finally {stop();}
});

test('storage errors for non-EPUB uploads retain their original error and status',async()=>{
 const error=new Error('provider unavailable');error.status=503;
 const service=extendUpload({services:{upload:()=>({async upload(){throw error;},async replace(){throw error;}})}}).services.upload({strapi:{log:{info(){}}}});
 await assert.rejects(service.upload({files:{originalFilename:'book.pdf'}}),actual=>actual===error);
 await assert.rejects(service.replace(1,{file:{originalFilename:'photo.jpg'}}),actual=>actual===error);
});
