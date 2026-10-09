import JSZip from 'jszip';
export const fixture=async(body,{language='km',version='3.0'}={})=>{
 const zip=new JSZip();zip.file('mimetype','application/epub+zip',{compression:'STORE'});
 zip.file('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>');
 zip.file('OEBPS/book.opf',`<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:test</dc:identifier><dc:language>${language}</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`);
 zip.file('OEBPS/chapter.xhtml',`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Book</title><link href="test.css" rel="stylesheet"/></head><body>${body}</body></html>`);
 zip.file('OEBPS/test.css','p { font-family: Content; }');zip.file('OEBPS/font.otf',Buffer.from([1,2,3,4,5]));
 return zip.generateAsync({type:'nodebuffer'});
};
