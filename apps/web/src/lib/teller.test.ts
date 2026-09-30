import { createHash, createHmac, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTransactions, normalizedBankRow, openToken, sealToken, tellerConfig, validWebhook, verifyEnrollment } from "./teller";
const keys = generateKeyPairSync("ed25519");
beforeEach(() => {
  vi.stubEnv("TELLER_APPLICATION_ID", "app_synthetic"); vi.stubEnv("TELLER_ENVIRONMENT", "sandbox");
  vi.stubEnv("TELLER_TOKEN_SIGNING_PUBLIC_KEY", keys.publicKey.export({ type: "spki", format: "pem" }).toString());
  vi.stubEnv("TELLER_TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});
afterEach(() => vi.unstubAllEnvs());
describe("Teller boundary", () => {
  it("requires installation configuration and mTLS only for real data", () => {
    expect(tellerConfig().environment).toBe("sandbox"); vi.stubEnv("TELLER_ENVIRONMENT", "development"); vi.stubEnv("TELLER_CERTIFICATE", ""); vi.stubEnv("TELLER_PRIVATE_KEY", "");
    expect(() => tellerConfig()).toThrow("TELLER_CERTIFICATE");
    vi.stubEnv("TELLER_ENVIRONMENT", "invalid"); expect(() => tellerConfig()).toThrow("TELLER_ENVIRONMENT");
  });
  it("authenticates encrypted tokens against company/enrollment and detects tampering", () => {
    const token = sealToken("synthetic_secret", "company-a:enrollment-a"); expect(token).not.toContain("synthetic_secret");
    expect(openToken(token, "company-a:enrollment-a")).toBe("synthetic_secret");
    expect(() => openToken(token, "company-b:enrollment-a")).toThrow();
    const parts = token.split("."); parts[2] = randomBytes(16).toString("base64"); expect(() => openToken(parts.join("."), "company-a:enrollment-a")).toThrow();
  });
  it("verifies nonce-bound signed callbacks and rejects another token or environment", () => {
    const data = { sessionId: "00000000-0000-4000-8000-000000000000", accessToken: "token_synthetic", user: { id: "usr_synthetic" }, enrollment: { id: "enr_synthetic" }, signatures: [] as string[] };
    data.signatures = [sign(null, createHash("sha256").update("nonce.token_synthetic.usr_synthetic.enr_synthetic.sandbox").digest(), keys.privateKey).toString("base64")];
    expect(verifyEnrollment("nonce", data)).toBe(true); expect(verifyEnrollment("other", data)).toBe(false);
    expect(verifyEnrollment("nonce", { ...data, accessToken: "token_other" })).toBe(false);
    vi.stubEnv("TELLER_TOKEN_SIGNING_PUBLIC_KEY", keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64")); expect(verifyEnrollment("nonce", data)).toBe(true);
  });
  it("verifies raw webhook bytes with rotation signatures and rejects replay, future timestamps and malformed signatures", () => {
    vi.stubEnv("TELLER_WEBHOOK_SECRET", "synthetic-webhook-key"); const body = '{"type":"webhook.test"}'; const now = 1790640000000; const time = now / 1000;
    const signature = createHmac("sha256", "synthetic-webhook-key").update(`${time}.${body}`).digest("hex");
    const header = `t=${time},v1=${"0".repeat(64)},v1=${signature}`;
    expect(validWebhook(body, header, now)).toBe(true); expect(validWebhook(body + " ", header, now)).toBe(false);
    expect(validWebhook(body, header, now + 181_000)).toBe(false); expect(validWebhook(body, header, now - 181_000)).toBe(false);
    expect(validWebhook(body, `t=${time},v1=nope`, now)).toBe(false);
  });
  it("paginates backward, preserves exact decimal amounts and rejects foreign or repeated rows", async () => {
    const row = { id: "txn_one", account_id: "acc_one", amount: "9007199254740.99", date: "2026-09-01", description: "Synthetic transfer", status: "posted" as const, type: "transfer" };
    expect(normalizedBankRow(row)).toMatchObject({ amount: row.amount, direction: "spend", status: "staged" });
    expect(normalizedBankRow({ ...row, amount: "-0.01" })).toMatchObject({ amount: "0.01", direction: "receipt" });
    const batch = Array.from({ length: 500 }, (_, i) => ({ ...row, id: `txn_${i}` }));
    const transport = vi.fn().mockResolvedValueOnce(batch).mockResolvedValueOnce([row]);
    expect(await fetchTransactions("synthetic", "acc_one", transport)).toHaveLength(501);
    expect(transport.mock.calls[1]![1]).toContain("from_id=txn_499");
    await expect(fetchTransactions("synthetic", "acc_one", vi.fn().mockResolvedValue([{ ...row, account_id: "acc_other" }]))).rejects.toThrow("inconsistent");
    await expect(fetchTransactions("synthetic", "acc_one", vi.fn().mockResolvedValue(batch))).rejects.toThrow("inconsistent");
  });
});
