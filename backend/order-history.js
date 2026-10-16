// Display-only rules. Active orders may use CRM creation as the order date;
// imported archive records must keep their original source date.
function value(record, field) {
  return record[field] ?? record[field.toUpperCase()] ?? record[field.replace(/^./, c => c.toUpperCase())] ?? '';
}

export function isAccountHistoryLead(record) {
  const type = String(record.entityType || record.type || '').toLowerCase();
  const title = String(record.title || record.TITLE || '').trim();
  return type === 'lead' || Number(record.entityTypeId) === 1 ||
    /^(?:лид|lead)\s*(?:[#№]\s*)?\d+\s*$/i.test(title);
}

export function accountOrderNumber(record, fields = {}) {
  for (const field of [fields.orderId || 'ufCrm_692EB51A171A6', fields.tildaOrderId || 'ufCrm_692EB518817D6']) {
    const number = String(value(record, field)).trim();
    if (number && number !== '0') return number.replace(/^(?:Заказ\s*)?[№#]\s*/i, '');
  }
  // An explicit order label is allowed; a CRM record ID is never an order number.
  const title = String(record.title || record.TITLE || '');
  const match = /заказ[^№#\r\n]*[№#]\s*([\p{L}\p{N}][\p{L}\p{N}._/-]*)/iu.exec(title);
  return match?.[1] || '';
}

export function validOrderDay(input) {
  const text = String(input || '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?=$|[T\s])/.exec(text);
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})(?=$|\s)/.exec(text);
  if (!iso && !ru) return null;
  const day = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : `${ru[3]}-${ru[2]}-${ru[1]}`;
  const date = new Date(`${day}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}

export function accountOrderDate(record) {
  const stored = validOrderDay(value(record, 'ufCrm_V2SD_NOCODB_ORDER_DATE'));
  if (stored) return { date: stored, dateSource: 'original_order' };

  // Imported Tilda orders can carry the original date only in a labelled comment.
  // Ignore unlabeled dates (import, payment, delivery etc.) and conflicting dates.
  const comments = String(record.comments || record.COMMENTS || '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ');
  const matches = [...comments.matchAll(/Дата\s+(?:заказа(?:\s+(?:Tilda|NocoDB))?|Tilda|NocoDB)\s*:\s*(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})(?!\d)/gi)];
  const tildaOrderMatches = [...comments.matchAll(/Заказ\s+Tilda\b[^\r\n]*?\s+от\s+(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})(?!\d)/gi)];
  const days = [...new Set([...matches, ...tildaOrderMatches].map(match => validOrderDay(match[1])).filter(Boolean))];
  if (days.length === 1) return { date: days[0], dateSource: 'order_comment' };
  if (days.length > 1) return { date: null, dateSource: 'conflicting_order_dates' };

  const stageId = String(value(record, 'stageId')).trim().toUpperCase();
  const archived = ['C1:UC_5WTFOJ', 'C1:UC_ER41UI'].includes(stageId);
  const dealCreated = archived ? null : validOrderDay(value(record, 'createdAt'));
  if (dealCreated) return { date: dealCreated, dateSource: 'deal_created' };
  return { date: null, dateSource: 'unknown' };
}
