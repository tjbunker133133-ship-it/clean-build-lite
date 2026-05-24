#!/usr/bin/env sh
# Vercel ignoredBuildStep: exit 0 = skip deployment, exit 1 = build.
#
# Goals:
# - Always build Production.
# - On stable/2026-05-23, build exactly ONE preview (canonical project name).
# - Skip duplicate Vercel projects (clean-build-lite-*, etc.) on the same repo.

if [ "${VERCEL_ENV:-}" = "production" ]; then
  exit 1
fi

# Optional per-project override in Vercel → Environment Variables (Preview + Production).
if [ "${VERCEL_CANONICAL_PROJECT:-}" = "1" ]; then
  exit 1
fi

if [ "${VERCEL_GIT_COMMIT_REF:-}" = "stable/2026-05-23" ]; then
  CANONICAL="$(tr -d '\r\n' < projects/hud-v1/canonical.vercel 2>/dev/null || echo hud-v1)"
  if [ "${VERCEL_PROJECT_NAME:-}" = "$CANONICAL" ]; then
    exit 1
  fi
  # Legacy Vercel project names until dashboard cleanup (see projects/hud-v1/DEPLOY.md).
  if [ "${VERCEL_PROJECT_NAME:-}" = "clean-build-lite" ]; then
    exit 1
  fi
fi

exit 0
