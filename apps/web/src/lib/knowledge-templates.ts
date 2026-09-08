export type KnowledgeDocumentTemplate = {
  slug: "company" | "policies" | "allocations" | "accounting" | "forecast";
  title: string;
  content: string;
};

export type KnowledgeTemplate = {
  id: string;
  title: string;
  industry: string;
  description: string;
  version: string;
  documents: KnowledgeDocumentTemplate[];
};

export const universalAccountingRules = `## Universal cash-activity rules

These baseline rules apply to every company unless a company-specific policy or approved decision says otherwise.

- Internal transfers, sweeps, automatic investments, bank-product deposits, and movements between accounts are cash-location changes—not revenue, expense, or operating cash receipts.
- Investment purchases, sales, redemptions, and financing activity are not operating revenue or operating expense.
- Opening and ending balances, total assets, holdings, and period summaries are balances or summaries—not transactions.
- A bank receipt is not automatically revenue. Recognize operating revenue only when the source supports the underlying customer, contract, service, sale, fee, or other earning activity.
- Preserve ambiguous items as review exceptions rather than silently assigning them to revenue.
- Reconcile beginning balance plus classified cash movements to the ending balance before treating a period as reliable.
`;

export const defaultKnowledgeDocuments: KnowledgeDocumentTemplate[] = [
  { slug: "company", title: "Company", content: "# Company\n\nHow the company operates.\n" },
  { slug: "policies", title: "Policies", content: "# Financial Policies\n\nStanding CFO judgment and recognition policies.\n" },
  { slug: "allocations", title: "Allocations", content: "# Allocations\n\nRecurring cost allocation treatment.\n" },
  { slug: "accounting", title: "Accounting", content: `# Accounting\n\nRecognition and accounting context.\n\n${universalAccountingRules}` },
  { slug: "forecast", title: "Forecast", content: "# Forecast\n\nForecast assumptions and scenarios.\n" },
];

const docs = (template: string, company: string, policies: string, allocations: string, accounting: string, forecast: string): KnowledgeDocumentTemplate[] => [
  { slug: "company", title: "Company", content: `<!-- Hemrock knowledge template: ${template} v1.0 -->\n\n${company}` },
  { slug: "policies", title: "Policies", content: `<!-- Hemrock knowledge template: ${template} v1.0 -->\n\n${policies}` },
  { slug: "allocations", title: "Allocations", content: `<!-- Hemrock knowledge template: ${template} v1.0 -->\n\n${allocations}` },
  { slug: "accounting", title: "Accounting", content: `<!-- Hemrock knowledge template: ${template} v1.0 -->\n\n${accounting}` },
  { slug: "forecast", title: "Forecast", content: `<!-- Hemrock knowledge template: ${template} v1.0 -->\n\n${forecast}` },
];

