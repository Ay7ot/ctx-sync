#!/bin/bash
# check-secrets.sh — Scan test output directories for accidental plaintext secret leaks
#
# Exits non-zero if any known token patterns are found in test artifacts.

set -euo pipefail

echo "🔍 Scanning for plaintext secrets in test artifacts..."

PATTERNS=(
  "sk_live_"
  "sk_test_"
  "ghp_"
  "gho_"
  "github_pat_"
  "xoxb-"
  "xoxp-"
  "AKIA"
  "AGE-SECRET-KEY-"
  "AIzaSy"
)

FOUND=0
SEARCH_DIRS=("/tmp/ctx-sync-test" "coverage" "apps/cli/coverage")

for dir in "${SEARCH_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    for pattern in "${PATTERNS[@]}"; do
      if grep -rn "$pattern" "$dir" 2>/dev/null; then
        echo "❌ ERROR: Found secret pattern '$pattern' in $dir"
        FOUND=1
      fi
    done
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "❌ FAILED: Plaintext secrets found in test artifacts!"
  echo "   This means secrets may have leaked during testing."
  echo "   Review the matches above and fix the leak."
  exit 1
fi

echo "✅ No plaintext secrets found in test artifacts."
exit 0
