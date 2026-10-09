import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { checksum, repairKnownEpubFont, replaceSfntTable } from '../src/fonts.mjs';
import { fixture } from './fixture.mjs';
const { preprocessEpub } = createRequire(import.meta.url)('../dist/processor.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => readFileSync(new URL('fixtures/' + name, import.meta.url));
const parse = source => new DOMParser({ onError(_, message) { throw Error(message); } }).parseFromString(source, 'application/xml');
const tables = font => new Map(Array.from({ length: font.readUInt16BE(4) }, (_, index) => {
  const record = 12 + 16 * index, offset = font.readUInt32BE(record + 8), length = font.readUInt32BE(record + 12);
  return [font.toString('ascii', record, record + 4), Buffer.from(font.subarray(offset, offset + length))];
}));
function validChecksums(font) {
  assert.equal(checksum(font), 0xb1b0afba);
  for (const [index, [tag, payload]] of [...tables(font)].entries()) {
    if (tag === 'head') payload.writeUInt32BE(0, 8);
    assert.equal(checksum(payload), font.readUInt32BE(12 + index * 16 + 4), tag);
    assert.equal(font.readUInt32BE(12 + index * 16 + 8) % 4, 0, tag);
  }
}
const subsetCases = [
  ['Ang DaunKeo', 'ang-daun-keo-indesign-subset.ttf', '10f00b09409f3c807daf91f42d5151e57e7602f66b48944418a9d7994359bb05'],
  ['Khmer Wat Phnom', 'khmer-wat-phnom-indesign-subset.ttf', 'fd663976cfc07b24a18f3a990caded04a7c4ab99ea490921e6e69058620c9378'],
];
for (const [family, filename, gsubHash] of subsetCases) test(`${family}: repairs GSUB with unchanged outlines/metrics and valid checksums`, () => {
  const original = read(filename), repaired = repairKnownEpubFont(original), before = tables(original), after = tables(repaired);
  assert.equal(hash(after.get('GSUB')), gsubHash);
  for (const [tag, payload] of before) if (tag !== 'GSUB') {
    if (tag === 'head') { payload.writeUInt32BE(0, 8);after.get(tag).writeUInt32BE(0, 8); }
    assert.deepEqual(after.get(tag), payload, tag);
  }
  validChecksums(repaired);assert.equal(repairKnownEpubFont(repaired), repaired);
  const unknown = Buffer.from(original);unknown[unknown.length - 1] ^= 1;
  assert.equal(repairKnownEpubFont(unknown), unknown);
});
const subsets = await JSZip.loadAsync(read('font-layout-subsets.zip'));
for (const item of JSON.parse(read('font-layout-manifest.json'))) test(`${item.family}: exact reference output for ${item.book}/${item.resource}`, async () => {
  const original = await subsets.file(item.fixture).async('nodebuffer');
  assert.equal(hash(original), item.sourceSha256);
  const repaired = repairKnownEpubFont(original);
  assert.equal(hash(repaired), item.replacementSha256);assert.equal(repaired.length, item.replacementBytes);
  validChecksums(repaired);assert.equal(repairKnownEpubFont(repaired), repaired);
});
test('upgrades the earlier v2 Ang repair and rejects invalid SFNT bounds', () => {
  const original = read('ang-daun-keo-indesign-subset.ttf');
  const v2 = replaceSfntTable(original, 'GSUB', read('ang-daun-keo-v2-gsub.bin'));
  assert.equal(hash(v2), 'f50f6e04fa801331dcf6358a64db7807bd760e85c6c633860b867d2766615bc1');
  assert.deepEqual(repairKnownEpubFont(v2), repairKnownEpubFont(original));
  assert.throws(() => replaceSfntTable(Buffer.alloc(2), 'GSUB', Buffer.alloc(0)), /header/);
  const bad = Buffer.from(original);bad.writeUInt32BE(original.length + 100, 20);
  assert.throws(() => replaceSfntTable(bad, 'GSUB', Buffer.alloc(0)), /bounds/);
  assert.throws(() => replaceSfntTable(original, 'xxxx', Buffer.alloc(0)), /Missing/);
});

async function fontBook({ language = 'km', font = read('ang-daun-keo-indesign-subset.ttf'), encrypted = true, extra = '', identifier = ' urn:uuid:\nfont-test\t ' } = {}) {
  const zip = await JSZip.loadAsync(await fixture('<p>លោកស្រ<span>ី</span> ខ្ញុំសូមអរគុណ</p>', { language }));
  const opf = (await zip.file('OEBPS/book.opf').async('string')).replace('urn:test', identifier);
  zip.file('OEBPS/book.opf', opf);font = Buffer.from(font);
  if (encrypted) {
    const key = createHash('sha1').update('urn:uuid:font-test').digest();
    for (let index = 0; index < Math.min(1040, font.length); index++) font[index] ^= key[index % key.length];
    zip.file('META-INF/encryption.xml', `<encryption xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="OEBPS/font/My%20Font.ttf"/></enc:CipherData></enc:EncryptedData>${extra}</encryption>`);
  }
  zip.file('OEBPS/font/My Font.ttf', font);
  return zip.generateAsync({ type: 'nodebuffer' });
}
test('bundled upload processor decodes IDPF then repairs both original subset families', async () => {
  for (const [, filename, gsubHash] of subsetCases) for (const encrypted of [false, true]) {
    const result = await preprocessEpub(await fontBook({ font: read(filename), encrypted })), zip = await JSZip.loadAsync(result.bytes);
    assert.equal(hash(tables(await zip.file('OEBPS/font/My Font.ttf').async('nodebuffer')).get('GSUB')), gsubHash);
    assert.equal(zip.file('META-INF/encryption.xml'), null);
    assert.equal(result.stats.fonts.decodedFonts, Number(encrypted));assert.equal(result.stats.fonts.repairedFonts, 1);
    const again = await preprocessEpub(result.bytes);assert.equal(again.reason, 'already-processed');assert.deepEqual(again.bytes, result.bytes);
  }
});
test('IDPF short and unknown fonts decode without replacing their bytes', async () => {
  for (const length of [600, 1500]) {
    const font = Buffer.alloc(length, 123);font.writeUInt32BE(0x00010000);
    const result = await preprocessEpub(await fontBook({ font }));
    assert.deepEqual(await (await JSZip.loadAsync(result.bytes)).file('OEBPS/font/My Font.ttf').async('nodebuffer'), font);
    assert.equal(result.stats.fonts.repairedFonts, 0);
  }
});
test('unsupported encryption entries and protected font resources retain their bytes', async () => {
  const extra = '<enc:EncryptedData><enc:EncryptionMethod Algorithm="other"/><enc:CipherData><enc:CipherReference URI="OEBPS/protected.ttf"/></enc:CipherData></enc:EncryptedData><enc:EncryptedData><enc:EncryptionMethod Algorithm="other"/><enc:CipherData><enc:CipherReference URI="https://example.com/external-reference"/></enc:CipherData></enc:EncryptedData>';
  const zip = await JSZip.loadAsync(await fontBook({ extra })), protectedFont = read('ang-daun-keo-indesign-subset.ttf');
  zip.file('OEBPS/protected.ttf', protectedFont);
  const result = await preprocessEpub(await zip.generateAsync({ type: 'nodebuffer' })), output = await JSZip.loadAsync(result.bytes);
  const doc = parse(await output.file('META-INF/encryption.xml').async('string'));
  assert.equal(doc.getElementsByTagNameNS('*', 'EncryptedData').length, 2);
  assert.equal(doc.getElementsByTagNameNS('*', 'CipherReference')[1].getAttribute('URI'), 'https://example.com/external-reference');
  assert.equal(doc.getElementsByTagNameNS('*', 'EncryptionMethod')[0].getAttribute('Algorithm'), 'other');
  assert.deepEqual(await output.file('OEBPS/protected.ttf').async('nodebuffer'), protectedFont);
});
test('foreign-language books keep original IDPF and known damaged fonts byte for byte', async () => {
  const zip = await JSZip.loadAsync(await fontBook({ language: 'en' }));
  zip.file('OEBPS/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>English prose.</p></body></html>');
  const input = await zip.generateAsync({ type: 'nodebuffer' }), result = await preprocessEpub(input);
  assert.equal(result.reason, 'not-khmer');assert.deepEqual(result.bytes, input);
});
test('wrong IDPF key and missing/unsafe font references fail the Khmer upload', async () => {
  await assert.rejects(preprocessEpub(await fontBook({ identifier: 'wrong' })), /Cannot decode/);
  for (const uri of ['missing.ttf', '../font.ttf', '%2Ffont.ttf', 'https%3A%2F%2Fexample.com%2Ffont.ttf', 'https://example.com/font.ttf', 'OEBPS/font/My%20Font.ttf?query=1']) {
    const zip = await JSZip.loadAsync(await fontBook());
    zip.file('META-INF/encryption.xml', (await zip.file('META-INF/encryption.xml').async('string')).replace('OEBPS/font/My%20Font.ttf', uri));
    await assert.rejects(preprocessEpub(await zip.generateAsync({ type: 'nodebuffer' })), /font reference|Missing embedded font/);
  }
});

test('duplicate IDPF references decode a font only once', async () => {
  const zip = await JSZip.loadAsync(await fontBook());
  const encryption = await zip.file('META-INF/encryption.xml').async('string');
  const entry = encryption.match(/<enc:EncryptedData>[\s\S]*?<\/enc:EncryptedData>/)[0];
  zip.file('META-INF/encryption.xml', encryption.replace('</encryption>', entry + '</encryption>'));
  const result = await preprocessEpub(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(result.stats.fonts.decodedFonts, 1);assert.equal(result.stats.fonts.repairedFonts, 1);
});

test('a font protected by both IDPF and an unsupported algorithm is rejected', async () => {
  const extra = '<enc:EncryptedData><enc:EncryptionMethod Algorithm="other"/><enc:CipherData><enc:CipherReference URI="OEBPS/font/My%20Font.ttf"/></enc:CipherData></enc:EncryptedData>';
  await assert.rejects(preprocessEpub(await fontBook({ extra })), /Unsupported additional font encryption/);
});

test('unknown boundary or font versions require the original source', async () => {
  const first = await preprocessEpub(await fontBook());
  for (const version of ['aksara-31740e9-kcc3-plovpit1', 'fonts-v3']) {
    const zip = await JSZip.loadAsync(first.bytes);
    zip.file('OEBPS/book.opf', (await zip.file('OEBPS/book.opf').async('string')).replace(version, 'unknown-future-version'));
    await assert.rejects(preprocessEpub(await zip.generateAsync({ type: 'nodebuffer' })), /original source EPUB/);
  }
});
test('segmentation-only books gain fonts without changing XHTML or doubling word breaks', async () => {
  const first = await preprocessEpub(await fontBook()), zip = await JSZip.loadAsync(first.bytes);
  const opf = parse(await zip.file('OEBPS/book.opf').async('string'));
  const marker = Array.from(opf.getElementsByTagNameNS('*', 'meta')).find(node => node.getAttribute('property') === 'plovpit:khmer-fonts');
  marker.parentNode.removeChild(marker);
  const { XMLSerializer } = await import('@xmldom/xmldom');
  zip.file('OEBPS/book.opf', new XMLSerializer().serializeToString(opf));
  // Simulate the first PR's word-boundary-only output with its original font.
  zip.file('OEBPS/font/My Font.ttf', read('ang-daun-keo-indesign-subset.ttf'));
  const result = await preprocessEpub(await zip.generateAsync({ type: 'nodebuffer' })), output = await JSZip.loadAsync(result.bytes);
  assert.equal(result.processed, true);assert.equal(result.stats.words, 0);assert.equal(result.stats.fonts.repairedFonts, 1);
  assert.deepEqual(await output.file('OEBPS/chapter.xhtml').async('nodebuffer'), await zip.file('OEBPS/chapter.xhtml').async('nodebuffer'));
});

test('real upload worker stores a repaired Khmer font and cleans up its prepared file',async()=>{
 const {withPreparedFiles}=createRequire(import.meta.url)('../../../src/lib/khmer-epub/upload.js');
 const {stop}=createRequire(import.meta.url)('../../../src/lib/khmer-epub/client.js');
 const zip=await JSZip.loadAsync(await fixture('<p>លោកស្រ<span>ី</span> ខ្ញុំសូមអរគុណ</p>'));
 zip.file('OEBPS/font.otf',read('ang-daun-keo-indesign-subset.ttf'));
 const source=await zip.generateAsync({type:'nodebuffer'}),directory=await fs.mkdtemp(path.join(os.tmpdir(),'epub-worker-test-'));
 const filepath=path.join(directory,'original.epub');await fs.writeFile(filepath,source);let preparedPath;
 try {
  await withPreparedFiles({originalFilename:'khmer.epub',filepath,size:source.length},async file=>{
   preparedPath=file.filepath;const bytes=await fs.readFile(preparedPath),output=await JSZip.loadAsync(bytes);
   assert.equal(file.size,bytes.length);
   const font=await output.file('OEBPS/font.otf').async('nodebuffer');let gsub;
   for(let index=0;index<font.readUInt16BE(4);index++) {const record=12+index*16;if(font.toString('ascii',record,record+4)==='GSUB') gsub=font.subarray(font.readUInt32BE(record+8),font.readUInt32BE(record+8)+font.readUInt32BE(record+12));}
   assert.equal(createHash('sha256').update(gsub).digest('hex'),'10f00b09409f3c807daf91f42d5151e57e7602f66b48944418a9d7994359bb05');
   assert.ok((await output.file('OEBPS/book.opf').async('string')).includes('plovpit:khmer-fonts'));
  });
  assert.deepEqual(await fs.readFile(filepath),source);await assert.rejects(fs.stat(preparedPath),{code:'ENOENT'});
 } finally {stop();await fs.rm(directory,{recursive:true,force:true});}
});
