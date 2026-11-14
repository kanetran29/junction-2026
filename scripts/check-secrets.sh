#!/usr/bin/env bash
# Fails when a secret reaches the git index: any value from .dev.vars or ~/.config/junction2026/*.env, a Google API key
# pattern, or a private JWK (the door signing key).
# Runs as the pre-commit hook and before `pnpm test`. Prints file names only, never the matching text.
# The local ADMIN_KEY in .dev.vars is the public dev default (`dev-admin-key`) and is skipped; the deployed one is a Worker secret.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0

if files=$(git grep --cached -lIE 'AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_-]{30,}'); then
  echo "check-secrets: a Google API key pattern is in: $files" >&2
  fail=1
fi

if files=$(git grep --cached -lIE '"d" ?: ?"[A-Za-z0-9_-]{40,}"'); then
  echo "check-secrets: a private JWK (a \"d\" member, e.g. the door signing key) is in: $files" >&2
  fail=1
fi

for f in .dev.vars "$HOME"/.config/junction2026/*.env; do
  [ -f "$f" ] || continue
  while IFS='=' read -r name value; do
    name="${name#export}"
    name="${name#"${name%%[![:space:]]*}"}"
    [ "$name" = "ADMIN_KEY" ] && [ "$f" = ".dev.vars" ] && continue
    value="${value%\"}"
    value="${value#\"}"
    [ "${#value}" -ge 12 ] || continue
    if files=$(git grep --cached -lIF -e "$value"); then
      echo "check-secrets: the value of $name is in: $files" >&2
      fail=1
    fi
  done < <(grep -E '^(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=' "$f")
done

exit "$fail"