const coreKnowledgeTemplates: KnowledgeTemplate[] = [
  {
    id: "saas-subscription",
    title: "SaaS / subscription",
    industry: "Software and recurring revenue",
    description: "A starting point for subscription metrics, contract timing, deferred revenue, renewals, and hosting costs.",
    version: "1.0",
    documents: docs(
      "saas-subscription",
      `# Company\n\n## Operating model\nSubscription software revenue is commonly driven by recurring contracts, usage, implementation, and expansion. Confirm the customer segments, billing cadence, contract terms, and renewal behavior.\n\n## Confirm for this company\n- Products and customer segments:\n- Billing and collection timing:\n- Annual versus monthly contracts:\n- Material implementation or professional-services work:\n`,
      `# Financial Policies\n\n## Revenue\nRevenue is commonly recognized over the service period for the performance obligation. Confirm whether implementation, setup, usage, and support are distinct obligations.\n\n## Working rules to confirm\n- Treatment of annual prepayments and deferred revenue\n- Contract modifications, refunds, credits, and churn\n- Capitalization policy for eligible software development costs\n- When commissions and customer acquisition costs are expensed or deferred\n\nThese are template prompts, not confirmed company policies.\n`,
      `# Allocations\n\n## Common pools\n- Hosting and infrastructure: allocate by usage or customer cohort when material.\n- Customer success and support: allocate by service activity or revenue when useful.\n- Shared software and corporate costs: allocate only where the management purpose requires it.\n\nConfirm the company’s allocation basis before using any split.\n`,
      `# Accounting\n\nTrack the distinction between invoicing, cash collection, and revenue recognition. Useful supporting schedules commonly include accounts receivable, deferred revenue, contract liabilities, refunds, hosting COGS, payroll, and capitalized development.\n\nConfirm the reporting basis, materiality thresholds, and close process.\n`,
      `# Forecast\n\n## Drivers to establish\n- Beginning and new recurring revenue\n- Expansion, contraction, churn, and renewal timing\n- Billing and collection lag\n- Hosting, support, payroll, and sales costs\n\nForecast from confirmed contracts first. Use scenarios for churn, hiring, and growth assumptions, and label each assumption as confirmed or provisional.\n`,
    ),
  },
  {
    id: "professional-services",
    title: "Professional services / agency",
    industry: "Projects, retainers, and billable work",
    description: "A starting point for project billing, retainers, utilization, contractors, receivables, and milestone revenue.",
    version: "1.0",
    documents: docs(
      "professional-services",
      `# Company\n\n## Operating model\nProfessional-services companies commonly earn revenue through projects, retainers, milestones, or time-and-materials work. Confirm the service lines, delivery team, subcontractors, billing terms, and project backlog.\n\n## Confirm for this company\n- Contract and invoice cadence:\n- Billing owner and collection process:\n- Open projects and remaining obligations:\n- Employee versus contractor delivery mix:\n`,
      `# Financial Policies\n\n## Revenue\nConfirm whether work is recognized as delivered, at milestones, on invoice, or at another documented point. Do not treat an invoice date as the recognition rule without evidence.\n\n## Working rules to confirm\n- Treatment of retainers and client deposits\n- Work in progress and unbilled receivables\n- Refunds, credits, change orders, and write-offs\n- Contractor and reimbursable-expense treatment\n\nThese are template prompts, not confirmed company policies.\n`,
      `# Allocations\n\n## Common pools\n- Shared delivery labor: allocate to projects using approved time or another documented basis.\n- Contractors and reimbursable costs: assign directly where the source supports it.\n- Corporate overhead: allocate only when the reporting purpose requires it.\n\nConfirm the timekeeping and allocation convention before using it in reporting.\n`,
      `# Accounting\n\nKeep project economics distinct from cash timing. Useful schedules commonly include accounts receivable, unbilled work, client deposits, deferred revenue, project costs, contractor payables, and reimbursable expenses.\n\nConfirm the reporting basis and month-end cut-off process.\n`,
      `# Forecast\n\n## Drivers to establish\n- Signed backlog and expected project start dates\n- Billing milestones and collection lag\n- Delivery capacity, utilization, payroll, and contractor needs\n- Retainer renewals and pipeline scenarios\n\nForecast signed work separately from pipeline. Flag capacity or collection assumptions for review.\n`,
    ),
  },
  {
    id: "ecommerce-retail",
    title: "E-commerce / retail",
    industry: "Inventory, orders, and payment processors",
    description: "A starting point for inventory, COGS, fulfillment, processor settlement, refunds, purchase orders, and working capital.",
    version: "1.0",
    documents: docs(
      "ecommerce-retail",
      `# Company\n\n## Operating model\nE-commerce and retail businesses commonly convert inventory into customer orders through direct sales, marketplaces, or wholesale channels. Confirm products, sales channels, fulfillment model, suppliers, and payment processors.\n\n## Confirm for this company\n- Inventory ownership and locations:\n- Supplier terms and purchase cadence:\n- Processor settlement timing:\n- Returns, refunds, and warranty obligations:\n`,
      `# Financial Policies\n\n## Revenue and inventory\nConfirm when control transfers, how returns are estimated, and how inventory and COGS are measured. Processor settlement is cash timing, not automatically the revenue date.\n\n## Working rules to confirm\n- Inventory costing and reserve policy\n- Freight, duties, fulfillment, and marketplace fees\n- Returns, discounts, chargebacks, and gift cards\n- Purchase-order commitments and stock-out treatment\n\nThese are template prompts, not confirmed company policies.\n`,
      `# Allocations\n\n## Common pools\n- Fulfillment and warehouse costs: allocate by units, orders, weight, or direct channel cost.\n- Marketing: allocate by campaign or channel when source data supports it.\n- Shared overhead: allocate only for a defined reporting purpose.\n\nConfirm the allocation basis and whether marketplace fees are direct costs.\n`,
      `# Accounting\n\nSeparate order date, shipment or transfer date, processor settlement date, and bank receipt date. Useful schedules commonly include inventory, COGS, purchase commitments, accounts payable, processor receivables, refunds, chargebacks, and sales tax liabilities.\n\nConfirm jurisdictional tax responsibilities and the close cut-off.\n`,
      `# Forecast\n\n## Drivers to establish\n- Orders, average order value, refunds, and channel mix\n- Gross margin, inventory purchases, and lead times\n- Processor settlement lag and working-capital needs\n- Fulfillment, marketing, payroll, and fixed costs\n\nForecast inventory cash needs separately from reported sales. Use scenarios for demand, returns, and supplier timing.\n`,
    ),
  },
  {
    id: "venture-fund-management-company",
    title: "Venture fund + management company",
    industry: "Funds, management fees, and shared costs",
    description: "A starting point for management fees, fund receipts, partner splits, allocations, intercompany balances, and capital activity.",
    version: "1.0",
    documents: docs(
      "venture-fund-management-company",
      `# Company\n\n## Operating model\nA venture platform may include one or more funds, a management company, partners, and service providers. Confirm which legal entity receives each cash flow, who bears each cost, and how fund and management-company activity is separated.\n\n## Confirm for this company\n- Funds and management entities:\n- Management-fee agreements and fee periods:\n- Partner or advisor arrangements:\n- Shared vendors and expense reimbursement rules:\n`,
      `# Financial Policies\n\n## Fees and recognition\nConfirm management-fee rate, fee base, fee period, payment timing, offsets, waivers, and the entity entitled to the receipt. A bank receipt alone does not establish the accounting treatment.\n\n## Working rules to confirm\n- Fund versus management-company revenue\n- Partner splits and distributions\n- Capital calls, contributions, and return of capital\n- Reimbursements, intercompany balances, and shared expenses\n\nThese are template prompts, not confirmed company policies.\n`,
      `# Allocations\n\n## Common pools\n- Shared professional fees: allocate by documented benefit or agreed fund split.\n- Personnel and operating costs: allocate by time, activity, or policy where support exists.\n- Management-company costs: do not push to a fund without an agreement, policy, or explicit decision.\n\nEvery allocation should retain its source, basis, and approval status.\n`,
      `# Accounting\n\nKeep bank activity, legal entity, economic bearer, and revenue recognition distinct. Useful schedules commonly include management-fee receivables, fee receipts, partner splits, amounts due from funds, reimbursements, capital activity, and shared-cost allocations.\n\nConfirm entity-level books, reporting periods, and close controls.\n`,
      `# Forecast\n\n## Drivers to establish\n- Fee base, rate, and collection dates by fund\n- Partner or advisor payout timing\n- Fund expenses and reimbursement timing\n- Capital calls, distributions, and management-company cash needs\n\nForecast each legal entity separately, then show approved intercompany and allocation relationships. Treat fee timing and partner splits as assumptions until supported by agreements or statements.\n`,
    ),
  },
];

