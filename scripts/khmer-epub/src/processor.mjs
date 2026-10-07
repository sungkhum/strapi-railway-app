import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { VERSION, WORD_CLASS, charSets, getBreaker, dictionaryEntries, modelFeatures } from './runtime.ts';

const XHTML='http://www.w3.org/1999/xhtml';
const OPF='http://www.idpf.org/2007/opf';
const DC='http://purl.org/dc/elements/1.1/';
const MARKER='plovpit:khmer-wordbreak';
const BLOCKS=new Set(['body','div','p','h1','h2','h3','h4','h5','h6','li','blockquote','pre','th','td','caption','figcaption','section','article','ol','ul','table','thead','tbody','tr','footer','header']);
const BARRIERS=new Set(['br','hr','img','script','style','svg','math','iframe','audio','video','ruby']);
const KHMER=/[\u1780-\u17ff]/u;
const LETTER=/\p{Letter}/u;
const ZWSP='\u200b';
const WORD_CSS=`.${WORD_CLASS}, .${WORD_CLASS} * { white-space: nowrap !important; word-break: normal !important; overflow-wrap: normal !important; hyphens: none !important; }`;
const children=node=>Array.from(node.childNodes || []);
const elements=(node, name)=>Array.from(node.getElementsByTagNameNS('*',name));
const hasClass=(node, value)=>(node.getAttribute?.('class') || '').split(/\s+/).includes(value);
const textOf=node=>node.nodeType===3 || node.nodeType===4 ? node.data : children(node).map(textOf).join('');
const visibleText=node=>node.nodeType===3 || node.nodeType===4 ? node.data : BARRIERS.has(node.localName) || (node.namespaceURI && node.namespaceURI!==XHTML) ? '' : children(node).map(visibleText).join('');
const parser = new DOMParser({onError(level,message){throw new Error(`Invalid XML (${level}): ${message}`);}});
const serializer=new XMLSerializer();
function parse(source,name) {
  try { return parser.parseFromString(source,'application/xhtml+xml'); }
  catch(error) { throw new Error(`${name}: ${error.message}`); }
}
function relativeResource(base,href) {
  const decoded=decodeURIComponent(href.split('#')[0]);
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('/')) throw new Error('External EPUB resource');
  const result=path.posix.normalize(path.posix.join(path.posix.dirname(base),decoded));
  if(result==='..' || result.startsWith('../')) throw new Error('Resource outside EPUB');
  return result;
}
function repairRuns(nodes) {
  const chars=nodes.flatMap(node=>Array.from(node.data).map(char=>({node,char,code:char.codePointAt(0)})));
  const output=new Map(nodes.map(node=>[node,'']));
  for(let i=0;i<chars.length;i++) {
    const {node,code,char}=chars[i];output.set(node,output.get(node)+char);
    if(code<0x1780 || code>0x17b3) continue;
    let afterCoeng=false;
    while(i+1<chars.length) {
      const next=chars[i+1];
      const mark=(next.code>=0x17b6 && next.code<=0x17d3) || next.code===0x17dd;
      const subscript=afterCoeng && next.code>=0x1780 && next.code<=0x17b3;
      const join=next.code===0x200c || next.code===0x200d;
      if(!mark && !subscript && !join) break;
      output.set(node,output.get(node)+next.char);i++;
      if(!join) afterCoeng=next.code===0x17d2;
    }
  }
  for(const node of nodes) node.data=output.get(node);
}
function collect(nodes) {
  const texts=[],protectedRanges=[];
  let offset=0;
  function visit(node,protectedWord=false) {
    const protect=protectedWord || /no[-_]?break|nowrap/i.test(node.getAttribute?.('class') || '') || /white-space\s*:\s*(?:nowrap|pre)(?:\s*[;!]|$)/i.test(node.getAttribute?.('style') || '');
    const start=offset;
    if(node.nodeType===3 || node.nodeType===4) {texts.push(node);offset+=node.data.length;}
    else children(node).forEach(child=>visit(child,protect));
    if(protect && !protectedWord && offset>start) protectedRanges.push([start,offset]);
  }
  nodes.forEach(node=>visit(node));
  return {texts,protectedRanges};
}
function wordBoundaries(text,protectedRanges) {
  const boundaries=new Set([0,text.length]);
  let base=0;
  for(const chunk of text.split(ZWSP)) {
    if(KHMER.test(chunk)) {
      const segments=getBreaker().getSegments(chunk);
      // A read-only EPUB must never inherit the editor's text normalization.
      if(segments.join('')!==chunk) throw new Error('Aksara segmentation changed source text');
      let position=0;
      for(const segment of segments.slice(0,-1)) {
        position+=segment.length;
        if(charSets.canBreakAt(chunk,position)) boundaries.add(base+position);
      }
    }
    base+=chunk.length;
    if(base<text.length) {boundaries.add(base);boundaries.add(base+1);base++;}
  }
  for(const boundary of [...boundaries]) {
    if(protectedRanges.some(([start,end])=>boundary>start && boundary<end)) boundaries.delete(boundary);
  }
  return [...boundaries].sort((a,b)=>a-b);
}
function processGroup(parent,nodes,stats) {
  if(!nodes.length) return;
  function barrier(node) { return node.nodeType===1 && (BARRIERS.has(node.localName) || node.namespaceURI && node.namespaceURI!==XHTML) || children(node).some(barrier); }
  if(nodes.some(barrier)) return;
  const before=nodes.map(textOf).join('');
  if(!KHMER.test(before)) return;
  const collected=collect(nodes);
  repairRuns(collected.texts);
  const text=nodes.map(textOf).join('');
  if(text!==before) throw new Error('Khmer run repair changed source text');
  const {protectedRanges}=collect(nodes);
  const boundaries=wordBoundaries(text,protectedRanges);
  // Measure offsets once; cloning slices must not re-scan subtrees per word.
  const extents=new Map();let offset=0;
  function index(node) {
    const start=offset;
    if(node.nodeType===3 || node.nodeType===4) offset+=node.data.length;
    else children(node).forEach(index);
    extents.set(node,[start,offset]);
  }
  nodes.forEach(index);
  const seenIds=new Set();
  function slice(node,start,end,isLast) {
    const [a,b]=extents.get(node);
    if(a===b) return (a>=start && (a<end || isLast && a===end)) ? node.cloneNode(true) : null;
    if(b<=start || a>=end) return null;
    if(node.nodeType===3 || node.nodeType===4) return parent.ownerDocument.createTextNode(node.data.slice(Math.max(0,start-a),Math.min(b-a,end-a)));
    const clone=node.cloneNode(false);
    const id=clone.getAttribute?.('id');
    if(id) {if(seenIds.has(id)) clone.removeAttribute('id'); else seenIds.add(id);}
    for(const child of children(node)) {const fragment=slice(child,start,end,isLast);if(fragment) clone.appendChild(fragment);}
    return clone;
  }
  const ranges=boundaries.slice(0,-1).map((start,index)=>{
    const end=boundaries[index+1],part=text.slice(start,end),next=text.slice(end,boundaries[index+2] ?? end);
    const khmer=KHMER.test(part);
    return {start,end,part,khmer,wrap:khmer && charSets.extractClusters(part).length>1,
      breakAfter:khmer && next && !/\s|\u200b/.test(part.at(-1)) && !/\s|\u200b/.test(next[0])};
  });
  const byEnd=new Map(ranges.map(range=>[range.end,range]));
  const boundarySet=new Set(boundaries);
  function replaceGroup(container,sourceNodes,suppressEnd=false) {
    if(!sourceNodes.length) return;
    const begin=extents.get(sourceNodes[0])[0],finish=extents.get(sourceNodes.at(-1))[1];
    const fragment=container.ownerDocument.createDocumentFragment();
    const placeholder=container.ownerDocument.createComment('plovpit-group');
    container.insertBefore(placeholder,sourceNodes[0]);
    function opportunity(end) {
      if(byEnd.get(end)?.breakAfter && (!suppressEnd || end<finish)) {
        fragment.appendChild(container.ownerDocument.createTextNode(ZWSP));stats.breaks++;
      }
    }
    function emit(range,content) {
      if(range.khmer) stats.words++;
      if(range.wrap) {
        const word=container.ownerDocument.createElementNS(XHTML,'span');word.setAttribute('class',WORD_CLASS);
        word.appendChild(content);fragment.appendChild(word);stats.wrappedWords=(stats.wrappedWords || 0)+1;
      } else fragment.appendChild(content);
      opportunity(range.end);
    }
    // Keep original formatting ancestors whenever every word fits wholly
    // inside one child. Only words spanning different styles require slicing.
    const aligned=sourceNodes.every(node=>{
      const [a,b]=extents.get(node);
      return a===b ? !node.getAttribute?.('id') || boundarySet.has(a) : boundarySet.has(a) && boundarySet.has(b);
    });
    if(aligned) {
      for(const node of sourceNodes) {
        const [a,b]=extents.get(node);
        if(a===b) {fragment.appendChild(node);continue;}
        if(node.nodeType===3 || node.nodeType===4) {
          for(const range of ranges) if(range.start>=a && range.end<=b) emit(range,container.ownerDocument.createTextNode(range.part));
        } else {
          replaceGroup(node,children(node),true);fragment.appendChild(node);opportunity(b);
        }
      }
    } else {
      for(const range of ranges) if(range.start>=begin && range.end<=finish) {
        const content=container.ownerDocument.createDocumentFragment();
        for(const node of sourceNodes) {const child=slice(node,range.start,range.end,range.end===finish);if(child) content.appendChild(child);}
        emit(range,content);
      }
    }
    sourceNodes.filter(node=>node.parentNode===container).forEach(node=>container.removeChild(node));
    container.replaceChild(fragment,placeholder);
  }
  replaceGroup(parent,nodes);

}
export function processDocument(document,stats={words:0,breaks:0}) {
  const target='plovpit-block-'+randomBytes(8).toString('hex');
  const fragments=[];
  const leafBlocks=new Set(['p','h1','h2','h3','h4','h5','h6','li','blockquote','th','td','caption','figcaption']);
  // Completed EPUBs are recognized by the package marker before this runs.
  function visit(container) {
    let group=[];
    const flush=()=>{processGroup(container,group,stats);group=[];};
    for(const child of children(container)) {
      if(child.nodeType===1 && (BLOCKS.has(child.localName) || BARRIERS.has(child.localName) || child.namespaceURI && child.namespaceURI!==XHTML)) {
        flush();
        if(BLOCKS.has(child.localName) && (!child.namespaceURI || child.namespaceURI===XHTML)) visit(child);
      } else group.push(child);
    }
    flush();
    if(leafBlocks.has(container.localName)) {
      const xml=serializer.serializeToString(container);
      // Retain serialized leaf paragraphs instead of hundreds of thousands of
      // XML DOM nodes. Ancestors remain in place, preserving namespaces/IDs.
      if(!xml.includes('<?'+target)) {
        const placeholder=document.createProcessingInstruction(target,String(fragments.length));
        fragments.push(xml);container.parentNode.replaceChild(placeholder,container);
      }
    }
  }
  const old=stats.words;
  for(const body of elements(document,'body')) visit(body);
  if(stats.words>old) {
    const head=elements(document,'head')[0];
    if(head && !elements(head,'style').some(style=>style.getAttribute('id')==='plovpit-khmer-wordbreak-style')) {
      const style=document.createElementNS(XHTML,'style');style.setAttribute('id','plovpit-khmer-wordbreak-style');style.setAttribute('type','text/css');style.appendChild(document.createTextNode(WORD_CSS));head.appendChild(style);
    }
  }
  return serializer.serializeToString(document).replace(new RegExp('<\\?'+target+' (\\d+)\\?>','g'),(_,index)=>fragments[Number(index)]);
}
export async function preprocessEpub(input,options={}) {
  const started=performance.now();
  const original=Buffer.from(input);
  const skipLimit=limit=>({bytes:original,processed:false,reason:'processing-limit',limit,stats:{elapsedMs:performance.now()-started}});
  if(original.length>(options.maxInputBytes ?? 50*1024*1024)) return skipLimit('compressed input size');
  const zip=await JSZip.loadAsync(original);
  const files=Object.values(zip.files).filter(file=>!file.dir);
  if(files.length>4000) return skipLimit('resource count');
  let unpacked=0;
  for(const file of files) {
    unpacked+=file._data?.uncompressedSize ?? 0;
    if((file._data?.uncompressedSize ?? 0)>32*1024*1024) return skipLimit('individual resource size');
  }
  if(unpacked>128*1024*1024) return skipLimit('unpacked size');
  const read=async name=>{const file=zip.file(name);if(!file) throw new Error(`Missing EPUB resource: ${name}`);return new TextDecoder('utf-8',{fatal:true}).decode(await file.async('uint8array'));};
  if(await read('mimetype')!=='application/epub+zip') throw new Error('Invalid EPUB mimetype');
  const container=parse(await read('META-INF/container.xml'),'container.xml');
  const packagePath=elements(container,'rootfile')[0]?.getAttribute('full-path');
  if(!packagePath) throw new Error('Missing EPUB package');
  const packageDoc=parse(await read(packagePath),packagePath);
  const metadata=elements(packageDoc,'metadata')[0];
  if(!metadata) throw new Error('Missing EPUB metadata');
  const marker=elements(metadata,'meta').find(meta=>meta.getAttribute('name')===MARKER || meta.getAttribute('property')===MARKER);
  const markerValue=marker?.getAttribute('content') || marker?.textContent;
  if(markerValue===VERSION) return {bytes:original,processed:false,reason:'already-processed',stats:{elapsedMs:performance.now()-started}};
  if(markerValue) throw new Error('This EPUB was prepared by another version; upload the original source EPUB to rebuild it');
  const declaredKhmer=Array.from(packageDoc.getElementsByTagNameNS(DC,'language')).some(node=>/^(km|khm)(-|$)/i.test(node.textContent.trim()));
  const markup=elements(packageDoc,'item').filter(item=>/^(application\/xhtml\+xml|text\/html)$/.test(item.getAttribute('media-type'))).map(item=>relativeResource(packagePath,item.getAttribute('href')));
  const documents=[];let khmerLetters=0,totalLetters=0;
  for(const name of new Set(markup)) {
    let source,document;
    try {source=await read(name);document=parse(source,name);}
    catch(error) {
      // Do not turn Khmer preprocessing into a validator for other languages.
      const visible=(source || '').match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || source || '';
      const letters=Array.from(visible.replace(/<[^>]*>/g,'')).filter(char=>LETTER.test(char));
      const ratio=letters.length ? letters.filter(char=>KHMER.test(char)).length/letters.length : 0;
      if(!declaredKhmer && ratio<0.5) return {bytes:original,processed:false,reason:'not-khmer',stats:{elapsedMs:performance.now()-started}};
      throw error;
    }
    const bodies=elements(document,'body');
    for(const char of bodies.map(visibleText).join('')) if(LETTER.test(char)) {totalLetters++;if(KHMER.test(char)) khmerLetters++;}
    documents.push({name,source,document});
  }
  const khmerRatio=totalLetters ? khmerLetters/totalLetters : 0;
  if(!khmerLetters || !declaredKhmer && khmerRatio<0.5) return {bytes:original,processed:false,reason:'not-khmer',stats:{khmerRatio,elapsedMs:performance.now()-started}};
  const stats={version:VERSION,dictionaryEntries,modelFeatures,intlSegmenter:typeof Intl.Segmenter==='function',icuVersion:process.versions.icu,khmerRatio,words:0,breaks:0,chapters:[]};
  const initStart=performance.now();getBreaker();stats.initializationMs=performance.now()-initStart;
  for(const item of documents) {
    const start=performance.now(),before=stats.words;
    const output=processDocument(item.document,stats);
    if(stats.words>before) zip.file(item.name,output,{date:zip.file(item.name).date});
    stats.chapters.push({name:item.name,words:stats.words-before,elapsedMs:performance.now()-start});
  }
  if(marker) marker.parentNode.removeChild(marker);
  const meta=packageDoc.createElementNS(OPF,'meta');
  if(packageDoc.documentElement.getAttribute('version').startsWith('3')) {
    const prefix=packageDoc.documentElement.getAttribute('prefix') || '';
    if(!/(^|\s)plovpit:/.test(prefix)) packageDoc.documentElement.setAttribute('prefix',(prefix+' plovpit: https://plovpit.com/vocab/').trim());
    meta.setAttribute('property',MARKER);meta.appendChild(packageDoc.createTextNode(VERSION));
  } else {meta.setAttribute('name',MARKER);meta.setAttribute('content',VERSION);}
  metadata.appendChild(meta);zip.file(packagePath,serializer.serializeToString(packageDoc),{date:zip.file(packagePath).date});
  // OCF requires mimetype first, stored and without an extra field.
  const result=new JSZip();result.file('mimetype','application/epub+zip',{compression:'STORE',date:zip.file('mimetype').date});
  for(const file of Object.values(zip.files)) {
    if(file.name==='mimetype') continue;
    result.file(file.name,file.dir ? null : await file.async('uint8array'),{dir:file.dir,date:file.date,unixPermissions:file.unixPermissions,dosPermissions:file.dosPermissions,compression:'DEFLATE'});
  }
  const bytes=await result.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6},platform:'UNIX'});
  stats.elapsedMs=performance.now()-started;stats.inputBytes=original.length;stats.outputBytes=bytes.length;
  return {bytes,processed:true,reason:'khmer',stats};
}
