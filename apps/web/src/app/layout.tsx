import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

// Self-hosted variable fonts. See src/fonts/LICENSE-*.txt.
const sans = localFont({
  src: [
    { path: "../fonts/InterVariable.woff2", style: "normal" },
    { path: "../fonts/InterVariable-Italic.woff2", style: "italic" },
  ],
  weight: "100 900",
  variable: "--font-sans-face",
  display: "swap",
});

const serif = localFont({
  src: [
    { path: "../fonts/SourceSerif4Variable-Roman.woff2", style: "normal" },
    { path: "../fonts/SourceSerif4Variable-Italic.woff2", style: "italic" },
  ],
  weight: "200 900",
  variable: "--font-serif-face",
  display: "swap",
});

export const metadata: Metadata = {
  title: "nevermodel",
  description: "An auditable, LLM-native financial operating system.",
};

const publishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
  process.env.CLERK_PUBLISHABLE_KEY;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${serif.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <ClerkProvider
            {...(publishableKey ? { publishableKey } : {})}
            signInUrl="/login"
            signUpUrl="/login"
            signInFallbackRedirectUrl="/"
            signUpFallbackRedirectUrl="/"
          >
            {children}
          </ClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
