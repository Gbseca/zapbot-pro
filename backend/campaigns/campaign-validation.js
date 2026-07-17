const MAX_RECIPIENTS = 5000;
const MAX_FIELDS = 40;
const MAX_BLOCKS = 12;
const MAX_ATTACHMENTS = 6;
const MAX_TEXT_LENGTH = 4000;
const DEFAULT_OPT_OUT = 'Para nao receber novas mensagens, responda SAIR.';
const FORBIDDEN_MOOVE_TERMS = /\b(seguro|seguradora|apolice|sinistro|premio)\b/i;
const SENSITIVE_VARIABLES = /\b(cpf|cnpj|cartao|senha|password|rg|conta_bancaria|agencia)\b/i;
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]{1,60})\s*\}\}/g;
const SUPPORTED_BLOCK_TYPES = new Set(['text', 'image', 'video', 'audio', 'document', 'poll']);
const SUPPORTED_INTENTS = new Set(['sales', 'relationship', 'informative', 'collections']);
const EDIT_LOCKED_STATUSES = new Set(['running', 'scheduled', 'paused', 'recovering']);
const MEDIA_RULES = Object.freeze({
  image: Object.freeze({
    maxBytes: 16 * 1024 * 1024,
    extensions: Object.freeze(['.jpg', '.jpeg', '.png', '.gif', '.webp']),
    mimeTypes: Object.freeze(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
  }),
  video: Object.freeze({
    maxBytes: 32 * 1024 * 1024,
    extensions: Object.freeze(['.mp4', '.webm', '.mov', '.3gp', '.m4v']),
    mimeTypes: Object.freeze(['video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp', 'video/x-m4v']),
  }),
  audio: Object.freeze({
    maxBytes: 16 * 1024 * 1024,
    extensions: Object.freeze(['.mp3', '.wav', '.ogg', '.opus', '.m4a', '.aac', '.mp4', '.webm']),
    mimeTypes: Object.freeze(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/opus', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/webm']),
  }),
  document: Object.freeze({
    maxBytes: 32 * 1024 * 1024,
    extensions: Object.freeze(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.ppt', '.pptx', '.zip']),
    mimeTypes: Object.freeze([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/plain',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip',
      'application/x-zip-compressed',
      'application/octet-stream',
    ]),
  }),
});

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function normalizeCampaignPhone(value) {
  let digits = digitsOnly(value);
  if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
  return /^\d{10,11}$/.test(digits) ? digits : null;
}

function cleanFieldName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function cleanCampaignText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .slice(0, maxLength);
}

function safeIdentifier(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return normalized || fallback;
}

function fileExtension(value = '') {
  const match = String(value || '').toLowerCase().match(/(\.[a-z0-9]{1,8})$/);
  return match?.[1] || '';
}

function formatMegabytes(bytes) {
  return Math.round(Number(bytes || 0) / (1024 * 1024));
}

function hasPrefix(buffer, values = []) {
  return values.every((value, index) => buffer[index] === value);
}

function hasAscii(buffer, value, offset = 0) {
  return buffer.subarray(offset, offset + value.length).toString('ascii') === value;
}

function isPlainTextBuffer(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return false;
  let controlBytes = 0;
  for (const byte of sample) {
    if (byte < 32 && ![9, 10, 13].includes(byte)) controlBytes += 1;
  }
  return controlBytes <= Math.max(1, Math.floor(sample.length * 0.01));
}

