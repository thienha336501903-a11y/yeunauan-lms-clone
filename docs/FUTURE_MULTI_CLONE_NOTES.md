# ARCHITECTURAL NOTES FOR FUTURE MULTI-CLONE EXPANSION

> **NOTE**: This document outlines conceptual design notes for future multi-tenant/multi-clone scalability. **DO NOT IMPLEMENT THESE ARCHITECTURES IN THE CURRENT PHASE.** Keep the current single-clone system simple, robust, and stable.

## Future Architecture Concepts (For Future Phases Only)

1. **Centralized Course Content Hub**:
   - Canonical Course ID mapping across multiple storefront clones.
   - Master course metadata service syncing course catalog updates to downstream storefront databases.

2. **Multi-Tenant Drive Media Orchestrator**:
   - Single central Google Drive media bucket with delegated folder structures (`/CLONE_A/`, `/CLONE_B/`).
   - Granular permission scopes for per-clone uploads.

3. **Per-Clone Isolated Commerce Databases**:
   - Each franchisee / clone instance maintains its own isolated Supabase database for orders, students, and payment config.

4. **Domain Independence**:
   - Use dynamic environment variables (`COMMERCE_PUBLIC_URL`, `LMS_PUBLIC_URL`) so custom domains can be bound instantly without code modifications.
