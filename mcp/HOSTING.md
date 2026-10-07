# Hosting the MCP server

Operator runbook for the hosted server at `https://garmin.ficdev.xyz/mcp`. Users do not need this;
see [README.md](README.md). The code is in `src/http/`, the image is built by `mcp/Dockerfile`,
and the bundle is `dist-http/http.mjs`. It is not published to npm.

## What runs where

```
garmin.ficdev.xyz ── Traefik (Dokploy)
   ├─ /mcp…                                   → garminconnect-mcp-http container
   ├─ /.well-known/oauth-protected-resource…  → same container
   ├─ /.well-known/oauth-authorization-server → same container
   └─ everything else                         → Next.js demo (unchanged)
```

The server needs Node 22.13 or newer (`node:sqlite`). The image provides it. To run the hosted
server on your own machine, use the same Node version.

## Dokploy setup

1. Create a new Application. Source is this GitHub repo, branch `main`, build type Dockerfile,
   Dockerfile path `mcp/Dockerfile`, build context `.`.
2. Set the environment: `PUBLIC_URL=https://garmin.ficdev.xyz`, `SEAL_KEYS=<openssl rand -base64 32>`,
   `DB_PATH=/data/grants.db`, `PORT=3000`, `TRUST_PROXY=1`. Optionally set `GARMIN_MCP_GROUPS` and
   `GARMIN_MCP_ENABLE_GRAPHQL`. `TRUST_PROXY=1` trusts exactly one proxy hop, Traefik. If
   Cloudflare proxying (the orange cloud) is turned on for the domain, every request's IP becomes
   a Cloudflare edge IP and the per-IP limits stop meaning anything: keep the DNS record "DNS
   only", or change the `trust proxy` setting to match.
3. Add a mount: a **named volume** at `/data`. Not a bind mount; see the comment in the Dockerfile.
4. Add three domains. All use host `garmin.ficdev.xyz`, HTTPS on, container port 3000, and
   **Strip Path off**:
   - path `/mcp`
   - path `/.well-known/oauth-protected-resource`
   - path `/.well-known/oauth-authorization-server`
5. Turn Auto Deploy **off**. Create an API key (Settings, Profile, API keys) and add the GitHub
   secrets `DOKPLOY_URL`, `DOKPLOY_API_KEY` and `DOKPLOY_APPLICATION_ID`. The release workflow
   then deploys on each version tag. Dokploy builds the HEAD of `main`, not the tagged commit, so
   tag the commit at `main`'s tip; a tag on an older commit deploys whatever `main` holds now.
6. Deploy once by hand with the Deploy button. Then check:
   - `curl https://garmin.ficdev.xyz/mcp/healthz` returns `ok`.
   - `curl -i -X POST https://garmin.ficdev.xyz/mcp` returns `401` with a `resource_metadata`
     header.

To check the server end to end against the test account, run `npm run smoke:http`. It uses an
in-memory grant store and needs `GARMIN_EMAIL`, `GARMIN_PASSWORD` and `GARMIN_TEST_PROFILE_ID`.

## Operations

- **Revoke one connection:** `node http.mjs revoke <grant_id>`, run in the container (Dokploy: open
  the app, then Terminal). It needs the full 22-character id, but the logs carry only the first 8
  characters. Look the full id up from the log prefix:
  `node -e "const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync('/data/grants.db').prepare('SELECT grant_id, client_name, state FROM grants WHERE grant_id LIKE ?').all(process.argv[1]+'%'))" <prefix>`
  Then run `node http.mjs revoke <full grant_id>`.
- **Revoke everyone:** `node http.mjs revoke --all`.
- **Rotate the key:** prepend a new key to `SEAL_KEYS` and redeploy. The first key seals; every
  key unseals. **Keep the old keys in `SEAL_KEYS`**: client ids are sealed without an expiry and
  never re-issued, so they only ever unseal under the key they were made with. Drop an old key only
  if it was compromised, and know that doing so disconnects every user who connected before the
  rotation: each has to remove and re-add the connector.
- **Logs** are JSON lines of grant prefix, RPC method, tool, status and milliseconds. They never
  hold tokens, emails, passwords, Garmin payloads or query strings.

## Known risks

Every user's Garmin traffic, logins especially, leaves from one server IP. Garmin rate-limits
logins and may flag the address under load. What is in place: five failed sign-in attempts per IP
and 100 sign-in attempts in total per 15 minutes, rolling refresh so users rarely sign in again,
and plain-language errors when Garmin answers 429 (each one is logged as `garmin rate limited`).
Multiple egress IPs are out of scope.

The SDK's authorize handler, which this server uses unchanged, redirects parameter errors (a bad
`code_challenge`, say) to the client's registered redirect URI, as OAuth specifies.
