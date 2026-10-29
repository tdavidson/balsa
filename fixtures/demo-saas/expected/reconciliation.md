# Demo expected results — do not upload as source evidence

All values are synthetic USD. Generated deterministically from the fixture specification. This is a human review oracle, not proof that Balsa supports every accrual automatically.

| Month | Revenue | Net income | Ending MRR | Bank cash | Demo Pay clearing |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-01 | $6000.00 | -$33175.20 | $6000.00 | $216824.80 | $0.00 |
| 2026-02 | $9000.00 | -$30962.80 | $9000.00 | $185862.00 | $0.00 |
| 2026-03 | $12000.00 | -$28750.40 | $12000.00 | $157111.60 | $0.00 |
| 2026-04 | $14000.00 | -$29146.70 | $14000.00 | $138964.90 | $0.00 |
| 2026-05 | $15500.00 | -$27694.20 | $15500.00 | $110270.70 | $0.00 |
| 2026-06 | $20000.00 | -$25082.30 | $20000.00 | $214888.40 | $0.00 |
| 2026-07 | $21500.00 | -$23281.80 | $21500.00 | $187706.60 | $0.00 |
| 2026-08 | $21500.00 | -$23981.80 | $21500.00 | $159824.80 | $0.00 |
| 2026-09 | $24500.00 | -$23467.30 | $25000.00 | $127345.10 | $2912.40 |

September closing checks:

- Accounts receivable $4,000; accounts payable $1,800.
- Deferred subscription revenue $36,000: annual A has $12,000 remaining; annual B has $24,000 remaining.
- Prepaid insurance $6,000; laptop cost $2,400 less $400 accumulated depreciation = $2,000 net.
- Paid-in capital $350,000, including June's $100,000 financing.
- Closing MRR $25,000, ARR $300,000. September recognized revenue $24,500; difference is the one-time $500 refund.
- September MRR bridge: $21,500 opening + $4,000 new enterprise − $500 downgrade = $25,000.
- Refunds retain the original processing fee. Demo Pay net collections less paid payouts equals $2912.40 clearing; the October 2 payout settles this exactly.
- Checking/savings transfers net to zero consolidated bank cash and do not affect income.
- October's three selected events create no new revenue or expense. They do not establish complete October coverage.

The reference ledger includes opening balances and noncash adjusting entries. The bank and Demo Pay files alone do not establish a complete accrual balance sheet. Unsupported or unverified treatments should remain visible for review rather than be forced to match this oracle.
