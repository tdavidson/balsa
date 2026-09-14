import "server-only";
import { cookies } from "next/headers";

export const activeCompanyCookieName = "nevermodel_company";
const activeCompanyCookieMaxAge = 365 * 24 * 60 * 60;

/**
 * The cookie records which company the user last opened. It is a preference,
 * never authorization: the auth service re-verifies membership for the stored
 * id on every request, so a forged or stale value can only be ignored.
 */
export async function readActiveCompanyId(): Promise<string | null> {
  return (await cookies()).get(activeCompanyCookieName)?.value ?? null;
}

export async function setActiveCompanyCookie(companyId: string) {
  (await cookies()).set({ name: activeCompanyCookieName, value: companyId, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: activeCompanyCookieMaxAge });
}

export async function clearActiveCompanyCookie() {
  (await cookies()).delete(activeCompanyCookieName);
}
