import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { ThemeControl } from "@/components/theme-control";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const { userId } = await auth();
  if (userId) redirect("/");
  return (
    <main className="relative grid min-h-screen place-items-center px-6 py-12">
      <LoginForm />
      <ThemeControl className="absolute right-6 bottom-5" />
    </main>
  );
}
