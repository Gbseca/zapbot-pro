import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '..');
const STORAGE_ROOT = process.env.APP_STORAGE_DIR
  ? path.resolve(process.env.APP_STORAGE_DIR)
  : null;

export const AUTH_DIR = STORAGE_ROOT
  ? path.join(STORAGE_ROOT, 'auth_info')
  : path.join(BACKEND_DIR, 'auth_info');

export const DATA_DIR = STORAGE_ROOT
  ? path.join(STORAGE_ROOT, 'data')
  : path.join(BACKEND_DIR, 'data');

export const DOCS_DIR = STORAGE_ROOT
  ? path.join(STORAGE_ROOT, 'docs')
  : path.join(BACKEND_DIR, 'knowledge', 'docs');

export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
export const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
export const PDF_CACHE_FILE = path.join(DATA_DIR, 'pdf-cache.json');
