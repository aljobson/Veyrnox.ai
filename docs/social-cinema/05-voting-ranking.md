# 5. Voting & Ranking Engine

## 5.1 Purpose

Voting is the defining Veyrnox.ai mechanic. The system must reward genuine audience response while reducing manipulation, purchased engagement and simple popularity dominance.

## 5.2 Vote types

### Community vote
Used for:
- Episode of the Week
- Series of the Week
- People's Choice

### Story decision vote
Used to influence the next episode. This is a poll, not a ranking signal by default.

## 5.3 Qualified voting

A qualified vote requires:
- authenticated account
- active target and competition
- uniqueness constraint satisfied
- account not suspended
- vote not rejected by fraud controls

Optional future qualification signals:
- minimum watch threshold
- account age
- verified email/phone
- reputation score

Avoid making qualification rules so strict that genuine new users cannot participate.

## 5.4 Baseline weekly scoring model

Initial score:

```text
Weekly Score =
  0.40 × Vote Score
+ 0.25 × Completion Score
+ 0.15 × Unique Viewer Score
+ 0.10 × Share Score
+ 0.10 × Engagement Score
```

All component metrics must be normalised before weighting.

## 5.5 Why normalisation matters

Raw counts disproportionately reward large creators. Recommended normalisation can use:
- percentile ranking
- log scaling
- rate-based metrics
- minimum sample thresholds

Example:
- completion score is a rate, not raw completed views
- vote score may combine qualified vote count and votes per qualified viewer
- share score should be bounded so spam sharing cannot dominate

## 5.6 Eligibility controls

Content may require:
- minimum unique viewers
- minimum watch minutes
- no unresolved severe moderation case
- creator in good standing
- published within eligible period

## 5.7 Fraud signals

Potential indicators:
- abnormal vote velocity
- repeated devices across many accounts
- newly created account clusters
- identical behavioural timing
- impossible geographic/device patterns
- repeated failed authentication
- automation signatures
- high vote-to-view ratio

Risk responses:
- allow
- allow but reduce confidence
- hold vote for review
- reject vote
- restrict account
- escalate creator/series

## 5.8 Weekly competition lifecycle

```text
Open
  ↓
Active scoring
  ↓
Competition closes
  ↓
Freeze eligible events
  ↓
Fraud reconciliation
  ↓
Calculate final score
  ↓
Provisional ranking
  ↓
Moderator approval
  ↓
Publish winners
  ↓
Archive snapshot
```

## 5.9 Transparency

The consumer UI should explain rankings in plain language without publishing anti-abuse thresholds.

Suggested wording:

> Weekly rankings consider community votes, viewing completion, unique audience, sharing and engagement. Invalid or manipulated activity is excluded.

## 5.10 Winner categories

MVP:
- Series of the Week
- Episode of the Week
- People's Choice
- Rising Creator

Later:
- Best New Series
- Best Interactive Story
- Genre awards
- Regional awards
