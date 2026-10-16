const CODE_FIELD = 'ufCrm13_1790841151894';
const NOMINAL_FIELD = 'ufCrm13_1790843078590';
const USED_FIELD = 'ufCrm13_1790844939861';
const BALANCE_FIELD = 'ufCrm13_1790844956658';

function decodeHtml(value) {
  return String(value).replace(/&(#x[\da-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    }
    return named[entity.toLowerCase()] || '';
  });
}

function cellText(html) {
  return decodeHtml(String(html).replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function isoDate(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value).trim());
  if (!match) throw new Error(`Некорректная дата в отчёте Digift: ${value}`);
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  if (new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) {
    throw new Error(`Несуществующая дата в отчёте Digift: ${value}`);
  }
  return iso;
}

function parseMoney(value) {
  const clean = String(value).replace(/[\s\u00a0]/g, '').replace(/(?:руб\.?|₽)$/i, '').replace(',', '.');
  const number = Number(clean);
  if (!Number.isFinite(number) || number <= 0 || Math.round(number * 100) !== number * 100) {
    throw new Error(`Некорректный номинал в отчёте Digift: ${value}`);
  }
  return number;
}

function reportTableRows(html) {
  const tables = String(html).match(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi) || [];
  for (const table of tables) {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)]
      .map((row) => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)]
        .map((cell) => cellText(cell[1])));
    const header = rows.findIndex((row) => row.length >= 6 &&
      /^номер карты$/i.test(row[0]) && /^номинал/i.test(row[1]) && /^дата покупки$/i.test(row[2]) &&
      /^дата начала действия$/i.test(row[3]) && /^дата окончания действия$/i.test(row[4]));
    if (header >= 0) return rows.slice(header + 1);
  }
  // Bitrix24 mail.message.get can return the HTML email converted to plain text.
  // In that representation each table cell occupies its own non-empty line.
  if (!tables.length) {
    const lines = String(html).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const header = lines.findIndex((line, index) => /^номер карты$/i.test(line) &&
      /^номинал/i.test(lines[index + 1] || '') && /^дата покупки$/i.test(lines[index + 2] || '') &&
      /^дата начала действия$/i.test(lines[index + 3] || '') &&
      /^дата окончания действия$/i.test(lines[index + 4] || '') && /^канал$/i.test(lines[index + 5] || ''));
    if (header >= 0) {
      const rows = [];
      for (let index = header + 6; index < lines.length;) {
        if (/^итого\s*:/i.test(lines[index])) { rows.push([lines[index]]); return rows; }
        if (index + 5 >= lines.length) break;
        rows.push(lines.slice(index, index + 6));
        index += 6;
      }
    }
  }
  throw new Error('Таблица подарочных карт Digift не найдена; формат письма изменился');
}

export function parseDigiftReport({ from, subject, html, messageId = '' }) {
  const sender = /<([^<>]+)>/.exec(String(from))?.[1] || String(from);
  if (sender.trim().toLowerCase() !== 'noreply@digift.ru') {
    throw new Error('Неожиданный отправитель отчёта Digift');
  }
  if (!/^отч[её]т по подарочным картам$/i.test(String(subject).trim())) {
    throw new Error('Неожиданная тема отчёта Digift');
  }
  if (!html || String(html).length > 2_000_000) throw new Error('Письмо Digift пустое или слишком большое');
  const rows = reportTableRows(html);
  const certificates = [];
  let reportedTotal = null;
  const seen = new Set();
  for (const cells of rows) {
    if (!cells.length) continue;
    if (/^итого\s*:/i.test(cells[0])) {
      const amount = cells[0].split(':').slice(1).join(':').trim();
      reportedTotal = parseMoney(amount);
      break;
    }
    if (!cells[0] && cells.every((cell) => !cell)) continue;
    if (cells.length < 6) throw new Error('Неполная строка сертификата Digift');
    const code = cells[0].trim().toUpperCase();
    if (!/^[A-Z0-9-]{6,64}$/.test(code)) throw new Error(`Некорректный код сертификата: ${code}`);
    if (seen.has(code)) throw new Error(`Повтор кода в одном отчёте: ${code}`);
    seen.add(code);
    const nominal = parseMoney(cells[1]);
    const purchasedAt = isoDate(cells[2]);
    const startsAt = isoDate(cells[3]);
    const expiresAt = isoDate(cells[4]);
    if (startsAt > expiresAt) throw new Error(`Дата начала позже окончания у ${code}`);
    certificates.push({ code, nominal, purchasedAt, startsAt, expiresAt, channel: cells[5] });
  }
  if (!certificates.length) throw new Error('В отчёте Digift нет сертификатов');
  const calculatedTotal = Math.round(certificates.reduce((sum, card) => sum + card.nominal, 0) * 100) / 100;
  if (reportedTotal === null || calculatedTotal !== reportedTotal) {
    throw new Error(`Итог отчёта Digift не совпадает: строки ${calculatedTotal}, отчёт ${reportedTotal}`);
  }
  return { messageId: String(messageId), certificates, total: calculatedTotal };
}

function money(value) { return Number(String(value ?? '').split('|')[0].replace(',', '.')) || 0; }
function dateOnly(value) { return String(value || '').slice(0, 10); }

export function planDigiftImport(report, existingItems) {
  if (!Array.isArray(existingItems) || existingItems.length >= 500) {
    throw new Error('Не удалось безопасно сверить все сертификаты СП (лимит 500)');
  }
  const byCode = new Map();
  for (const item of existingItems) {
    const code = String(item[CODE_FIELD] || '').trim().toUpperCase();
    if (code) {
      if (byCode.has(code)) throw new Error(`В СП есть дублирующийся код ${code}`);
      byCode.set(code, item);
    }
  }
  return report.certificates.map((card) => {
    const existing = byCode.get(card.code);
    if (existing) {
      const sameNominal = money(existing[NOMINAL_FIELD]) === card.nominal;
      const sameStart = !existing.begindate || dateOnly(existing.begindate) === card.startsAt;
      const sameEnd = !existing.closedate || dateOnly(existing.closedate) === card.expiresAt;
      if (!sameNominal || !sameStart || !sameEnd) return { action: 'conflict', code: card.code,
        existingId: existing.id, reason: !sameNominal ? 'номинал' : !sameStart ? 'дата начала' : 'дата окончания' };
      const dateFields = { ...(!existing.begindate ? { begindate: card.startsAt } : {}),
        ...(!existing.closedate ? { closedate: card.expiresAt } : {}) };
      return { action: Object.keys(dateFields).length ? 'updateDates' : 'exists', code: card.code,
        existingId: existing.id, fields: dateFields };
    }
    return { action: 'create', code: card.code, fields: {
      title: `Сертификат ${card.code}`, xmlId: `TILDA_CERT_${card.code}`,
      [CODE_FIELD]: card.code, [NOMINAL_FIELD]: `${card.nominal}|RUB`,
      [USED_FIELD]: '0|RUB', [BALANCE_FIELD]: `${card.nominal}|RUB`,
      begindate: card.startsAt, closedate: card.expiresAt,
      sourceDescription: `Digift. Куплен ${card.purchasedAt}. Канал: ${card.channel}.`,
    } };
  });
}
