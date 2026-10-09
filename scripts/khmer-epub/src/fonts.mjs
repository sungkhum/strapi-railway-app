import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import repairs from './font-repair-data.json' with { type: 'json' };

export const FONT_VERSION = 'fonts-v3';
export const FONT_MARKER = 'plovpit:khmer-fonts';
const XMLENC = 'http://www.w3.org/2001/04/xmlenc#';
const IDPF = 'http://www.idpf.org/2008/embedding';
const DC = 'http://purl.org/dc/elements/1.1/';
const completeFonts = new Map();
const elements = (node, namespace, name) => Array.from(node.getElementsByTagNameNS(namespace, name));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function checksum(bytes) {
  let sum = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    let value = 0;
    for (let i = 0; i < 4; i++) value = (value << 8) | (bytes[offset + i] ?? 0);
    sum = (sum + (value >>> 0)) >>> 0;
  }
  return sum;
}

// Preserve the SFNT directory order and every unrelated table. Recompute head's
// adjustment after directory checksums, with that field zero during summation.
export function replaceSfntTable(bytes, tag, replacement) {
  if (bytes.length < 12 || tag.length !== 4) throw new Error('Invalid SFNT header');
  const count = bytes.readUInt16BE(4), end = 12 + count * 16;
  if (end > bytes.length) throw new Error('Invalid SFNT table directory');
  const tables = [];
  let total = end, found = false, hasHead = false;
  for (let index = 0; index < count; index++) {
    const record = 12 + index * 16, name = bytes.toString('ascii', record, record + 4);
    const offset = bytes.readUInt32BE(record + 8), length = bytes.readUInt32BE(record + 12);
    if (offset < end || offset + length > bytes.length) throw new Error('Invalid SFNT table bounds');
    const payload = Buffer.from(name === tag ? replacement : bytes.subarray(offset, offset + length));
    if (name === tag) found = true;
    if (name === 'head') {
      if (payload.length < 12) throw new Error('Invalid SFNT head table');
      payload.writeUInt32BE(0, 8);hasHead = true;
    }
    tables.push({ name, payload });total += (payload.length + 3) & ~3;
  }
  if (!found || !hasHead) throw new Error('Missing SFNT table');
  const output = Buffer.alloc(total);bytes.copy(output, 0, 0, end);
  let offset = end, headOffset = 0;
  tables.forEach(({ name, payload }, index) => {
    const record = 12 + index * 16;
    payload.copy(output, offset);
    output.writeUInt32BE(checksum(payload), record + 4);
    output.writeUInt32BE(offset, record + 8);
    output.writeUInt32BE(payload.length, record + 12);
    if (name === 'head') headOffset = offset;
    offset += (payload.length + 3) & ~3;
  });
  output.writeUInt32BE((0xb1b0afba - checksum(output)) >>> 0, headOffset + 8);
  return output;
}

export function repairKnownEpubFont(bytes) {
  const hash = digest(bytes), complete = repairs.complete[hash];
  if (complete) {
    if (!completeFonts.has(complete)) {
      const font = gunzipSync(Buffer.from(repairs.payloads[complete], 'base64'));
      if (digest(font) !== complete) throw new Error('Pinned complete font hash mismatch');
      completeFonts.set(complete, font);
    }
    return completeFonts.get(complete);
  }
  const table = repairs.gsub[hash];
  return table ? replaceSfntTable(bytes, 'GSUB', Buffer.from(table, 'base64')) : bytes;
}