function matchesMediaSignature(rawBuffer, kind, extension) {
  const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer || []);
  if (!buffer.length) return false;
  const riff = hasAscii(buffer, 'RIFF');
  const isoMedia = hasAscii(buffer, 'ftyp', 4);
  const ebml = hasPrefix(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
  const ogg = hasAscii(buffer, 'OggS');
  const zip = hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04])
    || hasPrefix(buffer, [0x50, 0x4b, 0x05, 0x06])
    || hasPrefix(buffer, [0x50, 0x4b, 0x07, 0x08]);
  const compoundOffice = hasPrefix(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

  if (kind === 'image') {
    if (['.jpg', '.jpeg'].includes(extension)) return hasPrefix(buffer, [0xff, 0xd8, 0xff]);
    if (extension === '.png') return hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (extension === '.gif') return hasAscii(buffer, 'GIF87a') || hasAscii(buffer, 'GIF89a');
    if (extension === '.webp') return riff && hasAscii(buffer, 'WEBP', 8);
  }
  if (kind === 'video') return extension === '.webm' ? ebml : isoMedia;
  if (kind === 'audio') {
    if (extension === '.mp3') return hasAscii(buffer, 'ID3') || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
    if (extension === '.wav') return riff && hasAscii(buffer, 'WAVE', 8);
    if (['.ogg', '.opus'].includes(extension)) return ogg;
    if (['.m4a', '.mp4'].includes(extension)) return isoMedia;
    if (extension === '.aac') return buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
    if (extension === '.webm') return ebml;
  }
  if (kind === 'document') {
    if (extension === '.pdf') return hasAscii(buffer, '%PDF-');
    if (['.docx', '.xlsx', '.pptx', '.zip'].includes(extension)) return zip;
    if (['.doc', '.xls', '.ppt'].includes(extension)) return compoundOffice;
    if (['.csv', '.txt'].includes(extension)) return isPlainTextBuffer(buffer);
  }
  return false;
}

export function validateCampaignMedia(media = {}, kind = '') {
  const normalizedKind = String(kind || media.kind || '').toLowerCase();
  const rule = MEDIA_RULES[normalizedKind];
  if (!rule) return 'Informe o tipo do anexo.';
  if (!media || (!media.buffer && !media.fileName && !media.originalname)) return 'Selecione um arquivo.';

  const fileName = String(media.fileName || media.originalname || '');
  const extension = fileExtension(fileName);
  const mimeType = String(media.mimeType || media.mimetype || '').toLowerCase().split(';', 1)[0].trim();
  const size = Number(media.size ?? media.buffer?.length ?? 0);

  if (media.kind && String(media.kind).toLowerCase() !== normalizedKind) {
    return 'O arquivo anexado pertence a outro tipo de bloco.';
  }
  if (!extension || !rule.extensions.includes(extension)) {
    return `Formato de ${normalizedKind === 'document' ? 'documento' : normalizedKind} nao permitido.`;
  }
  if (!mimeType || !rule.mimeTypes.includes(mimeType)) {
    return `O tipo informado pelo arquivo nao corresponde a ${normalizedKind === 'document' ? 'um documento permitido' : `um ${normalizedKind}`}.`;
  }
  if (!Number.isFinite(size) || size <= 0) return 'O arquivo esta vazio ou corrompido.';
  if (size > rule.maxBytes) {
    return `O arquivo excede o limite de ${formatMegabytes(rule.maxBytes)} MB para este bloco.`;
  }
  if (!matchesMediaSignature(media.buffer, normalizedKind, extension)) {
    return 'O conteudo do arquivo nao corresponde ao formato informado.';
  }
  return '';
}

export function countCampaignQuestions(value = '') {
  return (String(value || '').match(/\?/g) || []).length;
}

export function isCampaignEditLockedStatus(status = '') {
  return EDIT_LOCKED_STATUSES.has(String(status || '').toLowerCase());
}

function sanitizeFields(fields = {}) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(fields).slice(0, MAX_FIELDS)) {
    const key = cleanFieldName(rawKey);
    if (!key || key === 'phone' || key === 'telefone' || key === 'numero') continue;
    output[key] = cleanCampaignText(rawValue, 300).trim();
  }
  return output;
}

function recipientFields(input = {}) {
  if (input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields)) {
    return sanitizeFields(input.fields);
  }
  const reserved = new Set(['id', 'phone', 'number', 'telefone', 'numero', 'name', 'nome', 'consent']);
  return sanitizeFields(Object.fromEntries(Object.entries(input).filter(([key]) => !reserved.has(key))));
}

