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
   `DB_PATH=/data/grants.db`, `PORT=3000`, `TRUST_PROXY=1`. Optionally set `ADMIN_PASSWORD` (the log viewer, see Operations), `LOG_DIR`, `GARMIN_MCP_GROUPS`,
   `GARMIN_MCP_ENABLE_GRAPHQL` and `CLIENT_IP_HEADER` (see below). `TRUST_PROXY=1` trusts exactly
   one proxy hop, Traefik.

   **Behind Cloudflare (including Cloudflare Tunnel):** every request then reaches the container
   from the tunnel or Traefik, so `req.ip` is the same for all users and every per-IP limit (the
   sign-in limiter and the SDK OAuth handlers' limiters) becomes global. Set
   `CLIENT_IP_HEADER=cf-connecting-ip`: when that header holds a valid IP it replaces `req.ip`
   for the request. This is safe only if the container is reachable solely through the tunnel or
   Cloudflare (no public port on Traefik answering for this host); otherwise a client can forge
   the header and dodge the limits. At acceptance, sign in once and confirm the logs and limits
   see your real IP.
3. Add a mount: a **named volume** at `/data`. Not a bind mount; see the comment in the Dockerfile.
4. Add three domains. All use host `garmin.ficdev.xyz`, HTTPS on, container port 3000, and
   **Strip Path off**:
   - path `/mcp`
   - path `/.well-known/oauth-protected-resource`
   - path `/.well-known/oauth-authorization-server`
5. Turn Auto Deploy **on**, building `main`. Every push to `main` redeploys the hosted server,
   released or not, so `main` must always be deployable: run `npm run check` before pushing, and
   keep unfinished work on a branch. A release needs no extra step; the version tag points at a
   commit on `main`, which is already live by the time the tag's publish workflow runs.
   (The publish workflow also has a "Deploy the hosted MCP server" step for deploying on tags
   only instead. It skips itself while the GitHub secrets `DOKPLOY_URL`, `DOKPLOY_API_KEY` and
   `DOKPLOY_APPLICATION_ID` are unset, which is the intended state with Auto Deploy on: setting
   them would deploy the same commit twice.)
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
- **Usage stats:** `https://garmin.ficdev.xyz/mcp/stats` (and `/mcp/stats.json`) is public and
  shows the live counts, recomputed at most every 5 minutes. The 90-day trend under it needs a
  snapshot per day, written by `node http.mjs snapshot`. The server never runs it itself: add a
  Dokploy **Schedule** on this application (Schedules tab, type Application), cron `0 * * * *`,
  command `node http.mjs snapshot`. Each run overwrites today's row (UTC), so hourly keeps the
  day's last count and a missed run costs nothing. Run it once by hand after adding it; the trend
  starts from that day, since purged rows cannot be counted back.
- **Logs** are JSON lines of grant prefix, person prefix (`user`, the first 8 characters of the
  grant's keyed pseudonym), RPC method, tool, status and milliseconds. They never
  hold tokens, emails, passwords, Garmin payloads or query strings. Each line goes to stdout (the
  Dokploy log view, which loses it on redeploy) and is also appended to `/data/logs/YYYY-MM.jsonl`,
  one file per UTC month on the data volume, so the history survives restarts and redeploys.
  Nothing deletes those files; prune them by hand if you ever want to. `LOG_DIR` moves them
  (default: `logs` beside `DB_PATH`). To read them, open the Dokploy Terminal and run, say,
  `tail -n 100 /data/logs/$(date -u +%Y-%m).jsonl` or `grep '"tool":"get_sleep_daily"' /data/logs/*.jsonl`.
  To copy them off the server: `docker cp <container>:/data/logs ./logs` on the host.
- **Log viewer:** `https://garmin.ficdev.xyz/mcp/admin`, linked from nowhere and off by default.
  Set `ADMIN_PASSWORD` (a long random one is best, e.g. `openssl rand -base64 24`) and redeploy; without it
  the path is a 404. The browser asks for a user name and password: the user name is ignored, the
  password is `ADMIN_PASSWORD`. Ten wrong passwords from one IP lock it out for 15 minutes, and
  each wrong one is logged as `admin auth failed`. Pick a range (Today to 1 year, or two dates;
  the page reloads on its own). It shows traffic, failure rate, tool latency and sign-ins, a
  per-day chart with failures in red (click a day to see it hour by hour), and sortable tables
  of people, connections, tools, request types, server events and log lines. Click a person to
  open their tools, daily activity, connections and latest requests, and to give them a name that
  stays in your browser. Clicking any other row filters the page to it; active filters show as
  removable chips, and the range and filters live in the URL, so a view can be bookmarked.
  "Download CSV" exports the matching lines. Lines logged before the person prefix existed get
  one from the grants still on record (or from a newer line of the same connection), so only
  purged connections' old lines show no person. One load returns at most 200,000 lines (the
  newest), and the raw lines are at `/mcp/admin/logs.json?from=YYYY-MM-DD&to=YYYY-MM-DD`.

## Known risks

Every user's Garmin traffic, logins especially, leaves from one server IP. Garmin rate-limits
logins and may flag the address under load. What is in place: five failed sign-in attempts per IP
and 100 sign-in attempts in total per 15 minutes, rolling refresh so users rarely sign in again,
and plain-language errors when Garmin answers 429 (each one is logged as `garmin rate limited`).
Multiple egress IPs are out of scope.

The SDK's authorize handler, which this server uses unchanged, redirects parameter errors (a bad
`code_challenge`, say) to the client's registered redirect URI, as OAuth specifies.
