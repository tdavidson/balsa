import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { request } from "node:https";
import { z } from "zod";

export class BankError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function tellerConfig() {
  const environment = z.enum(["sandbox", "development", "production"]).safeParse(process.env.TELLER_ENVIRONMENT || "sandbox");
  if (!environment.success) throw new BankError("TELLER_ENVIRONMENT must be sandbox, development, or production.", 503);
  const required = ["TELLER_APPLICATION_ID", "TELLER_TOKEN_SIGNING_PUBLIC_KEY", "TELLER_TOKEN_ENCRYPTION_KEY", ...(environment.data === "sandbox" ? [] : ["TELLER_CERTIFICATE", "TELLER_PRIVATE_KEY"])];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new BankError(`Configure ${missing.join(", ")} in your environment; see .env.example and docs/teller.md.`, 503);
  const key = Buffer.from(process.env.TELLER_TOKEN_ENCRYPTION_KEY!, "base64");
  if (key.length !== 32) throw new BankError("TELLER_TOKEN_ENCRYPTION_KEY must encode 32 random bytes in base64.", 503);
  const pem = (name: string) => process.env[name]?.replace(/\\n/g, "\n");
  return { environment: environment.data, applicationId: process.env.TELLER_APPLICATION_ID!, signingKey: pem("TELLER_TOKEN_SIGNING_PUBLIC_KEY")!, key, cert: pem("TELLER_CERTIFICATE"), privateKey: pem("TELLER_PRIVATE_KEY") };
}
export function sealToken(token: string, context: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", tellerConfig().key, iv);
  cipher.setAAD(Buffer.from(context)); const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}