export function prepareCampaignAudience({ recipients = [], numbers = [], isSuppressed = () => false } = {}) {
  const source = Array.isArray(recipients) && recipients.length
    ? recipients
    : (Array.isArray(numbers) ? numbers : []).map(number => ({ phone: number, fields: {} }));
  const validRecipients = [];
  const invalid = [];
  const duplicates = [];
  const suppressed = [];
  const seen = new Set();

  for (const raw of source.slice(0, MAX_RECIPIENTS + 1)) {
    const input = typeof raw === 'object' && raw !== null ? raw : { phone: raw };
    const phone = normalizeCampaignPhone(input.phone || input.number || input.telefone || input.numero);
    if (!phone) {
      invalid.push({ value: String(input.phone || input.number || raw || '').slice(0, 80), reason: 'Telefone deve ter DDD e 10 ou 11 digitos.' });
      continue;
    }
    if (seen.has(phone)) {
      duplicates.push(phone);
      continue;
    }
    seen.add(phone);
    if (isSuppressed(phone)) {
      suppressed.push(phone);
      continue;
    }
    validRecipients.push({
      id: String(input.id || phone),
      phone,
      fields: {
        ...recipientFields(input),
        nome: cleanCampaignText(input.name || input.nome || input.fields?.nome, 160).trim(),
      },
      consent: input.consent === true,
    });
  }

  return {
    totalInput: source.length,
    queuedCount: validRecipients.length,
    invalidCount: invalid.length,
    duplicateCount: duplicates.length,
    suppressedCount: suppressed.length,
    truncated: source.length > MAX_RECIPIENTS,
    invalid: invalid.slice(0, 100),
    duplicates: duplicates.slice(0, 100),
    suppressed: suppressed.slice(0, 100),
    validRecipients,
    validNumbers: validRecipients.map(recipient => recipient.phone),
  };
}

export function findTemplateVariables(text = '') {
  const variables = new Set();
  for (const match of String(text || '').matchAll(VARIABLE_PATTERN)) variables.add(cleanFieldName(match[1]));
  return [...variables].filter(Boolean);
}

export function renderCampaignText(text = '', recipient = {}, defaults = {}) {
  const fields = {
    numero: recipient.phone || recipient.number || '',
    telefone: recipient.phone || recipient.number || '',
    nome: recipient.fields?.nome || recipient.name || '',
    ...(recipient.fields || {}),
  };
  const missing = new Set();
  const rendered = cleanCampaignText(text).replace(VARIABLE_PATTERN, (_full, rawName) => {
    const key = cleanFieldName(rawName);
    const value = fields[key] ?? defaults[key];
    if (value === undefined || value === null || String(value).trim() === '') {
      missing.add(key);
      return '';
    }
    return cleanCampaignText(value, 500);
  });
  return { text: rendered, missing: [...missing] };
}

function blockTexts(blocks = []) {
  const output = [];
  for (const block of blocks) {
    if (block?.enabled === false) continue;
    output.push(String(block?.text || block?.caption || block?.question || ''));
    if (block?.type === 'poll') output.push(...(block.options || []).map(String));
  }
  return output.filter(Boolean);
}

export function normalizeContentBlocks(content = {}) {
  const blocks = Array.isArray(content.blocks) ? content.blocks : [];
  const normalized = [];
  for (const input of blocks.slice(0, MAX_BLOCKS)) {
    const type = String(input?.type || '').toLowerCase();
    if (!SUPPORTED_BLOCK_TYPES.has(type)) continue;
    const block = {
      id: safeIdentifier(input.id, `${type}-${normalized.length + 1}`),
      type,
      enabled: input.enabled !== false,
    };
    if (type === 'text') block.text = cleanCampaignText(input.text);
    if (['image', 'video', 'audio', 'document'].includes(type)) {
      block.mediaId = String(input.mediaId || '').slice(0, 100);
      block.caption = cleanCampaignText(input.caption, 1024);
      block.ptt = type === 'audio' && input.ptt === true;
    }
    if (type === 'poll') {
      block.question = cleanCampaignText(input.question, 255);
      block.options = [...new Set((input.options || []).map(value => cleanCampaignText(value, 100).trim()).filter(Boolean))].slice(0, 12);
      block.selectableCount = Math.max(1, Math.min(block.options.length || 1, Number(input.selectableCount) || 1));
    }
    normalized.push(block);
  }
  if (!normalized.length && String(content.message || '').trim()) {
    normalized.push({ id: 'legacy-text', type: 'text', enabled: true, text: cleanCampaignText(content.message) });
  }
  return normalized;
}

