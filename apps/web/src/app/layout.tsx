import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider, themeInitScript } from "@/components/theme-provider";

// Self-hosted variable fonts, roman only: the design language uses no italics. See src/fonts/LICENSE-*.txt.
const sans = localFont({
  src: "../fonts/InterVariable.woff2",
  weight: "100 900",
  variable: "--font-sans-face",
  display: "swap",
});

const serif = localFont({
  src: "../fonts/SourceSerif4Variable-Roman.woff2",
  weight: "200 900",
  variable: "--font-serif-face",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nevermodel",
  description: "A radical approach to an LLM-native financial operating system",
  icons: { icon: "/api/company/favicon" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${sans.variable} ${serif.variable}`}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
