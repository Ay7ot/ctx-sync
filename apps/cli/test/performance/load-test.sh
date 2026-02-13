#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# ctx-sync  Performance Load Test
#
# Runs a series of timed operations against the CLI core modules
# to verify performance under realistic workloads.
#
# Usage:
#   bash apps/cli/test/performance/load-test.sh
#
# Requirements:
#   - Node.js 18+
#   - npm dependencies installed (npm ci)
#   - npx tsx available
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║         ctx-sync — Performance Load Test                ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "CLI directory: $CLI_DIR"
echo "Timestamp:     $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

# ──────────────────────────────────────────────────────────────────
# Helper: time a command and report duration
# ──────────────────────────────────────────────────────────────────
run_benchmark() {
  local label="$1"
  shift
  echo -n "  ⏱  $label ... "

  local start end duration
  start=$(date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1e9))')
  "$@"
  end=$(date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1e9))')

  duration=$(( (end - start) / 1000000 )) # Convert ns → ms
  echo "${duration}ms"
}

# ──────────────────────────────────────────────────────────────────
# Test 1: Run Jest performance benchmarks
# ──────────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 1: Jest Performance Benchmarks"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

run_benchmark "Jest benchmarks" \
  npx --yes -w apps/cli jest test/performance --no-coverage --verbose 2>&1 | tail -40

echo ""

# ──────────────────────────────────────────────────────────────────
# Test 2: Inline encryption benchmark (via tsx)
# ──────────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 2: Inline Encryption Throughput"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

npx tsx - <<'SCRIPT'
import { performance } from 'node:perf_hooks';
import { generateKey, encrypt, decrypt, encryptState, decryptState } from './apps/cli/src/core/encryption.js';

async function main() {
  const { publicKey, privateKey } = await generateKey();

  // Warm up
  await encrypt('warmup', publicKey);

  // Encrypt throughput
  const COUNT = 200;
  const start = performance.now();
  for (let i = 0; i < COUNT; i++) {
    await encrypt(`secret-value-${i}`, publicKey);
  }
  const encryptTime = performance.now() - start;
  console.log(`  Encrypt ${COUNT} secrets:  ${encryptTime.toFixed(1)}ms  (${(encryptTime / COUNT).toFixed(1)}ms/op)`);

  // Decrypt throughput
  const ciphertexts: string[] = [];
  for (let i = 0; i < COUNT; i++) {
    ciphertexts.push(await encrypt(`secret-${i}`, publicKey));
  }

  const decStart = performance.now();
  for (const ct of ciphertexts) {
    await decrypt(ct, privateKey);
  }
  const decryptTime = performance.now() - decStart;
  console.log(`  Decrypt ${COUNT} secrets:  ${decryptTime.toFixed(1)}ms  (${(decryptTime / COUNT).toFixed(1)}ms/op)`);

  // State encryption (large payload)
  const largeState = {
    machine: { id: 'bench', hostname: 'bench.local' },
    projects: Array.from({ length: 100 }, (_, i) => ({
      id: `project-${i}`,
      name: `my-app-${i}`,
      path: `~/projects/my-app-${i}`,
      git: { branch: `feature/task-${i}`, remote: 'origin', hasUncommitted: false, stashCount: 0 },
      lastAccessed: new Date().toISOString(),
    })),
  };

  const stateStart = performance.now();
  const ct = await encryptState(largeState, publicKey);
  const stateParsed = await decryptState(ct, privateKey);
  const stateTime = performance.now() - stateStart;
  console.log(`  State encrypt+decrypt (100 projects): ${stateTime.toFixed(1)}ms`);

  const payloadSize = JSON.stringify(largeState).length;
  const ciphertextSize = ct.length;
  console.log(`  Payload size: ${(payloadSize / 1024).toFixed(1)}KB → Ciphertext: ${(ciphertextSize / 1024).toFixed(1)}KB  (${(ciphertextSize / payloadSize).toFixed(2)}x overhead)`);
}

main().catch(console.error);
SCRIPT

echo ""

# ──────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Load test complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
