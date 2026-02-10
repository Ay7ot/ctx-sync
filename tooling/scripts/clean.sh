#!/bin/bash
# clean.sh — Remove all build artifacts, dependencies, and test output
#
# Use when you need a completely fresh state.

set -euo pipefail

echo "🧹 Cleaning ctx-sync workspace..."

# Remove node_modules
echo "  Removing node_modules..."
rm -rf node_modules
rm -rf apps/cli/node_modules
rm -rf apps/website/node_modules
rm -rf packages/shared/node_modules

# Remove build output
echo "  Removing dist directories..."
rm -rf apps/cli/dist
rm -rf packages/shared/dist

# Remove coverage
echo "  Removing coverage..."
rm -rf apps/cli/coverage
rm -rf packages/shared/coverage
rm -rf coverage

# Remove test artifacts
echo "  Removing test artifacts..."
rm -rf /tmp/ctx-sync-test*

# Remove turbo cache
echo "  Removing turbo cache..."
rm -rf .turbo

echo ""
echo "✅ Clean complete. Run 'npm install' to reinstall dependencies."
