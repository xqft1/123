#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/build.sh
dfx canister --network ic upload-assets www
echo "Uploaded dist/ to assets canister (www)"
