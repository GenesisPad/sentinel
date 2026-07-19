# ADR 0039: Locker Exclusion and Supply-Transfer Score Aggregation

## Status

Accepted. Responds to a live `$GEN` scan the user flagged: after ADR 0038's fixes removed two
false positives, GEN's score got *worse* — CRITICAL 100 — driven entirely by six separate
`SUPPLY_TRANSFERRED_TO_WALLET` findings that appeared once the deployer address was corrected
(ADR 0037) and the wallet-clustering scan could finally see the real deployer's actual outgoing
transfers.

## Context and root causes

**One of the six "risky" transfers was the deployer sending supply to Genesis Locker.** Verified
live: `0x0372a1AE860CDc9357ac6bc8e9F97856b37B80Ed` is Blockscout-name-tagged "GenesisLocker" — the
real, already-integrated Genesis Locker contract this codebase's own `LockerProvider` queries for
LP-lock status. The deployer sending ~1% of supply there is a *locking* action (the opposite of a
risk — it's supply nobody can move without going through the locker's own rules), but the wallet-
clustering scan had no way to recognize the locker's own address, so it reported it identically to
an unexplained wallet transfer.

**Six separate findings of the same code linearly inflated the score.** The other five recipients
are genuine, unlabeled EOAs (`is_contract: false`, no name tag) each holding roughly 4-5% of
supply, all transferred within a tight block range shortly after launch — consistent with early
buyers on `$GEN`'s bonding-curve launcher, though Sentinel has no way to distinguish "paid
purchase" from "free allocation" from a bare ERC-20 Transfer log. Regardless of what they turn out
to be, `deployerHistoryDetector` emitted one `MEDIUM` `SUPPLY_TRANSFERRED_TO_WALLET` finding *per
recipient*, and `scoreFindings` sums same-category finding weights — six `MEDIUM` findings summed
past the 100 cap into CRITICAL, regardless of whether any individual recipient was actually
concerning. The category explanation text already says "highest-weighted is X," implying only one
finding should matter for the headline severity — the scoring itself didn't match that framing.

## Decision

- `packages/providers/src/locker.ts`: `LockerProvider` gained a `lockerAddress` field exposing
  the provider's own configured address (implementations that don't have a real locker, like
  `createUnsupportedLockerProvider`, return `null`) — no new registry of known-good addresses
  needed, since the provider already knows its own address statically.
- `apps/worker/src/scan-worker.ts`: the pool-address exclusion set from ADR 0034 (renamed
  `knownInfrastructureAddresses` at the call site) now also includes `providers.locker
  .lockerAddress` when present, so a supply transfer to the real locker contract is filtered out
  before it can become a `TRANSFERRED_SUPPLY_TO` edge, exactly like the existing liquidity-pool
  filter.
- `packages/security-engine/src/index.ts`: `deployerHistoryDetector` now emits **one**
  `SUPPLY_TRANSFERRED_TO_WALLET` finding regardless of how many `TRANSFERRED_SUPPLY_TO` edges
  were found, carrying every recipient in its evidence array (nothing is hidden — the wallet-
  cluster graph and `WALLET_CLUSTERING_EDGES_FOUND` check already show each recipient
  individually; only the *scored finding* is deduplicated). Title/description adapt for the
  single-recipient case (unchanged wording) versus multiple ("Deployer transferred supply to N
  other wallets").

## Consequences

- Full verification (`pnpm lint`, `typecheck`, `test`, `build`, `prisma:validate`) passed clean.
  New regression test in `packages/security-engine/src/index.test.ts` reproduces `$GEN`'s exact
  shape (6 recipients) and asserts exactly one finding is produced, still carrying all 6 in its
  evidence.
- `$GEN`'s next rescan should land closer to its pre-ADR-0037 HIGH/60 baseline (minus the two
  false positives ADR 0038 already removed) rather than the CRITICAL/100 this regression produced
  — the locker transfer stops counting entirely, and the five remaining transfers now contribute
  one `MEDIUM` (40) to `DISTRIBUTION_RISK` instead of `5 x MEDIUM` capped at 100.
- Did not attempt to distinguish "paid bonding-curve purchase" from "free allocation" for the five
  remaining unlabeled recipients — that would need cross-referencing each transfer's transaction
  for a paired inbound payment, which the current bounded Transfer-log scan doesn't do. The
  `SUPPLY_TRANSFERRED_TO_WALLET` finding (now singular) still surfaces the fact for manual review;
  this ADR only stops it from being systematically over-weighted by recipient count.
- This is the second scoring-adjacent bug this session where a single detector-level fix (ADR
  0034's pool-address filter) didn't generalize to a legitimate but different infrastructure
  address (the locker). Any future "known infrastructure, not a wallet" exclusion should route
  through the same `knownInfrastructureAddresses` set rather than adding a new one-off filter.
