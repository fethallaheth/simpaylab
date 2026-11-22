"use client";
import type { FailureId, ModuleId, RunResult } from "@sim/engine";
import { JourneyView } from "./journey";
import { CheckoutApp } from "./checkout/CheckoutApp";
import { WalletModule } from "./wallet/WalletModule";
import { QrApp } from "./qr/QrApp";
import { CryptoApp } from "./crypto/CryptoApp";
import { CustodyApp } from "./custody/CustodyApp";
import { NfcApp } from "./nfc/NfcApp";
import { P2pApp } from "./p2p/P2pApp";
import { MmApp } from "./mm/MmApp";
import { RemitApp } from "./remit/RemitApp";
import { BnplApp } from "./bnpl/BnplApp";

/** Guided learner layer: where is the money RIGHT NOW? Rendered as its own
 *  analysis panel, separate from the demo app. Reads the event log only. */
export function Guided({ moduleId, result, cursor }: { moduleId: ModuleId; result: RunResult; cursor: number }) {
  const events = result.events.slice(0, cursor + 1);
  return <JourneyView moduleId={moduleId} events={events} ccy={result.receipt.currency} />;
}

export function Experience({ moduleId, result, cursor, params, failures, seed, onLive }: { moduleId: ModuleId; result: RunResult; cursor: number; guided?: boolean; seed: number; params: Record<string, unknown>; failures: FailureId[]; onLive: (r: RunResult) => void }) {
  let viz: React.ReactNode;
  const live = { seed, params, failures, onLive };
  switch (moduleId) {
    case "checkout": viz = <CheckoutApp {...live} />; break;
    case "wallet": viz = <WalletModule {...live} />; break;
    case "qr": viz = <QrApp {...live} />; break;
    case "crypto": viz = <CryptoApp {...live} />; break;
    case "custody": viz = <CustodyApp {...live} />; break;
    case "nfc": viz = <NfcApp {...live} />; break;
    case "p2p": viz = <P2pApp {...live} />; break;
    case "mobilemoney": viz = <MmApp {...live} />; break;
    case "remit": viz = <RemitApp {...live} />; break;
    case "bnpl": viz = <BnplApp {...live} />; break;
    default: viz = <Guided moduleId={moduleId} result={result} cursor={cursor} />; break;
  }
  return (
    <div className="space-y-3">
      {viz}
    </div>
  );
}
