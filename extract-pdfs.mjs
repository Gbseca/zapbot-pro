import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

async function extract(filePath, label) {
  console.log(`\nExtraindo: ${label}...`);
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const clean = data.text.replace(/\f/g, '\n').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const words = clean.split(/\s+/).length;
  const outPath = `C:/Users/sgabr/Documents/trabalho/${label}_extracted.txt`;
  fs.writeFileSync(outPath, clean, 'utf-8');
  console.log(`✅ Páginas: ${data.numpages} | Palavras: ${words} | Salvo: ${outPath}`);
  console.log(`\n--- PREVIEW (primeiros 4000 chars) ---`);
  console.log(clean.substring(0, 4000));
  console.log(`--- FIM PREVIEW ---\n`);
}

await extract('C:/Users/sgabr/Documents/trabalho/regulamento.pdf', 'REGULAMENTO');
await extract('C:/Users/sgabr/Documents/trabalho/index.pdf', 'INDEX');
console.log('\n✅ Concluído!');
