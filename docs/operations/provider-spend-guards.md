# Supplier spend guards

The database reserves the catalog's worst-case wholesale cost before a paid or
free job can be created. Reservations are never released by customer refunds,
because a supplier may still bill an accepted request after Veyrnox refunds it.

Provider ceilings added by migration `0329_provider_spend_and_submit_guards.sql`:

| Provider key | Rolling hour | UTC day |
| --- | ---: | ---: |
| GrsAI | $1 | $5 |
| fal | $10 | $25 |
| KIE | $10 | $25 |
| OpenRouter video | $10 | $25 |
| OpenRouter Chat | $10 | $25 |
| OpenRouter Help | $1 | $5 |

These sit below the shared $50/hour and $250/day circuit breaker. The policy
tables are not readable or writable by browser roles or by the Worker service
role; an operator changes them through the protected database control plane.

## Ambiguous asynchronous submissions

Fal, KIE, GrsAI and OpenRouter video submissions are never retried after a
timeout, 5xx response, malformed success receipt, or lost database
acknowledgement. The job remains `DEBITED` with
`error_code = 'provider_outcome_unknown'`. The generic stuck-job sweep excludes
only these provider-reserved jobs, preventing both a supplier charge and a
customer refund from being recorded for the same uncertain request.

Before resolving one, check the supplier dashboard or support record. Never
guess. With service-role access, record a confirmed acceptance and its real
supplier handle:

```sql
select public.reconcile_provider_submit_unknown(
  '<job uuid>', 'ACCEPTED', '<supplier task id>'
);
```

If the supplier confirms that it rejected the request and did not charge it,
refund the held customer debit:

```sql
select public.reconcile_provider_submit_unknown(
  '<job uuid>', 'REJECTED', null
);
```

The RPC refuses jobs that are not still ambiguous, not still debited, or not
backed by a matching fal/KIE/GrsAI/OpenRouter spend reservation.
