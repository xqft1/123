# One Million Pixel Billboard

Two-canister architecture:

- **Assets (www):** `fnavb-oqaaa-aaaai-q3jvq-cai` (serves `dist/`)
- **Billboard (logic):** `vc3iz-viaaa-aaaad-qhokq-cai` (pixels, ownership, ICP payments)
- **ICP Ledger (mainnet):** `ryjl3-tyaaa-aaaaa-aaaba-cai`
- **Recipient principal:** `o72d6-axkp7-lv7lv-24bj5-vldpt-tqd2q-3f3n6-5wdn6-tizzq-ubugz-bae`
- **Price:** 0.01 ICP / pixel (1_000_000 e8s)

## Quick start

```bash
# 1) install frontend deps
cd frontend
npm install

# 2) build
npm run build   # outputs ../dist/

# 3) upload assets to your www canister
cd ..
dfx canister --network ic upload-assets www
```

**Note:** The provided Motoko canister (`src/billboard/main.mo`) is a starter. You already have a live canister
`vc3iz-viaaa-aaaad-qhokq-cai`. The frontend reads its ID from `.env.production` and talks to it directly.
