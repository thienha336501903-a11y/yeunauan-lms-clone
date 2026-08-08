# SYSTEM 2 STAGING ARCHITECTURE & ISOLATION SPEC
**Generated:** 2026-08-06 18:25:50

## 1. System Topology & Data Boundaries
- **System 1 (Legacy Core Content):**
  - Admin: dmin.yeunauan.live (Vercel Project dmin-web-tra-bai, Deployment dpl_BEjH3DUJ1kHLLqevmGypXbmjyuSX)
  - Student: www.yeunauan.live/post/<id> (Vercel Project student-web, Deployment dpl_92XTh25gr74NznTbr6vJZDfMo5Mq)
  - Supabase Database: crphwjizolsgghapyjjv (Region p-southeast-1)
  
- **System 2 (Independent Commerce & Portal Learning Staging):**
  - Commerce: shop.yeunauan.live (Vercel Project web-ban-hang-chinh-thuc)
  - LMS Admin: www.daubepnho.store (Vercel Project web-lms-chinh-thuc, Database qozjkfwzmyfunqvcyjv)
  - Portal Learning (New Target): Vercel Project student-portal-learning-yeunauan (Target Domain: portal-learning.yeunauan.live)
  - Portal Learning Database (New Dedicated Ref): mkxwitkcgkvgdjzdrvxk (Status: ACTIVE_HEALTHY, Region: p-southeast-1)

## 2. Isolation Guarantees
1. **Database Boundary:** mkxwitkcgkvgdjzdrvxk is 100% isolated from crphwjizolsgghapyjjv and qozjkfwzmyfunqvcyjv.
2. **Session Cookie Scope:** System 1 session tokens are strictly rejected by System 2. System 2 session tokens are strictly rejected by System 1.
3. **Fail-Closed Secrets:** Platform rejects any cross-system secret sharing.
4. **No Direct Fallback:** System 2 never redirects or falls back to www.yeunauan.live.