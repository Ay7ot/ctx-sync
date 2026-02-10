#!/bin/bash
# bootstrap.sh — First-time dev setup
#
# Run this after cloning the repo for the first time.

set -euo pipefail

echo "🚀 Setting up ctx-sync development environment..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Setup husky
echo "🐶 Setting up Git hooks..."
npx husky

# Build shared package (needed by CLI)
echo "🔨 Building shared package..."
npm run build -w packages/shared

# Build CLI
echo "🔨 Building CLI..."
npm run build -w apps/cli

# Run tests to verify setup
echo "🧪 Running tests..."
npm run test -w packages/shared
npm run test:unit -w apps/cli

echo ""
echo "✅ Setup complete! You're ready to develop."
echo ""
echo "Useful commands:"
echo "  npm run dev -w apps/cli        — Run CLI in dev mode"
echo "  npm run test:watch -w apps/cli — Watch tests"
echo "  npm run build                  — Build all packages"
echo "  npm run typecheck              — Type-check all packages"
echo "  npm run lint                   — Run ESLint"
