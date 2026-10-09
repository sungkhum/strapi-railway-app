// Verify a folder of complete original/processed EPUB pairs. Optionally compare
// fonts with a previously reviewed ready-to-read folder to prove migration parity.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
const [source, output, reference] = process.argv.slice(2);
if (!source || !output) throw Error('Usage: node verify.mjs original-directory prepared-directory [reviewed-directory]');
const parser = new DOMParser({ onError(_, message) { throw Error(message); } });
const parse = bytes => parser.parseFromString(bytes.toString('utf8'), 'application/xml');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const records = [];
const text = doc => Array.from(doc.getElementsByTagNameNS('*', 'body')).map(node => node.textContent).join('');
function anchors(doc) {
  return Array.from(doc.getElementsByTagName('*')).filter(node => !(node.localName === 'style' && node.getAttribute('id') === 'plovpit-khmer-wordbreak-style')).map(node => node.getAttribute('id')).filter(Boolean).sort();
}
function hrefs(doc) {
  return [...new Set(Array.from(doc.getElementsByTagName('*')).map(node => node.getAttribute('href')).filter(Boolean))].sort();
}
function authoredBreaks(value) {
  const positions = new Map();let offset = 0;
  for (const char of value) {
    if (char === '\u200b') positions.set(offset, (positions.get(offset) || 0) + 1);
    else offset++;
  }
  return positions;
}
for (const name of (await fs.readdir(source)).filter(name => /\.epub$/i.test(name))) {
  const originalBytes = await fs.readFile(path.join(source, name)), preparedBytes = await fs.readFile(path.join(output, name));
  const original = await JSZip.loadAsync(originalBytes), prepared = await JSZip.loadAsync(preparedBytes);
  const reviewed = reference && await JSZip.loadAsync(await fs.readFile(path.join(reference, name)));
  const record = { book: name, inputSha256: hash(originalBytes), outputSha256: hash(preparedBytes), fonts: [], chapters: [], unchangedAssets: 0 };
  assert.equal(preparedBytes.readUInt16LE(8), 0);assert.equal(preparedBytes.subarray(30, 38).toString(), 'mimetype');assert.equal(preparedBytes.readUInt16LE(28), 0);
  for (const file of Object.values(original.files).filter(file => !file.dir)) {
    const target = prepared.file(file.name);
    if (file.name === 'META-INF/encryption.xml' && !target) continue;
    assert.ok(target, file.name);
    const before = await file.async('nodebuffer'), after = await target.async('nodebuffer');
    if (/\.(xhtml|html|htm)$/i.test(file.name)) {
      const inputDoc = parse(before), outputDoc = parse(after), a = text(inputDoc), b = text(outputDoc);
      assert.equal(b.replaceAll('\u200b', ''), a.replaceAll('\u200b', ''), file.name);
      const addedBreaks = authoredBreaks(b);
      for (const [position, count] of authoredBreaks(a)) assert.ok((addedBreaks.get(position) || 0) >= count, 'authored boundary ' + file.name);
      assert.deepEqual(anchors(outputDoc), anchors(inputDoc), 'IDs ' + file.name);
      assert.deepEqual(hrefs(outputDoc), hrefs(inputDoc), 'links ' + file.name);
      record.chapters.push({ name: file.name, xmlValid: true, unicodeTextAndAuthoredBreaks: true, idsAndLinks: true });
    } else if (/\.(ttf|otf)$/i.test(file.name)) {
      if (reviewed) assert.deepEqual(after, await reviewed.file(file.name).async('nodebuffer'), 'font migration parity ' + file.name);
      record.fonts.push({ name: file.name, sha256: hash(after), bytes: after.length, matchesReviewedFont: reviewed ? true : undefined });
    } else if (/\.(opf|xml)$/i.test(file.name)) {
      parse(after);
      if (!/\.opf$/i.test(file.name) && file.name !== 'META-INF/encryption.xml') { assert.deepEqual(after, before, file.name);record.unchangedAssets++; }
    } else { assert.deepEqual(after, before, file.name);record.unchangedAssets++; }
  }
  records.push(record);console.log(JSON.stringify({ book: name, fonts: record.fonts.length, chapters: record.chapters.length, unchangedAssets: record.unchangedAssets }));
}
await fs.writeFile(path.join(output, 'integrity.json'), JSON.stringify(records, null, 2) + '\n');
