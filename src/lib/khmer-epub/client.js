'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs/promises');
let worker, idleTimer, tail = Promise.resolve(), queued = 0;
function stop() { clearTimeout(idleTimer);const old=worker;worker=undefined;old?.terminate(); }
function execute(input) {
  clearTimeout(idleTimer);
  worker ??= new Worker(path.join(__dirname,'worker.js'),{resourceLimits:{maxOldGenerationSizeMb:512}});
  const current=worker;
  return new Promise((resolve,reject) => {
    const cleanup=()=>{clearTimeout(timeout);current.off('message',message);current.off('error',failure);current.off('exit',exit);};
    const message=result=>{
      cleanup();
      idleTimer=setTimeout(stop,60_000);idleTimer.unref();
      result.error ? reject(new Error(result.error)) : resolve({...result,bytes:Buffer.from(result.bytes)});
    };
    const failure=error=>{cleanup();stop();reject(error);};
    const exit=code=>failure(new Error(`EPUB processor exited (${code})`));
    const timeout=setTimeout(()=>failure(new Error('EPUB preparation exceeded 120 seconds')),120_000);timeout.unref();
    current.once('message',message);current.once('error',failure);current.once('exit',exit);
    const bytes=new Uint8Array(input);current.postMessage({input:bytes},[bytes.buffer]);
  });
}
function enqueue(task) {
  if(queued>=8) return Promise.reject(new Error('EPUB preparation is busy; try the upload again'));
  queued++;
  const job=tail.then(task);
  tail=job.catch(()=>{});
  return job.finally(()=>queued--);
}
const prepare=input=>enqueue(()=>execute(input));
const prepareFile=filepath=>enqueue(async()=>execute(await fs.readFile(filepath)));
module.exports={prepare,prepareFile,stop};
