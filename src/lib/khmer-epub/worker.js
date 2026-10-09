'use strict';
const { parentPort } = require('node:worker_threads');
const { preprocessEpub } = require('../../../scripts/khmer-epub/dist/processor.cjs');
parentPort.on('message', async ({input}) => {
  try {
    const result = await preprocessEpub(input);
    const bytes = new Uint8Array(result.bytes);
    parentPort.postMessage({...result,bytes},[bytes.buffer]);
  } catch(error) {
    parentPort.postMessage({error:error.message});
  }
});