export function openToken(value: string, context: string) {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new BankError("Bank credential cannot be read. Check the encryption key.", 503);
  try { const cipher = createDecipheriv("aes-256-gcm", tellerConfig().key, Buffer.from(iv, "base64")); cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(Buffer.from(tag, "base64")); return Buffer.concat([cipher.update(Buffer.from(data, "base64")), cipher.final()]).toString("utf8"); }
  catch { throw new BankError("Bank credential cannot be read. Check the encryption key.", 503); }
}
const providerId = z.string().regex(/^[a-z]+_[a-zA-Z0-9]+$/).max(128);
export const enrollmentSchema = z.object({ sessionId: z.uuid(), accessToken: z.string().regex(/^[A-Za-z0-9_-]+$/).max(512), user: z.object({ id: providerId }), enrollment: z.object({ id: providerId }), signatures: z.array(z.string().max(256)).min(1).max(5) });
export function verifyEnrollment(nonce: string, enrollment: z.infer<typeof enrollmentSchema>) {
  const config = tellerConfig();
  const digest = createHash("sha256").update([nonce, enrollment.accessToken, enrollment.user.id, enrollment.enrollment.id, config.environment].join(".")).digest();
  try {
    // Teller's dashboard supplies a base64 raw Ed25519 key; PEM is supported too.
    const key = config.signingKey.includes("BEGIN PUBLIC KEY") ? createPublicKey(config.signingKey) : createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(config.signingKey, "base64")]), format: "der", type: "spki" });
    return enrollment.signatures.some((signature) => verify(null, digest, key, Buffer.from(signature, "base64")));
  } catch { return false; }
}
export function validWebhook(body: string, header: string | null, now = Date.now()) {
  const secret = process.env.TELLER_WEBHOOK_SECRET;
  if (!secret || !header || header.length > 2048) return false;
  const parts = header.split(",").map((part) => part.trim()); const timestamps = parts.filter((part) => part.startsWith("t="));
  if (timestamps.length !== 1) return false;
  const timestamp = timestamps[0]!.slice(2);
  if (!/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 180) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  return parts.filter((part) => part.startsWith("v1=")).some((part) => { const value = part.slice(3); if (!/^[a-f0-9]{64}$/i.test(value)) return false; return timingSafeEqual(expected, Buffer.from(value, "hex")); });
}
export const accountSchema = z.object({ id: providerId, enrollment_id: providerId, name: z.string().max(255), last_four: z.string().max(4).nullable().optional(), currency: z.string().regex(/^[A-Z]{3}$/), type: z.enum(["depository", "credit"]), status: z.enum(["open", "closed"]), institution: z.object({ name: z.string().max(255) }), links: z.object({ transactions: z.string().optional() }).optional() });
export const transactionSchema = z.object({ id: providerId, account_id: providerId, amount: z.string().regex(/^-?\d{1,15}\.\d{2}$/), date: z.iso.date(), description: z.string().max(2000), status: z.enum(["pending", "posted"]), type: z.string().max(128) });
export type TellerAccount = z.infer<typeof accountSchema>;
export type TellerTransaction = z.infer<typeof transactionSchema>;
export type TellerTransport = (token: string, path: string, method?: "GET" | "DELETE") => Promise<unknown>;
export const tellerRequest: TellerTransport = async (token, path, method = "GET") => {
  const config = tellerConfig();
  if (!/^\/accounts(?:[/?]|$)/.test(path)) throw new BankError("Invalid bank API request.");
  return new Promise((resolve, reject) => {
    const fail = () => reject(new BankError("Teller is unavailable. Retry syncing later.", 502));
    const req = request({ hostname: "api.teller.io", port: 443, path, method, ...(config.environment !== "sandbox" ? { cert: config.cert, key: config.privateKey } : {}), headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`, Accept: "application/json" } }, (res) => {
      const chunks: Buffer[] = []; let size = 0;
      res.on("error", fail);
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 2_000_000) { res.destroy(); fail(); } else chunks.push(chunk); });
      res.on("end", () => {
        if (method === "DELETE" && res.statusCode === 410) return resolve(null);
        if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 410) return reject(new BankError("Bank access needs attention. Reconnect this bank.", 409));
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) return fail();
        if (res.statusCode === 204) return resolve(null);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { fail(); }
      });
    });
    // Absolute deadline, including DNS, TLS, and a stalled response body.
    const timer = setTimeout(() => { req.destroy(); fail(); }, 15_000);
    req.on("close", () => clearTimeout(timer)); req.on("error", fail); req.end();
  });
};
export async function fetchTransactions(token: string, accountId: string, transport: TellerTransport = tellerRequest, deadline = Date.now() + 40_000) {
  providerId.parse(accountId); const rows: TellerTransaction[] = []; const seen = new Set<string>(); let cursor: string | undefined;
  for (let page = 0; page < 40; page++) {
    if (Date.now() > deadline) throw new BankError("Bank history exceeded the sync time limit. No partial import was saved.", 422);
    const path = `/accounts/${accountId}/transactions?count=500${cursor ? `&from_id=${cursor}` : ""}`;
    const batch = z.array(transactionSchema).max(500).parse(await transport(token, path));
    for (const row of batch) { if (row.account_id !== accountId || seen.has(row.id)) throw new BankError("Bank returned inconsistent transaction pagination. Retry syncing.", 502); seen.add(row.id); rows.push(row); }
    if (batch.length < 500) return rows;
    cursor = batch.at(-1)!.id;
  }
  throw new BankError("Bank history exceeds 20,000 transactions. No partial import was saved.", 422);
}
/** Teller positive amounts are debits, negative amounts credits. Never infer revenue or expenses here. */
export function normalizedBankRow(row: TellerTransaction) {
  const negative = row.amount.startsWith("-"); const amount = negative ? row.amount.slice(1) : row.amount;
  return { sourceKey: row.id, rowType: "bank_transaction", period: row.date.slice(0, 7), transactionDate: row.date, description: row.description, amount, direction: negative ? "receipt" as const : "spend" as const, sourceLocation: `teller:${row.account_id}:${row.id}`, rawJson: JSON.stringify(row), status: "staged" };
}
