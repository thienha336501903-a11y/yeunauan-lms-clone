# BACKUP & ROLLBACK PROCEDURES

## Baseline Stability Tag: `CLONE_STABLE_V1`

### 1. Git Source Control Backups
- **Commerce Stable Tag**: `git tag -a CLONE_STABLE_V1 -m "Stable Clone Baseline V1"`
- **LMS Stable Tag**: `git tag -a CLONE_STABLE_V1 -m "Stable Clone Baseline V1"`
- **Push Tags**: `git push clone-origin --tags`

### 2. Database Backup & Snapshot
- Database Project Ref: `yyiavtiwtekkocqpephr`
- Database Snapshots: Daily automated Supabase backup + SQL DDL/Data exports stored in secure backup storage.

### 3. Vercel Deployment Rollback
If a new deployment introduces a regression, rollback instantly via Vercel CLI:
```bash
# List recent deployments
vercel ls --scope thienha100022653824678-stacks-projects

# Promote last known good deployment ID to Production
vercel promote <DEPLOYMENT_ID> --scope thienha100022653824678-stacks-projects
```

### 4. Emergency Recovery Steps
1. Revert Git `main` branch to commit tag `CLONE_STABLE_V1`.
2. Promote previous deployment on Vercel.
3. Verify `/api/health` status returns `{"status":"ok"}`.
