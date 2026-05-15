const fs = require('fs');
let content = fs.readFileSync('app.js', 'utf8');

const regex = /async function loadLeads\(\) \{\r?\n\s+try \{\r?\n\s+const r = await fetch\('\/api\/leads'\);\r?\n\s+allLeads = await r.json\(\);\r?\n\s+renderLeadsStats\(\);\r?\n\s+renderLeadsList\(currentFilter\);\r?\n\s+updateLeadBadge\(\);\r?\n\s+\} catch \{\}\r?\n\}/;

const replacement = `let notifiedLeads = new Set();
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch(e) {}
}

async function loadLeads() {
  try {
    const r = await fetch('/api/leads');
    allLeads = await r.json();
    renderLeadsStats();
    renderLeadsList(currentFilter);
    updateLeadBadge();

    const needsAttention = allLeads.filter(l => l.status === 'transferred' || l.status === 'human_requested' || l.status === 'awaiting_financial_review');
    for (const lead of needsAttention) {
      if (!notifiedLeads.has(lead.number)) {
        notifiedLeads.add(lead.number);
        playBeep();
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('ZapBot Pro - Atencao!', {
            body: 'O lead ' + (lead.name || lead.number) + ' precisa de atendimento humano!'
          });
        }
      }
    }
  } catch (err) {}
}`;

content = content.replace(regex, replacement);
fs.writeFileSync('app.js', content);
