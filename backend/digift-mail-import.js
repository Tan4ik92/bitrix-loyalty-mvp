import { parseDigiftReport, planDigiftImport } from './digift-certificates.js';

const mailboxEmail = 'v2sportdress.ru@mail.ru';
const reportSubject = 'Отчет по подарочным картам';

function resultItems(payload) {
  const result = payload?.result ?? payload?.data ?? payload;
  return result?.items ?? result?.item ?? result;
}

function moscowTime(now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now);
  return Number(parts.find((part) => part.type === 'hour')?.value) * 60 + Number(parts.find((part) => part.type === 'minute')?.value);
}

export function isDigiftPollingWindow(now = new Date()) {
  const minute = moscowTime(now);
  return minute >= 9 * 60 && minute < 10 * 60 + 30;
}

function restV3Base(raw) {
  const value = String(raw || '').trim().replace(/\/$/, '');
  if (!/^https:\/\//i.test(value)) throw new Error('Не настроен HTTPS-вебхук Bitrix24 с правом mail');
  const url = new URL(value);
  if (!url.pathname.includes('/rest/api/')) url.pathname = url.pathname.replace('/rest/', '/rest/api/');
  if (!/\/rest\/api\/\d+\/[^/]+$/.test(url.pathname)) throw new Error('Неверный формат вебхука Bitrix24 REST 3.0');
  return url.toString().replace(/\/$/, '');
}

export function createDigiftApi({ mailWebhookUrl, crmBaseUrl, crmApiKey, fetchImpl = fetch }) {
  const mailBase = restV3Base(mailWebhookUrl);
  const crmBase = String(crmBaseUrl || 'https://vibecode.bitrix24.tech').replace(/\/$/, '');
  if (!crmApiKey) throw new Error('Не настроен ключ CRM API');
  async function request(url, body, headers) {
    const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const payload = await response.json();
    if (!response.ok || payload?.success === false || payload?.error) {
      throw new Error(`Ошибка API (${response.status}): ${payload?.error?.code || payload?.error || 'неизвестная ошибка'}`);
    }
    return payload;
  }
  return {
    mailCall: (method, body) => request(`${mailBase}/${method}`, body),
    crmCall: async (method, path, body) => {
      const url = `${crmBase}/v1${path}`;
      const response = await fetchImpl(url, { method, headers: { 'X-Api-Key': crmApiKey, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
      const payload = await response.json();
      if (!response.ok || payload?.success === false) {
        const code = typeof payload?.error === 'object' ? payload.error.code : payload?.error;
        throw new Error(`Ошибка CRM API (${response.status}${code ? `: ${code}` : ''})`);
      }
      return payload;
    },
  };
}

export async function runDigiftMailImport({ mailCall, crmCall, apply = false, now = new Date() }) {
  const mailboxResult = resultItems(await mailCall('mail.mailbox.list', {
    email: mailboxEmail, pagination: { page: 1, limit: 100 },
  }));
  const mailboxes = Array.isArray(mailboxResult) ? mailboxResult : [];
  const mailbox = mailboxes.find((item) => String(item.email).trim().toLowerCase() === mailboxEmail);
  if (!mailbox) throw new Error(`Ящик ${mailboxEmail} не доступен через текущий Bitrix24-вебхук`);

  const from = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const messages = [];
  for (let page = 1; page <= 10; page++) {
    const result = resultItems(await mailCall('mail.message.list', {
      mailboxId: Number(mailbox.id), searchQuery: reportSubject, dateFrom: from,
      pagination: { page, limit: 100 },
    }));
    if (!Array.isArray(result)) throw new Error('Bitrix24 вернул неожиданный список писем');
    messages.push(...result);
    if (result.length < 100) break;
    if (page === 10) throw new Error('Слишком много писем для безопасной обработки');
  }

  const reports = [];
  for (const candidate of messages) {
    if (String(candidate.mailboxEmail).trim().toLowerCase() !== mailboxEmail ||
      String(candidate.subject).trim() !== reportSubject) continue;
    const sender = /<([^<>]+)>/.exec(String(candidate.from))?.[1] || String(candidate.from);
    if (sender.trim().toLowerCase() !== 'noreply@digift.ru') continue;
    const detail = resultItems(await mailCall('mail.message.get', {
      id: Number(candidate.id), select: ['id', 'mailboxEmail', 'subject', 'from', 'date', 'body'],
    }));
    if (String(detail.mailboxEmail).trim().toLowerCase() !== mailboxEmail) throw new Error('Письмо получено не из ожидаемого ящика');
    reports.push(parseDigiftReport({ from: detail.from, subject: detail.subject, html: detail.body, messageId: String(detail.id) }));
  }

  const crmResult = await crmCall('GET', '/items/1052?limit=500&select=*');
  const raw = crmResult?.data ?? crmResult;
  const existing = Array.isArray(raw) ? raw : raw?.items;
  if (!Array.isArray(existing)) throw new Error('Не удалось получить карточки СП «Сертификаты»');
  const actions = [];
  for (const report of reports) {
    const plan = planDigiftImport(report, existing);
    if (plan.some((item) => item.action === 'conflict')) {
      actions.push({ messageId: report.messageId, status: 'conflict', plan });
      continue;
    }
    for (const item of plan) {
      actions.push({ messageId: report.messageId, action: item.action, code: item.code });
      if (!apply || item.action === 'exists') continue;
      if (item.action === 'create') {
        const created = await crmCall('POST', '/items/1052', item.fields);
        existing.push({ id: created?.data?.id ?? created?.data?.item?.id, ...item.fields });
      } else if (item.action === 'updateDates') {
        await crmCall('PATCH', `/items/1052/${encodeURIComponent(item.existingId)}`, item.fields);
        const current = existing.find((card) => String(card.id) === String(item.existingId));
        if (current) Object.assign(current, item.fields);
      }
    }
  }
  return { mode: apply ? 'apply' : 'dry-run', scannedMessages: messages.length, validReports: reports.length, actions };
}

export function startDigiftMailImportLoop({ mailCall, crmCall, intervalMs = 10 * 60 * 1000, now = () => new Date(), logger = console }) {
  let running = false;
  const tick = async () => {
    if (running || !isDigiftPollingWindow(now())) return;
    running = true;
    try {
      const result = await runDigiftMailImport({ mailCall, crmCall, apply: true, now: now() });
      logger.info('Digift certificate import', { scannedMessages: result.scannedMessages, validReports: result.validReports,
        created: result.actions.filter((item) => item.action === 'create').length,
        conflicts: result.actions.filter((item) => item.status === 'conflict').length });
    } catch (error) { logger.error('Digift certificate import failed:', error.message); }
    finally { running = false; }
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(timer);
}
