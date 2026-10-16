import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDigiftReport, planDigiftImport } from '../backend/digift-certificates.js';
import { isDigiftPollingWindow, runDigiftMailImport } from '../backend/digift-mail-import.js';

const html = `<p>За период 11.10.2026 были приобретены подарочные карты:</p>
<table><tr><th>Номер карты</th><th>Номинал, руб.</th><th>Дата покупки</th>
<th>Дата начала действия</th><th>Дата окончания действия</th><th>Канал</th></tr>
<tr><td>3833050577513117</td><td>4000</td><td>11.10.2026</td><td>11.10.2026</td><td>11.10.2027</td><td>B2C-виджет (мобильный сайт)</td></tr>
<tr><td>3724283767952791</td><td>5000</td><td>11.10.2026</td><td>12.10.2026</td><td>12.10.2027</td><td>B2C-виджет (мобильный сайт)</td></tr>
<tr><td>9987664212282405</td><td>3000</td><td>11.10.2026</td><td>11.10.2026</td><td>11.10.2027</td><td>B2C-виджет (iframe)</td></tr>
<tr><td colspan="6">ИТОГО: 12000</td></tr>
<tr><td colspan="6">СУММА К ПЕРЕЧИСЛЕНИЮ: 10800</td></tr></table>`;
const message = { from: 'V2SD <noreply@digift.ru>', subject: 'Отчет по подарочным картам', html, messageId: '34489' };

test('parses the pictured Digift daily report and keeps validity dates as data', () => {
  const report = parseDigiftReport(message);
  assert.equal(report.total, 12000);
  assert.equal(report.certificates.length, 3);
  assert.deepEqual(report.certificates[1], { code: '3724283767952791', nominal: 5000,
    purchasedAt: '2026-10-11', startsAt: '2026-10-12', expiresAt: '2027-10-12', channel: 'B2C-виджет (мобильный сайт)' });
  const plan = planDigiftImport(report, []);
  assert.equal(plan.every((item) => item.action === 'create'), true);
  assert.equal(plan[1].fields.begindate, '2026-10-12');
  assert.equal(plan[1].fields.closedate, '2027-10-12');
  assert.equal(plan[1].fields.ufCrm13_1790844939861, '0|RUB');
});

test('parses Bitrix24 mail.message.get plain-text rendering of the report', () => {
  const body = `Уважаемый партнер.\n\nНомер карты\nНоминал, руб.\nДата покупки\nДата начала действия\nДата окончания действия\nКанал\n\n3833050577513117\n4000\n11.10.2026\n11.10.2026\n11.10.2027\nB2C-виджет (мобильный сайт)\n\n3724283767952791\n5000\n11.10.2026\n12.10.2026\n12.10.2027\nB2C-виджет (мобильный сайт)\n\n9987664212282405\n3000\n11.10.2026\n11.10.2026\n11.10.2027\nB2C-виджет (iframe)\n\nИТОГО: 12000\nСУММА К ПЕРЕЧИСЛЕНИЮ: 10800`;
  const report = parseDigiftReport({ ...message, html: body });
  assert.equal(report.total, 12000);
  assert.equal(report.certificates.length, 3);
  assert.equal(report.certificates[1].startsAt, '2026-10-12');
});

test('rejects altered sender, incorrect total and duplicate codes', () => {
  assert.throws(() => parseDigiftReport({ ...message, from: 'fake@example.com' }), /отправитель/);
  assert.throws(() => parseDigiftReport({ ...message, html: html.replace('ИТОГО: 12000', 'ИТОГО: 11000') }), /не совпадает/);
  assert.throws(() => parseDigiftReport({ ...message, html: html.replace('3724283767952791', '3833050577513117') }), /Повтор кода/);
});

test('existing certificates keep their usage; only empty validity dates are filled', () => {
  const report = parseDigiftReport(message);
  const card = { id: 7, ufCrm13_1790841151894: '3833050577513117', ufCrm13_1790843078590: '4000|RUB',
    ufCrm13_1790844939861: '1000|RUB', ufCrm13_1790844956658: '3000|RUB', closedate: '2027-10-11' };
  const plan = planDigiftImport(report, [card]);
  assert.equal(plan[0].action, 'updateDates');
  assert.deepEqual(plan[0].fields, { begindate: '2026-10-11' });
  assert.equal(plan[0].fields.ufCrm13_1790844939861, undefined);
  assert.equal(planDigiftImport(report, [{ ...card, closedate: '2028-10-11' }])[0].action, 'conflict');
});

test('Bitrix mailbox dry-run fetches the report but does not mutate CRM', async () => {
  const calls = [];
  const mailCall = async (method) => {
    calls.push(method);
    if (method === 'mail.mailbox.list') return { result: { items: [{ id: 9, email: 'v2sportdress.ru@mail.ru' }] } };
    if (method === 'mail.message.list') return { result: { items: [{ id: 34489, mailboxEmail: 'v2sportdress.ru@mail.ru',
      subject: message.subject, from: message.from }] } };
    return { result: { item: { id: 34489, mailboxEmail: 'v2sportdress.ru@mail.ru', subject: message.subject,
      from: message.from, body: html } } };
  };
  const crmCall = async (method) => {
    if (method !== 'GET') throw new Error('Dry-run attempted a write');
    return { data: [] };
  };
  const result = await runDigiftMailImport({ mailCall, crmCall, apply: false });
  assert.deepEqual(calls, ['mail.mailbox.list', 'mail.message.list', 'mail.message.get']);
  assert.equal(result.actions.filter((item) => item.action === 'create').length, 3);
});

test('import is idempotent and never resets an already used certificate', async () => {
  const cards = [];
  const mailCall = async (method) => {
    if (method === 'mail.mailbox.list') return { result: { items: [{ id: 9, email: 'v2sportdress.ru@mail.ru' }] } };
    if (method === 'mail.message.list') return { result: { items: [{ id: 34489, mailboxEmail: 'v2sportdress.ru@mail.ru',
      subject: message.subject, from: message.from }] } };
    return { result: { item: { id: 34489, mailboxEmail: 'v2sportdress.ru@mail.ru', subject: message.subject,
      from: message.from, body: html } } };
  };
  let creates = 0;
  const crmCall = async (method, endpoint, fields) => {
    if (method === 'GET') return { data: cards.map((card) => ({ ...card })) };
    assert.equal(endpoint, '/items/1052');
    creates++;
    cards.push({ id: creates, ...fields });
    return { data: { id: creates } };
  };
  await runDigiftMailImport({ mailCall, crmCall, apply: true });
  assert.equal(creates, 3);
  cards[0].ufCrm13_1790844939861 = '1000|RUB';
  cards[0].ufCrm13_1790844956658 = '3000|RUB';
  await runDigiftMailImport({ mailCall, crmCall, apply: true });
  assert.equal(creates, 3);
  assert.equal(cards[0].ufCrm13_1790844939861, '1000|RUB');
  assert.equal(cards[0].ufCrm13_1790844956658, '3000|RUB');
});

test('scheduler uses Moscow 09:00–10:30, regardless of host timezone', () => {
  assert.equal(isDigiftPollingWindow(new Date('2026-10-13T05:59:00Z')), false);
  assert.equal(isDigiftPollingWindow(new Date('2026-10-13T06:00:00Z')), true);
  assert.equal(isDigiftPollingWindow(new Date('2026-10-13T07:29:00Z')), true);
  assert.equal(isDigiftPollingWindow(new Date('2026-10-13T07:30:00Z')), false);
});
