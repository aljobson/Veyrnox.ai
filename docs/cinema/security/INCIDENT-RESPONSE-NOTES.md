# Cinema incident response notes

Draft operational requirements, 25 September 2026. These notes do not establish an on-call service or prove that alerts are configured. Before launch assign a named incident lead, security responder, platform operator, finance operator, privacy contact and backups; verify contact routes and run a tabletop exercise. Do not record secrets here.

## Detection inventory to implement

Alert on abnormal auth/authorization failures, recovery/MFA/payout destination changes, privilege changes, anomalous payouts, repeated webhook verification failures, reconciliation mismatches, vote/view spikes, mass deletion and administrative anomalies. Use redacted request/event/resource IDs, timestamps and result codes. Establish thresholds, retention, routing and response ownership in the same feature PR. Do not log passwords, tokens, private keys, card details or full provider payloads.

## Response sequence

1. Triage scope and assign severity: CRITICAL, HIGH, MEDIUM, LOW or INFO. Record identifier, affected versions/resources, detection time and incident lead. Use a restricted incident record for sensitive details.
2. Preserve evidence with timestamps and access control: relevant audit IDs, request IDs, provider event IDs, deployment version and redacted logs. Do not paste credentials or personal payloads into public issues.
3. Contain the affected capability through its verified server flag or controlled rollback. Revoke affected credentials/sessions using authorized operational paths; isolate compromised integration access. Never make a bucket public, disable TLS/signature verification, bypass RLS or erase audit rows as recovery steps.
4. For suspected financial error/fraud: hold new settlement/payouts through the implemented controls; reconcile provider events and immutable records. Corrections are compensating entries, not historical edits. Avoid duplicate refunds/payouts when replaying events.
5. Fix the root cause with a reproducing test, reviewed patch and negative/replay regression tests. Validate in isolated preview before controlled production deployment. Ensure rollback does not reintroduce the weakness.
6. Restore gradually after the incident lead verifies controls and clean reconciliation. Check missed/reordered events and queued work, not only the HTTP health endpoint. Notify affected parties through the designated privacy/communications process where required.
7. Record root cause, blast radius, fix, validation, prevention change, owner and follow-up dates. Link to the relevant threat/ASVS/gap entry; review recurrence and detection gaps (SSDF RV.3).

## Release and risk decisions

Critical/high findings affecting identity, authorization, sensitive data, admin, money or code execution block release unless the owner records explicit acceptance, rationale, compensating controls, scope, expiry and review date. A scanner skip, flaky test or operational deadline is not risk acceptance. Manual verification is required when automated evidence is insufficient.

Production schema changes use the existing owner-approved migration workflow; incident urgency does not authorize ad-hoc SQL or deleting financial history. Record who authorized each privileged action. Verify backup/restore and credential rotation exercises before relying on them.
