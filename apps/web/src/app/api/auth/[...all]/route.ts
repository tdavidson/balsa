import { NextResponse } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";
import { betterAuthServer } from "@/lib/better-auth";

const handler = betterAuthServer ? toNextJsHandler(betterAuthServer) : null;

export const GET = handler?.GET ?? (() => NextResponse.json({ error: "Authentication is disabled for this installation." }, { status: 404 }));
export const POST = handler?.POST ?? (() => NextResponse.json({ error: "Authentication is disabled for this installation." }, { status: 404 }));
