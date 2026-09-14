/**
 * Black-box acceptance for local multi-company isolation.
 *
 * Runs against a live Nevermodel (BASE_URL, default http://localhost:3000) and
 * proves the acceptance gate in docs/plans/local-multi-company.md: two clean
 * companies, repeated switching, no state or blob leakage, cookies that are a
 * preference and never authorization, and a second user who cannot reach
 * another user's company even while holding its UUID.
 *
 * ISOLATION_AUTH_MODE=disabled (default) exercises the single operator user;
 * ISOLATION_AUTH_MODE=better-auth signs up two users and runs the full matrix.
 * Set ISOLATION_SIGN_UP_CODE to match AUTH_SIGN_UP_CODE when the installation
 * gates registration behind a passcode.
 */
const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const authMode = process.env.ISOLATION_AUTH_MODE === "better-auth" ? "better-auth" : "disabled";
const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const signUpCode = process.env.ISOLATION_SIGN_UP_CODE ?? "";

let checks = 0;
const pass = (message: string) => { checks += 1; console.log(`  ok   ${message}`); };
const step = (message: string) => console.log(`\n${message}`);
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

/** One browser: an isolated cookie jar, exactly what a real client carries between requests. */
type Browser = { label: string; jar: Map<string, string> };
const browser = (label: string): Browser => ({ label, jar: new Map() });
const copyJar = (source: Browser, label: string): Browser => ({ label, jar: new Map(source.jar) });

function storeCookies(target: Browser, response: Response) {
  for (const header of response.headers.getSetCookie()) {
    const [pair = "", ...attributes] = header.split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    const expired = attributes.some((attribute) => /^\s*max-age\s*=\s*0\s*$/i.test(attribute)) || value === "";
    if (expired) target.jar.delete(name); else target.jar.set(name, value);
  }
}

type RequestOptions = { method?: string; json?: unknown; form?: FormData; headers?: Record<string, string> };

async function call(target: Browser, path: string, options: RequestOptions = {}) {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { ...options.headers };
  if (target.jar.size) headers["Cookie"] = [...target.jar].map(([name, value]) => `${name}=${value}`).join("; ");
  // proxy.ts rejects cross-site mutations; a real browser sends a same-origin Origin.
  if (method !== "GET" && method !== "HEAD") headers["Origin"] = baseUrl;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.json !== undefined) { body = JSON.stringify(options.json); headers["Content-Type"] = "application/json"; }
  // Unauthenticated API calls redirect to /login; following that would hide the failure.
  const response = await fetch(`${baseUrl}${path}`, { method, headers, ...(body ? { body } : {}), redirect: "manual" });
  storeCookies(target, response);
  return response;
}

async function json<T = unknown>(target: Browser, path: string, options: RequestOptions = {}): Promise<{ status: number; body: T }> {
  const response = await call(target, path, options);
  const text = await response.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 400) }; }
  return { status: response.status, body: parsed as T };
}

