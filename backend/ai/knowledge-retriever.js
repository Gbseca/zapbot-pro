import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { searchPDFs } from '../knowledge/pdf-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to safely read JSON files
function readJSONSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
  }
  return {};
}

// Helper to safely read Markdown/text files
function readTextSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
  }
  return '';
}

export function getRelevantKnowledge(intent = '', text = '', mode = 'sales') {
  const knowledgeDir = path.join(__dirname, '..', 'knowledge');
  
  const faq = readJSONSafe(path.join(knowledgeDir, 'faq-moove.json'));
  const coverage = readJSONSafe(path.join(knowledgeDir, 'coverage-rules.json'));
  const operational = readJSONSafe(path.join(knowledgeDir, 'operational-rules.json'));
  const profile = readTextSafe(path.join(knowledgeDir, 'company-profile.md'));

  const rawText = String(text || '').toLowerCase();
  const matchedSnippets = [];

  // Search in uploaded PDFs cache first
  const pdfMatches = searchPDFs(rawText);
  if (pdfMatches) {
    matchedSnippets.push(pdfMatches);
  }

  // Match keyword mappings to push relevant items
  
  // 1. Cobertura, Roubo, Furto, Colisão, etc.
  if (intent === 'general_question' || /cobre|cobertura|roubo|furto|colisao|incendio|natureza|terceiros/i.test(rawText)) {
    if (coverage.what_is_covered) matchedSnippets.push(`* Coberturas: ${coverage.what_is_covered}`);
  }

  // 2. Exclusões / O que não cobre
  if (/nao cobre|exclusao|mecanico|desgaste|pneu|rodas|bebida|cnh/i.test(rawText)) {
    if (coverage.what_is_not_covered) matchedSnippets.push(`* Exclusões (o que NÃO cobre): ${coverage.what_is_not_covered}`);
  }

  // 3. Vidros
  if (/vidro|farol|lanterna|retrovisor|para-brisa|parabrisa/i.test(rawText)) {
    if (coverage.glass_coverage) matchedSnippets.push(`* Regras de Vidros: ${coverage.glass_coverage}`);
  }

  // 4. Carro Reserva
  if (/carro reserva|aluguel|locadora/i.test(rawText)) {
    if (coverage.car_rental_benefit) matchedSnippets.push(`* Carro Reserva: ${coverage.car_rental_benefit}`);
  }

  // 5. Assistência 24h, Reboque, Guincho
  if (/assistencia|guincho|reboque|chaveiro|pneu|pane|hospedagem|taxi/i.test(rawText)) {
    if (coverage.assistance_24h) matchedSnippets.push(`* Assistência 24h: ${coverage.assistance_24h}`);
  }

  // 6. Indenização Integral / Perda Total (PT)
  if (/indenizacao|perda total|pt|pagamento pt|documento/i.test(rawText)) {
    if (coverage.total_loss_payout) matchedSnippets.push(`* Indenização Integral: ${coverage.total_loss_payout}`);
  }

  // 7. Cota de participação / Franquia
  if (/cota|participacao|franquia|taxa de evento|pagamento de franquia/i.test(rawText)) {
    if (faq.cota_participacao) matchedSnippets.push(`* Cota de Participação: ${faq.cota_participacao}`);
  }

  // 8. Mensalidade / Cobrança / Boleto
  if (/mensalidade|preco|valor|pagar|boleto|vencimento|cartao/i.test(rawText) || intent.includes('boleto') || intent.includes('regularization')) {
    if (faq.monthly_payment) matchedSnippets.push(`* Mensalidades: ${faq.monthly_payment}`);
  }

  // 9. Rastreador
  if (/rastreador|diesel|instalacao|taxa de rastreador/i.test(rawText)) {
    if (operational.tracker_requirement) matchedSnippets.push(`* Rastreador Obrigatório: ${operational.tracker_requirement}`);
  }

  // 10. Vistoria / Revistoria / Fotos
  if (/vistoria|revistoria|fotos|codigo|video/i.test(rawText)) {
    if (operational.inspection_requirement) matchedSnippets.push(`* Vistorias: ${operational.inspection_requirement}`);
  }

  // 11. Inadimplência / Atraso
  if (/inadimplente|atraso|atrasado|bloqueado|app bloqueado/i.test(rawText) || intent.includes('billing') || intent.includes('app_blocked')) {
    if (operational.late_payments) matchedSnippets.push(`* Regras de Atraso e Suspensão: ${operational.late_payments}`);
  }

  // 12. Cancelamento
  if (/cancelar|cancelamento|desistir/i.test(rawText) || intent.includes('cancel')) {
    if (operational.cancellation_policy) matchedSnippets.push(`* Regras de Cancelamento: ${operational.cancellation_policy}`);
  }

  // 13. Placa / Veículo Zero Km
  if (/zero km|concessionaria|nota fiscal|nf|sem placa|nova placa/i.test(rawText)) {
    if (operational.zero_km_policy) matchedSnippets.push(`* Regra para Zero Km: ${operational.zero_km_policy}`);
  }

  // Always append general profile of Moove to contextualize Sales IA (limit output size)
  let generalProfile = '';
  if (mode === 'sales') {
    generalProfile = `== Perfil da Associação Moove ==\n${profile.substring(0, 800)}\n\n`;
  }

  // Fallback to standard short FAQ entries if no specific keywords matched
  if (matchedSnippets.length === 0) {
    matchedSnippets.push(`* Resumo Moove: ${faq.what_is_moove}`);
    matchedSnippets.push(`* Modelo: ${faq.is_insurance_company}`);
    matchedSnippets.push(`* Contatos: ${faq.phone_contact}`);
  }

  const combined = generalProfile + "== Regras de Conhecimento Relevantes ==\n" + matchedSnippets.join('\n\n');
  
  // Hard limit on returned size to save tokens (approx. 2000 chars)
  return combined.substring(0, 2200);
}
