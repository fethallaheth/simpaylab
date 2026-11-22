/**
 * Commerce lens: one plain-money line per engine event type, written for
 * economics / finance / commerce learners (not IT).
 * EN inline; FR/AR live in commerce-fr.ts / commerce-ar.ts. The raw protocol view
 * stays available under "Under the hood" in the inspector.
 */
export interface CommerceLine {
  /** what this step means for money: who pays/earns/risks what */
  money: string;
  /** what the commerce learner should watch for (optional) */
  watch?: string;
}

export const COMMERCE: Record<string, CommerceLine> = {
  DEMO_STARTED: { money: "A sample payment runs the full money cycle: promise, hold, then move." },
  CART_CREATED: { money: "The buyer commits to a purchase; the amount becomes a pending obligation." },
  TOKENIZED: { money: "Card details are swapped for a token — the sale value is unchanged, the theft value drops.", watch: "Tokens cut breach costs, which is why PSPs push them." },
  RISK_SCORED: { money: "Each sale gets a risk price: approve, challenge, or refuse it.", watch: "False declines cost real baskets — risk has two sides." },
  TDS_CHALLENGE_SHOWN: { money: "The buyer proves identity; this proof decides who pays for fraud later." },
  TDS_FRICTIONLESS: { money: "Low-risk sale skips the challenge to protect conversion." },
  TDS_FAILED: { money: "No proof, no sale. The merchant loses the basket but dodges the fraud." },
  TDS_PASSED: { money: "Proof accepted: the fraud cost of this sale shifts to the issuer.", watch: "Liability shift is the economic reason merchants adopt 3DS." },
  AUTH_REQUESTED: { money: "The question travels buyer to issuer: is this money good right now?" },
  AUTHENTICATED: { money: "Identity proven. Still no approval to move a cent." },
  ISSUER_DECLINED: { money: "The issuer says no — funds, expiry, suspicion. Nothing moves; the sale pauses." },
  AUTHORIZED_HOLD: { money: "Funds frozen, not moved. The buyer can't spend them; the seller can't have them yet.", watch: "A hold is someone else's liquidity, temporarily locked." },
  CAPTURE_DEFERRED: { money: "The seller waits to claim until goods ship — cash flow delayed by choice." },
  CAPTURED: { money: "The hold becomes the seller's receivable. Still not cash in hand." },
  CLEARED: { money: "Banks net the day's claims in batch — the plumbing behind payday." },
  SETTLING: { money: "Money in transit on a schedule (T+N). Approval happened days ago.", watch: "Working capital sits idle here — settlement speed is a financing question." },
  SETTLED: { money: "Final: the seller can use the money; fees were already split three ways." },
  DUPLICATE_BLOCKED: { money: "A double-click didn't double-charge: one key, one debit." },
  GATEWAY_TIMEOUT: { money: "No answer is not a no — the retry must reuse the same key." },
  RETRY_SAFE: { money: "Safe retry: same key, single charge." },
  CHARGEBACK_OPENED: { money: "The issuer forcibly pulls the money back from the seller, plus dispute costs.", watch: "Chargeback rates decide whether a business line stays profitable." },
  CARD_VALIDATED: { money: "The card passes format and demo-range checks before anything travels the network." },
  CARD_REJECTED: { money: "Bad details die at the form: no token, no network cost, the buyer just retries." },
  OTP_SENT: { money: "A one-time code travels out-of-band; each attempt is a priced authentication event." },
  OTP_WRONG: { money: "Wrong codes burn attempts — three strikes ends the sale, which is the anti-guessing budget." },
  ORDER_CONFIRMED: { money: "The seller commits to the order on the authorization code — before seeing a cent." },
  REFUND_ISSUED: { money: "The full amount flows back to the buyer; the seller keeps the fee lesson.", watch: "Refunds cost sellers twice: the lost sale plus non-refundable fees." },
  REFUND_PARTIAL: { money: "Part of the sale flows back; the rest stays settled until fully returned." },
  CHARGEBACK_ACCEPTED: { money: "The seller eats the dispute: money stays with the buyer, case closed." },
  REPRESENTMENT_SUBMITTED: { money: "The seller fights back with evidence — disputes have a second round." },
  REPRESENTMENT_WON: { money: "Evidence wins: the pulled amount returns to the seller." },
  REPRESENTMENT_LOST: { money: "Evidence fails: the pullback stands, plus the dispute fee lesson." },
  ACCOUNT_LINKED: { money: "A bank account powers the wallet directly — no card rails, no interchange." },
  ACCOUNT_REJECTED: { money: "Bad account details die at enrolment: nothing links, nothing moves." },
  PIN_FALLBACK_SHOWN: { money: "Biometrics failed repeatedly, so the device falls back to its passcode." },
  PIN_WRONG: { money: "Wrong passcode burns an attempt — three strikes locks the payment." },
  MANDATE_CHARGED: { money: "The direct-debit mandate pulls the amount straight from the linked account." },
  OTP_VERIFIED: { money: "Out-of-band proof accepted: the account owner approved this debit." },
  TOKEN_PRESENTED: { money: "A stored token pays instead of the card: the number never leaves the vault." },
  QR_SHOWN: { money: "The wallet displays a one-time code: the till reads it, the phone never hands over money." },
  MULTISIG_APPROVED: { money: "Two of three key-holders signed: no single phone or person can move the coins." },
  RECOVERED: { money: "The backup words check out: the wallet can be rebuilt after loss or theft." },
  SWAP_STOPPED: { money: "A careful eye stopped the theft: verifying the address on-device beats trusting the screen." },
  TERMINAL_READY: { money: "The till states amount and limit: the rules of this tap are public before it happens." },
  APP_SELECTED: { money: "Card and terminal agree on which payment application to speak." },
  DATA_READ: { money: "The terminal reads the card data contactlessly — seconds, not minutes." },
  CVM_REQUIRED: { money: "Over the limit, a tap alone is not enough: the holder must prove presence." },
  CVM_OK: { money: "Holder verified: the tap is now as strong as chip-and-PIN." },
  OFFLINE_AUTH: { money: "No signal, small amount: the terminal approves locally against its floor limit." },
  CRYPTOGRAM: { money: "A one-time cryptogram seals this tap — replays are worthless." },
  TOPUP_FUNDED: { money: "Bank money becomes wallet balance, minus the funding fee. The float now lives with the provider." },
  P2P_SENT: { money: "Money jumps wallets instantly; the provider holds the float in between." },
  REQUEST_SENT: { money: "A pull replaces the push: the recipient must still accept." },
  REQUEST_PAID: { money: "The friend paid: a pending request becomes settled money." },
  INCOMING_REQUEST: { money: "Someone asks YOU for money — strangers' requests deserve suspicion, not speed." },
  SCAM_WARNING: { money: "Paid to an unverified handle: instant rails have no undo button." },
  SCAM_REPORTED: { money: "Declined and reported: the cheapest fraud control is a careful user." },
  SPLIT_CREATED: { money: "One bill becomes many requests: arithmetic replaces awkwardness." },
  P2P_PENDING: { money: "Reserved, not moved: slow rails promise first and pay later." },
  BANK_PULL_FAILED: { money: "The bank pull bounced: the reservation evaporates, nobody was paid." },
  REQUEST_CANCELLED: { money: "Request withdrawn before acceptance: asking costs nothing." },
  LEG_PAID: { money: "One share lands: the organizer collects only what friends actually pay." },
  LEG_DECLINED: { money: "One friend declines: the split stays open, the rest still counts." },
  SPLIT_COMPLETE: { money: "Every share resolved: collected versus outstanding is now final." },
  FEED_POSTED: { money: "A friends-visible post: social proof is the product, privacy the price." },
  CANCELLED: { money: "Cancelled before money moved: nothing to unwind." },
  USSD_OPENED: { money: "A phone session opens on codes, not apps: inclusion starts here." },
  USSD_MENU: { money: "Numbered menus replace screens — every choice is typed, not tapped." },
  PIN_SET: { money: "A secret PIN now guards this wallet; the network never sees it typed." },
  MM_SENT: { money: "E-money jumps phone numbers in seconds; the trust account backs every unit." },
  CASHIN_DONE: { money: "Paper cash becomes e-money at the till; the agent's float absorbs it." },
  CASHOUT_DONE: { money: "E-money becomes paper cash; the agent earns a commission for the float risk." },
  AGENT_NO_FLOAT: { money: "The till is dry: agents are the ATMs here, and liquidity is their constraint." },
  BILL_PAID: { money: "A bill dies by code: utilities ride the same rails as remittances." },
  AIRTIME_BOUGHT: { money: "Credit tops itself up: the phone network sells through the money network." },
  BALANCE_SHOWN: { money: "The balance is the product: visible money builds trust in invisible rails." },
  PIN_LOCKED: { money: "Three wrong PINs freeze the wallet — guessing budgets protect everyone." },
  SESSION_TIMEOUT: { money: "Silence kills the session: USSD holds no state, so nothing dangles." },
  SIM_SWAP_FLAG: { money: "A swapped SIM trips the alarm: identity theft meets its tripwire." },
  QUOTE_MADE: { money: "Fee plus spread, in one number: the only honest price in remittances." },
  COMPLIANCE_PASSED: { money: "Screening clears: this money may legally travel." },
  COMPLIANCE_HOLD: { money: "Screening stops the transfer: frozen beats complicit." },
  DEBITED: { money: "The sender's account is debited the full cost — principal plus fees." },
  CORRIDOR_HOP: { money: "Each correspondent bank takes its cut and its day: the chain is the cost." },
  DELIVERED: { money: "Payout confirmed in the destination currency. Corridor closed." },
  FUNDING_DECLINED: { money: "The funding leg refused: no debit, no transfer, nothing to unwind." },
  TRANSFER_DELAYED: { money: "A partner backlog slips the ETA: the money waits, the promise stretches." },
  ELIGIBILITY_CHECKED: { money: "A soft look at income vs obligations prices this customer — no hard inquiry." },
  BNPL_APPROVED: { money: "Credit granted on thin data: the schedule below is the underwriting bet." },
  BNPL_DENIED: { money: "No credit: the model refused, and no hard footprint remains." },
  VERIFICATION_REQUIRED: { money: "Borderline file: one out-of-band code decides whether the schedule exists." },
  VERIFICATION_WRONG: { money: "Wrong code burns an attempt — identity proof has a budget too." },
  PLAN_ACTIVATED: { money: "The merchant is funded today minus the discount; the provider owns the wait." },
  INSTALLMENT_PAID: { money: "One slice paid on time: the schedule holds." },
  INSTALLMENT_MISSED: { money: "A missed slice compounds: the debt grows while the goods depreciate." },
  LATE_FEE_CHARGED: { money: "Late fees are the business model wearing a penalty costume." },
  AUTODEBIT_FAILED: { money: "The auto-pull bounced: insufficient funds meet an unforgiving schedule." },
  PLAN_COMPLETE: { money: "Last slice paid: the most expensive way to buy, finished." },
  RETURNED: { money: "Goods back, schedule unwound: paid slices return, the rest evaporates." },
  LEGS_CANCELLED: { money: "Future slices cancelled: the credit line closes with the return." },
  WALLET_OPENED: { money: "Buyer opens the wallet: same money, shorter checkout, higher conversion." },
  CARD_PROVISIONED: { money: "The card is enrolled as a device token — the real number never travels again." },
  TOKEN_SUSPENDED: { money: "Token killed: this device can't pay, but the card itself still works." },
  PROVISION_VERIFIED: { money: "The issuer confirms the enrolment — this blocks criminals adding stolen cards." },
  BIOMETRIC_PROMPT: { money: "The device asks 'are you the owner?' before unlocking payment." },
  BIOMETRIC_FAILED: { money: "Three misses switch to PIN. Security bends so legitimate sales don't break." },
  BIOMETRIC_OK: { money: "Owner confirmed locally. Nothing biometric ever leaves the phone." },
  PIN_FALLBACK_OK: { money: "Second factor accepted; the sale proceeds." },
  DEVICE_LOST: { money: "Phone gone: suspend first, mourn later. Speed limits the loss window." },
  TOKEN_REVOKED: { money: "The device token dies everywhere at once. The account lives on." },
  REPROVISIONED: { money: "New device, new token, same account — business as usual." },
  OFFLINE_DECLINED: { money: "No connection and no offline path: the sale stops instead of risking money." },
  CRYPTOGRAM_BUILT: { money: "A one-time proof locks amount, seller, and token together for this sale only." },
  QR_GENERATED: { money: "The bill is printed as a code: who gets paid, how much, which reference." },
  QR_SCANNED: { money: "The buyer reads the bill with the camera." },
  QR_EXPIRED: { money: "Old bill, no pay — time limits kill replay fraud." },
  QR_TAMPER_WARNING: { money: "The bill doesn't match the seller: possibly a swapped sticker. Walk away.", watch: "Sticker fraud is a merchant-side loss until customers verify on screen." },
  QR_VALIDATED: { money: "Bill checks out: right seller, right amount, intact code." },
  PIN_CONFIRMED: { money: "The buyer approves the reviewed bill." },
  WALLET_TO_WALLET: { money: "Money jumps account to account — no card rails, thinner fees.", watch: "This is why QR wallets undercut cards on cost." },
  MERCHANT_NOTIFIED: { money: "The seller sees 'paid' in seconds — cash-flow visibility, not cash yet." },
  INVOICE_CREATED: { money: "The seller quotes a price locked for 15 minutes — volatility is the seller's risk." },
  WRONG_ADDRESS: { money: "Destination invalid: one character can strand money. Stop.", watch: "No helpdesk can reverse this — verification is the whole control." },
  WRONG_NETWORK: { money: "Right address, wrong railway: chains don't forward to each other." },
  TX_BUILT: { money: "The buyer assembles the payment: funding, change, and the miner's fee." },
  FEE_CHOSEN: { money: "The buyer bids for speed: a higher fee jumps the queue.", watch: "Block space is an auction — congestion pricing in miniature." },
  BROADCAST: { money: "The signed payment enters the queue. Announced is not settled." },
  MEMPOOL_QUEUED: { money: "The waiting room, ordered by fee bid. Position predicts delay, not finality." },
  TX_STUCK: { money: "Bid too low for the crowd: wait it out or outbid." },
  RBF_REPLACED: { money: "Same payment, higher bid — the new bid replaces the old one." },
  INVOICE_EXPIRED: { money: "The price lock lapsed: the seller reprices, the buyer restarts." },
  UNDERPAID: { money: "Received less than billed — top up or cancel, per policy." },
  BLOCK_MINED: { money: "One more confirmation toward the seller's safety threshold." },
  DEPEG: { money: "The 'dollar' token trades below a dollar — the seller receives less value.", watch: "Peg risk is counterparty risk wearing a stablecoin costume." },
  CONFIRMED: { money: "Threshold reached: practically irreversible. Release the goods." },
  MARKED_PAID: { money: "The seller accepts the crypto as final and ships." },
  SEED_GENERATED: { money: "Drill recovery words (FAKE). Real ones are the entire business." },
  HOT_SIGNED: { money: "The online key signs in seconds — speed at the price of exposure." },
  HOT_COMPROMISED: { money: "The online key is stolen: compare what the cold path would have saved.", watch: "Hot-wallet loss is an inventory write-off with no insurer." },
  WATCHONLY_BUILT: { money: "The payment is drafted on a device that holds no keys." },
  QTRANSFER_TO_OFFLINE: { money: "The unsigned payment crosses the air gap into the vault." },
  DEVICE_VERIFIED: { money: "Amount and address checked on the trusted screen — the anti-fraud moment." },
  ADDRESS_SWAP: { money: "Malware swapped the destination and nobody checked. Money gone." },
  FUNDS_LOST: { money: "No issuer, no chargeback: irreversibility priced in full." },
  SIGNED_OFFLINE: { money: "The vault signs blind to the internet; only the signature returns." },
  QTRANSFER_BACK: { money: "The signature is ferried back for broadcast." },
  SEED_LOST: { money: "No backup, no recovery desk: self-custody's hardest lesson.", watch: "Key-person risk, household edition." },
  FX_QUOTED: { money: "Mid-market versus offered rate: the gap is the dealer's margin.", watch: "Always compare total cost %, never the headline fee." },
  FLOW_STARTED: { money: "A new payment flow begins." },
  WALLET_DECLINED: { money: "The wallet balance can't cover it. Top up or switch funding." }
};

export function commerceFor(type: string): CommerceLine | undefined {
  return COMMERCE[type];
}

import { COMMERCE_FR, COMMERCE_WATCH_FR } from "./commerce-fr";
import { COMMERCE_AR, COMMERCE_WATCH_AR } from "./commerce-ar";

export type CommerceLocale = "en" | "fr" | "ar";

export interface CommerceText {
  money: string;
  watch?: string;
}

/** Localized commerce lens with EN fallback per line. */
export function commerceText(type: string, locale: CommerceLocale = "en"): CommerceText | undefined {
  const base = COMMERCE[type];
  if (!base) return undefined;
  if (locale === "fr") return { money: COMMERCE_FR[type] ?? base.money, watch: COMMERCE_WATCH_FR[type] ?? base.watch };
  if (locale === "ar") return { money: COMMERCE_AR[type] ?? base.money, watch: COMMERCE_WATCH_AR[type] ?? base.watch };
  return { money: base.money, watch: base.watch };
}
