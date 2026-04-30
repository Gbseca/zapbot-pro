import cron from 'node-cron';
import { getAllLeads, updateLead } from '../data/leads-manager.js';
import { loadConfig } from '../data/config-manager.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runFollowUp(wa) {
  const config = loadConfig();
  if (!config.aiEnabled || !config.followUpEnabled) return;

  const leads = getAllLeads();
  const now = Date.now();

  // FIX [7]: Only follow up with genuinely engaged leads.
  // no_interest, blocked, transferred, cold → never re-engage automatically.
  const SKIP_STATUSES = new Set([
    'no_interest',
    'blocked',
    'transferred',
    'cold',
    'human_requested',
    'awaiting_financial_review',
    'payment_claimed',
    'receipt_received',
    'inspection_pending',
    'inspection_disputed',
    'app_blocked',
    'billing_disputed',
    'transferred_to_financial',
    'transferred_to_support',
    'human_taken_over',
  ]);

  for (const lead of leads) {
    if (SKIP_STATUSES.has(lead.status)) continue;
    if (lead.status !== 'talking') continue;

    const lastInteraction = new Date(lead.lastInteraction || lead.createdAt).getTime();
    const hoursSince = (now - lastInteraction) / (1000 * 60 * 60);

    const h1 = config.followUp1Hours || 4;
    const h2 = config.followUp2Hours || 24;
    const hCold = config.followUpColdHours || 48;

    try {
      if (hoursSince >= hCold && lead.followUp1Sent) {
        // Mark as cold — no more follow-ups
        await updateLead(lead.number, { status: 'cold' });
        console.log(`[FollowUp] Marked ${lead.number} as cold`);

      } else if (hoursSince >= h2 && lead.followUp1Sent && !lead.followUp2Sent) {
        // 2nd follow-up — gentler
        const name = lead.name ? `${lead.name}, só` : 'Só';
        const msg = `${name} passando pra dar um oi 👋\n\nSei que o dia a dia é corrido! Se quiser saber mais sobre como proteger seu veículo, é só chamar aqui.\n\nEstarei à disposição sempre que precisar 🙂`;
        await sleep(3000 + Math.random() * 2000);
        await wa.sendMessage(lead.number, msg, null);
        await updateLead(lead.number, {
          followUp2Sent: true,
          lastInteraction: new Date().toISOString(),
        });
        console.log(`[FollowUp] 2nd follow-up sent to ${lead.number}`);

      } else if (hoursSince >= h1 && !lead.followUp1Sent) {
        // 1st follow-up — warm
        const greeting = lead.name ? `Oi ${lead.name}!` : 'Oi!';
        const msg = `${greeting} Tudo bem? 😊\n\nVi que a gente tava conversando sobre proteção veicular e não queria que você ficasse com alguma dúvida em aberto.\n\nPosso te ajudar com alguma coisa?`;
        await sleep(3000 + Math.random() * 3000);
        await wa.sendMessage(lead.number, msg, null);
        await updateLead(lead.number, {
          followUp1Sent: true,
          lastInteraction: new Date().toISOString(),
        });
        console.log(`[FollowUp] 1st follow-up sent to ${lead.number}`);
      }
    } catch (err) {
      console.error(`[FollowUp] Error for ${lead.number}:`, err.message);
    }
  }
}

export function startFollowUpCron(wa) {
  // Check every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    await runFollowUp(wa);
  });
  console.log('[FollowUp] Cron started (every 30 min)');
}
