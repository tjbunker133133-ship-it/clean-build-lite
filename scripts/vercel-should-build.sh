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
  case "${VERCEL_PROJECT_NAME:-}" in
    clean-build-lite) exit 1 ;;
  esac
fi

exit 0