function campaignContentVersions(content = {}, originalBlocks = normalizeContentBlocks(content)) {
  const versions = [{ id: 'original', name: 'Original', blocks: originalBlocks }];
  if (content.variantMode !== 'split') return versions;
  for (const [index, variant] of (content.variants || []).entries()) {
    if (!variant || variant.enabled === false) continue;
    const blocks = normalizeContentBlocks({
      message: variant.message || '',
      blocks: Array.isArray(variant.blocks) && variant.blocks.length ? variant.blocks : [],
    });
    if (!blocks.length) continue;
    versions.push({
      id: safeIdentifier(variant.id, `variant-${index + 1}`),
      name: cleanCampaignText(variant.name || `Variante ${index + 1}`, 80).trim(),
      blocks,
    });
  }
  return versions;
}

function pushIssue(collection, code, message, details = null) {
  collection.push({ code, message, details });
}

function validateTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function safeBoolean(value, fallback = false) {
  return value === undefined ? fallback : value === true;
}

function safeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function sanitizeCampaignDraft(input = {}) {
  const output = {};
  if ('name' in input) output.name = cleanCampaignText(input.name, 120).trim();
  if ('objective' in input) output.objective = cleanCampaignText(input.objective, 160).trim();
  if ('intent' in input) {
    const intent = String(input.intent || '').toLowerCase();
    output.intent = SUPPORTED_INTENTS.has(intent) ? intent : 'sales';
  }
  if (input.audience && typeof input.audience === 'object') {
    const audience = input.audience;
    const recipients = Array.isArray(audience.recipients)
      ? audience.recipients.slice(0, MAX_RECIPIENTS + 1).map((raw) => {
        const recipient = raw && typeof raw === 'object' ? raw : { phone: raw };
        return {
          id: String(recipient.id || recipient.phone || recipient.number || '').slice(0, 100),
          phone: String(recipient.phone || recipient.number || recipient.telefone || recipient.numero || '').slice(0, 40),
          fields: {
            ...recipientFields(recipient),
            nome: cleanCampaignText(recipient.name || recipient.nome || recipient.fields?.nome, 160).trim(),
          },
          consent: recipient.consent === true,
        };
      })
      : [];
    output.audience = {
      recipients,
      source: String(audience.source || 'manual').slice(0, 80),
      consentConfirmed: audience.consentConfirmed === true,
      consentSource: cleanCampaignText(audience.consentSource, 240).trim(),
      consentAt: audience.consentConfirmed ? String(audience.consentAt || new Date().toISOString()) : null,
      importedColumns: Array.isArray(audience.importedColumns)
        ? audience.importedColumns.map(value => cleanFieldName(value)).filter(Boolean).slice(0, MAX_FIELDS)
        : [],
    };
  }
  if (input.content && typeof input.content === 'object') {
    const content = input.content;
    output.content = {
      message: cleanCampaignText(content.message),
      blocks: normalizeContentBlocks(content),
      variants: Array.isArray(content.variants)
        ? content.variants.slice(0, 5).map((variant, index) => ({
          id: safeIdentifier(variant?.id, `variant-${index + 1}`),
          name: cleanCampaignText(variant?.name || `Variante ${index + 1}`, 80).trim(),
          enabled: variant?.enabled !== false,
          weight: Math.max(1, Math.min(100, safeNumber(variant?.weight, 1))),
          message: cleanCampaignText(variant?.message),
          blocks: Array.isArray(variant?.blocks) ? normalizeContentBlocks({ blocks: variant.blocks }) : [],
        })).filter(variant => variant.message || variant.blocks.length)
        : [],
      variantMode: ['single', 'split'].includes(content.variantMode) ? content.variantMode : 'single',
      variableDefaults: sanitizeFields(content.variableDefaults || {}),
      appendOptOut: content.appendOptOut !== false,
      optOutText: cleanCampaignText(content.optOutText || DEFAULT_OPT_OUT, 300).trim(),
      aiRepliesEnabled: content.aiRepliesEnabled !== false,
      aiInstructions: cleanCampaignText(content.aiInstructions, 1000).trim(),
    };
  }
  if (input.delivery && typeof input.delivery === 'object') {
    const delivery = input.delivery;
    output.delivery = {
      startMode: delivery.startMode === 'scheduled' ? 'scheduled' : 'now',
      scheduledAt: delivery.scheduledAt ? String(delivery.scheduledAt).slice(0, 40) : null,
      timezone: String(delivery.timezone || 'America/Sao_Paulo').slice(0, 80),
      allowedWeekdays: Array.isArray(delivery.allowedWeekdays)
        ? [...new Set(delivery.allowedWeekdays.map(Number).filter(value => Number.isInteger(value) && value >= 0 && value <= 6))]
        : [1, 2, 3, 4, 5],
      useWindow: safeBoolean(delivery.useWindow, true),
      windowStart: String(delivery.windowStart || '08:00').slice(0, 5),
      windowEnd: String(delivery.windowEnd || '20:00').slice(0, 5),
      intervalMode: delivery.intervalMode === 'fixed' ? 'fixed' : 'random',
      intervalFixed: safeNumber(delivery.intervalFixed, 45),
      intervalMin: safeNumber(delivery.intervalMin, 30),
      intervalMax: safeNumber(delivery.intervalMax, 90),
      flowControl: {
        enabled: delivery.flowControl?.enabled !== false,
        maxContacts: safeNumber(delivery.flowControl?.maxContacts, 15),
        windowMinutes: safeNumber(delivery.flowControl?.windowMinutes, 10),
      },
      dailyLimit: {
        enabled: delivery.dailyLimit?.enabled !== false,
        max: safeNumber(delivery.dailyLimit?.max, 50),
      },
      frequencyCap: {
        enabled: delivery.frequencyCap?.enabled !== false,
        max: safeNumber(delivery.frequencyCap?.max, 2),
        days: safeNumber(delivery.frequencyCap?.days, 7),
      },
      typing: delivery.typing !== false,
      pauseAfterFailures: safeNumber(delivery.pauseAfterFailures, 3),
      pauseFailureRate: safeNumber(delivery.pauseFailureRate, 35),
      pauseUnconfirmedRate: safeNumber(delivery.pauseUnconfirmedRate, 50),
    };
  }
  return output;
}

