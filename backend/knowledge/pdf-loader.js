import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { DOCS_DIR, PDF_CACHE_FILE } from '../storage/paths.js';

// pdf-parse is CommonJS — use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
let chunkCache = { key: '', chunks: [] };

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

// Retorna apenas a lista de arquivos carregados para evitar encher o prompt
export async function loadExtractedPDFs() {
  const cache = loadCache();
  const filenames = Object.keys(cache);
  if (filenames.length === 0) return '';
  return `Documentos PDF Carregados no Sistema: ${filenames.join(', ')}`;
}

// Busca por palavra-chave nos PDFs extraídos
export function searchPDFs(query = '') {
  const cache = loadCache();
  const normalizedQuery = query.toLowerCase();
  const matches = [];

  for (const [filename, data] of Object.entries(cache)) {
    const text = data.text || '';
    if (text.toLowerCase().includes(normalizedQuery)) {
      // Pega um trecho ao redor da ocorrência ou os primeiros 800 caracteres
      const idx = text.toLowerCase().indexOf(normalizedQuery);
      const start = Math.max(0, idx - 200);
      const end = Math.min(text.length, idx + 800);
      matches.push(`Trecho de [${filename}]: ... ${text.slice(start, end).trim()} ...`);
    }
  }

  return matches.join('\n\n');
}

export function splitPDFText(text = '', { maxChunkChars = 1800, overlapChars = 180 } = {}) {
  const normalized = String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return [];

  const chunks = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    let end = Math.min(normalized.length, cursor + maxChunkChars);
    if (end < normalized.length) {
      const boundary = Math.max(
        normalized.lastIndexOf('\n\n', end),
        normalized.lastIndexOf('. ', end),
        normalized.lastIndexOf('; ', end),
      );
      if (boundary > cursor + Math.floor(maxChunkChars * 0.55)) end = boundary + 1;
    }
    const chunk = normalized.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    cursor = Math.max(cursor + 1, end - overlapChars);
  }
  return chunks;
}

export function getPDFKnowledgeChunks(options = {}) {
  let modifiedAt = 0;
  try {
    modifiedAt = fs.statSync(PDF_CACHE_FILE).mtimeMs;
  } catch {
    return [];
  }
  const cacheKey = `${modifiedAt}:${options.maxChunkChars || 1800}:${options.overlapChars || 180}`;
  if (chunkCache.key === cacheKey) return chunkCache.chunks;

  const cache = loadCache();
  const chunks = [];
  for (const [filename, data] of Object.entries(cache)) {
    const documentChunks = splitPDFText(data.text, options);
    documentChunks.forEach((text, index) => {
      chunks.push({ filename, index: index + 1, text });
    });
  }
  chunkCache = { key: cacheKey, chunks };
  return chunks;
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
