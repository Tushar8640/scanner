import * as FileSystem from 'expo-file-system/legacy';
import { Document, Page } from '@/core/types';
import { DatabaseService } from '@/services/database/DatabaseService';
import { OcrService } from '@/services/ocr/OcrService';

/*
 * Word (.docx) export from the text OCR finds on each page. A .docx file is a ZIP of XML parts;
 * this writes an uncompressed ("stored") ZIP directly, so no extra library is needed.
 */

const utf8 = (str: string): Uint8Array => {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (data: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** ZIP with every file stored uncompressed (valid for .docx). */
function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  for (const f of files) {
    const name = utf8(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    // version 20, UTF-8 names flag, stored, no time/date
    const header = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0),
    ]);
    chunks.push(header, name, f.data);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(0), ...u32(offset),
      ]),
      name
    );
    offset += header.length + name.length + size;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let pos = 0;
  for (const c of all) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function documentXml(sections: { title: string; pages: string[] }[]): string {
  const paras: string[] = [];
  sections.forEach((sec, si) => {
    if (si > 0) paras.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    paras.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">${esc(sec.title)}</w:t></w:r></w:p>`);
    sec.pages.forEach((text, pi) => {
      if (pi > 0) paras.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      for (const line of text.split(/\r?\n/)) {
        paras.push(`<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`);
      }
    });
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

export const DocxService = {
  /**
   * Word file with each document's text (one heading per document, one page break per page).
   * Pages with no stored text are read with OCR first (from the filtered image when renderPage is given).
   * Returns the file URI, or null when no text was found at all.
   */
  async fromDocuments(docs: Document[], renderPage?: (p: Page) => Promise<string>, fileName = 'document'): Promise<string | null> {
    const sections: { title: string; pages: string[] }[] = [];
    let any = false;
    for (const doc of docs) {
      const pages = await DatabaseService.getPagesByDocumentId(doc.id);
      const texts: string[] = [];
      for (const p of pages) {
        let text = p.ocr_text ?? '';
        if (!text) {
          const img = renderPage ? await renderPage(p) : p.processed_path || p.original_path;
          text = await OcrService.recognizeText(img);
          await DatabaseService.updatePage(p.id, { ocr_text: text });
        }
        if (text.trim()) any = true;
        texts.push(text);
      }
      sections.push({ title: doc.title, pages: texts });
    }
    if (!any) return null;
    const bytes = zip([
      { name: '[Content_Types].xml', data: utf8(CONTENT_TYPES) },
      { name: '_rels/.rels', data: utf8(RELS) },
      { name: 'word/document.xml', data: utf8(documentXml(sections)) },
    ]);
    // Named after the document, in its own folder so the shared file keeps a readable name
    const safe = fileName.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'document';
    const dir = `${FileSystem.cacheDirectory}word_${Date.now()}/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const out = `${dir}${safe}.docx`;
    await FileSystem.writeAsStringAsync(out, toBase64(bytes), { encoding: FileSystem.EncodingType.Base64 });
    return out;
  },
};