function fontPath(uri) {
  // CipherReference paths are relative to the EPUB root, not encryption.xml.
  if (!uri || /^[a-z][a-z0-9+.-]*:|^[\/]|[?#]/i.test(uri)) throw new Error('Invalid EPUB font reference');
  const decoded = decodeURIComponent(uri);
  if (/^[a-z][a-z0-9+.-]*:|^[\/]|[?#\u0000]/i.test(decoded) || decoded.includes('\\') || decoded.split('/').some(part => part === '..')) throw new Error('Invalid EPUB font reference');
  return decoded.split('/').filter(part => part && part !== '.').join('/');
}
function isFont(bytes) {
  return bytes.length >= 4 && (bytes.readUInt32BE(0) === 0x00010000 || ['OTTO', 'true', 'typ1', 'wOFF', 'wOF2'].includes(bytes.toString('latin1', 0, 4)));
}

// Called only after Khmer detection. Standard IDPF embedding obfuscation is
// decoded for epub.js; unrelated encryption records/resources remain intact.
export async function prepareFonts(zip, packageDoc, { parse, serialize }) {
  const started = performance.now(), decoded = new Set(), protectedFonts = new Set();
  const stats = { version: FONT_VERSION, decodedFonts: 0, repairedFonts: 0, resources: [] };
  const encryptionFile = zip.file('META-INF/encryption.xml');
  if (encryptionFile) {
    const encryption = parse(await encryptionFile.async('string'), encryptionFile.name);
    const entries = elements(encryption, XMLENC, 'EncryptedData');
    // Do not alter any resource also protected by an unsupported algorithm.
    for (const entry of entries) {
      const method = elements(entry, XMLENC, 'EncryptionMethod')[0]?.getAttribute('Algorithm');
      if (method !== IDPF) for (const reference of elements(entry, XMLENC, 'CipherReference')) {
        try { protectedFonts.add(fontPath(reference.getAttribute('URI'))); }
        catch { /* Unhandled external references stay intact in their descriptor. */ }
      }
    }
    let key;
    for (const entry of entries) {
      if (elements(entry, XMLENC, 'EncryptionMethod')[0]?.getAttribute('Algorithm') !== IDPF) continue;
      const references = elements(entry, XMLENC, 'CipherReference');
      if (references.length !== 1) throw new Error('Missing or ambiguous IDPF font reference');
      const name = fontPath(references[0].getAttribute('URI'));
      if (protectedFonts.has(name)) throw new Error(`Unsupported additional font encryption: ${name}`);
      if (!key) {
        const id = packageDoc.documentElement.getAttribute('unique-identifier');
        const identifiers = elements(packageDoc, DC, 'identifier').filter(node => node.getAttribute('id') === id);
        if (!id || identifiers.length !== 1) throw new Error('Missing EPUB unique identifier for IDPF fonts');
        const identifier = identifiers[0].textContent.replace(/[ \t\r\n]/g, '');
        if (!identifier) throw new Error('Empty EPUB identifier');
        key = createHash('sha1').update(identifier, 'utf8').digest();
      }
      const file = zip.file(name);
      if (!file) throw new Error(`Missing embedded font: ${name}`);
      if (!decoded.has(name)) {
        const bytes = await file.async('nodebuffer');
        for (let index = 0; index < Math.min(1040, bytes.length); index++) bytes[index] ^= key[index % key.length];
        if (!isFont(bytes)) throw new Error(`Cannot decode embedded font: ${name}`);
        zip.file(name, bytes, { date: file.date });decoded.add(name);stats.decodedFonts++;
      }
      entry.parentNode.removeChild(entry);
    }
    if (decoded.size) {
      if (elements(encryption, XMLENC, 'EncryptedData').length) zip.file(encryptionFile.name, serialize(encryption), { date: encryptionFile.date });
      else zip.remove(encryptionFile.name);
    }
  }
  for (const file of Object.values(zip.files)) {
    if (file.dir || !/\.(ttf|otf)$/i.test(file.name) || protectedFonts.has(file.name)) continue;
    const bytes = await file.async('nodebuffer'), repaired = repairKnownEpubFont(bytes);
    if (repaired !== bytes) { zip.file(file.name, repaired, { date: file.date });stats.repairedFonts++; }
    stats.resources.push({ name: file.name, sourceSha256: digest(bytes), outputSha256: digest(repaired), bytes: repaired.length });
  }
  stats.elapsedMs = performance.now() - started;
  return stats;
}
