#!/usr/bin/env bash
# Hook Stop : si des fichiers TypeScript ont été modifiés (non commités), vérifie les types de tout
# le monorepo avant de rendre la main. En cas d'erreur, la renvoie à Claude pour correction.
input=$(cat)
# Évite une boucle infinie : une seule relance par tour.
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0
cd "$(printf '%s' "$input" | jq -r '.cwd // empty')" 2>/dev/null || cd "$(dirname "$0")/../.."
git status --porcelain -- 'apps/*.ts' 'apps/*.tsx' 'packages/*.ts' 'apps/**/*.ts' 'apps/**/*.tsx' 'packages/**/*.ts' | grep -q . || exit 0
if ! out=$(npm run typecheck 2>&1); then
  errors=$(printf '%s\n' "$out" | grep -E "error TS|\.tsx?\([0-9]+,[0-9]+\)" | head -30)
  jq -n --arg r "Le typage TypeScript échoue après tes modifications — corrige avant de terminer :
$errors" '{decision: "block", reason: $r}'
fi
exit 0
