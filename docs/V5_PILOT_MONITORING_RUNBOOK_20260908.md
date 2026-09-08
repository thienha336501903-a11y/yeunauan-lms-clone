# V5 Pilot Monitoring Runbook — System B

Date: 2026-09-08

## Scope

System B only.

- LMS repo: `thienha336501903-a11y/yeunauan-lms-clone`
- Production merge baseline: `5fa4e0f4e3a750c44983695b09856a06d4b02d58`
- Supabase B: `yyiavtiwtekkocqpephr`
- LMS production: `https://v4.daubepnho.store`
- Cloudflare media Worker: `yeubep-v5-media`

Do not touch System A. Do not bypass auth/security. Do not commit directly to `main`. Any code/config fix must use branch -> Draft PR -> CI/Preview -> QA -> Ready for review -> owner-confirmed merge.

## Known production baseline before pilot

PR #156 passed the authenticated 50 -> 100 -> 300 synthetic metadata/lease suite with 100% success at every stage. The successful 300-learner stage had total p95 about 4.56 s and p99 about 5.11 s, with one ~14.9 s playback-lease outlier but no failed learner.

Post-merge production smoke passed:

- protected image renders
- protected video starts
- Range/seek works
- Vercel production health = 200
- Supabase sample = ~22 connections / 1 active
- heartbeat cumulative counters remained stable during benchmark

This is the baseline to compare against. Do not treat the synthetic test as a substitute for real-user monitoring.

## Rollout stages

| Stage | Pilot size | Minimum observation window | Advance only when |
|---|---:|---:|---|
| P1 | 20 learners | 24 h | No STOP condition; learner success >= 99%; no normal-user 429; production smoke still passes |
| P2 | 50 learners | 24 h | Same gates; no rising error trend; quota projection remains comfortable |
| P3 | 100 learners | 48 h | Same gates; no DB/Worker/Vercel saturation signal; support complaints remain isolated |
| P4 | up to 300 learners | 72 h | Same gates; p95 stays within thresholds; no sustained resource pressure |

Do not jump stages because enrollment is available. Advance only after the observation window and gate review.

## Learner-facing checks

Sample at least 3 real learners per stage, ideally on different devices/networks.

1. Google login succeeds.
2. `Khóa học của tôi` loads.
3. Course V5 feed loads.
4. Protected image renders.
5. Protected video starts.
6. Seek forward/backward works.
7. Reload and resume do not break auth.
8. No learner sees R2 key, Telegram `file_id`, playback private key, or raw credential material.

## Service thresholds

### GREEN — continue stage

- learner request success >= 99%
- Vercel 5xx < 0.2% over the observation window
- no repeated auth failure pattern
- no normal learner receives Cloudflare `429`
- feed p95 <= 5 s in representative samples
- playback-lease p95 <= 3 s in representative samples
- end-to-end metadata + lease p95 <= 6 s
- Supabase total connections < 42 / 60 and active connections < 10 in sampled periods
- DB size < 70% of Free storage allowance
- no unexplained rise in write amplification

### AMBER — hold current stage, investigate before increasing

Any one of:

- Vercel 5xx between 0.2% and 1% over 15+ minutes
- feed p95 > 5 s or playback-lease p95 > 3 s for 15+ minutes
- total p95 > 6 s for 15+ minutes
- Supabase total connections >= 42 / 60 or active >= 10 for repeated samples
- repeated learner complaints from different networks/devices
- Cloudflare Worker error rate rises even if learner retries eventually succeed
- monthly quota projection exceeds 70% of a Free-plan allowance

Action: freeze rollout size, capture metrics, diagnose. Do not add learners until GREEN again.

### RED / STOP — do not increase; contain incident

Any one of:

- Vercel 5xx >= 1% for 15 minutes
- >= 5 consecutive normal learner operations fail for the same path
- learner playback failure > 2% across multiple learners/networks
- normal learners hit Cloudflare `429` under ordinary viewing
- Supabase total connections >= 48 / 60 sustained or active connections >= 20 sustained
- database timeouts / PostgREST availability failures
- protected media begins returning 403/5xx broadly
- auth/security regression or any secret exposure
- p95 total > 10 s sustained for 15 minutes

Action: stop onboarding immediately. Preserve evidence. Do not auto-rollback or reset branches. If a code/config change is needed, use the normal PR workflow.

## What to inspect after every stage

### Vercel

For the production deployment of current `main`:

- status-code counts
- runtime error groups
- top failing request paths
- latency trend for `/api/lms/portal` V5 feed/play calls
- monthly invocation / compute projection

A clean stage should show overwhelmingly HTTP 200 and no new repeating 5xx cluster.

### Supabase B

Run `sql/ops_v5_pilot_snapshot.sql` and record the output at:

- stage start
- peak usage period
- stage end

Track:

- DB size
- total / active connections
- cumulative playback RPC calls
- cumulative heartbeat update calls
- recently active verified/student sessions

Use deltas between snapshots. Cumulative counters alone are not an incident.

### Cloudflare Worker / R2

Check Worker analytics for:

- total requests
- 4xx / 5xx
- `429` rate-limit responses
- request spikes correlated with learner complaints
- R2 Class B read-operation trend

Ordinary learners should not trigger the 600 requests/minute per learner/video limiter.

### Support signal

Classify learner reports into:

- login/auth
- course/feed loading
- image
- video start
- seek/buffering
- device/network-specific

One report is not automatically a system incident. The same failure across multiple users/networks is.

## Stage review record

Create one record per stage using this template:

```text
Stage: P1 / P2 / P3 / P4
Pilot size:
Start time:
End time:
Production main SHA:
Vercel deployment ID:
Learner success rate:
Feed p95:
Play lease p95:
Total p95:
Vercel 5xx rate:
Supabase connections total/active:
Supabase DB size:
Playback RPC delta:
Heartbeat write delta:
Cloudflare Worker error/429 summary:
R2 operation trend:
Learner complaints by category:
Decision: GREEN / AMBER / RED
Next action:
Operator:
```

## Incident workflow

1. Freeze onboarding at the current pilot size.
2. Record exact time window and affected course/user path.
3. Check Vercel status/errors first.
4. Check Supabase connections/errors/counter deltas.
5. Check Cloudflare Worker 4xx/5xx/429 and R2 operations.
6. Reproduce with one authenticated test learner only.
7. If code/config change is required, create a new branch and Draft PR.
8. CI -> Preview -> authenticated QA.
9. Merge only after explicit owner confirmation.

Never weaken auth, CORS, ECDSA lease validation, UA binding, private `no-store`, Range/seek protections, or R2 privacy to make an incident disappear.

## Capacity interpretation

The current architecture is approved for staged real-user rollout toward 100-300 learners, not an unconditional guarantee of 300 simultaneous full-video streams under every network/content pattern. Media bytes remain on Cloudflare/R2; Vercel should continue to serve only small auth/feed/lease responses. Real-user stage metrics override synthetic expectations.
