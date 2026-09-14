import { authMode, isAuthenticated } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { isSignUpCodeRequired, isSignUpEnabled } from "@/lib/better-auth";
import { ThemeControl } from "@/components/theme-control";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (authMode === "disabled" || await isAuthenticated()) redirect("/");
  return (
    <main className="relative grid min-h-screen place-items-center px-6 py-12">
      <LoginForm allowSignUp={isSignUpEnabled()} requireSignUpCode={isSignUpCodeRequired()} />
      <ThemeControl className="absolute right-6 bottom-5" />
    </main>
  );
}