type RevenueModelDefinition = {
  id: string;
  title: string;
  industry: string;
  description: string;
  focus: string;
  drivers: string[];
  expenses: string[];
  accounting: string;
  questions: string[];
};

const revenueModelTemplate = (model: RevenueModelDefinition): KnowledgeTemplate => ({
  id: model.id,
  title: model.title,
  industry: model.industry,
  description: model.description,
  version: "1.0",
  documents: docs(
    model.id,
    `# Company\n\n## Operating model\n${model.focus}\n\n## Confirm for this company\n${model.questions.map((question) => `- ${question}`).join("\n")}\n`,
    `# Financial Policies\n\n## Revenue and pricing\nConfirm what the customer is paying for, when the performance obligation is satisfied, and whether pricing is fixed, usage-based, percentage-based, or a mix. Do not infer recognized revenue from invoices or cash receipts alone.\n\n## Working rules to confirm\n${model.questions.map((question) => `- ${question}`).join("\n")}\n- Contract changes, refunds, credits, cancellations, and bad debt\n- Taxes, pass-through amounts, and amounts collected for another party\n\nThese are template prompts, not confirmed company policies.\n`,
    `# Allocations\n\n## Common pools\n- Direct delivery or product costs: assign to the product, customer, order, contract, or channel when the source supports it.\n- Shared growth costs: allocate by campaign, channel, customer cohort, or another documented basis.\n- Corporate overhead: allocate only for a defined reporting purpose.\n\nConfirm the allocation basis before using any split. Preserve the source and approval status for every allocation.\n`,
    `# Accounting\n\nSeparate the operational event that creates value, the invoice or billing event, the cash settlement, and the revenue-recognition event. Track the balances that bridge those events, such as receivables, deferred revenue, customer deposits, inventory, payables, reserves, or amounts held for third parties.\n\n${model.accounting}\n\nConfirm the reporting basis, materiality thresholds, tax treatment, and month-end cut-off process.\n`,
    `# Forecast\n\n## Drivers to establish\n${model.drivers.map((driver) => `- ${driver}`).join("\n")}\n\n## Cost and cash considerations\n${model.expenses.map((expense) => `- ${expense}`).join("\n")}\n\nForecast confirmed contracts, orders, policies, and commitments separately from provisional assumptions. Use scenarios for growth, retention, pricing, collections, and capacity, and label each assumption as confirmed or provisional.\n`,
  ),
});

