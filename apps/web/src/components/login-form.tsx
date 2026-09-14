"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Nevermodel-owned password sign-in. Better Auth handles credentials and session
 * cookies; this screen deliberately remains application UI rather than a
 * hosted identity widget.
 */
export function LoginForm({ allowSignUp }: { allowSignUp: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setMessage(null);
    setBusy(true);
    try {
      const result = mode === "sign-up"
        ? await authClient.signUp.email({ email: email.trim(), password, name: name.trim() || email.trim() })
        : await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        setMessage(describe(result.error));
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid w-full max-w-[384px] gap-2" onSubmit={submit} noValidate>
      <h1 className="display text-[32px] leading-[1.15]" style={{ fontVariationSettings: '"opsz" 32' }}>
        Sign in to Nevermodel
      </h1>
      <p className="mb-5 text-ink-2">
        {mode === "sign-in" ? "Sign in to continue working with your company’s financial system." : "Create the first sign-in for this Nevermodel installation."}
      </p>

      {mode === "sign-up" && (
        <input
          className={field}
          type="text"
          name="name"
          autoComplete="name"
          placeholder="Your name"
          aria-label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
        />
      )}
      <input
        className={field}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@company.com"
        aria-label="Email"
        autoFocus={mode === "sign-in"}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={busy}
      />
      <input
        className={field}
        type="password"
        name="password"
        autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        placeholder="Password"
        aria-label="Password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={busy}
      />

      <button
        className="mt-3 inline-flex h-[52px] items-center justify-center gap-2 rounded-full bg-ink text-[15px] font-medium text-paper transition-colors outline-none hover:bg-ink/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
        type="submit"
        disabled={busy || !email.trim() || !password}
      >
        {mode === "sign-in" ? "Sign in" : "Create account"}
        <ArrowRight className="size-4" aria-hidden="true" />
      </button>

      {message && (
        <p className="mt-2 text-[14px] text-red-ink" role="alert">
          {message}
        </p>
      )}

      {allowSignUp && <p className="mt-5 text-[14px] text-ink-2">
        {mode === "sign-in" ? "New here?" : "Already have an account?"}{" "}
        <button type="button" className="text-ink underline underline-offset-[3px]" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setMessage(null); }}>
          {mode === "sign-in" ? "Create an account" : "Sign in"}
        </button>
      </p>}
    </form>
  );
}

const field =
  "nevermodel-auth-field h-[52px] w-full rounded-lg border border-input bg-background px-4 text-[17px] text-ink outline-none transition-colors placeholder:text-pencil focus:border-ink focus:bg-background focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60";

function describe(error: { message?: string | undefined; longMessage?: string | undefined } | null): string {
  return error?.longMessage ?? error?.message ?? "Something went wrong. Try again.";
}
