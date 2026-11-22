# Economics audit — June products

Every fiat payment simulation is denominated in **EUR** (the dinar). **Checkout** is the exception: its local (dz) region runs in **DZD**, everything else in EUR. **Remit** is a second exception: it moves money between two currencies, so it needs the source currency plus the corridor destination (`EUR → DZD`). Crypto/custody are chain-asset simulations (BTC), not fiat payments.

| Module | UI denom. | Engine `MODULE_CURRENCY` | Scenario preset currencies | Notes |
|---|---|---|---|---|
| checkout | EUR (dz region: DZD) | EUR | checkout-happy-3ds / frictionless / delayed / decline / chargeback: EUR | region switcher → dz: DZD |
| wallet | EUR | EUR | wallet-happy: EUR, wallet-dzb-local: EUR | staging EUR→EUR done |
| qr | EUR | EUR | qr-dynamic / static / customer-presented / tampered: EUR | |
| nfc | EUR | EUR | nfc-tap: EUR | |
| p2p | EUR | EUR | p2p-send: EUR | was USD |
| mobilemoney | EUR | EUR | mm-cashout: EUR | was KES |
| **remit** | — | EUR (exception) | remit-corridor: EUR, `dstCurrency: DZD`, `fxPair: EUR/DZD` | cross-border corridor |
| bnpl | EUR | EUR | bnpl-split: EUR | |
| crypto | BTC | BTC | — | chain asset, not fiat |
| custody | BTC | BTC | — | chain asset, not fiat |
| demo | EUR | EUR | — | |

## Currency enforcement

- `packages/engine/src/scenario.ts`: `MODULE_CURRENCY` now yields EUR for all fiat modules (`remit: EUR` excepted).
- `packages/content/src/config.ts`: all fiat scenario presets updated from EUR/CNY/DZD/KES/USD to EUR (remit preset untouched, still `EUR → DZD`).
- Module UI denoms: `CheckoutApp` (`ccy`), `BnplApp`, `MmApp`, `NfcApp`, `P2pApp`, `QrApp` hardcoded consts → EUR; `wallet/sheets.tsx` display strings and staged sessions → EUR; `panels.tsx` currency selector → `["USD","EUR","BTC","USDT"]`.
- Added `"EUR"` to the engine `Currency` type.

## Explanations

Every simulate page now shows a "How this simulation works" section (`ProcessView`, translated EN/FR/AR) — step label + plain-language description per journey step (authorize, capture, settle, etc.), statuses computed from the event log.

## Verification

- `pnpm typecheck` clean; `pnpm test`: 127/127 pass.
- `pnpm dev` live; simulate pages render the new process section and EUR amounts; no Lecturer/SIM/banner chrome.
