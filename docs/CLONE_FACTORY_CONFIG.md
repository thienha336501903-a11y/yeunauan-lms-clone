# Clone Factory configuration

The LMS code is shared by every cloned system. Clone identity and public origins
come from environment variables; application handlers must read them through
`utils/clone-config.js` rather than embedding a deployment domain.

System B remains the compatibility default when the new variables are absent.
This keeps the current Production deployment unchanged. A new system must set
all public URL variables from `.env.example` before its first deployment.

Safe client-side values are exposed by `/api/public-config.js`. Secrets remain
server-only and are never included in that response.

Run `npm test` and `npm run check:clone` before deploying a clone.
