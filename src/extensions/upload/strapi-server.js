'use strict';
const { errors: { ApplicationError } } = require('@strapi/utils');
const { withPreparedFiles } = require('../../lib/khmer-epub/upload');
module.exports = plugin => {
  const original = plugin.services.upload;
  plugin.services.upload = context => {
    const service = typeof original==='function' ? original(context) : original;
    const options={log:message=>context.strapi.log.info(message)};
    const process=async(files,callback)=>{
      try {return await withPreparedFiles(files,callback,options);}
      catch(error) {
        if(!error.epubPreparation || error instanceof ApplicationError) throw error;
        throw new ApplicationError(`Unable to prepare EPUB: ${error.message}`);
      }
    };
    return {
      ...service,
      upload(args,opts) {return process(args.files,files=>service.upload({...args,files},opts));},
      replace(id,args,opts) {return process(args.file,file=>service.replace(id,{...args,file},opts));},
    };
  };
  return plugin;
};
