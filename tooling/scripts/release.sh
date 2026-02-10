#!/bin/bash
# release.sh — Prepare a release
#
# Usage: ./tooling/scripts/release.sh <major|minor|patch>

set -euo pipefail

VERSION_TYPE=${1:-patch}

echo "📦 Preparing release (${VERSION_TYPE})..."

# Ensure we're on develop
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "develop" ]; then
  echo "❌ Must be on 'develop' branch. Currently on: $CURRENT_BRANCH"
  exit 1
fi

# Ensure working directory is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Working directory is not clean. Commit or stash changes first."
  exit 1
fi

# Run full test suite
echo "🧪 Running full test suite..."
npm run test:all

# Bump version
echo "📝 Bumping version (${VERSION_TYPE})..."
NEW_VERSION=$(npm version "$VERSION_TYPE" --no-git-tag-version -w apps/cli | tail -1)

echo "   New version: $NEW_VERSION"

# Update root package.json version to match
npm version "$VERSION_TYPE" --no-git-tag-version

# Create release branch
RELEASE_BRANCH="release/${NEW_VERSION}"
echo "🌿 Creating release branch: $RELEASE_BRANCH"
git checkout -b "$RELEASE_BRANCH"

# Commit version bump
git add -A
git commit -m "chore: bump version to ${NEW_VERSION}"

echo ""
echo "✅ Release branch created: $RELEASE_BRANCH"
echo ""
echo "Next steps:"
echo "  1. Update CHANGELOG.md"
echo "  2. Run final tests"
echo "  3. Merge to main: git checkout main && git merge $RELEASE_BRANCH"
echo "  4. Tag: git tag $NEW_VERSION"
echo "  5. Push: git push origin main --tags"
echo "  6. Back-merge: git checkout develop && git merge main"
