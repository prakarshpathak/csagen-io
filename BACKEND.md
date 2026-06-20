# Send for Signature - serverless DocuSign endpoint

The CSA Generator is a static page. "Send for Signature" POSTs the generated
document + signer to a small serverless endpoint that holds the DocuSign
credentials (which can never live in the public client) and creates a DocuSign
envelope for signature.

```
Browser (index.html)  --POST /api/sign-->  serverless function  --DocuSign API-->  envelope sent
```

Files:
- `lib/docusign.js` - framework-agnostic core (zero dependencies; JWT via `node:crypto`, built-in `fetch`).
- `api/sign.js` - Vercel function wrapper.
- `server.js` - plain Node HTTP server wrapper (Hostinger / any VPS).
- `package.json` - `type: module`, Node >= 18, no dependencies.

## DRY-RUN first (no DocuSign needed)
If the DocuSign env vars are not set, the endpoint runs in **DRY-RUN**: it
validates the request and returns what it *would* send. Use this to confirm the
browser -> function loop before touching DocuSign.

```
npm start            # or: node server.js   (listens on :3000)
curl -X POST localhost:3000/api/sign -H 'Content-Type: application/json' \
  -d '{"signer":{"name":"Acme","email":"legal@acme.com"},"document":{"html":"<p>hi</p>"}}'
# -> { "ok": true, "dryRun": true, ... }
```

## Option A - Vercel (recommended)
Hosts the static app **and** the function on one origin, so there's no CORS to manage.

1. Push this repo and import it at vercel.com (no build step; it auto-detects `api/`).
2. Add the env vars below in Project Settings -> Environment Variables.
3. In `index.html`, set `WEBHOOK_URL`. Same-origin, so a relative path works:
   ```js
   const WEBHOOK_URL = "/api/sign";
   ```
4. Redeploy. (You can keep GitHub Pages too, but then set `WEBHOOK_URL` to the
   full `https://<app>.vercel.app/api/sign` and set `ALLOWED_ORIGIN` to the Pages URL.)

## Option B - Hostinger / VPS
1. Upload the repo, ensure Node >= 18.
2. Set the env vars (panel or a process manager), then `node server.js` (or `npm start`).
3. Reverse-proxy it so `POST https://<your-host>/api/sign` reaches the app.
4. In `index.html` set `WEBHOOK_URL = "https://<your-host>/api/sign"` and set
   `ALLOWED_ORIGIN` to wherever the page is served from.

## DocuSign setup (JWT / server-to-server)
1. DocuSign Admin -> **Apps and Keys**: create an app, copy the **Integration Key**.
2. Add an **RSA keypair**; keep the **private key**.
3. Copy your **API Account ID** and **User ID** (the user to impersonate).
4. Grant consent once (one-time admin consent URL):
   ```
   https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=<INTEGRATION_KEY>&redirect_uri=https://www.docusign.com
   ```
   (use `account.docusign.com` for production)
5. Start in the **demo** environment, then switch the two `DS_*_BASE` vars for prod.

### Environment variables
| Var | Required | Notes |
|---|---|---|
| `DS_INTEGRATION_KEY` | yes | app integration key (client id) |
| `DS_USER_ID` | yes | impersonated user GUID |
| `DS_ACCOUNT_ID` | yes | API account id |
| `DS_PRIVATE_KEY` | yes | RSA private key PEM (escape newlines as `\n` in the env var) |
| `DS_OAUTH_BASE` | no | `account-d.docusign.com` (demo, default) / `account.docusign.com` (prod) |
| `DS_REST_BASE` | no | `https://demo.docusign.net` (default) / `https://www.docusign.net` (prod) |
| `ALLOWED_ORIGIN` | no | CORS origin; default `*`. **Lock to your app URL in production.** |

Leave the four `DS_*` required vars unset to stay in DRY-RUN.

## Notes / caveats
- **Document fidelity:** the doc is sent as HTML and DocuSign converts it to PDF.
  Tables/fonts/colors render well; verify section numbering (CSS counters) on a
  real envelope. The cleaner long-term path is a pre-built **DocuSign template**
  (cover-page merge fields) approved by legal - send field values instead of a doc.
- **Signature placement** uses anchor tabs on the "Signature"/"Date" labels already
  in the document.
- **Security:** lock `ALLOWED_ORIGIN`, keep `DS_PRIVATE_KEY` only in env (never in
  the repo). Margin/cost data is never sent to this endpoint - the browser only
  posts public contract data.
