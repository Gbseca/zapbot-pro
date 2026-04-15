import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// pdf-parse is CommonJS — use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(__dirname, 'docs');
const CACHE_FILE = path.join(__dirname, '..', 'data', 'pdf-cache.json');

function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveCache(cache) {
  const dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
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

// Max chars injected into the prompt per PDF and total
// Groq free tier: 12K TPM — prompt must stay well under ~6K tokens (~8K chars)
const MAX_CHARS_PER_PDF = 6000;
const MAX_CHARS_TOTAL   = 12000;

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
