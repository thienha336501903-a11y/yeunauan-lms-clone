# V4 Final E2E Release — 2026-08-21

## Status

Production E2E: PASS.

Validated end-to-end flow:

1. Register a brand-new Telegram V4 source without changing clone MASTER.
2. Import historical text/photo/video from a private Telegram channel through the local Windows reader.
3. Hydrate historical Telegram media metadata so photo/video thumbnails and playback work in LMS.
4. Create a V4 Draft through the launch Wizard.
5. Grant a learner while Draft and confirm the Draft gate blocks lesson access.
6. Run pre-publish checks: 10 PASS, 0 WARNING, 0 BLOCKER.
7. Publish and confirm learner access.
8. Confirm historical text, photo and video render/play successfully.
9. Post a new Telegram message after Publish and confirm it appears through webhook without re-import.
10. Edit the live Telegram message and confirm the same LMS item updates in place with no duplicate.
11. Revoke learner access and confirm the learner is blocked.
12. Delete all E2E test artifacts and verify the real baseline remains unchanged.

## Final source-code rollback points

- LMS stable branch: `stable/v4-final-20260821`
  - commit: `9de1159ec2a8dfbb744ce8000cce5a849075081f`
- Telegram Cloner stable branch: `stable/v4-final-20260821`
  - commit: `b6ad0484862b2d205fe085eac11900101f4ad710`

Do not move these branches. Create a new dated stable branch for future releases.

## Final fixes discovered during E2E

### Windows private-channel history import

PR #22 in `telegram-channel-cloner` fixed the one-command Windows wrapper when a Bot API chat id begins with `-100...`. The wrapper now binds the value explicitly as the `Channel` argument instead of letting PowerShell parse it as a parameter name.

### Exact V4 source counts after live webhook

PR #53 in `yeunauan-lms-clone` fixed stale Admin/Wizard source counts. V4 Admin/Wizard now derives the displayed message count from the actual `tgcloner_source_messages` rows instead of trusting the cached `tgcloner_sources.indexed_message_count` value.

This was a display/health-count issue only; student content and webhook delivery were already correct.

## Post-cleanup baseline verification

After deleting the final E2E artifacts:

- no test course remains;
- no test source remains;
- no test source messages remain;
- no test V4 mapping remains;
- no test enrollment remains;
- no test media tickets remain;
- no `__clone_factory_test` course/source remains.

Real baseline `cagiatay` remains:

- active: true;
- published: true;
- delivery mode: V4;
- Telegram MASTER source active: true;
- indexed/actual messages: 14/14;
- media messages: 13;
- media missing file metadata: 0;
- active enrollments: 2.

## Operating entry points

- Primary launch path: `/v4-course-wizard.html`
- Advanced fallback/admin path: `/v4-admin.html?advanced=1`
- Telegram source registration/import: Cloner Admin in V4 source mode.

## Safety invariants

- A V4 course source does not need to be clone MASTER.
- Never promote a course-specific V4 source to MASTER unless deliberately changing the clone/mirror system.
- Historical import uses the local Telegram user session; Telegram API credentials and reader secrets must stay local and must never be committed.
- Publish only after preflight reports zero blockers.
- Treat `cagiatay` and its real enrollments as baseline data; do not use them for mutation tests.

## Security follow-up

A Telegram API credential was exposed during the manual E2E conversation. Rotate/recreate that Telegram API credential after testing. Do not copy the replacement credential into documentation, Git, issue comments, or chat logs.
