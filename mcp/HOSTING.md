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
   `GARMIN_MCP_ENABLE_GRAPHQL`.
3. Add a mount: a **named volume** at `/data`. Not a bind mount; see the comment in the Dockerfile.
4. Add three domains. All use host `garmin.ficdev.xyz`, HTTPS on, container port 3000, and
   **Strip Path off**:
   - path `/mcp`
   - path `/.well-known/oauth-protected-resource`
   - path `/.well-known/oauth-authorization-server`
5. Turn Auto Deploy **off**. Create an API key (Settings, Profile, API keys) and add the GitHub
   secrets `DOKPLOY_URL`, `DOKPLOY_API_KEY` and `DOKPLOY_APPLICATION_ID`. The release workflow
   then deploys on each version tag. Tag a commit on `main`, because Dokploy builds `main`.
6. Deploy once by hand with the Deploy button. Then check:
   - `curl https://garmin.ficdev.xyz/mcp/healthz` returns `ok`.
   - `curl -i -X POST https://garmin.ficdev.xyz/mcp` returns `401` with a `resource_metadata`
     header.

To check the server end to end against the test account, run `npm run smoke:http`. It uses an
in-memory grant store and needs `GARMIN_EMAIL`, `GARMIN_PASSWORD` and `GARMIN_TEST_PROFILE_ID`.

## Operations

- **Revoke one connection:** `node http.mjs revoke <grant_id>`. In Dokploy, open the app and use
  Terminal. The grant id prefix is in the logs.
- **Revoke everyone:** `node http.mjs revoke --all`.
- **Rotate the key:** prepend a new key to `SEAL_KEYS`, redeploy, and drop the old key after 35
  days. The first key seals; every key unseals.
- **Logs** are JSON lines of grant prefix, RPC method, tool, status and milliseconds. They never
  hold tokens, emails, passwords, Garmin payloads or query strings.

## Known risk

Every user's Garmin traffic, logins especially, leaves from one server IP. Garmin rate-limits
logins and may flag the address under load. What is in place: five sign-in attempts per IP per 15
minutes, rolling refresh so users rarely sign in again, and plain-language errors when Garmin
answers 429. Multiple egress IPs are out of scope.
