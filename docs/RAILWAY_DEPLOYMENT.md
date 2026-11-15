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
- `DEEPSEEK_API_KEY`: only if DeepSeek is a selected upstream provider.
- `NVIDIA_API_KEY`: only if NVIDIA NIM is a selected upstream provider.

Never use a `VITE_*` variable for a secret. Vite variables are bundled into browser
assets and are not suitable for API keys or gateway tokens.

## First verification

After deployment, open `https://YOUR-RAILWAY-DOMAIN/api/health`. A healthy service
returns JSON with `"status":"ok"`. Then configure the provider in NEXUS:

- Gateway URL: `/api/provider/PROVIDER_ID` for Gemini, DeepSeek or NVIDIA. The older `/api/gemini` route remains only for existing saved configurations.
- Gateway Token: the value of `NEXUS_API_TOKEN` configured in Railway.
- Model: select a model supported by the configured provider.

The browser remembers the shared Railway gateway session using an HttpOnly cookie. Every hosted provider request is dispatched through the same `/api/provider/:provider` handler. Provider API keys remain in Railway Variables and are never sent to the browser.

## Important

Railway variables do not inherit from Vercel. Configure the gateway token and provider
keys in Railway itself. Changing variables requires a new Railway deployment/restart,
not a Vercel redeploy. Keep the Vercel project untouched until the Railway service has
passed its health and chat tests.
