#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pushd frontend
npm install
npm run build
popd
echo "Built to dist/"