export function buildCampaignPreflight({ campaign = {}, waStatus = 'disconnected', isSuppressed = () => false, mediaResolver = () => null, recentSendCount = () => 0 } = {}) {
  const blockers = [];
  const warnings = [];
  const audience = campaign.audience || {};
  const content = campaign.content || {};
  const delivery = campaign.delivery || {};
  const prepared = prepareCampaignAudience({ recipients: audience.recipients || [], isSuppressed });
  const blocks = normalizeContentBlocks(content);
  const contentVersions = campaignContentVersions(content, blocks);

  if (!String(campaign.name || '').trim()) pushIssue(blockers, 'campaign_name_missing', 'Informe um nome para a campanha.');
  if (!String(campaign.objective || '').trim()) pushIssue(blockers, 'campaign_objective_missing', 'Informe o objetivo da campanha.');
  if (!audience.consentConfirmed) pushIssue(blockers, 'consent_missing', 'Confirme que os contatos autorizaram mensagens da Moove.');
  if (!String(audience.consentSource || '').trim()) pushIssue(blockers, 'consent_source_missing', 'Registre a origem do consentimento.');
  if (!prepared.validRecipients.length) pushIssue(blockers, 'audience_empty', 'Nenhum contato elegivel para envio.');
  if (prepared.invalidCount) pushIssue(warnings, 'invalid_recipients', `${prepared.invalidCount} contato(s) invalido(s) serao ignorados.`);
  if (prepared.duplicateCount) pushIssue(warnings, 'duplicate_recipients', `${prepared.duplicateCount} contato(s) duplicado(s) serao ignorados.`);
  if (prepared.suppressedCount) pushIssue(warnings, 'suppressed_recipients', `${prepared.suppressedCount} contato(s) em supressao serao ignorados.`);
  if (prepared.truncated) pushIssue(blockers, 'audience_too_large', `O limite por campanha e ${MAX_RECIPIENTS} contatos.`);
  if (waStatus !== 'connected') pushIssue(blockers, 'whatsapp_disconnected', 'O WhatsApp precisa estar conectado.');
  if (!blocks.some(block => block.enabled !== false)) pushIssue(blockers, 'content_empty', 'Adicione pelo menos um bloco de conteudo.');

  const texts = contentVersions.flatMap(version => blockTexts(version.blocks));
  if (content.appendOptOut !== false) texts.push(String(content.optOutText || DEFAULT_OPT_OUT));
  for (const text of texts) {
    if (FORBIDDEN_MOOVE_TERMS.test(normalizeForMatch(text))) {
      pushIssue(blockers, 'forbidden_moove_term', 'A mensagem contem termo proibido pelas regras da Moove.');
      break;
    }
  }

  const variables = [...new Set(texts.flatMap(findTemplateVariables))];
  if (variables.some(variable => SENSITIVE_VARIABLES.test(variable))) {
    pushIssue(blockers, 'sensitive_variable', 'Remova variaveis com identificadores ou dados sensiveis.');
  }
  const missingByVariable = {};
  for (const recipient of prepared.validRecipients) {
    for (const text of texts) {
      const rendered = renderCampaignText(text, recipient, content.variableDefaults || {});
      for (const variable of rendered.missing) missingByVariable[variable] = (missingByVariable[variable] || 0) + 1;
    }
  }
  if (Object.keys(missingByVariable).length) {
    pushIssue(blockers, 'variables_unresolved', 'Existem variaveis sem valor para parte do publico.', missingByVariable);
  }

  let attachmentCount = 0;
  for (const version of contentVersions) {
    let versionAttachmentCount = 0;
    for (const block of version.blocks) {
      if (block.enabled === false) continue;
      const details = { blockId: block.id, versionId: version.id };
      if (block.type === 'text' && !String(block.text || '').trim()) {
        pushIssue(blockers, 'text_block_empty', `Existe um bloco de texto vazio em ${version.name}.`, details);
      }
      if (block.type === 'poll' && (block.options?.length || 0) < 2) {
        pushIssue(blockers, 'poll_invalid', `A enquete de ${version.name} precisa de pelo menos duas opcoes.`, details);
      }
      const questionText = block.type === 'text'
        ? block.text
        : block.type === 'poll'
          ? block.question
          : block.caption;
      const questionCount = countCampaignQuestions(questionText);
      if (questionCount > 1) {
        pushIssue(blockers, 'multiple_questions', `Separe as ${questionCount} perguntas de ${version.name} em mensagens diferentes.`, { ...details, questionCount });
      }
      if (['image', 'video', 'audio', 'document'].includes(block.type)) {
        versionAttachmentCount += 1;
        const media = mediaResolver(block.mediaId);
        if (!media) {
          pushIssue(blockers, 'media_missing', `Um bloco de midia de ${version.name} perdeu o arquivo anexado.`, details);
        } else {
          const mediaError = validateCampaignMedia(media, block.type);
          if (mediaError) pushIssue(blockers, 'media_invalid', mediaError, details);
        }
      }
    }
    attachmentCount = Math.max(attachmentCount, versionAttachmentCount);
  }
  if (attachmentCount > MAX_ATTACHMENTS) pushIssue(blockers, 'too_many_attachments', `Use no maximo ${MAX_ATTACHMENTS} anexos por campanha.`);

  if (content.appendOptOut === false && String(campaign.intent || 'sales') === 'sales') {
    pushIssue(warnings, 'opt_out_disabled', 'Campanha comercial sem instrucao de saida.');
  }

  const intervalMode = delivery.intervalMode === 'fixed' ? 'fixed' : 'random';
  const fixed = Number(delivery.intervalFixed);
  const min = Number(delivery.intervalMin);
  const max = Number(delivery.intervalMax);
  if (intervalMode === 'fixed' && (!Number.isFinite(fixed) || fixed < 5 || fixed > 3600)) {
    pushIssue(blockers, 'fixed_interval_invalid', 'Intervalo fixo deve ficar entre 5 e 3600 segundos.');
  }
  if (intervalMode === 'random' && (!Number.isFinite(min) || !Number.isFinite(max) || min < 5 || max > 3600 || min > max)) {
    pushIssue(blockers, 'random_interval_invalid', 'Intervalo aleatorio invalido. O minimo deve ser menor ou igual ao maximo.');
  }
  if (delivery.useWindow && (!validateTime(delivery.windowStart) || !validateTime(delivery.windowEnd))) {
    pushIssue(blockers, 'time_window_invalid', 'A janela de horario esta incompleta ou invalida.');
  }
  if (!Array.isArray(delivery.allowedWeekdays) || delivery.allowedWeekdays.length === 0) {
    pushIssue(blockers, 'weekdays_empty', 'Selecione pelo menos um dia da semana para os envios.');
  }
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: delivery.timezone || 'America/Sao_Paulo' }).format(new Date());
  } catch {
    pushIssue(blockers, 'timezone_invalid', 'O fuso horario selecionado e invalido.');
  }
  if (delivery.startMode === 'scheduled' && (!delivery.scheduledAt || new Date(delivery.scheduledAt).getTime() <= Date.now())) {
    pushIssue(blockers, 'schedule_invalid', 'Escolha uma data futura para o agendamento.');
  }

  const cap = delivery.frequencyCap || {};
  let frequencyCapped = 0;
  if (cap.enabled) {
    if (!Number.isFinite(Number(cap.max)) || Number(cap.max) < 1 || Number(cap.max) > 100 || !Number.isFinite(Number(cap.days)) || Number(cap.days) < 1 || Number(cap.days) > 365) {
      pushIssue(blockers, 'frequency_cap_invalid', 'O limite de frequencia precisa ter quantidade e periodo validos.');
    }
    for (const recipient of prepared.validRecipients) {
      if (recentSendCount(recipient.phone, Number(cap.days) || 7) >= (Number(cap.max) || 2)) frequencyCapped += 1;
    }
    if (frequencyCapped) pushIssue(warnings, 'frequency_capped', `${frequencyCapped} contato(s) atingiram o limite de frequencia e serao ignorados.`);
  }

  const messagesPerRecipient = Math.max(...contentVersions.map((version) => {
    const active = version.blocks.filter(block => block.enabled !== false);
    return active.length + (content.appendOptOut !== false && !active.some(block => block.type === 'text') ? 1 : 0);
  }));
  const daily = delivery.dailyLimit || {};
  if (daily.enabled && (!Number.isFinite(Number(daily.max)) || Number(daily.max) < 1 || Number(daily.max) > 100000)) {
    pushIssue(blockers, 'daily_limit_invalid', 'O limite diario precisa ficar entre 1 e 100000 envios.');
  } else if (daily.enabled && Number(daily.max) < messagesPerRecipient) {
    pushIssue(blockers, 'daily_limit_below_contact', `O limite diario precisa ser de pelo menos ${messagesPerRecipient} envios para concluir um contato.`);
  }
  const flow = delivery.flowControl || {};
  if (flow.enabled && (!Number.isFinite(Number(flow.maxContacts)) || Number(flow.maxContacts) < 1 || !Number.isFinite(Number(flow.windowMinutes)) || Number(flow.windowMinutes) < 1)) {
    pushIssue(blockers, 'flow_control_invalid', 'O controle de fluxo precisa de quantidade e janela validas.');
  }

  const estimatedPayloads = prepared.validRecipients.length * messagesPerRecipient;
  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    variables,
    audience: prepared,
    normalizedBlocks: blocks,
    contentVersions: contentVersions.map(version => ({ id: version.id, name: version.name, messages: version.blocks.filter(block => block.enabled !== false).length })),
    attachmentCount,
    estimatedPayloads,
    messagesPerRecipient,
    frequencyCapped,
  };
}

export const CAMPAIGN_LIMITS = Object.freeze({
  maxRecipients: MAX_RECIPIENTS,
  maxFields: MAX_FIELDS,
  maxBlocks: MAX_BLOCKS,
  maxAttachments: MAX_ATTACHMENTS,
  maxTextLength: MAX_TEXT_LENGTH,
  defaultOptOut: DEFAULT_OPT_OUT,
  media: Object.fromEntries(Object.entries(MEDIA_RULES).map(([kind, rule]) => [kind, {
    maxBytes: rule.maxBytes,
    extensions: [...rule.extensions],
    mimeTypes: [...rule.mimeTypes],
  }])),
});
