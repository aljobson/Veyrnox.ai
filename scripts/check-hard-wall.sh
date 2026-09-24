#!/usr/bin/env bash
# HARD WALL — Veyrnox.ai (this repo, credit-metered AI generation) must
# never mention the sibling Veyrnox wallet product. If a term below shows
# up in the marketing tree or in customer-facing site content, the check
# fails.
#
# Scope of the wall: app/veyrnox/**, top-level app metadata, README.
# The API gateway (app/api/**) and DB code (packages/**) are exempt —
# they're implementation, not customer-facing surface.
#
# Bypass only after a written product decision that the two brands
# converge; then remove terms from BANNED individually with a comment
# explaining why.

set -u

BANNED=(
  'wallet'
  'multichain'
  'on-chain'
  'onchain'
  'payout'
  # 'passkey' was here. Removed 2026-09-23 when Veyrnox.ai shipped passkey
  # sign-in of its own (ADR-0032). It is not wallet vocabulary: it is the
  # standard WebAuthn term, and Apple's own sign-in page offers "Sign in with
  # Passkey". It was added for the wallet's "passkey wallet recovery", and
  # that phrase still trips the 'wallet' term above, so the wall loses no
  # coverage. This is a narrowing, NOT a brand convergence — every other term
  # stands.
  'settle to'
  'get paid on ship'
  'chains routed'
  'chains supported'
  'platform take'
  'ethereum'
  'solana'
  '\bBSC\b'
  'on-chain payouts'
)

SCOPE=(
  'app/veyrnox'
  'app/legal'
  'app/layout.js'
  'app/sitemap.js'
  'components'
  'public'
  'README.md'
)

fail=0
for term in "${BANNED[@]}"; do
  hits=$(grep -RniE "$term" "${SCOPE[@]}" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "HARD WALL breach — banned term matches:"
    echo "$hits"
    fail=1
  fi
done

if [ "$fail" -eq 1 ]; then
  echo
  echo "Veyrnox.ai is the AI generation product. Wallet copy belongs in"
  echo "the sibling repo (VEYRNOX/veyrnox). Strip or paraphrase and retry."
  exit 1
fi

echo "HARD WALL clean."
