import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { accountOrderDate, accountOrderNumber, isAccountHistoryLead } from '../backend/order-history.js';

test('history excludes real leads and technical lead titles, not converted orders', () => {
  for (const record of [{type:'lead'}, {entityTypeId:1}, {title:'Лид #14117'}, {TITLE:'Lead #22'}]) assert.equal(isAccountHistoryLead(record), true);
  assert.equal(isAccountHistoryLead({title:'Заказ № 123', leadId:14117}), false);
  assert.equal(isAccountHistoryLead({title:'Лидер коллекции'}), false);
});
test('order number comes from order fields or explicit order title, never CRM ID', () => {
  assert.equal(accountOrderNumber({id:88, title:'Архивный заказ NocoDB №1016728291'}), '1016728291');
  assert.equal(accountOrderNumber({ufCrm_692EB51A171A6:'123',title:'Заказ № 456'}), '123');
  assert.equal(accountOrderNumber({id:88,title:'Лид #14117'}), '');
  assert.equal(accountOrderNumber({id:88,title:'Сделка #88'}), '');
  assert.equal(accountOrderNumber({custom:'OFF-12'}, {orderId:'custom'}), 'OFF-12');
});
test('NocoDB date is the original date, not creation/import date', () => {
  assert.deepEqual(accountOrderDate({createdAt:'2026-09-18',ufCrm_V2SD_NOCODB_ORDER_DATE:'2025-08-22'}), {date:'2025-08-22',dateSource:'original_order'});
});
test('Tilda original date in labelled comments, including HTML and Russian date', () => {
  assert.equal(accountOrderDate({comments:'Дата Tilda: 2024-06-01\nДата Tilda: 2024-06-01'}).date, '2024-06-01');
  assert.equal(accountOrderDate({comments:'<p><b>Дата заказа Tilda:</b>&nbsp;22.08.2025</p>'}).date, '2025-08-22');
  assert.equal(accountOrderDate({comments:'Заказ Tilda 1172891851 от 2026-10-08 08:10.'}).date, '2026-10-08');
});
test('missing and invalid dates stay empty for archives and records without a deal date', () => {
  for (const stageId of ['C1:UC_5WTFOJ','C1:UC_ER41UI']) {
    assert.equal(accountOrderDate({stageId,createdAt:'2025-12-23',begindate:'2025-12-23'}).date, null);
  }
  for (const date of ['2025-02-29','2025-02-31','2025-13-01','garbage']) assert.equal(accountOrderDate({ufCrm_V2SD_NOCODB_ORDER_DATE:date}).date, null);
  assert.equal(accountOrderDate({comments:'Дата оплаты: 2025-08-22; импорт 2026-09-18'}).date, null);
  assert.equal(accountOrderDate({comments:'Дата заказа: 2024-02-29'}).date, '2024-02-29');
});
test('active orders use the Bitrix deal creation date when no original source date is stored', () => {
  assert.deepEqual(accountOrderDate({stageId:'C1:PREPARATION',createdAt:'2026-10-13T14:13:09.000Z'}), {date:'2026-10-13',dateSource:'deal_created'});
  assert.deepEqual(accountOrderDate({stageId:'C1:UC_79WI97',createdAt:'13.10.2026'}), {date:'2026-10-13',dateSource:'deal_created'});
});
test('ambiguous comment dates are not guessed; explicit original-date field wins', () => {
  const comments='Дата Tilda: 2025-06-11\nДата NocoDB: 2025-07-02';
  assert.equal(accountOrderDate({comments}).date, null);
  assert.equal(accountOrderDate({comments,ufCrm_V2SD_NOCODB_ORDER_DATE:'2025-07-02'}).date, '2025-07-02');
});

