/**
 * Whether an account is cash. Loaders resolve `isCash` for every account from
 * the chart: the user's explicit choice, otherwise a linked bank account,
 * otherwise "cash" in the account name or statement line. Each caller passes
 * its historical name rule as the fallback, which applies only to lines that
 * carry no resolved flag (stored calculation inputs and fixtures that predate it).
 */
export const cashFlag = (line: { isCash?: boolean }, byName: () => boolean) => line.isCash ?? byName();

/** The chart-level rule loaders use to resolve `isCash`. */
export function resolveAccountIsCash(account: { accountType: string; statementSection?: string | null; statementLine?: string | null; name: string; cashTreatment?: string | null; bankLinked: boolean }) {
  const section = account.accountType === "contra" ? account.statementSection : account.accountType;
  if (section !== "asset") return false;
  if (account.cashTreatment === "cash") return true;
  if (account.cashTreatment === "not_cash") return false;
  return account.bankLinked || /\bcash\b/i.test(`${account.statementLine ?? ""} ${account.name}`);
}
