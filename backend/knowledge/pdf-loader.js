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

export async function loadExtractedPDFs() {
  const cache = loadCache();
  const entries = Object.entries(cache);
  if (entries.length === 0) return '';

  return entries
    .map(([filename, data]) => `=== ${filename.toUpperCase().replace('.PDF', '').replace(/_/g, ' ')} ===\n${data.text}`)
    .join('\n\n');
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
