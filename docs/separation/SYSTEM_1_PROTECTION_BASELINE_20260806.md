# SYSTEM 1 PROTECTION BASELINE & PROTECTION MANIFEST
**Generated:** 2026-08-06 18:25:12

## 1. Executive Summary
Há»‡ thá»‘ng 1 (Trang Quáº£n trá»‹ vÃ  Trang Há»c viÃªn Tráº£ bÃ i) Ä‘Æ°á»£c báº£o vá»‡ tuyá»‡t Ä‘á»‘i 100%. KhÃ´ng cÃ³ báº¥t ká»³ thay Ä‘á»•i code, biáº¿n mÃ´i trÆ°á»ng, domain, DNS hay thao tÃ¡c ghi dá»¯ liá»‡u nÃ o Ä‘á»‘i vá»›i Há»‡ thá»‘ng 1 trong suá»‘t quÃ¡ trÃ¬nh chuáº©n bá»‹ Há»‡ thá»‘ng 2.

## 2. Verified Deployments & Infrastructure
- **Admin Deployment (dmin-web-tra-bai):** dpl_BEjH3DUJ1kHLLqevmGypXbmjyuSX (Status: READY / HTTP 200 táº¡i /login)
- **Student Deployment (student-web):** dpl_92XTh25gr74NznTbr6vJZDfMo5Mq (Status: READY / HTTP 200 táº¡i /post/8d4844be-b2f2-4c4e-b086-67dd5211abb2)
- **Supabase Production Ref:** crphwjizolsgghapyjjv (Region: p-southeast-1, Health: ACTIVE_HEALTHY)

## 3. Verified Data Boundary & Row Counts
- **public.posts:** 387 rows
- **public.post_views:** 1,000 rows
- **public.student_enrollments:** 16 rows
- **public.gated_posts_access:** 0 rows
- **Canary Post UUID (8d4844be-b2f2-4c4e-b086-67dd5211abb2):** Exists (Title: "Thá»‹t kho má»m tá»›p DuyÃªn DuyÃªn")

## 4. Live Health Check
- https://admin.yeunauan.live/login: HTTP 200 OK (Redirected from /)
- https://www.yeunauan.live/post/8d4844be-b2f2-4c4e-b086-67dd5211abb2: HTTP 200 OK (SSR Matched Path /post/[id])

## 5. Protection Guarantee
- Zero row mutations on crphwjizolsgghapyjjv
- Zero deployment promotions on System 1
- Zero DNS/domain routing changes on System 1
- Zero secret rotations on System 1