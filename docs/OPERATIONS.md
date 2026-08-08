# SYSTEM OPERATIONS & MAINTENANCE MANUAL

## Daily Operations & Monitoring

### Health Checks
- **Commerce Health Endpoint**: `GET https://yeunauan-commerce-clone.vercel.app/api/health`
- **LMS Health Endpoint**: `GET https://yeunauan-lms-clone.vercel.app/api/health`
- **Expected Output**:
  ```json
  {
    "status": "ok",
    "app": "ok",
    "database": "ok",
    "timestamp": "2026-08-08T16:30:00.000Z"
  }
  ```

### Release Workflow
All production changes must follow the strict git feature branch workflow:
1. `git checkout -b feature/xyz`
2. Develop locally & test.
3. Push to GitHub (`thienha336501903-a11y/yeunauan-commerce-clone` or `yeunauan-lms-clone`).
4. Verify Vercel Preview deployment URL.
5. Merge into `main` branch.
6. Deploy to Vercel Production (`vercel --prod`).

### Security Best Practices
- **Least Privilege**: `anon` role is granted SELECT on public content tables (`courses`, `lessons`, `site_config`, `course_slug_mappings`) and INSERT-only on `orders`.
- **Admin API**: Secured via `service_role` key and Vercel serverless environment variables.
- **No Secrets in Client**: Never output `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, or API secrets in frontend JS or HTML.
