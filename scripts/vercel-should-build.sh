#!/usr/bin/env sh
# Vercel ignoredBuildStep: exit 0 = skip deployment, exit 1 = build.
#
# Keeps one production build per push on the canonical branch and skips
# preview deployments (common cause of "6 deploys" when Vercel + previews +
# duplicate git integrations are all enabled).

if [ "${VERCEL_ENV:-}" = "production" ]; then
  exit 1
fi

exit 0
