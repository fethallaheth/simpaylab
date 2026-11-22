/**
 * Quizzes: 8 per Tier A module (checkout, wallet, qr, crypto, custody),
 * 2 per Tier B stub. EN inline; FR/AR fall back to EN (Phase 5 completes).
 * Every answer carries an explanation.
 */
import type { QuizDef } from "./schemas";

const T = (en: string) => ({ en });
const Q = (
  id: string,
  moduleId: string,
  kind: QuizDef["kind"],
  q: string,
  options: string[],
  answer: string,
  explanation: string
): QuizDef => ({
  id,
  moduleId,
  kind,
  questionKey: `quiz.${id}.q`,
  optionsKeys: options.map((_, i) => `quiz.${id}.o${i}`),
  answerKey: `quiz.${id}.a`,
  explanationKey: `quiz.${id}.e`,
  text: { q: T(q), options: options.map(T), answer, explanation: T(explanation) }
});

export const QUIZZES: QuizDef[] = [
  // ---- checkout (8) ----
  Q("co1", "checkout", "mcq", "Authorization vs settlement: which statement is correct?", ["They are the same step", "Authorization reserves funds; settlement moves them later", "Settlement happens before authorization", "Neither touches the ledger"], "Authorization reserves funds; settlement moves them later", "The hold (authorization) only reserves; capture/clearing/settlement move money in batch, often T+1."),
  Q("co2", "checkout", "mcq", "Who receives the interchange fee?", ["The card network", "The issuer bank", "The PSP", "The customer"], "The issuer bank", "Interchange compensates the issuer for credit risk and funding the authorization."),
  Q("co3", "checkout", "prediction", "A €49.99 low-risk purchase with 3DS set to auto will most likely…", ["Trigger an OTP challenge", "Go frictionless (no challenge)", "Be declined", "Require a PIN at a terminal"], "Go frictionless (no challenge)", "Low risk scores qualify for frictionless flow; liability rules still apply."),
  Q("co4", "checkout", "mcq", "What does tokenization replace?", ["The merchant with the PSP", "The real card number with a surrogate token", "3DS with biometrics", "Settlement with clearing"], "The real card number with a surrogate token", "Tokens limit blast radius: a stolen token is useless outside its context."),
  Q("co5", "checkout", "mcq", "Why does retrying a timed-out payment need an idempotency key?", ["It speeds up the network", "It prevents charging twice", "It skips 3DS", "It lowers fees"], "It prevents charging twice", "Same key = same operation; the gateway returns the original result instead of a second charge."),
  Q("co6", "checkout", "mcq", "A chargeback happens…", ["Before authorization", "After settlement, via the issuer", "Instead of a refund", "Only for cash"], "After settlement, via the issuer", "The issuer pulls funds back from the merchant; refunds are voluntary, chargebacks are forced."),
  Q("co7", "checkout", "mcq", "3DS liability shift means…", ["The customer pays the fee", "Fraud liability moves from merchant to issuer", "Settlement becomes instant", "Interchange drops to zero"], "Fraud liability moves from merchant to issuer", "Authenticated transactions shift certain fraud costs to the issuer — that is the incentive to adopt 3DS."),
  Q("co8", "checkout", "mcq", "Delayed capture is used when…", ["The card is expired", "Goods ship later and the merchant captures on fulfilment", "Fees are too high", "The customer pays cash"], "Goods ship later and the merchant captures on fulfilment", "Authorize at order, capture at shipment; holds eventually expire."),
  // ---- wallet (8) ----
  Q("wa1", "wallet", "mcq", "What is a DPAN?", ["The printed card number", "A device-specific token standing in for the real PAN", "A biometric template", "A QR payload"], "A device-specific token standing in for the real PAN", "Device PAN: unique per device, can be suspended without reissuing the card."),
  Q("wa2", "wallet", "mcq", "Where is the biometric checked in a wallet payment?", ["On the merchant server", "Locally on the device", "At the card network", "By the PSP"], "Locally on the device", "Biometrics unlock the local key; the template never leaves the device."),
  Q("wa3", "wallet", "mcq", "What does the per-transaction cryptogram prove?", ["The customer's balance", "That this specific transaction was approved by the token holder", "The merchant's identity", "The FX rate"], "That this specific transaction was approved by the token holder", "Dynamic cryptograms can't be replayed for a different amount or merchant."),
  Q("wa4", "wallet", "prediction", "Biometrics fail 3 times. What happens next?", ["Payment auto-approves", "Fallback to device PIN", "Card is cancelled", "Merchant is charged"], "Fallback to device PIN", "Retry limits fall back to a knowledge factor instead of locking the user out."),
  Q("wa5", "wallet", "mcq", "A lost phone is handled by…", ["Waiting for settlement", "Remote suspend + token revocation", "Issuing a chargeback", "Changing the PAN"], "Remote suspend + token revocation", "Kill the token, keep the card: reprovision a fresh DPAN on the new device."),
  Q("wa6", "wallet", "mcq", "Card-linked vs account-linked wallets differ in…", ["Color scheme", "Funding source: card rails vs bank/mobile-money account", "QR support", "Language"], "Funding source: card rails vs bank/mobile-money account", "Same tap UX, different money movement underneath."),
  Q("wa7", "wallet", "mcq", "Fraudulent provisioning means…", ["A fake terminal", "An attacker adds someone else's card to their wallet", "A revoked token", "A wrong PIN"], "An attacker adds someone else's card to their wallet", "Hence issuer verification (OTP, app approval) during provisioning."),
  Q("wa8", "wallet", "mcq", "Why is the real PAN never sent to the merchant?", ["It is too long", "To shrink breach impact and enable per-device revocation", "Merchants prefer QR", "Regulators ban numbers"], "To shrink breach impact and enable per-device revocation", "No PAN at the merchant = nothing to steal there."),
  // ---- QR (8) ----
  Q("qr1", "qr", "mcq", "Static vs dynamic merchant QR differs in…", ["Image size", "Whether amount/reference are encoded per transaction", "Color", "Language"], "Whether amount/reference are encoded per transaction", "Static stickers are reusable; dynamic codes carry amount + expiry."),
  Q("qr2", "qr", "mcq", "QR-swap fraud is…", ["A broken camera", "Replacing a merchant's sticker with the attacker's code", "An expired code", "A double scan"], "Replacing a merchant's sticker with the attacker's code", "Defense: verify merchant name/amount on screen before confirming."),
  Q("qr3", "qr", "mcq", "What is inside the QR payload (simplified)?", ["Merchant ID, amount, reference, checksum", "The customer's PIN", "The private key", "Nothing readable"], "Merchant ID, amount, reference, checksum", "The inspector decodes the fake payload field by field."),
  Q("qr4", "qr", "prediction", "A time-bound code is scanned after expiry. Result?", ["It still works", "Expired — generate a new code", "Double charge", "Instant refund"], "Expired — generate a new code", "Expiry bounds replay risk for customer-presented codes."),
  Q("qr5", "qr", "mcq", "Customer-presented QR means…", ["The customer prints a sticker", "The merchant scans the customer's wallet code", "No phone needed", "Cash only"], "The merchant scans the customer's wallet code", "Two mirror models: merchant-presented and customer-presented."),
  Q("qr6", "qr", "mcq", "QR wallet payments often settle…", ["Via card interchange", "Account to account, cheaper than cards", "In cash", "After 30 days"], "Account to account, cheaper than cards", "No card rails = different (often lower) fee stack."),
  Q("qr7", "qr", "mcq", "Checksum mismatch on scan suggests…", ["Low battery", "Tampering or a wrong-provider code", "High amount", "Bad luck"], "Tampering or a wrong-provider code", "Never confirm when the checksum or merchant mismatches."),
  Q("qr8", "qr", "mcq", "Scanning the same dynamic code twice triggers…", ["A double charge", "Duplicate detection — second scan blocked", "A refund", "A chargeback"], "Duplicate detection — second scan blocked", "Idempotency applies to QR too."),
  // ---- crypto (8) ----
  Q("cr1", "crypto", "mcq", "How many confirmations make a payment 'final'?", ["Always exactly one", "Policy-dependent (e.g. 3–6 for high value)", "Zero", "Infinite"], "Policy-dependent (e.g. 3–6 for high value)", "Finality is probabilistic on PoW chains; merchants set thresholds by value."),
  Q("cr2", "crypto", "mcq", "A stuck low-fee transaction can be…", ["Charged back", "Replaced with a higher fee (RBF) or waited out", "Refunded by the miner", "Cancelled by the merchant"], "Replaced with a higher fee (RBF) or waited out", "Fee markets: priority goes to higher fee rates during congestion."),
  Q("cr3", "crypto", "mcq", "UTXO selection visualizes…", ["Which inputs fund the payment and the change output", "The seed phrase", "The exchange order book", "The mempool password"], "Which inputs fund the payment and the change output", "Bitcoin-like: inputs consumed fully, change returns to sender."),
  Q("cr4", "crypto", "mcq", "Sending to the wrong network typically…", ["Auto-converts", "Loses or strands funds — always verify network", "Speeds up", "Reduces fees"], "Loses or strands funds — always verify network", "Address formats overlap across chains; the rail matters."),
  Q("cr5", "crypto", "prediction", "Mempool has 3,000 queued txs and you paid a low fee. Expect…", ["Instant confirmation", "Delayed confirmation until fees clear", "A refund", "A chargeback"], "Delayed confirmation until fees clear", "Miners order by fee rate; congestion delays cheap transactions."),
  Q("cr6", "crypto", "mcq", "A stablecoin depeg means…", ["Blocks stop", "Market price breaks from the $1 peg", "Gas drops to zero", "Nonces reset"], "Market price breaks from the $1 peg", "Merchant receives less value; rate-lock windows exist for this reason."),
  Q("cr7", "crypto", "mcq", "On-chain payments are…", ["Reversible via the issuer", "Practically irreversible after confirmation", "Insured by default", "Editable"], "Practically irreversible after confirmation", "No chargeback rail: verification before broadcast is everything."),
  Q("cr8", "crypto", "mcq", "The issuer freeze/blacklist demo shows…", ["Decentralization is absolute", "Some stablecoins have admin controls with compliance trade-offs", "Fees are zero", "Keys are optional"], "Some stablecoins have admin controls with compliance trade-offs", "Custody and compliance differ between bearer assets and issued tokens."),
  // ---- custody (8) ----
  Q("cu1", "custody", "mcq", "Hot vs cold wallet differs in…", ["Coin type", "Whether keys live on an online device or air-gapped signer", "Price", "Color"], "Whether keys live on an online device or air-gapped signer", "Custody model, not a payment rail."),
  Q("cu2", "custody", "mcq", "A cold-signing flow moves…", ["The hardware device online", "The unsigned tx to the offline device and the signature back", "The seed to the merchant", "Cash"], "The unsigned tx to the offline device and the signature back", "Keys never touch the network; only data crosses the air gap."),
  Q("cu3", "custody", "mcq", "Why verify details on the device screen?", ["It looks nice", "The online machine may show a swapped address (clipboard malware)", "It lowers fees", "It speeds blocks"], "The online machine may show a swapped address (clipboard malware)", "The device screen is the trusted display."),
  Q("cu4", "custody", "mcq", "Losing the seed phrase without backup means…", ["The provider resets it", "Funds are unrecoverable", "A chargeback applies", "The miner refunds"], "Funds are unrecoverable", "Self-custody: no recovery desk. Drill backups."),
  Q("cu5", "custody", "mcq", "2-of-3 multisig means…", ["Two passwords", "Any 2 of 3 keys must sign", "Three blockchains", "Double fees"], "Any 2 of 3 keys must sign", "Tolerates one lost or stolen key."),
  Q("cu6", "custody", "prediction", "A malicious approval request pops up in a hot wallet. Best action?", ["Approve quickly", "Reject and verify the origin", "Share the seed", "Disable internet forever"], "Reject and verify the origin", "Hot wallets face phishing; default-deny unfamiliar prompts."),
  Q("cu7", "custody", "mcq", "Custodial (exchange) failure risk is…", ["Impossible", "Counterparty risk: someone else holds the keys", "Only about fees", "A UX issue"], "Counterparty risk: someone else holds the keys", "'Not your keys, not your coins' — convenience vs control."),
  Q("cu8", "custody", "mcq", "A fake seed-phrase drill uses…", ["Real words from your wallet", "Clearly-marked FAKE words, never real keys", "Your PIN", "The merchant key"], "Clearly-marked FAKE words, never real keys", "Simulation rule: never enter real secrets anywhere."),
  // ---- Tier B stubs (2 each) ----
  Q("nf1", "nfc", "mcq", "NFC is…", ["A card network", "A short-range radio technology used by several rails", "A cryptocurrency", "A bank"], "A short-range radio technology used by several rails", "Technology ≠ network: NFC carries EMV, wallet tokens, transit passes…"),
  Q("nf2", "nfc", "mcq", "Above the contactless limit the terminal…", ["Declines always", "Requests cardholder verification (PIN/biometric)", "Doubles the amount", "Skips authorization"], "Requests cardholder verification (PIN/biometric)", "CVM rules: no-CVM below limit, verify above."),
  Q("pp1", "p2p", "mcq", "Instant P2P payouts usually cost more because…", ["Of card-rail / instant-settlement fees", "Of fraud", "Of taxes", "They don't"], "Of card-rail / instant-settlement fees", "Standard (slow) moves ride cheaper rails; speed has a price."),
  Q("pp2", "p2p", "mcq", "Sending to the wrong handle teaches…", ["Reversibility", "Irreversibility and handle verification", "Interchange", "Mining"], "Irreversibility and handle verification", "Check the recipient; scams exploit haste."),
  Q("mm1", "mobilemoney", "mcq", "E-money is backed by…", ["Nothing", "A trust account at a partner bank", "Bitcoin", "Airtime"], "A trust account at a partner bank", "Operator liabilities matched by pooled funds — not a bank deposit."),
  Q("mm2", "mobilemoney", "mcq", "An agent cash-out fails when…", ["It rains", "The agent lacks float (cash/e-money balance)", "Fees are low", "KYC passes"], "The agent lacks float (cash/e-money balance)", "Agent liquidity is the last-mile constraint."),
  Q("re1", "remit", "mcq", "The hidden cost in remittances is often…", ["The receipt paper", "The FX spread over mid-market", "The envelope", "The queue"], "The FX spread over mid-market", "Compare total cost %: fee + spread, not the headline fee."),
  Q("re2", "remit", "mcq", "Correspondent banking adds…", ["Hops, each possibly deducting fees and time", "Free speed", "Cash", "Mining"], "Hops, each possibly deducting fees and time", "Why alternative rails can be cheaper/faster."),
  Q("bn1", "bnpl", "mcq", "In BNPL the merchant…", ["Bears the credit risk", "Is paid upfront minus a discount fee; the provider bears risk", "Waits for installments", "Sets the credit score"], "Is paid upfront minus a discount fee; the provider bears risk", "Provider earns MDR + late fees, absorbs defaults."),
  Q("bn2", "bnpl", "mcq", "Debt stacking means…", ["Paying early", "Parallel plans across providers the customer can't afford", "One big loan", "Saving money"], "Parallel plans across providers the customer can't afford", "Underwriting with partial data misses cross-provider exposure."),
  // ---- commerce lens: economics-first extras (2 per Tier A module) ----
  Q("co9", "checkout", "mcq", "A €1,000 hold sits 3 days before capture. The buyer's main cost is…", ["The interchange fee", "Frozen liquidity — an opportunity cost", "A chargeback", "The FX spread"], "Frozen liquidity — an opportunity cost", "Holds don't charge interest, but locked money can't work elsewhere."),
  Q("co10", "checkout", "mcq", "Interchange is 140bps on a €100 sale. The issuer receives…", ["€14.00", "€1.40", "€0.14", "Nothing until settlement"], "€1.40", "140 basis points = 1.40%. It settles to the issuer through clearing."),
  Q("wa9", "wallet", "mcq", "Tokenization's economic payoff for merchants is mainly…", ["Higher prices", "Lower breach exposure and cheaper reissuance after incidents", "Faster block times", "Free chargebacks"], "Lower breach exposure and cheaper reissuance after incidents", "No PAN stored means less to steal, fewer cards to reissue, lower fraud losses."),
  Q("wa10", "wallet", "mcq", "Falling back to PIN after failed biometrics trades…", ["Security for nothing", "A little fraud risk for saved legitimate sales", "Fees for speed", "Privacy for rewards"], "A little fraud risk for saved legitimate sales", "Every fallback is priced: accept small fraud to avoid losing good baskets."),
  Q("qr9", "qr", "mcq", "A swapped sticker diverts €300 of lunch sales. First loss sits with…", ["The card network", "The merchant, until the customer verifies on screen", "The phone maker", "Nobody — QR is insured"], "The merchant, until the customer verifies on screen", "Liability follows the checker: whoever could have verified bears the loss."),
  Q("qr10", "qr", "mcq", "Provider fee is 50bps on a €200 QR sale. The provider earns…", ["€10.00", "€1.00", "€0.10", "€50.00"], "€1.00", "50bps = 0.50%. Compare with card stacks near 2% — the wallet's price edge."),
  Q("cr9", "crypto", "mcq", "During congestion, rational senders…", ["Pay less to save money", "Bid higher fees to buy earlier confirmation", "Split into more transactions", "Wait for a chargeback"], "Bid higher fees to buy earlier confirmation", "Block space auctions: urgency is expressed in fee bids."),
  Q("cr10", "crypto", "mcq", "Between invoice and confirmation the price falls 4%. Who bears it?", ["The miner", "The merchant, unless the rate lock or policy covers it", "The wallet app", "Nobody — blocks adjust"], "The merchant, unless the rate lock or policy covers it", "Volatility is a commercial risk allocated by invoice terms, not by code."),
  Q("cu9", "custody", "mcq", "A hardware signer (€80, slow, safe) versus free hot storage is…", ["A technology choice", "An insurance purchase against total loss", "A fee decision", "A tax choice"], "An insurance purchase against total loss", "Cold storage premium buys survival of the worst case — price it like insurance."),
  Q("cu10", "custody", "mcq", "2-of-3 multisig protects a business mainly against…", ["High fees", "Key-person risk: one lost or rogue key can't move funds alone", "Slow blocks", "Bad exchange rates"], "Key-person risk: one lost or rogue key can't move funds alone", "Multisig is succession planning expressed as cryptography.")
];
