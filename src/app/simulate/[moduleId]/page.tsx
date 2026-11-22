import { SimulateClient } from "@/components/simulate-client";
import type { ModuleId } from "@sim/engine";
import { notFound } from "next/navigation";
import { Suspense } from "react";

const VALID: ModuleId[] = ["checkout", "wallet", "qr", "crypto", "custody", "nfc", "p2p", "mobilemoney", "remit", "bnpl", "demo"];

export function generateStaticParams() {
  return VALID.map((moduleId) => ({ moduleId }));
}

export default function SimulatePage({ params }: { params: Promise<{ moduleId: string }> }) {
  return (
    <Suspense fallback={<div className="h-72 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950" aria-label="Loading simulator" />}>
      <Resolve params={params} />
    </Suspense>
  );
}

async function Resolve({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = await params;
  if (!(VALID as string[]).includes(moduleId)) notFound();
  return <SimulateClient moduleId={moduleId as ModuleId} />;
}
