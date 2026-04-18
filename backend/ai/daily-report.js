import cron from 'node-cron';
import { getAllLeads, getLeadStats } from '../data/leads-manager.js';
import { loadConfig } from '../data/config-manager.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeContactNumber(number) {
  let digits = String(number || '').replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }
  return digits;
}

function formatPhone(number) {
  const d = normalizeContactNumber(number);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

async function sendDailyReport(wa) {
  const config = loadConfig();
  if (!config.aiEnabled || !config.reportEnabled) return;

  const consultors = config.consultors || [];
  if (consultors.length === 0) return;

  const stats = getLeadStats();
  const allLeads = getAllLeads();
  const today = new Date().toDateString();

  const todayQualified = allLeads.filter(l =>
    (l.status === 'qualified' || l.status === 'transferred') &&
    new Date(l.updatedAt || l.createdAt).toDateString() === today
  );

  const dateStr = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  });

  const qualifiedSection = todayQualified.length > 0
    ? `\n🏆 *Leads qualificados hoje:*\n\n` +
      todayQualified.map((l, i) =>
        `${i + 1}. ${l.name || 'Sem nome'}\n` +
        `   🚗 ${l.model || '?'} | 🔑 ${l.plate || '?'}\n` +
        `   📱 ${formatPhone(l.phone || l.displayNumber || l.number)}`
      ).join('\n\n') + '\n\n'
    : '\n_Nenhum lead qualificado hoje._\n\n';

  const msg =
    `📊 *Resumo do dia — ZapBot Pro*\n` +
    `_${dateStr}_\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🆕 Novos contatos hoje: *${stats.todayTotal}*\n` +
    `💬 Conversas ativas: *${stats.talking}*\n` +
    `✅ Qualificados hoje: *${stats.todayQualified}*\n` +
    `🥶 Leads frios: *${stats.cold}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📈 Taxa de conversão: *${stats.conversationRate}%*\n` +
    qualifiedSection +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_Relatório automático ZapBot Pro_ 🤖`;

  for (const consultor of consultors) {
    try {
      const cNum = String(consultor.number).replace(/\D/g, '');
      await wa.sendMessage(cNum, msg, null);
      await sleep(2000);
      console.log(`[DailyReport] Sent to ${consultor.name || cNum}`);
    } catch (err) {
      console.error(`[DailyReport] Error sending to ${consultor.number}:`, err.message);
    }
  }
}

export function startDailyReportCron(wa) {
  // Default: 18:00 São Paulo time; re-read config at trigger time
  cron.schedule('0 * * * *', async () => {
    const config = loadConfig();
    if (!config.reportEnabled) return;
    const [rh] = (config.reportHour || '18:00').split(':').map(Number);
    const nowSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    if (nowSP.getHours() === rh) {
      await sendDailyReport(wa);
    }
  });
  console.log('[DailyReport] Cron started (checks every hour)');
}
