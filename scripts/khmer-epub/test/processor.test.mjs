import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
const {preprocessEpub}=createRequire(import.meta.url)('../dist/processor.cjs');
const fixture=async(body,{language='km',version='3.0'}={})=>{
 const zip=new JSZip();zip.file('mimetype','application/epub+zip',{compression:'STORE'});
 zip.file('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>');
 zip.file('OEBPS/book.opf',`<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:test</dc:identifier><dc:language>${language}</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`);
 zip.file('OEBPS/chapter.xhtml',`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Book</title><link href="test.css" rel="stylesheet"/></head><body>${body}</body></html>`);
 zip.file('OEBPS/test.css','p { font-family: Content; }');zip.file('OEBPS/font.otf',Buffer.from([1,2,3,4,5]));
 return zip.generateAsync({type:'nodebuffer'});
};
const parse=source=>new DOMParser({onError(_,message){throw Error(message);}}).parseFromString(source,'application/xhtml+xml');
const chapter=async result=>parse(await (await JSZip.loadAsync(result.bytes)).file('OEBPS/chapter.xhtml').async('string'));
const bodyText=doc=>doc.getElementsByTagNameNS('*','body')[0].textContent;
const words=doc=>Array.from(doc.getElementsByTagNameNS('*','span')).filter(s=>s.getAttribute('class').includes('plovpit-khmer-word'));
test('English, Thai and Japanese EPUBs pass through byte for byte',async()=>{
 for(const [language,body] of [['en','<p>English prose and ខ្មែរ as a short quotation.</p>'],['th','<p>ภาษาไทยสำหรับผู้อ่านทุกคน</p>'],['ja','<p>これは日本語の文章です。</p>']]) {
  const input=await fixture(body,{language}),result=await preprocessEpub(input);
  assert.equal(result.processed,false);assert.equal(result.reason,'not-khmer');assert.deepEqual(result.bytes,input);
 }
});
test('InDesign English metadata still recognizes predominantly Khmer content',async()=>{
 const result=await preprocessEpub(await fixture('<p>សូមថ្លែងអំណរគុណចំពោះ លោកស្រី កែវ សិរីវុឌ្ឍី</p>',{language:'en-US'}));assert.equal(result.processed,true);
});
test('repairs split vowel runs, preserves links, IDs and source characters',async()=>{
 const source='សូមថ្លែងអំណរគុណចំពោះ៖ លោកស្រី កែវ សិរីវុឌ្ឍី';
 const input=await fixture('<p id="credits">សូមថ្លែងអំណរគុណចំពោះ៖ លោកស្រ<span class="Vo-Fix-Khmer">ី</span> <a id="person" href="#credits">កែវ សិរីវុឌ្ឍី</a></p>');
 const result=await preprocessEpub(input),doc=await chapter(result);
 assert.equal(bodyText(doc).replaceAll('\u200b',''),source);
 assert.ok(words(doc).length>1);
 const ids=Array.from(doc.getElementsByTagName('*')).map(el=>el.getAttribute('id')).filter(Boolean);
 assert.equal(ids.filter(id=>id==='person').length,1);assert.equal(ids.filter(id=>id==='credits').length,1);
 for(const a of Array.from(doc.getElementsByTagNameNS('*','a'))) assert.equal(a.getAttribute('href'),'#credits');
 for(const span of Array.from(doc.getElementsByTagNameNS('*','span')).filter(s=>s.getAttribute('class')==='Vo-Fix-Khmer')) assert.equal(span.textContent,'');
 const zip=await JSZip.loadAsync(result.bytes),original=await JSZip.loadAsync(input);
 for(const name of ['OEBPS/font.otf','OEBPS/test.css','META-INF/container.xml']) assert.deepEqual(await zip.file(name).async('nodebuffer'),await original.file(name).async('nodebuffer'));
 assert.equal(result.bytes.readUInt16LE(8),0);assert.equal(result.bytes.subarray(30,38).toString(),'mimetype');assert.equal(result.bytes.readUInt16LE(28),0);
});
test('preserves existing authored boundaries and avoids coeng/repetition splits',async()=>{
 const input=await fixture('<p>ព្រះ\u200bជាម្ចាស់ ខ្ញុំ សូមថ្លែងអំណរគុណ ផ្សេងៗ \u2060ព្រះជាម្ចាស់\u2060</p>');
 const result=await preprocessEpub(input),doc=await chapter(result),text=bodyText(doc);
 assert.ok(text.includes('ព្រះ\u200bជាម្ចាស់'));assert.ok(text.includes('\u2060'));
 assert.ok(!/\u17d2\u200b|\u200b[\u17b6-\u17d3\u17dd]/u.test(text));
});
test('author no-break spans stay intact across word decisions',async()=>{
 const doc=await chapter(await preprocessEpub(await fixture('<p>ព្រះ<span class="Khmer-No-Break" id="joined">ជាម្ចាស់ស្រឡាញ់</span>មនុស្ស</p>')));
 const joined=Array.from(doc.getElementsByTagName('*')).find(e=>e.getAttribute('id')==='joined');assert.equal(joined.textContent,'ជាម្ចាស់ស្រឡាញ់');assert.ok(!joined.textContent.includes('\u200b'));
});
test('scripts, styles, images and nested barriers are untouched',async()=>{
 const body='<p><span>ខ្ញុំ<img src="cover.jpg"/>សូមអរគុណ</span></p><script>const x="ព្រះជាម្ចាស់";</script><p>ខ្ញុំសូមអរគុណ</p>';
 const doc=await chapter(await preprocessEpub(await fixture(body)));
 assert.equal(doc.getElementsByTagNameNS('*','script')[0].textContent,'const x="ព្រះជាម្ចាស់";');
 assert.equal(doc.getElementsByTagNameNS('*','p')[0].textContent,'ខ្ញុំសូមអរគុណ');assert.equal(doc.getElementsByTagNameNS('*','img').length,1);
});
test('processing is byte-idempotent and supports EPUB 2 metadata',async()=>{
 for(const version of ['2.0','3.0']) {
 const first=await preprocessEpub(await fixture('<p>ខ្ញុំសូមអរគុណ</p>',{version})),second=await preprocessEpub(first.bytes);
 assert.equal(second.reason,'already-processed');assert.deepEqual(second.bytes,first.bytes);
 }
});
test('malformed XHTML is rejected instead of repaired silently',async()=>{
 await assert.rejects(preprocessEpub(await fixture('<p>ព្រះជាម្ចាស់</div>')),/Invalid XML/);
});
test('processing limits leave Khmer and other-language archives byte-identical',async()=>{
 for(const [language,body] of [['km','<p>ខ្ញុំសូមអរគុណ</p>'],['en','<p>English prose</p>']]) {
  const input=await fixture(body,{language}),result=await preprocessEpub(input,{maxInputBytes:1});
  assert.equal(result.processed,false);assert.equal(result.reason,'processing-limit');assert.deepEqual(result.bytes,input);
 }
});

