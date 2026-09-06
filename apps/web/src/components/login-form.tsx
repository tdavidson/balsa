"use client";

import { useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type Step = "email" | "code";

/**
 * Email-code sign-in built on Clerk's custom-flow API. An email Clerk has not
 * seen before is created on the fly, so there is no separate sign-up page.
 */
export function LoginForm() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const busy = fetchStatus === "fetching";

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    if (!signIn || !email.trim()) return;
    setMessage(null);
    const created = await signIn.create({ identifier: email.trim(), signUpIfMissing: true });
    if (created.error) return setMessage(describe(created.error));
    const sent = await signIn.emailCode.sendCode();
    if (sent.error) return setMessage(describe(sent.error));
    setStep("code");
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (!signIn || code.trim().length < 6) return;
    setMessage(null);
    const verified = await signIn.emailCode.verifyCode({ code: code.trim() });
    if (verified.error) return setMessage(describe(verified.error));
    if (signIn.status !== "complete") return setMessage("Sign-in needs more information than this form collects. Check the Clerk settings for required fields.");
    const finalized = await signIn.finalize({ navigate: () => router.push("/") });
    if (finalized.error) setMessage(describe(finalized.error));
  }

  function startOver() {
    setStep("email");
    setCode("");
    setMessage(null);
    void signIn?.reset();
  }

  const fieldError = step === "email" ? errors.fields.identifier?.message : errors.fields.code?.message;

  return (
    <form className="grid w-full max-w-[384px] gap-2" onSubmit={step === "email" ? sendCode : verifyCode} noValidate>
      <h1 className="display text-[32px] leading-[1.15]" style={{ fontVariationSettings: '"opsz" 32' }}>
        Sign in to Nevermodel
      </h1>
      <p className="mb-5 text-ink-2">
        {step === "email" ? "A radical rethink of financial operations for AI-native startups." : <>Thanks! We sent a six-digit code to <span className="text-ink">{email}</span>.</>}
      </p>

      {step === "email" ? (
        <input
          className={field}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@company.com"
          aria-label="Email"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />
      ) : (
        <input
          className={cn(field, "tracking-[0.2em]")}
          type="text"
          name="code"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="000000"
          aria-label="Six-digit code"
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          disabled={busy}
        />
      )}

      <button
        className="mt-3 inline-flex h-[52px] items-center justify-center gap-2 rounded-full bg-ink text-[15px] font-medium text-paper transition-colors outline-none hover:bg-ink/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
        type="submit"
        disabled={busy || !signIn || (step === "email" ? !email.trim() : code.length < 6)}
      >
        {step === "email" ? "Send code" : "Continue"}
        <ArrowRight className="size-4" aria-hidden="true" />
      </button>

      {(message || fieldError) && (
        <p className="mt-2 text-[14px] text-red-ink" role="alert">
          {message ?? fieldError}
        </p>
      )}

      <p className="mt-5 text-[14px] text-ink-2">
        {step === "email" ? (
          "New here? The same email creates your workspace."
        ) : (
          <>
            Didn’t get it?{" "}
            <button type="button" className="text-ink underline underline-offset-[3px]" onClick={startOver}>
              Use a different email
            </button>
          </>
        )}
      </p>
    </form>
  );
}

const field =
  "h-[52px] w-full rounded-lg border border-input bg-background px-4 text-[17px] text-ink outline-none transition-colors placeholder:text-pencil focus:border-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60";

function describe(error: { message?: string | undefined; longMessage?: string | undefined } | null): string {
  return error?.longMessage ?? error?.message ?? "Something went wrong. Try again.";
}
