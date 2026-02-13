#!/bin/bash
# check-secrets.sh — Scan test output directories for accidental plaintext secret leaks
#
# Exits non-zero if any known token patterns are found in test artifacts.
#
# Run in CI as part of the security job. Also safe to run locally:
#   bash tooling/ci/check-secrets.sh
#
# Environment:
#   CHECK_SECRETS_EXTRA_DIRS — space-separated extra directories to scan
#   CHECK_SECRETS_VERBOSE    — set to "1" for verbose output

set -euo pipefail

VERBOSE="${CHECK_SECRETS_VERBOSE:-0}"

echo "🔍 Scanning for plaintext secrets in test artifacts..."

# ── Patterns ──────────────────────────────────────────────────────
# Each pattern is a regex that, if found in a test artifact file,
# indicates a potential secret leak. Keep in sync with the log
# sanitizer patterns in src/core/log-sanitizer.ts.
#
# Patterns are designed to minimise false positives:
# - AGE-SECRET-KEY- requires at least one uppercase alphanumeric char after the prefix
# - Other patterns require sufficient suffix characters

PATTERNS=(
  "sk_live_[a-zA-Z0-9]"
  "sk_test_[a-zA-Z0-9]"
  "ghp_[a-zA-Z0-9]"
  "gho_[a-zA-Z0-9]"
  "github_pat_[a-zA-Z0-9]"
  "xoxb-[0-9]"
  "xoxp-[0-9]"
  "AKIA[A-Z0-9]{4,}"
  "AGE-SECRET-KEY-1[A-Z0-9]"
  "AIzaSy[a-zA-Z0-9]"
)

# ── Directories to scan ──────────────────────────────────────────
# Default directories + any extras from the environment.

SEARCH_DIRS=(
  "/tmp/ctx-sync-test"
)

# Append extra dirs from environment
if [ -n "${CHECK_SECRETS_EXTRA_DIRS:-}" ]; then
  IFS=' ' read -ra EXTRA <<< "$CHECK_SECRETS_EXTRA_DIRS"
  SEARCH_DIRS+=("${EXTRA[@]}")
fi

FOUND=0

for dir in "${SEARCH_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    [ "$VERBOSE" = "1" ] && echo "  Scanning: $dir"
    for pattern in "${PATTERNS[@]}"; do
      if grep -rn -E "$pattern" "$dir" 2>/dev/null; then
        echo "❌ ERROR: Found secret pattern '$pattern' in $dir"
        FOUND=1
      fi
    done
  else
    [ "$VERBOSE" = "1" ] && echo "  Skip (not found): $dir"
  fi
done

# ── Summary ──────────────────────────────────────────────────────

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "❌ FAILED: Plaintext secrets found in test artifacts!"
  echo "   This means secrets may have leaked during testing."
  echo "   Review the matches above and fix the leak."
  exit 1
fi

echo "✅ No plaintext secrets found in test artifacts."
exit 0
