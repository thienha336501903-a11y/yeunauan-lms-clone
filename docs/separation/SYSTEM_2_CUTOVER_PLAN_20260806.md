# SYSTEM 2 PRODUCTION CUTOVER PLAN (STAGING ONLY â€” NOT PROMOTED YET)
**Generated:** 2026-08-06 18:25:50

## Pre-Cutover Checklist
- [x] System 1 Encrypted Backup Verified (AES-256-GCM + DPAPI)
- [x] Dedicated System 2 Database Provisioned (mkxwitkcgkvgdjzdrvxk)
- [x] System 1 Protection Baseline Active
- [ ] Owner Action Checklist Completed (DNS / OAuth Origins)
- [ ] Final Owner Review Approval

## Execution Steps for Future Cutover
1. Point portal-learning.yeunauan.live CNAME to Vercel deployment.
2. Add https://portal-learning.yeunauan.live to Google OAuth Authorized Origins.
3. Switch Commerce System 2 routing parameter to portal-learning.yeunauan.live.
4. Re-verify System 1 regression.