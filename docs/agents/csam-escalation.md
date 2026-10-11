# CSAM escalation procedure

What to do when generated or uploaded content on Veyrnox.ai is, or may be,
child sexual abuse material (CSAM), AI-generated CSAM, or child sexual
exploitative material (CSEM). This is the procedure the Thorn / All Tech Is
Human *Safety by Design for Generative AI* standard asks a deployer to
document (Deploy mitigation 1), and the one UK law expects of a service that
becomes aware of such material. ADR-0083 records the decision. Short on
purpose: read it once now, follow it under pressure.

## The rule

**Do not look longer than it takes to decide. Do not download, forward,
screenshot, describe in detail or store a copy anywhere but where the
procedure says. Do not tell the account holder.** Possession and distribution
are offences even when the purpose is reporting; the exemption covers the
report itself and the preserved original, nothing else.

## Who

| Role | Who |
|---|---|
| Decides and reports | Product owner (Al Jobson). Sole admin; `users.is_admin`. |
| UK reporting body | Internet Watch Foundation (IWF), report.iwf.org.uk, for content hosted or generated on a UK service. |
| US reporting body | NCMEC CyberTipline, report.cybertip.org, when US users, US providers or US hosting are involved (fal.ai, Cloudflare R2). A US ESP obligation under 18 U.S.C. §2258A may apply to the provider rather than to us; report to both when unsure. |
| Law enforcement | NCA CEOP (ceop.police.uk) for the UK. Give them the evidence hold reference, never the files. |
| Model providers | Each provider's abuse channel (fal.ai, kie.ai, OpenRouter, BytePlus). They have their own duty to report. Reference the job id and the time; attach nothing. |

## Steps

1. **Escalate in the product, at once.** `/app/admin/violations`, find the user
   or the job, **Escalate (CSAM)** on that job. This records
   `account_actions.action = 'csam_escalation'` with your email and a short
   reason (an IWF or NCMEC reference once you have one), stops the files being
   served (the `assets` rows are deleted), moves their R2 keys to
   `evidence_holds` so the reaper never deletes them, removes them from the
   reap queue if they were already there, and Freezes the account
   (`content:csam_escalation`). **No email is sent to the user for this tier.**
   The same key replays without a second record.
2. **Report within 24 hours.** IWF first for UK material; NCMEC when the US is
   involved. Give them the job id, the account id, the time of generation, the
   model and the prompt from the `jobs` row, and the evidence hold id. They
   will ask for the material through their own secure channel if they want it:
   use that, never email. Record each reference in the incident note.
3. **Tell the provider** through their abuse channel with the same identifiers.
   Attach nothing.
4. **Law enforcement.** If a request arrives, or if the content shows an
   identifiable child who may be at risk now, contact NCA CEOP the same day.
   Answer a production order with the evidence hold reference; the files stay
   in R2 until the order is served or the retention period ends.
5. **Preserve, then destroy.** Keep the hold for 90 days from the report
   (NCMEC's preservation period, which the IWF does not shorten) or as long as
   law enforcement asks, whichever is later. Then release it:
   `POST /api/v1/admin/reports { release_action_id, reason }` or the
   **Release evidence** button on the account page. That writes
   `account_actions.action = 'evidence_released'` and queues the keys for the
   reaper, which deletes them within five minutes. Do not release before the
   report is acknowledged.
6. **Record.** One incident note under `docs/incidents/YYYY-MM-DD-csam-<id>.md`
   with timeline, references and who was told. No descriptions of the content,
   no prompts, no file names: the identifiers above are enough. The note stays
   in the private incident folder, never in this public repository's history
   with anything beyond the ids.
7. **Model-level enforcement.** If the prompt shows a pattern the provider's
   filter missed, add the pattern to our own prompt refusal (`topic_refused`
   and `brief_refused` already exist for the agent paths) and tell the
   provider. A rule that blocks the prompt and its variants is the second
   enforcement layer the Thorn standard asks for; the user-level one is the
   Freeze.

## What the account holder sees

Generating and buying stop (the Freeze). Sign-in, the Library (minus the
escalated job's files) and account deletion still work. They receive no
notice, and the appeal page does not offer an appeal for this tier. A support
message about it gets no detail: "This account is under review."

## What is not here

- Automatic scanning of prompts, uploads or outputs. The providers run their
  own classifiers and the violations queue handles what is reported. A hash
  match on uploads (PhotoDNA or an IWF hash list) needs an agreement with the
  IWF and is a separate decision.
- A hotline. Users report through **Report** on a Library card or
  `/app/account/report`, which lands in `/app/admin/reports` with CSAM at the
  top. That page is checked at least daily while the site is live.

## Scanner holds

A scanner hold is a report for human review, never an automatic CSAM escalation. In the reports queue, use **View held image**: this administrator-only five-minute link logs `held_asset_viewed` on every inspection. If the image is CSAM, use **Escalate (CSAM)** from the violations page as today. The scanner's `sexual/minors` category is text-only, so image classification cannot determine this for you. Release a mistaken hold with a reason; the action is logged and open scanner reports are resolved. After a takedown, release resolves the report but cannot restore the deleted file.

When disabling scanning, turn off `CONTENT_SCAN_ENABLED`, then use **Scanner: disarm monitoring** on the reports page with a reason. Monitoring remains armed through outages until explicitly disarmed. The reports page displays unavailable scans from the last 24 hours even when there are no reports; unavailable scans are never held.
