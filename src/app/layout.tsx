import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { TopNav } from "@/components/ui";
import "./globals.css";

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap"
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap"
});

export const metadata: Metadata = {
  title: "SimPay Lab — FinTech Payment Simulation",
  description: "Simulation-only lab to experience and dissect 10 electronic payment methods."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={`${sans.variable} ${mono.variable} h-full`}>
      <body className="min-h-full bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <Providers>
          <TopNav />
          <main id="main" className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 lg:py-8">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}

function Footer() {
  return (
    <footer className="mt-12 border-t border-zinc-200 py-6 text-[12px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400 print:hidden">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
        <span>Code open source — <a href="https://github.com/ben333" target="_blank" rel="noopener noreferrer" className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800">GitHub</a></span>
        <span>Fethallah Benmokhatr · <a href="mailto:fethallahbenmokhtar@gmail.com" className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800">fethallahbenmokhtar@gmail.com</a> · <a href="https://www.linkedin.com/in/fethallah-benmokhatr" target="_blank" rel="noopener noreferrer" className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800">LinkedIn</a></span>
      </div>
    </footer>
  );
}
