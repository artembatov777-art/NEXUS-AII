# Railway deployment

Railway runs the NEXUS AU frontend and API from one Node.js service. The service uses
`server/railway.js` to serve the Vite build and adapt the existing API handlers to
Node's HTTP server. The Vercel deployment can remain available independently, but it
is no longer required by the Railway runtime.

## Railway settings

The repository root must be the project root (leave Root Directory empty).

- Builder: Railpack
- Build command: `npm run build`
- Start command: `npm start`
- Health check path: `/api/health`

These settings are also declared in `railway.json`.

## Required variables

Add these in the Railway service's Variables section:

- `NEXUS_API_TOKEN`: a random secret with at least 32 characters.
- `GEMINI_API_KEY`: only if Gemini is a selected upstream provider.
- `GROQ_API_KEY`: only if Groq is a selected upstream provider.
- `NVIDIA_API_KEY`: only if NVIDIA NIM is a selected upstream provider.
- `NEXUS_DATA_DIR`: set to `/data` after attaching a Railway Volume mounted at `/data` (required for cross-device provider profile sync).

Never use a `VITE_*` variable for a secret. Vite variables are bundled into browser
assets and are not suitable for API keys or gateway tokens.

## First verification

After deployment, open `https://YOUR-RAILWAY-DOMAIN/api/health`. A healthy service
returns JSON with `"status":"ok"`. Then configure the provider in NEXUS:

- Gateway URL: `/api/provider/PROVIDER_ID` for Gemini, Groq or NVIDIA. The older `/api/gemini` route remains only for existing saved configurations.
- Gateway Token: the value of `NEXUS_API_TOKEN` configured in Railway.
- Model: select a model supported by the configured provider.

The browser remembers the shared Railway gateway session using an HttpOnly cookie. Every hosted provider request is dispatched through the same `/api/provider/:provider` handler. Provider API keys remain in Railway Variables and are never sent to the browser.

## Persistent provider profiles

To make saved provider profiles available in Safari and when NEXUS is launched from the iOS Home Screen, attach a Railway Volume to this service with mount path `/data` and set `NEXUS_DATA_DIR=/data`. The protected `/api/profiles` endpoint stores validated profile settings in `/data/provider-profiles.json` using atomic file replacement. In Railway, the server verifies that `NEXUS_DATA_DIR` is actually covered by a non-root mount before reading or writing, so setting the variable without attaching a Volume fails closed instead of silently writing ephemeral data. The browser syncs profiles after the device has been remembered through the NEXUS gateway session. Existing local profiles are merged into the cloud store on first sync. Deletion tombstones are monotonic and profile upserts compare update timestamps to prevent stale devices from restoring deleted profiles or rolling newer settings back. API keys are not included.

The current gateway uses one shared `NEXUS_API_TOKEN`, so devices authenticated with that token share one profile collection. This is intended for the single-owner NEXUS deployment, not multi-user accounts. Without the mounted volume and variable, the app deliberately keeps local profiles and reports that cloud sync is unavailable; it does not pretend ephemeral container storage is durable. This cloud sync currently covers provider profile metadata only, not conversations, memories, projects, knowledge documents, or native OS-vault credentials.

## Important

Railway variables do not inherit from Vercel. Configure the gateway token and provider
keys in Railway itself. Changing variables requires a new Railway deployment/restart,
not a Vercel redeploy. Keep the Vercel project untouched until the Railway service has
passed its health and chat tests.

## Preview CI gate

The Quality workflow reports Web/API tests and build separately from the shared
npm security audit. The existing `frontend` check requires both to pass. The
Native desktop quality workflow covers CLI smoke tests, native tests and bundles,
and audits both Rust lockfiles. The full npm audit covers the build and test tools
shared by Web/API and Desktop, including packages excluded from the runtime audit.

Railway's [Wait for CI](https://docs.railway.com/deployments/github-autodeploys#wait-for-ci)
waits on the commit's GitHub Actions workflows. A passing Web/API job alone does
not clear that gate. Keep Preview isolated from Production credentials, volumes
and external services before starting a manual Preview deployment.

### Draft exception for GHSA-fc5q-39xc-vjpf

**Pending explicit owner approval.** This draft does not configure an exception.
The full npm audit and the independent production dependency audit remain
required by the `frontend` CI check.

- Scope: only GHSA-fc5q-39xc-vjpf in the locked dev-only `picomatch@4.0.7`,
  only for pushes to `feat/nexus-core-architecture` intended for Railway
  Preview. PR and main audits, the production dependency audit, and Desktop
  tests and Rust audits would remain strict.
- Expiration: 2026-11-25 at 00:00 UTC, or immediately when a verified fix
  is available or the dependency becomes reachable from untrusted runtime input.
- Risk: Vite and Vitest use glob matching during build and test. Tracked
  files, configuration and test inputs are under repository control, but
  code and inputs from unreviewed contributors or dependencies can still
  affect CI. A patched dependency is preferable. Restrict any exception
  to reviewed branch commits on hosted runners with read-only permissions
  and no Production secrets. A stalled build is still possible.
- Enforcement if approved: run and retain the full npm audit report. Fail
  closed on tool or registry errors, a changed package version or path,
  expiration, or any other high or critical advisory. Determine transitive
  findings from their underlying advisory records. An affected dependent
  with any additional high or critical cause must still fail. Keep this
  exception visible in the job summary.
- Removal: check the registry and advisory daily until expiry. Once a fixed
  release is verified, update the lockfile, rerun both audits, the Web/API
  and Desktop checks, then remove the exception in the same change.

Railway evaluates workflow conclusions for the commit, including PR runs.
A push-only exception cannot unblock Preview while a strict PR audit on the
same commit fails. Keep that failure visible and use a verified dependency
fix to clear both checks.

### Dependency update tracking

The Dependabot version-update configuration targets
`feat/nexus-core-architecture`, checks npm daily, and includes indirect
dependencies such as `picomatch`. Updates arrive as reviewable pull requests.
GitHub loads this configuration from the default branch, so the copy on
the feature branch is prepared for review. It does not schedule updates yet.
GitHub's Dependabot security updates target the default branch independently
of this version-update configuration.

Review dependency PRs before merging them. A merge into the connected feature
branch changes the commit seen by Railway. Keep Preview behind Wait for CI and
verify that Production autodeploy is disabled before merging dependency updates.