const additionalRevenueModels: RevenueModelDefinition[] = [
  {
    id: "subscription",
    title: "Subscription",
    industry: "Recurring products and services",
    description: "A starting point for recurring contracts, renewals, churn, billing cadence, and deferred revenue.",
    focus: "Customers pay a recurring fee for continuing access to a product or service. The company may have tiers, annual commitments, add-ons, or a physical subscription component.",
    drivers: ["Beginning subscribers and new subscribers", "Renewal, churn, contraction, and expansion", "Price, plan mix, billing cadence, and collection lag", "Bookings, billings, cash receipts, and recognized revenue"],
    expenses: ["Customer acquisition and sales capacity", "Customer support and retention programs", "Product, fulfillment, hosting, and service delivery costs"],
    accounting: "Maintain a bridge from bookings to billings to cash and recognized revenue. Annual or prepaid contracts commonly create deferred revenue, while cancellations and refunds may require reserves or adjustments.",
    questions: ["Customer segments and plans:", "Renewal and cancellation rules:", "Billing and collection timing:", "Annual, monthly, or usage add-ons:"],
  },
  {
    id: "product-as-a-service",
    title: "Product-as-a-service",
    industry: "Products bundled with ongoing services",
    description: "A starting point for hardware or physical products bundled with maintenance, access, monitoring, or recurring service.",
    focus: "The company provides a physical product together with ongoing service or access. Customers may pay upfront, periodically, by usage, or through a blended contract.",
    drivers: ["Units placed, active units, and replacement cycle", "Installation, activation, and service attach rate", "Recurring fee or usage per active unit", "Renewals, upgrades, and loss or return rates"],
    expenses: ["Manufacturing or procurement and inventory carrying costs", "Installation, maintenance, warranty, and field service", "Logistics, financing, and device recovery"],
    accounting: "Identify whether the product and service are separate performance obligations and whether control transfers at delivery, installation, or over time. Track inventory, warranties, service contracts, and any customer deposits separately.",
    questions: ["Product and service components:", "Ownership and return terms:", "Installation and activation timing:", "Warranty and maintenance obligations:"],
  },
  {
    id: "pay-per-seat",
    title: "Pay-per-seat",
    industry: "Per-user software and services",
    description: "A starting point for seat counts, tiered pricing, expansion, contraction, and seat-based billing.",
    focus: "Customers pay based on the number of authorized, active, or billable users. Contracts may include minimum commitments, overages, tiers, or annual true-ups.",
    drivers: ["Customer accounts and seats per account", "New seats, expansion, contraction, and churn", "Price per seat, minimums, discounts, and overages", "Billing basis and seat-count measurement date"],
    expenses: ["Sales capacity and customer onboarding", "Support and customer success per account or seat", "Hosting, identity, and product costs that scale with usage"],
    accounting: "Define which seats are billable and when a seat change affects billing. Reconcile provisioning data to invoices, cash receipts, receivables, and recognized revenue, especially for annual minimum commitments.",
    questions: ["Billable seat definition:", "Minimum commitments and overages:", "Seat measurement and true-up date:", "Tier, discount, and expansion rules:"],
  },
  {
    id: "usage-based",
    title: "Usage-based / consumption",
    industry: "Metered products and services",
    description: "A starting point for metered usage, rate cards, minimums, overages, invoicing, and variable collections.",
    focus: "Customers are charged for measured consumption such as API calls, storage, transactions, compute, miles, hours, or units delivered.",
    drivers: ["Active customers and usage volume by segment", "Usage per customer and price per unit", "Minimums, tiers, overages, and credits", "Metering close, invoice timing, and collection lag"],
    expenses: ["Infrastructure or supplier cost per unit", "Capacity reserved ahead of demand", "Support, monitoring, fraud, and usage measurement"],
    accounting: "Reconcile the usage ledger to invoices and cash. Establish the point at which usage is delivered and the treatment of prepaid credits, unused balances, minimum commitments, refunds, and disputed consumption.",
    questions: ["Usage unit and measurement source:", "Rate card, tiers, and minimums:", "Prepaid credits or postpaid billing:", "Usage close and dispute process:"],
  },
  {
    id: "royalties",
    title: "Royalties",
    industry: "IP, content, and rights-based revenue",
    description: "A starting point for royalties tied to licensee sales, units, usage, or other contractual bases.",
    focus: "The company earns a fee from another party's exploitation of intellectual property, content, brands, patents, or other rights. The royalty may be a percentage, a per-unit amount, or a guaranteed minimum.",
    drivers: ["Licensees, territories, products, and reporting periods", "Licensee sales, units, usage, or other royalty base", "Rate, minimum guarantee, advances, and recoupment", "Statement receipt, audit, and collection timing"],
    expenses: ["Rights acquisition and content production", "Royalty administration, audits, and legal costs", "Partner splits, advances, and commissions"],
    accounting: "Tie recognized royalty revenue to the contractual sales or usage base and the period in which it is earned. Track advances, minimum guarantees, recoupment, statements not yet received, and partner share obligations.",
    questions: ["Licensed rights and territories:", "Royalty base and reporting source:", "Minimum guarantees or advances:", "Partner split and audit rights:"],
  },
  {
    id: "advertising",
    title: "Advertising",
    industry: "Audience, media, and ad-supported products",
    description: "A starting point for impressions, fill rate, advertiser demand, pricing, campaigns, and ad-revenue cash timing.",
    focus: "Advertisers pay for access to an audience through impressions, clicks, placements, sponsorships, campaigns, or other inventory. The business may sell directly or through an ad exchange.",
    drivers: ["Active users, sessions, impressions, and available inventory", "Fill rate, click or conversion rate, and advertiser demand", "CPM, CPC, CPA, sponsorship, or campaign pricing", "Advertiser billing, platform settlement, and collection lag"],
    expenses: ["Content, audience acquisition, and moderation", "Ad serving, measurement, and exchange fees", "Sales commissions and revenue share with creators or publishers"],
    accounting: "Determine whether the company is the principal or an agent in each arrangement. Separate gross billings, platform fees, amounts owed to publishers, campaign delivery, make-goods, and recognized advertising revenue.",
    questions: ["Inventory and audience metric:", "Direct versus exchange sales:", "Pricing and campaign delivery rule:", "Publisher or creator revenue share:"],
  },
  {
    id: "renting-leasing",
    title: "Renting / leasing",
    industry: "Physical assets, equipment, and space",
    description: "A starting point for utilization, rental terms, deposits, maintenance, asset ownership, and lease cash flows.",
    focus: "The company provides access to an asset, space, vehicle, or equipment for a period of time. Renting is often shorter-term; leasing commonly uses longer contractual commitments.",
    drivers: ["Available units, occupancy, utilization, and average term", "Rental rate, escalators, discounts, and renewals", "Turnover, downtime, deposits, and late payments", "Billing, collection, and maintenance timing"],
    expenses: ["Asset acquisition, financing, depreciation, and insurance", "Maintenance, repairs, cleaning, and property costs", "Vacancy, utilization, sales, and asset recovery"],
    accounting: "Separate customer rental revenue from deposits, damage charges, and pass-through costs. Track owned assets, depreciation, financing, maintenance obligations, and any lease classification or right-of-use accounting that applies.",
    questions: ["Asset ownership and contract term:", "Utilization and vacancy definition:", "Deposits and damage treatment:", "Maintenance and insurance responsibility:"],
  },
  {
    id: "freemium",
    title: "Freemium",
    industry: "Free acquisition with paid conversion",
    description: "A starting point for free users, activation, conversion, paid retention, feature limits, and cost-to-serve.",
    focus: "A free tier is used to acquire and activate users, with revenue generated from premium features, higher limits, seats, or paid plans. Free access is an acquisition mechanism, not itself revenue.",
    drivers: ["Free signups, activation, and engaged users", "Conversion to paid, time to conversion, and plan mix", "Paid retention, expansion, and churn", "Cost to serve free users and acquisition channel efficiency"],
    expenses: ["Infrastructure and support for free users", "Product-led acquisition, marketing, and community", "Sales, onboarding, and premium feature development"],
    accounting: "Keep free usage metrics separate from paid contracts and recognized revenue. Evaluate whether bundled free and paid promises create distinct performance obligations and track discounts, trials, refunds, and credits.",
    questions: ["Definition of an activated user:", "Free-tier limits and upgrade triggers:", "Conversion and trial treatment:", "Cost-to-serve free users:"],
  },
  {
    id: "product-led-growth",
    title: "Product-led growth",
    industry: "Self-serve and product-driven acquisition",
    description: "A starting point for activation, virality, self-serve conversion, expansion, and the operating costs behind product-led growth.",
    focus: "The product itself drives discovery, activation, sharing, conversion, and expansion. Product-led growth is an acquisition and operating strategy that may use subscription, usage, or transaction revenue.",
    drivers: ["Acquisition source, activation, and time to value", "Invites, sharing, virality, and product-qualified leads", "Self-serve conversion, expansion, and churn", "Pricing experiment, funnel, and cohort performance"],
    expenses: ["Product and engineering investment", "Infrastructure and support before conversion", "Lifecycle marketing, experimentation, and customer success"],
    accounting: "Choose the underlying revenue model explicitly; product-led growth does not determine the recognition rule. Track free usage, trials, paid contracts, refunds, and any material implementation or service obligations separately.",
    questions: ["Activation and product-qualified lead definition:", "Underlying revenue model:", "Conversion and expansion event:", "Free usage and infrastructure cost:"],
  },
  {
    id: "licensing",
    title: "Licensing",
    industry: "Software, intellectual property, and rights",
    description: "A starting point for recurring licenses, perpetual licenses, usage rights, renewals, implementation, and support.",
    focus: "Customers pay for permission to use software, content, trademarks, patents, or other intellectual property. Terms may be recurring, perpetual, usage-limited, territory-limited, or bundled with services.",
    drivers: ["Licensed customers, seats, products, and territories", "New licenses, renewals, expansions, and expirations", "Upfront, recurring, per-use, or milestone pricing", "Implementation, support, and collection timing"],
    expenses: ["Product or IP development and maintenance", "Implementation, support, and customer success", "Sales commissions, legal protection, and partner royalties"],
    accounting: "Identify the licensed right and any distinct implementation, support, or update obligations. Separate upfront fees, recurring access, usage fees, renewals, deferred revenue, and royalties or partner shares.",
    questions: ["Right-to-use or right-to-access license:", "Perpetual versus recurring term:", "Implementation and support obligations:", "Renewal, usage, and partner terms:"],
  },
  {
    id: "transaction",
    title: "Transaction",
    industry: "One-time products and services",
    description: "A starting point for transaction volume, average value, gross transaction value, refunds, and cash settlement.",
    focus: "Customers pay a one-time amount for a product or service. The company may earn the full transaction value or only a fee, commission, markup, or spread for facilitating it.",
    drivers: ["Customers, orders, or transactions per period", "Average order or transaction value", "Gross transaction value and take rate", "Payment approval, settlement, refunds, and chargebacks"],
    expenses: ["Product cost, materials, fulfillment, and shipping", "Payment processing, sales commissions, and support", "Returns, warranty, fraud, and chargeback losses"],
    accounting: "Determine whether reported revenue is gross or net of amounts collected for another party. Separate transaction date, delivery or service completion, payment settlement, refunds, and chargebacks.",
    questions: ["Transaction event and delivery point:", "Gross versus net revenue basis:", "Average value and take rate:", "Refund and chargeback policy:"],
  },
  {
    id: "marketplace",
    title: "Marketplace",
    industry: "Two-sided buyer and seller platforms",
    description: "A starting point for supply, demand, GMV, take rate, liquidity, payouts, trust, and platform economics.",
    focus: "The company brings buyers and sellers together and facilitates transactions. It may charge buyers, sellers, or both through subscriptions, fixed fees, percentage fees, or a combination.",
    drivers: ["Active buyers, sellers, listings, and liquidity", "Orders, gross merchandise value, average order value, and take rate", "Repeat purchase, fulfillment, cancellation, and dispute rates", "Platform settlement, seller payout, and reserve timing"],
    expenses: ["Payments, fraud, trust and safety, and customer support", "Seller acquisition, buyer marketing, and incentives", "Infrastructure, fulfillment, and marketplace operations"],
    accounting: "Establish whether the platform is principal or agent and whether it controls the underlying product or service. Reconcile GMV, platform fees, seller funds held, payouts, refunds, chargebacks, and reserves.",
    questions: ["Buyer and seller roles:", "Platform fee and take-rate basis:", "Gross versus net presentation:", "Seller payout and reserve rules:"],
  },
  {
    id: "interest-lending",
    title: "Interest / lending",
    industry: "Loans and financial intermediation",
    description: "A starting point for principal outstanding, rates, originations, repayments, funding costs, and credit losses.",
    focus: "The company lends money or facilitates lending and earns interest or related fees. Cash flows include principal advances and repayments as well as the interest economics.",
    drivers: ["Originations, principal outstanding, and repayment schedule", "Interest rate, yield, fees, and average balance", "Cost of funds and funding availability", "Delinquency, default, recovery, and loss assumptions"],
    expenses: ["Cost of funds, warehouse lines, or investor payouts", "Credit underwriting, servicing, and collections", "Expected credit losses, fraud, compliance, and capital"],
    accounting: "Keep loan principal movements separate from interest income, origination fees, servicing fees, and credit-loss provisions. Confirm the applicable financial-instrument and expected-loss framework before relying on a forecast.",
    questions: ["Lender, borrower, and funding entities:", "Rate, fee, and accrual convention:", "Repayment and delinquency schedule:", "Credit-loss and reserve policy:"],
  },
  {
    id: "trading",
    title: "Trading",
    industry: "Securities, commodities, and investment strategies",
    description: "A starting point for positions, purchases, sales, realized and unrealized gains, fees, capital, and risk limits.",
    focus: "The company buys and sells financial instruments or other assets for its own account or for customers. Economics may come from spreads, realized gains, management fees, performance fees, or commissions.",
    drivers: ["Capital, positions, turnover, and market exposure", "Purchases, sales, realized gains, and unrealized changes", "Spread, commission, management fee, or performance fee", "Settlement, margin, collateral, and liquidity timing"],
    expenses: ["Cost of assets sold and trading fees", "Research, technology, personnel, and custody", "Financing, margin, compliance, and risk management"],
    accounting: "Separate principal activity from customer agency activity and distinguish realized results, unrealized changes, fees, and cash settlement. Track positions, cost basis, collateral, margin, and legal-entity ownership.",
    questions: ["Own-account versus customer activity:", "Instrument and valuation source:", "Realized versus unrealized treatment:", "Capital, margin, and settlement rules:"],
  },
  {
    id: "insurance",
    title: "Insurance",
    industry: "Premiums, policies, and claims",
    description: "A starting point for policy count, premiums, renewals, earned premium, claims, reserves, and reinsurance.",
    focus: "The company receives premiums in exchange for agreeing to pay covered losses or provide a defined benefit. The economics depend on policy acquisition, retention, exposure, claims, and reserving.",
    drivers: ["Policies in force, new policies, renewals, and lapse", "Premium per policy, coverage period, and payment cadence", "Exposure units, claims frequency, severity, and settlement lag", "Reinsurance, commissions, and premium collection"],
    expenses: ["Claims and loss adjustment costs", "Acquisition commissions, underwriting, and servicing", "Reinsurance, compliance, capital, and investment operations"],
    accounting: "Separate written premium, collected premium, earned premium, unearned premium, claims paid, and claims reserves. Confirm the applicable insurance accounting, reserving, regulatory, and reinsurance treatment.",
    questions: ["Policy and coverage period:", "Written versus earned premium:", "Claims and reserve methodology:", "Reinsurance and commission terms:"],
  },
];

export const knowledgeTemplates: KnowledgeTemplate[] = [
  ...coreKnowledgeTemplates,
  ...additionalRevenueModels.map(revenueModelTemplate),
];
