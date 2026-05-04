export function toDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

export function toBaseId(value = '') {
  return String(value || '').split('@')[0].split(':')[0];
}

export function isLidIdentifier(value = '') {
  const text = String(value || '');
  return text.includes('@lid') || text.includes('@hosted.lid');
}

export function normalizeLidJid(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (isLidIdentifier(raw)) return raw;
  const base = toBaseId(raw);
  return base ? `${base}@lid` : null;
}

export function normalizeRealWhatsAppPhone(value = '') {
  if (isLidIdentifier(value)) return null;
  const digits = toDigits(value);
  if (!digits) return null;

  if (/^55[1-9]\d\d{8,9}$/.test(digits)) return digits;
  if (/^[1-9]\d\d{8,9}$/.test(digits)) return `55${digits}`;

  return null;
}

export function isRealWhatsAppPhone(value = '') {
  return !!normalizeRealWhatsAppPhone(value);
}

export function getLeadRealPhone(lead = {}) {
  return normalizeRealWhatsAppPhone(lead.phone)
    || normalizeRealWhatsAppPhone(lead.displayNumber)
    || normalizeRealWhatsAppPhone(lead.number)
    || null;
}

export function getLeadInternalWhatsAppId(lead = {}) {
  const candidates = [
    lead.lidJid,
    lead.internalWhatsAppId,
    lead.jid,
    lead.replyTargetJid,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isLidIdentifier(candidate)) return candidate;
  }

  const rawNumber = String(lead.number || '');
  if (!getLeadRealPhone(lead) && /^\d{14,}$/.test(rawNumber)) {
    return `${rawNumber}@lid`;
  }

  return null;
}

export function formatRealWhatsAppPhone(value = '') {
  const phone = normalizeRealWhatsAppPhone(value);
  if (!phone) return 'Nao resolvido';

  let local = phone;
  if (local.startsWith('55')) local = local.slice(2);
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}

export function buildWaLinkNumber(value = '') {
  return normalizeRealWhatsAppPhone(value);
}

export function buildClientSendOptions(target, baseOptions = {}) {
  const targetText = String(target || '');
  if (isLidIdentifier(targetText)) {
    const { forcePhoneJid, ...rest } = baseOptions || {};
    return {
      ...rest,
      allowRawLid: true,
      forcePhoneJid: false,
    };
  }

  return {
    ...(baseOptions || {}),
    forcePhoneJid: true,
    allowRawLid: false,
  };
}