async function expectJson<T = unknown>(target: Browser, path: string, expected: number, options: RequestOptions = {}): Promise<T> {
  const { status, body } = await json<T>(target, path, options);
  assert(status === expected, `${options.method ?? "GET"} ${path} as ${target.label}: expected ${expected}, got ${status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

/** Every `companyId` anywhere in a payload, however deeply nested. */
function companyIds(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) { for (const entry of value) companyIds(entry, found); return found; }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === "companyId" && typeof entry === "string") found.push(entry);
      else companyIds(entry, found);
    }
    return found;
  }
  return found;
}

const cookieHeaderFor = (target: Browser) => [...target.jar].map(([name, value]) => `${name}=${value}`).join("; ");

type Company = { id: string; name: string; baseCurrency: string; role: string };

async function activeCompanyId(target: Browser) {
  const body = await expectJson<{ companies: Company[]; activeCompanyId: string }>(target, "/api/companies", 200);
  return body.activeCompanyId;
}

async function selectCompany(target: Browser, companyId: string) {
  const body = await expectJson<{ activeCompanyId: string }>(target, "/api/companies/active", 200, { method: "PUT", json: { companyId } });
  assert(body.activeCompanyId === companyId, `Switching ${target.label} to ${companyId} returned ${body.activeCompanyId}`);
}

async function postTextEvidence(target: Browser, sourceName: string) {
  const body = await expectJson<{ id?: string; queued?: boolean; duplicate?: boolean }>(target, "/api/evidence", 200, {
    method: "POST",
    // `defer: true` keeps intake durable and model-free: no provider key is needed.
    json: { text: `Isolation probe ${token} for ${sourceName}. Opening cash 1234.`, sourceName, month: "2026-09", defer: true },
  });
  assert(typeof body.id === "string" && body.id.length > 0, `Text evidence ${sourceName} returned no id: ${JSON.stringify(body)}`);
  return body.id as string;
}

async function postFileEvidence(target: Browser, filename: string) {
  const form = new FormData();
  form.set("file", new File([`date,description,amount\n2026-09-01,isolation ${token} ${filename},100\n`], filename, { type: "text/csv" }));
  form.set("month", "2026-09");
  form.set("defer", "true");
  const body = await expectJson<{ id?: string }>(target, "/api/evidence", 200, { method: "POST", form });
  assert(typeof body.id === "string" && body.id.length > 0, `File evidence ${filename} returned no id: ${JSON.stringify(body)}`);
  return body.id as string;
}

/** Every read surface the plan requires to stay company-scoped. */
const scopedEndpoints = ["/api/evidence", "/api/state", "/api/conversations", "/api/knowledge", "/api/journals", "/api/calculations", "/api/usage"] as const;

async function readScopedSurfaces(target: Browser, expectedCompanyId: string) {
  const snapshot: Record<string, string> = {};
  for (const path of scopedEndpoints) {
    const body = await expectJson(target, path, 200);
    const serialized = JSON.stringify(body);
    for (const id of companyIds(body)) assert(id === expectedCompanyId, `${path} returned companyId ${id} while ${expectedCompanyId} was active`);
    snapshot[path] = serialized;
  }
  return snapshot;
}

function assertAbsent(snapshot: Record<string, string>, needles: string[], label: string) {
  for (const [path, serialized] of Object.entries(snapshot)) {
    for (const needle of needles) assert(!serialized.includes(needle), `${path} under ${label} leaked ${needle}`);
  }
}

const signUpBody = (label: string, email: string) => ({ name: `Isolation ${label}`, email, password: `Isolation-${token}-passphrase` });

async function signUp(label: string): Promise<{ target: Browser; email: string }> {
  const target = browser(label);
  const email = `isolation-${label}-${token}@nevermodel.test`;
  const headers = signUpCode ? { "x-nevermodel-sign-up-code": signUpCode } : undefined;
  const response = await call(target, "/api/auth/sign-up/email", { method: "POST", json: signUpBody(label, email), ...(headers ? { headers } : {}) });
  const text = await response.text();
  assert(response.ok, `Sign-up for ${label} failed: ${response.status} ${text.slice(0, 300)}`);
  assert(target.jar.size > 0, `Sign-up for ${label} returned no session cookie`);
  return { target, email };
}

async function deleteActiveCompany(target: Browser, expectedName: string) {
  const preview = await expectJson<{ company: { id: string; name: string }; confirmation: string }>(target, "/api/testing/company-reset", 200);
  assert(preview.company.name === expectedName, `Reset preview names ${preview.company.name}, expected ${expectedName}`);
  await expectJson(target, "/api/testing/company-reset", 200, { method: "POST", json: { confirmation: preview.confirmation } });
  return preview.company.id;
}

async function main() {
  console.log(`Multi-company isolation acceptance — ${baseUrl} (ISOLATION_AUTH_MODE=${authMode})`);
  if (authMode === "better-auth" && signUpCode) {
    // The passcode is the whole registration gate: an unauthenticated stranger
    // must not be able to create an identity on this installation at all.
    const stranger = browser("stranger");
    const denied = await json(stranger, "/api/auth/sign-up/email", { method: "POST", json: signUpBody("stranger", `isolation-stranger-${token}@nevermodel.test`) });
    assert(denied.status === 403, `Sign-up without the sign-up code returned ${denied.status}, expected 403`);
    assert(stranger.jar.size === 0, "A rejected sign-up still returned a session cookie");
    pass("signing up without the sign-up code is rejected (403) and sets no session cookie");
  }
  const one = authMode === "better-auth" ? await signUp("user1").then((session) => { pass(`signed up ${session.email} and received a session cookie`); return session.target; }) : browser("user1");

  step("1. Two companies, creation selects the new one");
  const initial = await expectJson<{ companies: Company[]; activeCompanyId: string }>(one, "/api/companies", 200);
  assert(initial.companies.length >= 1, "The first user has no company");
  const companyA = initial.companies[0]!;
  assert(uuidPattern.test(companyA.id), `Company A id is not a UUID: ${companyA.id}`);
  pass(`company A is ${companyA.name} (${companyA.id})`);
  const nameB = `Isolation B ${token}`;
  const created = await expectJson<{ company: Company }>(one, "/api/companies", 201, { method: "POST", json: { name: nameB, baseCurrency: "EUR" } });
  const companyB = created.company;
  assert(companyB.id !== companyA.id, "POST /api/companies returned the existing company");
  assert(companyB.baseCurrency === "EUR", `Company B base currency is ${companyB.baseCurrency}, expected EUR`);
  assert(!("financialStateRevision" in (companyB as object)), "POST /api/companies leaked internal company columns");
  pass(`created company B ${companyB.name} (${companyB.id}) with EUR`);
  const listed = await expectJson<{ companies: Company[]; activeCompanyId: string }>(one, "/api/companies", 200);
  const listedIds = listed.companies.map((company) => company.id);
  assert(listedIds.includes(companyA.id) && listedIds.includes(companyB.id), `The switcher lists ${JSON.stringify(listedIds)}, expected both companies`);
  assert(listed.activeCompanyId === companyB.id, `Creation did not select company B (active is ${listed.activeCompanyId})`);
  pass("GET /api/companies lists both and the cookie now selects B");
  const stateB = await expectJson<{ companyId: string }>(one, "/api/state", 200);
  assert(stateB.companyId === companyB.id, `GET /api/state reports ${stateB.companyId}, expected B`);
  pass("GET /api/state reports company B");

  step("2. Evidence, dashboard, chat, knowledge, journals and calculations stay scoped");
  const evidenceBText = await postTextEvidence(one, `b-notes-${token}.md`);
  const evidenceBFile = await postFileEvidence(one, `b-upload-${token}.csv`);
  pass(`posted two evidence records to B (${evidenceBText}, ${evidenceBFile})`);
  await selectCompany(one, companyA.id);
  const evidenceAText = await postTextEvidence(one, `a-notes-${token}.md`);
  pass(`switched to A and posted ${evidenceAText}`);
  const snapshotA = await readScopedSurfaces(one, companyA.id);
  assertAbsent(snapshotA, [companyB.id, evidenceBText, evidenceBFile, `b-notes-${token}.md`, `b-upload-${token}.csv`, nameB], "company A");
  pass(`company A reads (${scopedEndpoints.join(", ")}) contain no company B ids, names or evidence`);
  await selectCompany(one, companyB.id);
  const snapshotB = await readScopedSurfaces(one, companyB.id);
  assertAbsent(snapshotB, [companyA.id, evidenceAText, `a-notes-${token}.md`], "company B");
  pass("company B reads contain no company A ids or evidence");
  const evidenceListB = await expectJson<{ evidence: { id: string }[] } | { id: string }[]>(one, "/api/evidence", 200);
  const rowsB = Array.isArray(evidenceListB) ? evidenceListB : (evidenceListB as { evidence?: { id: string }[] }).evidence ?? [];
  assert(rowsB.some((row) => row.id === evidenceBText) && rowsB.some((row) => row.id === evidenceBFile), "Company B does not list its own evidence");
  pass("company B lists exactly its own evidence records");

  step("3. Blobs cannot cross companies");
  await selectCompany(one, companyA.id);
  for (const [label, id] of [["B text evidence", evidenceBText], ["B uploaded file", evidenceBFile]] as const) {
    const response = await call(one, `/api/evidence/${id}/file`, {});
    assert(response.status === 404, `While A was active, downloading ${label} returned ${response.status}, expected 404`);
    await response.arrayBuffer();
  }
  pass("downloading company B blobs while A is active returns 404");
  await selectCompany(one, companyB.id);
  const ownFile = await call(one, `/api/evidence/${evidenceBFile}/file`, {});
  const ownBytes = Buffer.from(await ownFile.arrayBuffer());
  assert(ownFile.status === 200, `Company B cannot download its own upload: ${ownFile.status} ${ownBytes.toString("utf8").slice(0, 200)}`);
  assert(ownBytes.toString("utf8").includes(token), "Company B's own upload came back without its contents");
  pass("company B downloads its own uploaded file (200 with the stored bytes)");

  step("4. Guessed, stale and hand-edited company cookies are rejected");
  const forged = copyJar(one, "user1-forged");
  const guessedId = crypto.randomUUID();
  forged.jar.set("nevermodel_company", guessedId);
  const forgedState = await expectJson<{ companyId: string }>(forged, "/api/state", 200);
  assert(forgedState.companyId === companyA.id, `A guessed company UUID resolved to ${forgedState.companyId}, expected the fallback ${companyA.id}`);
  pass("a guessed company UUID in the cookie falls back to the first company without erroring");
  forged.jar.set("nevermodel_company", "not-a-company");
  const garbageState = await expectJson<{ companyId: string }>(forged, "/api/state", 200);
  assert(garbageState.companyId === companyA.id, `A garbage cookie resolved to ${garbageState.companyId}, expected the fallback ${companyA.id}`);
  pass("a garbage cookie value falls back to the first company without erroring");
  const deniedSwitch = await json(forged, "/api/companies/active", { method: "PUT", json: { companyId: guessedId } });
  assert(deniedSwitch.status === 403, `PUT /api/companies/active with an unknown UUID returned ${deniedSwitch.status}, expected 403`);
  const invalidSwitch = await json(forged, "/api/companies/active", { method: "PUT", json: { companyId: "abc" } });
  assert(invalidSwitch.status === 400, `PUT /api/companies/active with "abc" returned ${invalidSwitch.status}, expected 400`);
  pass("switching to an unknown company is 403 and a malformed id is 400");
  assert(cookieHeaderFor(one).includes(companyB.id), "Cookie tampering in another jar changed the real session's selection");
  pass("the tampered jar never altered the honest session");

  step("5. Selection survives a fresh request that carries only the cookie");
  assert((await activeCompanyId(one)) === companyB.id, "Company B was not still active before the restart simulation");
  const restarted = { label: "user1-restart", jar: new Map(one.jar) } satisfies Browser;
  const page = await call(restarted, "/", {});
  assert(page.status === 200, `GET / returned ${page.status}`);
  const html = await page.text();
  assert(html.includes(nameB), "The dashboard shell does not show company B after a cookie-only request");
  assert((await activeCompanyId(restarted)) === companyB.id, "A cookie-only request did not restore company B");
  pass("a cookie-only request re-opens company B on both the page and the API");

  step("6. A second user cannot reach the first user's company");
  let secondCompany: Company | null = null;
  let two: Browser | null = null;
  if (authMode !== "better-auth") {
    console.log("  note  ISOLATION_AUTH_MODE=disabled has exactly one operator identity; second-user checks are skipped (run with ISOLATION_AUTH_MODE=better-auth).");
  } else {
    const signedUp = await signUp("user2");
    two = signedUp.target;
    const theirs = await expectJson<{ companies: Company[]; activeCompanyId: string }>(two, "/api/companies", 200);
    assert(theirs.companies.length === 1, `The second user sees ${theirs.companies.length} companies, expected exactly 1`);
    secondCompany = theirs.companies[0]!;
    assert(secondCompany.id !== companyA.id && secondCompany.id !== companyB.id, "The second user was given one of the first user's companies");
    pass(`second user ${signedUp.email} sees only its own company ${secondCompany.id}`);
    for (const [label, id] of [["A", companyA.id], ["B", companyB.id]] as const) {
      const denied = await json(two, "/api/companies/active", { method: "PUT", json: { companyId: id } });
      assert(denied.status === 403, `The second user switching to company ${label} returned ${denied.status}, expected 403`);
    }
    pass("knowing another user's company UUID does not allow switching to it (403)");
    for (const [label, id] of [["A text", evidenceAText], ["B file", evidenceBFile]] as const) {
      const blocked = await call(two, `/api/evidence/${id}/file`, {});
      assert(blocked.status === 404, `The second user downloading ${label} evidence returned ${blocked.status}, expected 404`);
      await blocked.arrayBuffer();
    }
    pass("the second user cannot download another user's blobs (404)");
    const theirState = await expectJson<{ companyId: string }>(two, "/api/state", 200);
    assert(theirState.companyId === secondCompany.id, `The second user's state reports ${theirState.companyId}`);
    const theirSnapshot = await readScopedSurfaces(two, secondCompany.id);
    assertAbsent(theirSnapshot, [companyA.id, companyB.id, evidenceAText, evidenceBText, evidenceBFile], "the second user");
    pass("the second user's dashboard, chat, knowledge, journals and calculations show only their own company");
  }

  step("7. Deleting one company leaves the other untouched");
  await selectCompany(one, companyB.id);
  const deletedId = await deleteActiveCompany(one, nameB);
  assert(deletedId === companyB.id, `Reset deleted ${deletedId}, expected ${companyB.id}`);
  const remaining = await expectJson<{ companies: Company[]; activeCompanyId: string }>(one, "/api/companies", 200);
  assert(!remaining.companies.some((company) => company.id === companyB.id), "Company B is still listed after deletion");
  assert(remaining.companies.some((company) => company.id === companyA.id), "Deleting company B removed company A");
  assert(remaining.activeCompanyId === companyA.id, `After deleting B the active company is ${remaining.activeCompanyId}, expected the fallback to A`);
  pass("company B is gone and the selection falls back to company A");
  const survivingA = await expectJson<{ companyId: string }>(one, "/api/state", 200);
  assert(survivingA.companyId === companyA.id, `Company A state reports ${survivingA.companyId} after the deletion`);
  const finalSnapshotA = await readScopedSurfaces(one, companyA.id);
  assertAbsent(finalSnapshotA, [companyB.id, evidenceBText, evidenceBFile], "company A after deletion");
  const stillThere = await call(one, `/api/evidence/${evidenceAText}/file`, {});
  await stillThere.arrayBuffer();
  assert(stillThere.status === 200, `Company A's own evidence file returned ${stillThere.status} after deleting company B`);
  pass("company A keeps its evidence and blobs after company B is deleted");
  if (two && secondCompany) {
    await deleteActiveCompany(two, secondCompany.name);
    pass(`deleted the second user's company ${secondCompany.id}`);
  }

  console.log(`\nMulti-company isolation passed: ${checks} checks in ${authMode} mode — two companies created and switched, blobs and every company-scoped read surface isolated, forged cookies rejected, selection persisted across a cookie-only request, and deletion confined to one company.`);
}

main().catch((error: unknown) => {
  console.error(`\nMulti-company isolation FAILED after ${checks} checks: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
