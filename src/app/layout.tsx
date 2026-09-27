import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { UserSwitcher } from "@/components/user-switcher";
import { appPool } from "@/infrastructure/db/pool";
import { staffRepository } from "@/infrastructure/db/repositories/staff-repository";
import { currentPrincipal } from "./session";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "commerceAgent — AI SDK POC",
  description: "Arquitetura de referência: agente de IA operando uma aplicação com capabilities.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [principal, staff] = await Promise.all([currentPrincipal(), staffRepository.list(appPool())]);

  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-full flex-col font-sans">
        <header className="flex items-center gap-6 border-b border-border bg-surface px-5 py-3">
          <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
            commerce<span className="text-accent">Agent</span>
          </Link>
          <nav className="flex gap-4 text-sm text-muted">
            <Link href="/" className="hover:text-foreground">Chat</Link>
            <Link href="/audit" className="hover:text-foreground">Auditoria</Link>
          </nav>
          <div className="ml-auto">
            <UserSwitcher current={principal?.id ?? ""} staff={staff} />
          </div>
        </header>
        <div className="flex min-h-0 flex-1">{children}</div>
      </body>
    </html>
  );
}
