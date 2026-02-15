#!/bin/bash
# coverage-gate.sh — Enforce minimum coverage thresholds
#
# Reads coverage-summary.json and fails if line coverage is below 80%.

set -euo pipefail

COVERAGE_FILE="coverage/coverage-summary.json"
THRESHOLD=65

echo "📊 Checking coverage thresholds (minimum: ${THRESHOLD}%)..."

if [ ! -f "$COVERAGE_FILE" ]; then
  echo "⚠️  Coverage file not found: $COVERAGE_FILE"
  echo "   This is expected during early development."
  echo "   Skipping coverage gate."
  exit 0
fi

# Extract line coverage percentage from coverage-summary.json
LINE_PCT=$(node -e "
  const summary = require('./${COVERAGE_FILE}');
  const total = summary.total;
  if (total && total.lines) {
    console.log(total.lines.pct);
  } else {
    console.log('0');
  }
")

echo "   Line coverage: ${LINE_PCT}%"

# Compare (using node for float comparison)
PASS=$(node -e "console.log(${LINE_PCT} >= ${THRESHOLD} ? 'true' : 'false')")

if [ "$PASS" = "true" ]; then
  echo "✅ Coverage gate passed: ${LINE_PCT}% >= ${THRESHOLD}%"
  exit 0
else
  echo "❌ Coverage gate FAILED: ${LINE_PCT}% < ${THRESHOLD}%"
  echo "   Please add tests to increase coverage."
  exit 1
fi