test('keeps an existing formatting ancestor once instead of cloning it for every word',async()=>{
 const doc=await chapter(await preprocessEpub(await fixture('<p><span class="body-style" id="paragraph-style">ខ្ញុំសូមថ្លែងអំណរគុណចំពោះព្រះជាម្ចាស់</span></p>')));
 const ancestors=Array.from(doc.getElementsByTagNameNS('*','span')).filter(s=>s.getAttribute('class')==='body-style');
 assert.equal(ancestors.length,1);assert.ok(words(ancestors[0]).length>1);assert.equal(ancestors[0].getAttribute('id'),'paragraph-style');
});

test('processing the same source produces identical bytes',async()=>{
 const input=await fixture('<p>ខ្ញុំសូមអរគុណព្រះជាម្ចាស់</p>');
 const a=await preprocessEpub(input),b=await preprocessEpub(input);assert.deepEqual(a.bytes,b.bytes);
 const original=await JSZip.loadAsync(input),output=await JSZip.loadAsync(a.bytes);
 assert.equal(output.file('OEBPS/chapter.xhtml').date.getTime(),original.file('OEBPS/chapter.xhtml').date.getTime());
});

test('foreign-language XHTML parsing errors do not change or reject its upload',async()=>{
 const input=await fixture('<p>English prose</div>',{language:'en'});
 const result=await preprocessEpub(input);assert.equal(result.processed,false);assert.deepEqual(result.bytes,input);
});
