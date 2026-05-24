#!/usr/bin/env sh
# Vercel ignoredBuildStep: exit 0 = skip deployment, exit 1 = build.
#
# Keeps one production build per push on the canonical branch and skips
# preview deployments (common cause of "6 deploys" when Vercel + previews +
# duplicate git integrations are all enabled).

if [ "${VERCEL_ENV:-}" = "production" ]; then
  exit 1
fi

# Field branch: build when Vercel treats this ref as Preview (production may still be main).
if [ "${VERCEL_GIT_COMMIT_REF:-}" = "stable/2026-05-23" ]; then
  exit 1
fi

exit 0
