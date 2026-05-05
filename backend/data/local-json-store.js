import fs from 'fs';
import path from 'path';

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readJsonFile(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) return fallbackValue;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.warn(`[LocalStore] Failed to read ${path.basename(filePath)}: ${error.message}`);
    return fallbackValue;
  }
}

export function writeJsonFile(filePath, value) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

export function appendJsonLine(filePath, value) {
  ensureParentDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

export function readJsonArray(filePath) {
  const value = readJsonFile(filePath, []);
  return Array.isArray(value) ? value : [];
}