const serverPath = process.env.HISTORY_SERVER_FILE || new URL('../backend/server.js', import.meta.url);
const server = fs.readFileSync(serverPath, 'utf8');
const block = server.slice(server.indexOf('async function loadContactDeals('), server.indexOf('async function createBitrixOrder('));
function context(request) {
  const ctx = vm.createContext({ accountOrderDate, accountOrderNumber, isAccountHistoryLead,
    clean:v=>String(v||'').trim(), bitrixRequest:request, asArray:v=>Array.isArray(v)?v:[],
    dealOrderFields:{paymentStatus:'paid',operation:'operation',orderId:'orderId',tildaOrderId:'tildaOrderId',track:'track'},
    dealOrderValues:{paymentStatus:'Оплачено'},canceledDealStageIds:new Set(),
    numberOrZero:v=>Number(v)||0,numberOrNull:v=>v==null?null:Number(v),console });
  vm.runInContext(block, ctx);
  return ctx;
}
test('actual backend mapping keeps products, formats archive number, no technical title/status suffix', async () => {
  const ctx=context(async()=>[{productName:'Шорты',price:3000,quantity:1}]);
  const deal={id:5,stageId:'C1:UC_5WTFOJ',paid:'Оплачено',title:'Архивный заказ NocoDB №123',createdAt:'2026-09-18'};
  const mapped=await ctx.mapAccountDeal(deal);
  assert.equal(mapped.composition,'Шорты');
  assert.equal(mapped.orderNumber,'123');
  assert.equal(mapped.date,null);
  const noProducts=await context(async()=>[]).mapAccountDeal(deal);
  assert.equal(noProducts.composition,'Заказ № 123');
  assert.equal(noProducts.title,'Заказ № 123');
  assert.equal(noProducts.status,'Выполнен');
  const unnamed=await context(async()=>[]).mapAccountDeal({...deal,title:'Сделка #5'});
  assert.equal(unnamed.composition,'');
});
test('actual history query uses deals only, selects original date/number/comments and excludes lead rows', async () => {
  const calls=[];
  const ctx=context(async(p,options)=>{
    calls.push(p);
    if(p==='/v1/deals/search') {
      const select=JSON.parse(options.body).select;
      for(const field of ['comments','orderId','tildaOrderId','track','ufCrm_V2SD_NOCODB_ORDER_DATE']) assert.ok(select.includes(field));
      return [{id:1,title:'Лид #14117',stageId:'C1:UC_ER41UI',paid:'Оплачено'},
        {id:2,title:'Заказ №123',stageId:'C1:UC_5WTFOJ',paid:'Оплачено'},
        {id:3,title:'Заказ №456',stageId:'C1:NEW',paid:'Не оплачен'},
        {id:4,title:'Заказ №789',stageId:'C1:LOSE',stageSemanticId:'F',paid:'Оплачено'}];
    }
    return [];
  });
  assert.deepEqual(Array.from(await ctx.loadContactDeals(99), x=>x.id),[2]);
  assert.ok(calls.every(p=>p.startsWith('/v1/deals')));
  assert.ok(!calls.includes('/v1/deals/1/products'));
});
test('history-only exclusion does not alter shared bonus eligibility rules', () => {
  const ctx=context(async()=>[]);
  assert.equal(ctx.shouldShowAccountDeal({title:'Лид #14117',stageId:'C1:UC_ER41UI',paid:'Оплачено'}),true);
  assert.equal(ctx.shouldShowAccountDeal({title:'Заказ №123',stageId:'C1:PREPARATION',paid:'Оплачен'}),true);
  assert.equal(ctx.shouldShowAccountDeal({title:'Заказ №124',stageId:'C1:LOSE',stageSemanticId:'F',paid:'Оплачено'}),false);
  assert.equal(ctx.shouldShowAccountDeal({title:'Заказ №125',stageId:'C1:NEW',paid:'Оплачено'}),false);
  assert.equal(ctx.shouldShowAccountDeal({stageId:'C1:NEW',paid:'Не оплачен'}),false);
});

test('customer-facing statuses follow the order pipeline and include tracking in transit', async () => {
  const ctx=context(async()=>[{productName:'Товар',price:1000,quantity:1}]);
  const base={id:10,paid:'Оплачен',title:'Заказ №123',amount:1000};
  const cases=[
    ['C1:PREPARATION','Принят/Собирается'],
    ['C1:EXECUTING','На персонализации'],
    ['C1:FINAL_INVOICE','На персонализации'],
    ['C1:UC_04FYEQ','Готов к отправке'],
    ['C1:UC_79WI97','В пути'],
    ['C1:WON','Доставлен'],
    ['C1:UC_ER41UI','Выполнен'],
  ];
  for (const [stageId,status] of cases) assert.equal((await ctx.mapAccountDeal({...base,stageId})).status,status);
  assert.equal((await ctx.mapAccountDeal({...base,stageId:'C1:UC_79WI97',track:'10334394384'})).status,'В пути (трек-номер: 10334394384)');
});

const frontendPath=process.env.HISTORY_FRONTEND_FILE || new URL('../frontend/tilda-bitrix-orders.js', import.meta.url);
const frontend=fs.readFileSync(frontendPath,'utf8');
function createRow() {
  return {cells:[{textContent:''},{textContent:''},{textContent:''}],dataset:{},
    cloneNode(){return createRow();}, insertCell(){this.cells.push({textContent:''});}};
}
test('actual Tilda renderer leaves unknown date empty and preserves registration bonus', () => {
  const row=createRow();
  const rows=[row];
  const tbody={querySelector:()=>row,querySelectorAll:()=>[],appendChild:r=>rows.push(r)};
  const table={querySelector:()=>tbody};
  const document={readyState:'loading',addEventListener(){},getElementById:()=>null,querySelectorAll:()=>[],querySelector:()=>table};
  const ctx=vm.createContext({document,window:{},console,URLSearchParams});
  vm.runInContext(frontend.replace('  ready(async () => {','  globalThis.render = renderOrders;\n  ready(async () => {'),ctx);
  ctx.render({contact:{loyalty:{registeredAt:'2025-12-27'}},orders:[
    {id:5,archived:true,date:null,composition:'Заказ № 1016728291',sum:3000,status:'Выполнен'},
    {id:6,archived:true,date:'2025-08-22',composition:'Шорты',sum:4000,status:'Выполнен'}]});
  assert.equal(rows.length,3);
  const archive=rows.find(r=>r.cells[1].textContent==='Заказ № 1016728291');
  assert.ok(archive);
  assert.equal(archive.cells[0].textContent,'');
  assert.ok(rows.some(r=>r.cells[1].textContent==='Шорты'));
  assert.ok(rows.some(r=>r.cells[1].textContent==='Бонусные баллы за регистрацию'));
  assert.ok(rows.every(r=>!r.cells[1].textContent.includes('Выполнен')));
});
