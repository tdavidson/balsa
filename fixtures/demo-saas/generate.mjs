#!/usr/bin/env node
// Entirely invented software-test fixtures. All money is integer USD cents.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes('--check');
const files = new Map();
const months = Array.from({ length: 9 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
const lastDay = (month) => `${month}-${new Date(Date.UTC(2026, Number(month.slice(5)), 0)).getUTCDate()}`;
const dollars = (cents) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
const usd = (cents) => `${cents < 0 ? '-' : ''}$${dollars(Math.abs(cents))}`;
const csv = (rows) => rows.map((row) => row.map((v) => {
  const value = String(v ?? '');
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}).join(',')).join('\n') + '\n';
const put = (path, text) => { assert(!files.has(path), `duplicate file ${path}`); files.set(path, text.trimEnd() + '\n'); };
const table = (path, headers, rows) => put(path, csv([headers, ...rows]));
const accounts = {
  '1000': ['Operating checking', 'asset'], '1010': ['Reserve savings', 'asset'],
  '1020': ['Stripe clearing', 'asset'], '1100': ['Accounts receivable', 'asset'],
  '1200': ['Prepaid insurance', 'asset'], '1500': ['Computer equipment', 'asset'],
  '1510': ['Accumulated depreciation', 'contra_asset'], '2000': ['Accounts payable', 'liability'],
  '2100': ['Deferred subscription revenue', 'liability'], '3000': ['Paid-in capital', 'equity'],
  '4000': ['Subscription revenue', 'revenue'], '4010': ['Subscription refunds', 'contra_revenue'],
  '5000': ['Cloud hosting', 'expense'], '5010': ['Payment processing fees', 'expense'],
  '6000': ['Salaries', 'expense'], '6010': ['Employer payroll taxes', 'expense'],
  '6100': ['Software tools', 'expense'], '6200': ['Rent', 'expense'],
  '6300': ['Contractors', 'expense'], '6400': ['Marketing', 'expense'],
  '6500': ['Insurance', 'expense'], '6600': ['Depreciation', 'expense'],
};
let journalSeq = 0;
const journal = [], bank = [], stripe = [], payouts = [], invoices = [], metrics = [], results = [];
const balances = Object.fromEntries(Object.keys(accounts).map((code) => [code, 0]));
function post(date, description, source, lines) {
  assert.equal(lines.reduce((sum, [, amount]) => sum + amount, 0), 0, description);
  const id = `demo_je_${String(++journalSeq).padStart(4, '0')}`;
  for (const [code, amount] of lines) {
    assert(Number.isSafeInteger(amount)); assert(accounts[code]);
    balances[code] += amount;
    journal.push([date, id, code, accounts[code][0], description, amount > 0 ? dollars(amount) : '', amount < 0 ? dollars(-amount) : '', 'USD', source]);
  }
}
function cash(date, description, amount, account = '1000', reference = '') {
  bank.push({ date, description, amount, account, reference, sequence: bank.length });
}
function payment(date, description, cents, code, reference) {
  post(date, description, reference, [[code, cents], ['1000', -cents]]);
  cash(date, description, -cents, '1000', reference);
}
function payout(date, id, cents, transactionIds) {
  post(date, `Stripe payout ${id}`, id, [['1000', cents], ['1020', -cents]]);
  cash(date, `STRIPE PAYOUT ${id}`, cents, '1000', id);
  payouts.push([id, date, dollars(cents), 'USD', 'paid', 'demo_1000_001', transactionIds.join(';')]);
}
const customers = Array.from({ length: 12 }, (_, i) => ({
  id: `demo_cus_${String(i + 1).padStart(3, '0')}`,
  name: `Demo Customer ${String(i + 1).padStart(2, '0')}`,
  start: i < 4 ? '2026-01' : i < 6 ? '2026-02' : i < 8 ? '2026-03' : `2026-${String(i - 3).padStart(2, '0')}`,
  end: i === 1 ? '2026-07' : '',
}));
const annuals = [
  { id: 'demo_cus_101', name: 'Demo Annual Customer A', start: '2026-04', end: '2027-03-31', cents: 2400000 },
  { id: 'demo_cus_102', name: 'Demo Annual Customer B', start: '2026-06', end: '2027-05-31', cents: 3600000 },
];
post('2025-12-31', 'Opening founder capital; no other opening assets or liabilities', '00-company/opening-balances.md', [['1000', 25000000], ['3000', -25000000]]);
table('00-company/chart-of-accounts.csv', ['Account Code', 'Account Name', 'Type', 'Currency'], Object.entries(accounts).map(([code, [name, type]]) => [code, name, type, 'USD']));
table('01-onboarding/customers.csv', ['Customer ID', 'Customer Name', 'Email', 'Billing', 'Start', 'End', 'Monthly Price USD', 'Annual Price USD'], [
  ...customers.map((c) => [c.id, c.name, `${c.id}@example.test`, 'monthly', `${c.start}-01`, c.end ? lastDay(c.end) : '', '1500.00', '']),
  ...annuals.map((c) => [c.id, c.name, `${c.id}@example.test`, 'annual prepaid', `${c.start}-01`, c.end, dollars(c.cents / 12), dollars(c.cents)]),
  ['demo_cus_201', 'Demo Enterprise Customer', 'enterprise@example.test', 'monthly invoice net 30', '2026-09-01', '', '4000.00', ''],
]);
let previousMrr = 0, previousCustomers = 0;
let heldPayout;
for (let index = 0; index < months.length; index++) {
  const month = months[index], end = lastDay(month), opening = { ...balances };
  const transactions = [], active = customers.filter((c) => c.start <= month && (!c.end || c.end >= month));
  const activeAnnuals = annuals.filter((c) => c.start <= month);
  let grossCharges = 0, fees = 0, refunds = 0;
  let monthlyMrr = 0;
  function charge(customer, cents, deferred, day) {
    const id = `demo_bt_${month.replace('-', '')}_${customer.id.slice(-3)}`;
    const invoice = `demo_inv_${month.replace('-', '')}_${customer.id.slice(-3)}`;
    const fee = Math.round(cents * 29 / 1000) + 30;
    const date = `${month}-${day}`;
    post(date, `Subscription charge ${customer.name}`, id, [['1020', cents], [deferred ? '2100' : '4000', -cents]]);
    post(date, `Stripe processing fee ${id}`, id, [['5010', fee], ['1020', -fee]]);
    const delayed = month === '2026-09' && ['011', '012'].includes(customer.id.slice(-3));
    const payoutId = delayed ? 'demo_po_20261002' : `demo_po_${month.replace('-', '')}`;
    stripe.push([id, date, 'charge', `Subscription ${customer.name}`, dollars(cents), dollars(fee), dollars(cents - fee), 'USD', customer.id, invoice, payoutId]);
    invoices.push([invoice, customer.id, customer.name, date, date, deferred ? `${month}-01` : `${month}-01`, deferred ? customer.end : end, dollars(cents), '0.00', dollars(cents), '0.00', 'paid', 'Stripe', id]);
    transactions.push({ id, net: cents - fee, delayed }); grossCharges += cents; fees += fee;
  }
  active.forEach((c) => {
    const price = month === '2026-09' && c.id === 'demo_cus_003' ? 100000 : 150000;
    monthlyMrr += price;
    charge(c, price, false, month === '2026-09' && ['demo_cus_011', 'demo_cus_012'].includes(c.id) ? '30' : '01');
  });
  annuals.filter((c) => c.start === month).forEach((c) => charge(c, c.cents, true, '01'));
  if (month === '2026-09') {
    refunds = 50000;
    const id = 'demo_bt_refund_202609';
    stripe.push([id, '2026-09-04', 'refund', 'Service credit Demo Customer 04', '-500.00', '0.00', '-500.00', 'USD', 'demo_cus_004', 'demo_inv_202609_004', 'demo_po_202609']);
    transactions.push({ id, net: -refunds, delayed: false });
    post('2026-09-04', 'One-time service credit; subscription remains active', id, [['4010', refunds], ['1020', -refunds]]);
  }
  const settled = transactions.filter((t) => !t.delayed);
  payout(`${month}-05`, `demo_po_${month.replace('-', '')}`, settled.reduce((sum, t) => sum + t.net, 0), settled.map((t) => t.id));
  const held = transactions.filter((t) => t.delayed);
  if (held.length) heldPayout = { amount: held.reduce((sum, t) => sum + t.net, 0), ids: held.map((t) => t.id) };
  for (const c of activeAnnuals) post(end, `Monthly service earned ${c.name}`, `contract_${c.id}`, [['2100', c.cents / 12], ['4000', -c.cents / 12]]);
  const enterpriseMrr = month === '2026-09' ? 400000 : 0;
  if (enterpriseMrr) {
    post('2026-09-01', 'Enterprise September service invoice; net 30', 'demo_inv_enterprise_sep', [['1100', enterpriseMrr], ['4000', -enterpriseMrr]]);
    invoices.push(['demo_inv_enterprise_sep', 'demo_cus_201', 'Demo Enterprise Customer', '2026-09-01', '2026-10-01', '2026-09-01', end, '4000.00', '0.00', '0.00', '4000.00', 'open', 'bank ACH', '']);
  }
  payment(`${month}-15`, 'Demo Payroll Bureau net wages (aggregate)', 2400000, '6000', `demo_payroll_${month}`);
  // Employer cost = 30k gross salaries + 3k employer taxes. Withholdings are
  // remitted in the same month: the 9k bank payment contains 6k employee + 3k employer taxes.
  post(`${month}-16`, 'Payroll withholding remittance and employer payroll taxes', `demo_payroll_${month}`, [['6000', 600000], ['6010', 300000], ['1000', -900000]]);
  cash(`${month}-16`, 'Demo Payroll Bureau tax remittance', -900000, '1000', `demo_payroll_${month}`);
  payment(`${month}-08`, 'Demo Cloud hosting', 90000 + index * 20000, '5000', `demo_cloud_${month}`);
  payment(`${month}-09`, 'Demo Worktools monthly software', 90000, '6100', `demo_tools_${month}`);
  payment(`${month}-03`, 'Demo Workspace rent', 120000, '6200', `demo_rent_${month}`);
  payment(`${month}-20`, 'Demo Design contractor', 250000, '6300', `demo_design_${month}`);
  payment(`${month}-22`, 'Demo Campaigns advertising', 50000 + index * 50000, '6400', `demo_ads_${month}`);
  if (month === '2026-04') {
    payment('2026-04-02', 'Demo Cover annual business insurance', 1200000, '1200', 'demo_insurance_annual');
    post('2026-04-06', 'Internal transfer to reserve savings', 'demo_transfer_apr', [['1010', 5000000], ['1000', -5000000]]);
    cash('2026-04-06', 'INTERNAL TRANSFER TO DEMO RESERVE', -5000000, '1000', 'demo_transfer_apr');
    cash('2026-04-06', 'INTERNAL TRANSFER FROM DEMO CHECKING', 5000000, '1010', 'demo_transfer_apr');
  }
  if (month === '2026-06') {
    post('2026-06-10', 'Founder equity contribution; not revenue or debt', 'demo_capital_jun', [['1000', 10000000], ['3000', -10000000]]);
    cash('2026-06-10', 'FOUNDER EQUITY CONTRIBUTION', 10000000, '1000', 'demo_capital_jun');
    payment('2026-06-12', 'Demo Devices laptop', 240000, '1500', 'demo_laptop_jun');
  }
  if (month === '2026-09') {
    post('2026-09-10', 'Internal transfer from reserve savings', 'demo_transfer_sep', [['1000', 2000000], ['1010', -2000000]]);
    cash('2026-09-10', 'INTERNAL TRANSFER FROM DEMO RESERVE', 2000000, '1000', 'demo_transfer_sep');
    cash('2026-09-10', 'INTERNAL TRANSFER TO DEMO CHECKING', -2000000, '1010', 'demo_transfer_sep');
    post(end, 'September security review invoice due October 15', 'demo_vendor_security_sep', [['6300', 180000], ['2000', -180000]]);
  }
  if (month >= '2026-04') post(end, 'Monthly insurance amortization', 'demo_insurance_annual', [['6500', 100000], ['1200', -100000]]);
  if (month >= '2026-06') post(end, 'Laptop depreciation; 24 months straight line', 'demo_laptop_jun', [['6600', 10000], ['1510', -10000]]);
  const movement = (code) => balances[code] - opening[code];
  const revenue = -movement('4000') - movement('4010');
  const cogs = movement('5000') + movement('5010');
  const expenses = Object.keys(accounts).filter((code) => code.startsWith('6')).reduce((sum, code) => sum + movement(code), 0);
  const profit = revenue - cogs - expenses;
  const annualMrr = activeAnnuals.reduce((sum, c) => sum + c.cents / 12, 0);
  const mrr = monthlyMrr + annualMrr + enterpriseMrr;
  const newMrr = active.filter((c) => c.start === month).length * 150000
    + annuals.filter((c) => c.start === month).reduce((sum, c) => sum + c.cents / 12, 0)
    + enterpriseMrr;
  const churnMrr = month === '2026-08' ? 150000 : 0, contraction = month === '2026-09' ? 50000 : 0;
  assert.equal(previousMrr + newMrr - churnMrr - contraction, mrr);
  const count = active.length + activeAnnuals.length + (enterpriseMrr ? 1 : 0);
  const newCustomers = active.filter((c) => c.start === month).length + annuals.filter((c) => c.start === month).length + (enterpriseMrr ? 1 : 0);
  const churnCustomers = month === '2026-08' ? 1 : 0;
  assert.equal(previousCustomers + newCustomers - churnCustomers, count);
  metrics.push([month, dollars(previousMrr), dollars(newMrr), '0.00', dollars(contraction), dollars(churnMrr), dollars(mrr), dollars(mrr * 12), previousCustomers, newCustomers, churnCustomers, count, dollars(revenue), dollars(grossCharges), dollars(refunds), dollars(fees), '4']);
  previousMrr = mrr; previousCustomers = count;
  const snapshot = { month, revenue, cogs, operatingExpenses: expenses, profit, grossCharges, refunds, fees, mrr, customers: count, balances: { ...balances } };
  results.push(snapshot);
  table(`02-history/accounting-reference/trial-balance-${month}.csv`, ['Account Number', 'Account Name', 'Debit', 'Credit', 'Currency', 'As Of'], Object.entries(balances).map(([code, amount]) => [code, accounts[code][0], amount > 0 ? dollars(amount) : '', amount < 0 ? dollars(-amount) : '', 'USD', end]));
}

// Bank exports include running balances, with no opening-balance transaction.
for (const [code, filename, starting] of [['1000', 'operating-checking', 25000000], ['1010', 'reserve-savings', 0]]) {
  let balance = starting;
  const rows = bank.filter((t) => t.account === code).sort((a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence).map((t) => {
    balance += t.amount;
    return [t.date, t.description, dollars(t.amount), 'USD', `demo_${code}_001`, t.reference, dollars(balance)];
  });
  assert.equal(balance, balances[code]);
  table(`02-history/bank/${filename}-transactions.csv`, ['Date', 'Description', 'Amount', 'Currency', 'Account ID', 'Reference', 'Balance'], rows);
  let opening = starting;
  for (const month of months) {
    const activity = bank.filter((t) => t.account === code && t.date.startsWith(month));
    const inflows = activity.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const outflows = -activity.filter((t) => t.amount < 0).reduce((sum, t) => sum + t.amount, 0);
    const ending = opening + inflows - outflows;
    put(`02-history/bank/statements/${filename}-${month}.md`, `# Demo Lumenloop — synthetic bank statement\n\nDemo Ledger Bank; ${filename}; identifier demo_${code}_001. USD.\nStatement period: ${month}-01 through ${lastDay(month)}.\n\nBeginning balance: ${usd(opening)}\nDeposits: ${usd(inflows)}\nWithdrawals: ${usd(outflows)}\nEnding balance: ${usd(ending)}\n\n${activity.length} transactions. Complete transaction detail is supplied in ${filename}-transactions.csv. This summary is corroborating evidence, not additional transactions. All names, identifiers and amounts are invented.`);
    opening = ending;
  }
}
table('02-history/stripe/balance-transactions.csv', ['Balance Transaction ID', 'Date', 'Type', 'Description', 'Amount', 'Fee', 'Net', 'Currency', 'Customer ID', 'Invoice ID', 'Payout ID'], stripe);
table('02-history/stripe/payouts.csv', ['Payout ID', 'Arrival Date', 'Amount', 'Currency', 'Status', 'Destination', 'Balance Transaction IDs'], payouts);
table('02-history/billing/customer-invoices.csv', ['Invoice ID', 'Customer ID', 'Customer Name', 'Invoice Date', 'Due Date', 'Service Start', 'Service End', 'Subtotal USD', 'Tax USD', 'Amount Paid USD', 'Amount Due USD', 'Status', 'Payment Method', 'Payment Reference'], invoices);
table('02-history/performance/saas-metrics.csv', ['Month', 'Starting MRR USD', 'New MRR USD', 'Expansion MRR USD', 'Contraction MRR USD', 'Churned MRR USD', 'Ending MRR USD', 'ARR USD', 'Starting Customers', 'New Customers', 'Churned Customers', 'Ending Customers', 'Recognized Revenue USD', 'Stripe Gross Charges USD', 'Stripe Refunds USD', 'Stripe Fees USD', 'Headcount'], metrics);
table('02-history/accounting-reference/general-ledger.csv', ['Date', 'Journal Entry ID', 'Account Number', 'Account Name', 'Description', 'Debit', 'Credit', 'Currency', 'Source Reference'], journal);
table('02-history/people/payroll-summary.csv', ['Month', 'Employees', 'Gross Salaries USD', 'Employee Withholdings USD', 'Net Pay USD', 'Employer Taxes USD', 'Tax Remittance USD', 'Employer Expense USD'], months.map((month) => [month, 4, '30000.00', '6000.00', '24000.00', '3000.00', '9000.00', '33000.00']));
const financialHeaders = ['Line Item', ...months];
table('02-history/accounting-reference/profit-and-loss.csv', financialHeaders, [
  ['Subscription revenue net of refunds', ...results.map((r) => dollars(r.revenue))],
  ['Cloud hosting and processing fees', ...results.map((r) => dollars(r.cogs))],
  ['Gross profit', ...results.map((r) => dollars(r.revenue - r.cogs))],
  ['Operating expenses', ...results.map((r) => dollars(r.operatingExpenses))],
  ['Net income', ...results.map((r) => dollars(r.profit))],
]);
let retained = 0;
const balanceSheets = results.map((r) => {
  retained += r.profit;
  const b = r.balances;
  const assets = ['1000', '1010', '1020', '1100', '1200', '1500', '1510'].reduce((sum, code) => sum + b[code], 0);
  const liabilities = -b['2000'] - b['2100'];
  const equity = -b['3000'] + retained;
  assert.equal(assets, liabilities + equity);
  return { assets, liabilities, equity, retained };
});
table('02-history/accounting-reference/balance-sheet.csv', financialHeaders, [
  ...['1000', '1010', '1020', '1100', '1200', '1500', '1510'].map((code) => [accounts[code][0], ...results.map((r) => dollars(r.balances[code]))]),
  ['Total assets', ...balanceSheets.map((b) => dollars(b.assets))],
  ['Accounts payable', ...results.map((r) => dollars(-r.balances['2000']))],
  ['Deferred subscription revenue', ...results.map((r) => dollars(-r.balances['2100']))],
  ['Total liabilities', ...balanceSheets.map((b) => dollars(b.liabilities))],
  ['Paid-in capital', ...results.map((r) => dollars(-r.balances['3000']))],
  ['Retained earnings', ...balanceSheets.map((b) => dollars(b.retained))],
  ['Total equity', ...balanceSheets.map((b) => dollars(b.equity))],
]);
const flows = results.map((r, i) => {
  const prior = i ? results[i - 1].balances : { '1000': 25000000, '1010': 0, '1020': 0, '1100': 0, '1200': 0, '1500': 0, '1510': 0, '2000': 0, '2100': 0, '3000': -25000000 };
  const delta = (code) => r.balances[code] - prior[code];
  const operating = r.profit - delta('1510') - delta('1020') - delta('1100') - delta('1200') - delta('2000') - delta('2100');
  const investing = -delta('1500'), financing = -delta('3000');
  const opening = prior['1000'] + prior['1010'];
  const ending = r.balances['1000'] + r.balances['1010'];
  assert.equal(opening + operating + investing + financing, ending);
  return { operating, investing, financing, opening, ending };
});
table('02-history/accounting-reference/cash-flow.csv', financialHeaders, [
  ...[['Opening bank cash', 'opening'], ['Operating cash flow', 'operating'], ['Investing cash flow', 'investing'], ['Financing cash flow', 'financing'], ['Ending bank cash', 'ending']].map(([label, key]) => [label, ...flows.map((f) => dollars(f[key]))]),
]);

put('00-company/company-profile.md', `# Demo Lumenloop\n\nEntirely synthetic B2B SaaS company for Balsa demos. No real company or financial information is used.\n\nProduct: project handoff and client reporting software for small design studios.\nFounded: 2026-01-01; opening founder contribution was received 2025-12-31.\nLegal entity: one fictional US corporation. Currency: USD. Fiscal year: calendar year.\nHistory: January through September 2026, all complete months. Initial review date: 2026-10-01.\nFour employees; aggregate payroll only. No subsidiaries, debt, foreign currency, dividends or taxes payable in this simplified demo. Sales tax, income tax and interest are explicitly assumed zero.\n\nMonthly plan: $1,500 per customer; cancel at month end. Customer 03 downgrades to $1,000 effective September 1. Annual plans are individually contracted.\nContacts: demo-founder@example.test and demo-finance@example.test. All account and provider IDs use demo_ prefixes and cannot authenticate to any service.\n\nThe demo distinguishes subscriptions, collections, recognized revenue, annual prepayments and bank transfers. September ends with a Stripe payout in transit and an unpaid enterprise invoice.`);
put('00-company/opening-balances.md', `# Opening balances — 2025-12-31\n\nDemo Lumenloop; entirely synthetic; USD.\n\nOperating checking demo_1000_001: $250,000.00 debit.\nPaid-in capital: $250,000.00 credit.\nAll other asset, liability, equity, revenue and expense accounts: zero.\n\nThe opening cash is already in the account before the first supplied bank transaction. Record the opening capital once. Do not infer an opening liability or post an additional $250,000 receipt when importing January transactions.`);
put('00-company/accounting-policies.md', `# Demo Lumenloop accounting policies\n\nSynthetic owner-approved policy memo dated 2026-01-01. Accrual basis, USD, monthly reporting. The opening balance document is authoritative for December 31, 2025.\n\n- Monthly service revenue is earned in its service month. Enterprise invoices create receivables until collected.\n- Annual subscriptions are collected in advance, recorded as deferred revenue and recognized evenly over the 12 stated service months. Monthly MRR is annual contract value divided by 12. ARR is closing MRR times 12; neither is cash receipts.\n- Stripe clearing records gross customer collections, fees, refunds and payouts. Each payout is a transfer from Stripe clearing into checking, never additional sales. Original processing fees are retained on refunds. No reserves, disputes or currency conversions exist in this simplified pack. Stripe exports are simplified test extracts, not a full provider schema or live API integration.\n- Bank cash is checking plus savings; processor clearing is a separate current asset, excluded from bank cash in reference cash flows.\n- Transfers between checking and savings are neither revenue nor expense. Founder contributions are equity financing.\n- Annual insurance is prepaid April 1, 2026 through March 31, 2027, amortized $1,000 per month.\n- The $2,400 laptop placed in service June 1 is depreciated $100 per month over 24 months with no residual value. Simplified demo policy uses a $2,000 capitalization threshold.\n- Payroll is $30,000 gross plus $3,000 employer taxes monthly. Employee withholding is $6,000; net wages are $24,000 and tax remittances $9,000. Everything is paid within the service month. Do not add net wages, gross wages and withholding as separate expenses.\n- Vendor services are expensed in their service month, including unpaid invoices. September's $1,800 security review is payable October 15.\n- No annual renewal, proposed hire or budget is an approved new financial commitment without explicit review. Refund credits do not change MRR unless a subscription changes.\n- Upload duplicates and summary reports must not create a second set of postings. Reference statements and the ledger are alternate representations of the same activity.`);
for (const c of annuals) put(`01-onboarding/contracts/annual-${c.id}.md`, `# Subscription agreement — ${c.name}\n\nSynthetic customer agreement ${c.id}; Demo Lumenloop.\nEffective: ${c.start}-01. Service ends: ${c.end}.\nAnnual fee: ${usd(c.cents)} USD, paid in full through Stripe on ${c.start}-01.\nRecognize service revenue evenly at ${usd(c.cents / 12)} per service month.\nNo setup fee, sales tax, automatic renewal, cancellation or variable consideration.\nCustomer contact: ${c.id}@example.test. All terms and identities are invented.`);
put('01-onboarding/contracts/monthly-subscription-terms.md', `# Monthly subscription terms\n\nSynthetic standard agreement, effective January 1, 2026.\nDemo Lumenloop charges $1,500 per customer per calendar service month, paid through Stripe; no setup fee or tax. A monthly plan may be cancelled before the next service month. The customer roster and invoice export identify actual participants and dates.\n\nDemo Customer 02 cancels after July 31; no August or September service is due. Demo Customer 03 has an approved price reduction to $1,000 from September 1. Demo Customer 04 receives a one-time $500 September service credit, refunded September 4; its recurring price remains $1,500.\n\nCustomer 11 and Customer 12 have September payments processed September 30; all other monthly payments are processed on the first day in this simplified dataset. No late fee is imposed.`);
put('01-onboarding/contracts/enterprise-agreement.md', `# Enterprise subscription agreement\n\nEntirely synthetic. Customer: Demo Enterprise Customer, demo_cus_201.\nService begins September 1, 2026. Monthly recurring fee $4,000 USD; invoiced monthly, net 30; no sales tax or setup fee. September service invoice demo_inv_enterprise_sep is dated September 1, due October 1.\n\nAs of September 30: $4,000 service earned, $4,000 receivable, no collection. Do not count an expected collection as a September bank transaction. The later update pack documents the actual payment.`);
put('01-onboarding/contracts/vendor-commitments.md', `# Recurring vendor commitments\n\nSynthetic owner-approved terms, reviewed September 30, 2026. USD.\n\n- Demo Workspace: office rent $1,200 monthly, paid on the 3rd; month to month.\n- Demo Worktools: software subscription $900 monthly, paid on the 9th.\n- Demo Design: support contractor $2,500 monthly, paid on the 20th.\n- Demo Cloud: usage-based hosting, January $900 increasing $200 each month to September $2,500, paid on the 8th. October forecast $2,700 is an assumption, not an invoice.\n- Demo Campaigns: approved monthly advertising increased from $500 in January by $500 each month to $4,500 in September, paid on the 22nd. October proposed budget stays $4,500, subject to review.\n- Demo Cover: annual insurance $12,000 paid April 2 for April 1, 2026–March 31, 2027.\n- Demo Payroll Bureau: four employees; gross salaries $30,000 and employer taxes $3,000 monthly. Net pay on the 15th and all taxes on the 16th. See aggregate payroll summary; no personal identifiers are included.\n\nThese commitments corroborate payments in the supplied bank files. Do not create additional actual payments from this memo.`);
put('02-history/billing/security-review-invoice.md', `# Vendor invoice demo_vendor_security_sep\n\nEntirely synthetic. Issuer: Demo Secure Review. Customer: Demo Lumenloop.\nInvoice date September 30, 2026. September security review services: $1,800 USD. No tax. Total due $1,800; due October 15, 2026. Unpaid at September 30. Record September contractor expense and accounts payable. No September bank withdrawal exists.`);
put('02-history/billing/insurance-and-equipment.md', `# Insurance and equipment source receipts\n\nSynthetic Demo Lumenloop source records.\n\nReceipt demo_insurance_annual: Demo Cover, $12,000 USD paid April 2, 2026, coverage April 1, 2026 through March 31, 2027. No tax.\nReceipt demo_laptop_jun: Demo Devices, one laptop for $2,400 USD paid June 12, 2026; placed in service June 1; no tax.\n\nThese amounts already appear in checking transactions. Receipt copies support classification and schedules; they are not additional payments.`);
const september = results.at(-1), b = september.balances;
const march = results.find((r) => r.month === '2026-03');
const q1 = results.filter((r) => r.month <= '2026-03');
put('02-history/performance/q1-founder-update.md', `# Demo Lumenloop — Q1 performance update\n\nEntirely synthetic. Prepared April 1, 2026; information cutoff March 31. USD.\n\nThe company began service January 1 with four monthly customers. Two more started in February and two in March. All customers paid monthly through Stripe.\n\n| Month | Active customers | Recognized revenue | Closing MRR |\n| --- | ---: | ---: | ---: |\n${q1.map((r) => `| ${r.month} | ${r.customers} | ${usd(r.revenue)} | ${usd(r.mrr)} |`).join('\n')}\n\nQ1 recognized revenue: ${usd(q1.reduce((sum, r) => sum + r.revenue, 0))}. Q1 net income: ${usd(q1.reduce((sum, r) => sum + r.profit, 0))}. March 31 bank cash: ${usd(march.balances['1000'] + march.balances['1010'])}. Four employees remained on payroll throughout Q1. Hosting grew from $900 to $1,300 monthly; advertising grew from $500 to $1,500. Payroll, rent, tools and contractor commitments are described in the vendor terms.\n\nThe $250,000 opening contribution was received December 31, 2025; it is equity, not Q1 revenue. No annual prepaid customer contracts, insurance prepayment, equipment, receivables or payables exist at March 31. Annual Customer A and the insurance coverage begin April 1. These later agreements are separate evidence and do not create Q1 activity.`);
put('02-history/performance/september-founder-update.md', `# Demo Lumenloop — September performance update\n\nEntirely synthetic. Prepared October 1, 2026; information cutoff September 30. USD.\n\nClosing MRR ${usd(september.mrr)}; ARR ${usd(september.mrr * 12)}; ${september.customers} active paying customers.\nSeptember recognized revenue ${usd(september.revenue)} after a $500 service credit.\nSeptember net income ${usd(september.profit)}.\nChecking ${usd(b['1000'])}; savings ${usd(b['1010'])}; bank cash ${usd(b['1000'] + b['1010'])}.\nStripe clearing ${usd(b['1020'])}, expected in checking October 2. Receivable $4,000 due October 1. Deferred subscription revenue ${usd(-b['2100'])}.\n\nCustomer 03 downgraded by $500 MRR. The new enterprise account added $4,000 MRR but has not paid at this cutoff. A one-time refund did not churn Customer 04. June's $100,000 founder contribution was financing, not revenue.\n\nDecision: should we hire a customer success manager in November? Proposed gross monthly salary $7,500 plus 10% employer taxes. One-time recruiting fee $3,000 in November. The hire is unapproved. Compare hiring with waiting until January; keep monthly advertising at $4,500 in both cases initially.\n\nTrack: bank cash, MRR, enterprise collections and implementation backlog. Do not infer that the hire causes additional sales without a separately reviewed assumption. The historical data alone does not identify churn or sales uplift from the hire.`);
table('03-october-update/bank-transactions.csv', ['Date', 'Description', 'Amount', 'Currency', 'Account ID', 'Reference'], [
  ['2026-10-02', 'STRIPE PAYOUT demo_po_20261002', dollars(heldPayout.amount), 'USD', 'demo_1000_001', 'demo_po_20261002'],
  ['2026-10-08', 'Demo Enterprise Customer payment September invoice', '4000.00', 'USD', 'demo_1000_001', 'demo_inv_enterprise_sep'],
  ['2026-10-15', 'Demo Secure Review September invoice payment', '-1800.00', 'USD', 'demo_1000_001', 'demo_vendor_security_sep'],
]);
table('03-october-update/stripe-payout.csv', ['Payout ID', 'Arrival Date', 'Amount', 'Currency', 'Status', 'Destination', 'Balance Transaction IDs'], [['demo_po_20261002', '2026-10-02', dollars(heldPayout.amount), 'USD', 'paid', 'demo_1000_001', heldPayout.ids.join(';')]]);
put('03-october-update/collection-and-coverage-notes.md', `# October follow-up — information through October 15, 2026\n\nEntirely synthetic. The update CSV is a PARTIAL extract containing three selected transactions; it is not a complete October bank statement and cannot support an October close.\n\nSeptember Stripe collections in transit arrived October 2 (${usd(heldPayout.amount)}). Do not recognize new revenue from the payout. The $4,000 September enterprise invoice was collected October 8, seven days after its due date. The September $1,800 vendor payable was paid October 15. Both settlements reduce existing balances rather than creating new revenue or expense.\n\nNo October subscription charge, payroll, rent, advertising or other transactions are provided. Absence from this extract does not imply those events did not happen. October performance and ending bank balance remain incomplete. The proposed November hire is still unapproved.`);
table('04-edge-cases/overlapping-checking-extract.csv', ['Date', 'Description', 'Amount', 'Currency', 'Account ID', 'Reference', 'Balance'], bank.filter((t) => t.account === '1000' && t.date >= '2026-09-10').sort((a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence).map((t) => [t.date, t.description, dollars(t.amount), 'USD', 'demo_1000_001', t.reference, '']));
put('04-edge-cases/conflicting-sales-note.md', `# Unreviewed sales note — synthetic conflict exercise\n\nAuthor: demo-sales@example.test. Dated October 1, 2026.\n\nI think September ended with $29,000 MRR and that the enterprise customer has already paid. I have not reconciled this to billing or the bank.\n\nThis note is intentionally incorrect and unapproved. Resolve the conflict with the customer roster, service invoices and September bank evidence. Do not silently replace the approved financial state.`);

// Independently tie source exports to the journal and expected account balances.
const chargeTotal = stripe.reduce((sum, row) => sum + Math.round(Number(row[4]) * 100), 0);
const feeTotal = stripe.reduce((sum, row) => sum + Math.round(Number(row[5]) * 100), 0);
const payoutTotal = payouts.reduce((sum, row) => sum + Math.round(Number(row[2]) * 100), 0);
assert.equal(chargeTotal - feeTotal - payoutTotal, balances['1020']);
assert.equal(heldPayout.amount, balances['1020']);
assert.equal(balances['1100'], 400000);
assert.equal(balances['2000'], -180000);
assert.equal(balances['2100'], -3600000);
assert.equal(balances['1200'], 600000);
assert.equal(balances['1500'] + balances['1510'], 200000);
assert.equal(balances['3000'], -35000000);
assert.equal(september.mrr, 2500000);
assert.equal(september.revenue, 2450000);
assert.equal(Object.values(balances).reduce((sum, value) => sum + value, 0), 0);
const expected = {
  synthetic: true, company: 'Demo Lumenloop', fixtureVersion: 2, generator: 'demo-saas-v2',
  currency: 'USD', amountUnits: 'integer cents', historyCutoff: '2026-09-30', reviewDate: '2026-10-01',
  openingDate: '2025-12-31',
  openingBankCash: 25000000, monthly: results,
  september: { bankCash: b['1000'] + b['1010'], stripeClearing: b['1020'], receivables: b['1100'], payables: -b['2000'], deferredRevenue: -b['2100'], prepaidInsurance: b['1200'], equipmentNet: b['1500'] + b['1510'], paidInCapital: -b['3000'], mrr: september.mrr, arr: september.mrr * 12, customers: september.customers },
  octoberSelectedEventsOnly: { stripePayout: heldPayout.amount, receivableCollected: 400000, payablePaid: 180000, netBankMovement: heldPayout.amount + 400000 - 180000, newRevenue: 0, newExpense: 0, fullMonthCoverage: false },
};
put('expected/expected-results.json', JSON.stringify(expected, null, 2));
put('expected/reconciliation.md', `# Demo expected results — do not upload as source evidence\n\nAll values are synthetic USD. Generated deterministically from the fixture specification. This is a human review oracle, not proof that Balsa supports every accrual automatically.\n\n| Month | Revenue | Net income | Ending MRR | Bank cash | Stripe clearing |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${results.map((r) => `| ${r.month} | ${usd(r.revenue)} | ${usd(r.profit)} | ${usd(r.mrr)} | ${usd(r.balances['1000'] + r.balances['1010'])} | ${usd(r.balances['1020'])} |`).join('\n')}\n\nSeptember closing checks:\n\n- Accounts receivable $4,000; accounts payable $1,800.\n- Deferred subscription revenue $36,000: annual A has $12,000 remaining; annual B has $24,000 remaining.\n- Prepaid insurance $6,000; laptop cost $2,400 less $400 accumulated depreciation = $2,000 net.\n- Paid-in capital $350,000, including June's $100,000 financing.\n- Closing MRR $25,000, ARR $300,000. September recognized revenue $24,500; difference is the one-time $500 refund.\n- September MRR bridge: $21,500 opening + $4,000 new enterprise − $500 downgrade = $25,000.\n- Refunds retain the original processing fee. Stripe net collections less paid payouts equals ${usd(b['1020'])} clearing; the October 2 payout settles this exactly.\n- Checking/savings transfers net to zero consolidated bank cash and do not affect income.\n- October's three selected events create no new revenue or expense. They do not establish complete October coverage.\n\nThe reference ledger includes opening balances and noncash adjusting entries. The bank and Stripe files alone do not establish a complete accrual balance sheet. Unsupported or unverified treatments should remain visible for review rather than be forced to match this oracle.`);

// A manifest makes changed bytes and document provenance inspectable. README and
// this generator are maintained by hand and intentionally outside the manifest.
const manifest = [...files.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({
  path, sha256: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content),
  role: path.startsWith('expected/') ? 'expected-result-do-not-upload' : path.includes('accounting-reference/') ? 'alternate-accounting-reference' : path.startsWith('04-') ? 'optional-edge-case' : 'synthetic-source-evidence',
}));
put('manifest.json', JSON.stringify({ synthetic: true, fixtureVersion: 2, files: manifest }, null, 2));
for (const [path, content] of files) {
  const target = join(root, path);
  if (check) assert.equal(await readFile(target, 'utf8'), content, `fixture drift: ${path}`);
  else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, content); }
}
async function walk(directory, prefix = '') {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) paths.push(...await walk(join(directory, entry.name), `${path}/`));
    else paths.push(path);
  }
  return paths;
}
for (const path of await walk(root)) assert(files.has(path) || ['README.md', 'generate.mjs'].includes(path), `unmanaged fixture file: ${path}`);
console.log(`${check ? 'Verified' : 'Generated'} ${files.size} synthetic demo files; balanced journals, cash roll-forwards, Stripe clearing, balance sheets and MRR/customer bridges reconcile.`);
