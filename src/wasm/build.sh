#!/usr/bin/env bash
# Build the TFStudio TMM WASM kernel with Emscripten.
# One-time toolchain install: https://emscripten.org/docs/getting_started/downloads.html
#   git clone https://github.com/emscripten-core/emsdk && cd emsdk
#   ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh
#
# Then from the project root:  bash src/wasm/build.sh   (or: npm run build:wasm)
set -euo pipefail
cd "$(dirname "$0")/../.."   # project root

emcc src/wasm/tmm_kernel.c \
  -O3 \
  --no-entry \
  -sSTANDALONE_WASM=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS=_tmm_one,_tmm_spectrum,_tmm_jacobian,_tmm_needle_scan,_tmm_hessian,_malloc,_free \
  -o src/wasm/tmm_kernel.wasm

echo "Built src/wasm/tmm_kernel.wasm"
node tests/wasm_tmm_equivalence.mjs
