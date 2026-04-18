import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { DOCS_DIR, PDF_CACHE_FILE } from '../storage/paths.js';

// pdf-parse is CommonJS — use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

function loadCache() {
  if (!fs.existsSync(PDF_CACHE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PDF_CACHE_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveCache(cache) {
  const dir = path.dirname(PDF_CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PDF_CACHE_FILE, JSON.stringify(cache, null, 2));
}

export async function extractAndSavePDF(buffer, filename) {
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

  // Save the file
  const filePath = path.join(DOCS_DIR, filename);
  fs.writeFileSync(filePath, buffer);

  // Extract text
  const data = await pdfParse(buffer);
  const text = data.text.trim();

  // Cache it
  const cache = loadCache();
  cache[filename] = {
    text,
    pages: data.numpages,
    wordCount: text.split(/\s+/).length,
    extractedAt: new Date().toISOString(),
  };
  saveCache(cache);

  return { text, pages: data.numpages, wordCount: cache[filename].wordCount };
}

// Max chars injected into the prompt per PDF and total.
// Keep the docs helpful without estourar o orçamento dos modelos gratuitos.
const MAX_CHARS_PER_PDF = 3000;
const MAX_CHARS_TOTAL   = 6000;

export async function loadExtractedPDFs() {
  const cache = loadCache();
  const entries = Object.entries(cache);
  if (entries.length === 0) return '';

  let totalChars = 0;
  const sections = [];

  for (const [filename, data] of entries) {
    if (totalChars >= MAX_CHARS_TOTAL) {
      sections.push('(demais documentos omitidos por limite de espaço)');
      break;
    }
    const available = Math.min(MAX_CHARS_PER_PDF, MAX_CHARS_TOTAL - totalChars);
    let text = data.text || '';
    let truncated = false;
    if (text.length > available) {
      text = text.slice(0, available);
      truncated = true;
    }
    const label = filename.toUpperCase().replace('.PDF', '').replace(/_/g, ' ');
    sections.push(`=== ${label} ===\n${text}${truncated ? '\n[... conteúdo truncado por limite de tamanho ...]' : ''}`);
    totalChars += text.length;
  }

  return sections.join('\n\n');
}

export function getUploadedDocs() {
  const cache = loadCache();
  return Object.entries(cache).map(([filename, data]) => ({
    filename,
    pages: data.pages,
    wordCount: data.wordCount,
    extractedAt: data.extractedAt,
  }));
}

export function removePDF(filename) {
  const filePath = path.join(DOCS_DIR, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  const cache = loadCache();
  delete cache[filename];
  saveCache(cache);
}
