# ENVIRONMENT VARIABLES INVENTORY & CONFIGURATION

## Commerce Project (`yeunauan-commerce-clone`)

| Variable Name | Environment Scope | Purpose | Required |
| :--- | :--- | :--- | :---: |
| `SUPABASE_URL` | Production, Preview, Dev | Supabase project URL (`https://yyiavtiwtekkocqpephr.supabase.co`) | YES |
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview, Dev | Supabase service_role key for backend API queries | YES |
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Dev | Public Supabase URL | YES |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview, Dev | Public anon API key | YES |
| `CLOUDINARY_CLOUD_NAME` | Production, Preview, Dev | Cloudinary Cloud Name for payment proof uploads | YES |
| `CLOUDINARY_API_KEY` | Production, Preview, Dev | Cloudinary API Key | YES |
| `CLOUDINARY_API_SECRET` | Production, Preview, Dev | Cloudinary API Secret | YES |
| `COMMERCE_PUBLIC_URL` | Production, Preview, Dev | Public domain URL (e.g. `https://yeunauan-commerce-clone.vercel.app`) | OPTIONAL |

## LMS Project (`yeunauan-lms-clone`)

| Variable Name | Environment Scope | Purpose | Required |
| :--- | :--- | :--- | :---: |
| `SUPABASE_URL` | Production, Preview, Dev | Supabase project URL (`https://yyiavtiwtekkocqpephr.supabase.co`) | YES |
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview, Dev | Supabase service_role key | YES |
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Dev | Public Supabase URL | YES |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview, Dev | Public anon API key | YES |
| `GOOGLE_CLIENT_ID` | Production, Preview, Dev | Google OAuth Client ID for Student GSI Login | YES |
| `GOOGLE_CLIENT_SECRET` | Production, Preview, Dev | Google OAuth Client Secret for token exchange | YES |
| `LMS_PUBLIC_URL` | Production, Preview, Dev | Public domain URL (e.g. `https://yeunauan-lms-clone.vercel.app`) | OPTIONAL |
