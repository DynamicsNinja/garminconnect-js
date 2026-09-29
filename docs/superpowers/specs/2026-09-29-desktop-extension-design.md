# garminconnect-mcp Desktop Extension (.mcpb) — design

Date: 2026-09-29. Status: approved in conversation, awaiting written-spec review.

## 1. Intent

**Goal.** Anyone — not only developers — installs the Garmin MCP server in Claude Desktop by
double-clicking one file: no Node install, no `npm install -g`, no config editing, no terminal,
and the server shows an icon in Claude Desktop.

**Why now.** 0.7.x works but needs a global npm install plus a hand-edited config (the `npx`
route breaks when Claude Desktop starts several copies at once), and Claude Desktop ignores the
server-reported icon for hand-configured servers. A Desktop Extension (`.mcpb`) fixes all three.

**Constraints.**
- The npm packages are unchanged in shape: `garminconnect-js` keeps zero dependencies;
  `@dynamicsninja/garminconnect-mcp` keeps its current install route and terminal `login`.
- Sign-in must work with no terminal, support Garmin MFA, and never route the password through
  Claude, the chat, logs, or stored settings (user decision: **local sign-in page**).
- Releases still need the maintainer's explicit go-ahead.

**Success criteria.**
1. Double-clicking the `.mcpb` on Windows installs the extension; the icon and Garmin tools appear.
2. With no saved session, asking for Garmin data leads Claude to `sign_in_to_garmin`, a local page
   opens, the user signs in (with MFA if required), and the next request succeeds — no restart.
3. The `.mcpb` is built and attached to the GitHub Release by the tag-driven workflow.

## 2. Format facts (verified 2026-09-29 against modelcontextprotocol/mcpb MANIFEST.md)

- `manifest_version: "0.4"`; required: `manifest_version`, `name`, `version`, `description`,
  `author.name`, `server`.
- Node server: `server: { type: "node", entry_point, mcp_config: { command: "node",
  args: ["${__dirname}/server/index.mjs"], env: { KEY: "${user_config.x}" } } }`.
- `icon`: PNG (relative path). `user_config` types `string | number | boolean | directory | file`
  with `title`, `description`, `required`, `default`, `sensitive`.
- `compatibility: { platforms, runtimes: { node } }`; `tools` + `tools_generated`;
  `privacy_policies` (URLs) for extensions talking to external services; `long_description`.
- The manifest spec does not say whether Claude Desktop supplies Node; Anthropic's announcement
  says it ships one for Node extensions. **Verified during implementation on the maintainer's
  machine** (§6); if it does not, the README states Node ≥ 18 as a requirement.

## 3. The package

Built by `npm run build:mcpb -w mcp` into `mcp/dist-mcpb/garminconnect-mcp-<version>.mcpb`
(gitignored), containing exactly:

- `server/index.mjs` — the server bundled with **all** dependencies inlined (MCP SDK, ajv, the
  library), a separate tsup build from the npm `dist/cli.js` (which keeps the SDK/ajv external).
  Runs with no `node_modules`. It is `.mjs` because the extension folder has no `package.json`
  to say `"type": "module"`: Node 22 detects ESM from the source, but Node 18 and 20 load a `.js`
  file as CommonJS and fail on the first `import` (found by CI on Node 18).
- `icon.png` — 512×512, rasterized at build time from the same SVG as `mcp/src/icon.ts` (which
  is refactored to export the SVG string so both use one source).
- `manifest.json` — generated from `mcp/extension/manifest.template.json` plus `mcp/package.json`
  (version, description), so the version cannot drift:
  - `name: "garminconnect-mcp"`, `display_name: "Garmin Connect (unofficial)"`, `author`,
    `homepage`/`repository`/`support` links, `license: "MIT"`, `keywords`.
  - `server` as in §2 with `env`: `GARMIN_MCP_GROUPS: "${user_config.groups}"`,
    `GARMIN_MCP_DOWNLOAD_DIR: "${user_config.download_dir}"`,
    `GARMIN_MCP_ENABLE_GRAPHQL: "${user_config.enable_graphql}"`.
  - `user_config` (all optional): `groups` (string, default empty = all), `download_dir`
    (directory, default `${HOME}/Downloads/garmin`), `enable_graphql` (boolean, default false).
    The server treats an empty string as unset and `"true"` as enabled for GraphQL (today only
    `"1"`); `loadConfig` is extended accordingly, with tests.
  - `compatibility: { platforms: ["darwin","win32","linux"], runtimes: { node: ">=18.0.0" } }`.
  - `tools`: the four workout tools plus `sign_in_to_garmin`, and `tools_generated: true`.
  - `privacy_policies: ["https://github.com/DynamicsNinja/garminconnect-js/blob/main/mcp/PRIVACY.md"]`.
- Tooling (dev dependencies only, in `mcp/`): `@anthropic-ai/mcpb` (`validate`, `pack`) and an
  SVG→PNG rasterizer (`@resvg/resvg-js`).

## 4. Sign-in without a terminal

### 4.1 Tool `sign_in_to_garmin` (`mcp/src/signin-tool.ts`)

Hand-written, always registered, no arguments, `readOnlyHint: false`, `destructiveHint: false`.
- Signed in already (session loads and `getUserProfile` succeeds): returns "Already signed in to
  Garmin as <displayName>." and changes nothing.
- Otherwise: ensures the sign-in page (§4.2) is running, opens its URL in the default browser, and
  returns "A Garmin sign-in page opened in your browser: <url>. Sign in there (including any MFA
  code), then tell me when you're done." The URL is included so the user can open it manually.
- `LOGIN_HINT` (used by every "not logged in"/"session expired" error) becomes: "call the
  `sign_in_to_garmin` tool to sign in (or run `garminconnect-mcp login` in a terminal), then try
  again".

Opening the browser: `start "" <url>` via `cmd /c` on win32, `open` on darwin, `xdg-open`
elsewhere; spawned detached, output ignored, failures ignored (the URL is in the result). The
opener is injected so tests never launch a browser.

### 4.2 Sign-in page (`mcp/src/signin-page.ts`)

A `node:http` server started on demand:
- Binds `127.0.0.1`, port 0 (random). URL: `http://127.0.0.1:<port>/<key>` with `key` = 32 random
  bytes, base64url.
- Every request must have `Host: 127.0.0.1:<port>` and path `/<key>` (GET/POST); anything else
  → 404 with an empty body. POSTs must carry `key` as a form field too.
- Responses: `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline';
  form-action 'self'`, `Cache-Control: no-store`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`. Pages are self-contained HTML; no external resources.
- Flow: GET → email/password form. POST `step=credentials` → `client.login(email, password)`;
  `success` → save + done; `mfa_required` → keep `mfaState` in memory (never in the page) and show
  the MFA form. POST `step=mfa` → `client.resumeLogin(mfaState, code)` → done. Errors re-show the
  current step with the library's message (HTML-escaped); the password field is never re-filled.
- Done: tokens are saved through a `FileTokenStore` on the configured token dir (the client's own
  store does this on login), `session.reset()` is called so the running server uses the new
  session, the page says "Signed in as <displayName>. You can close this tab and go back to
  Claude.", and the HTTP server closes after that response.
- Lifetime: at most one instance; a second `sign_in_to_garmin` while it runs returns the same URL.
  It closes after success or 15 minutes without a request (injectable clock/timer for tests).
- The password exists only in the request handler's scope for the `login` call; it is never
  logged, stored, echoed, or included in any tool result.

## 5. Docs and release

- `mcp/README.md`: "Set up" leads with "Download `garminconnect-mcp-<version>.mcpb` from the
  latest GitHub Release and double-click it; then ask Claude anything about your Garmin data and
  sign in when asked." The npm/global route moves to "Other ways to install".
- New `mcp/PRIVACY.md`: runs locally; talks only to Garmin (connect.garmin.com / sso.garmin.com);
  stores the Garmin session in the token folder on this computer; sends nothing elsewhere; no
  telemetry.
- `AGENTS.md` §9 and `CHANGELOG.md` updated.
- `.github/workflows/publish.yml`: after both npm publishes, `npm run build:mcpb -w mcp`, then
  `gh release create vX.Y.Z --verify-tag --generate-notes` (or upload if it exists) with the
  `.mcpb` attached. The job gains `contents: write`.
- Ships as **0.8.0** (new capability). No release without the maintainer's go-ahead.

## 6. Testing

- `mcp/tests/signin-page.test.ts` (real HTTP against the page, fake login client): key/host
  checks (404 for wrong key, missing key, wrong Host); credentials without MFA; with MFA; wrong
  password re-shows the form with the error and without the password; success saves tokens,
  resets the session and closes the server; second start returns the same URL; idle timeout
  closes it (fake timer); no response body or log line ever contains the password.
- `mcp/tests/signin-tool.test.ts`: already-signed-in path changes nothing; not-signed-in path
  returns the URL and calls the injected opener once; the new `LOGIN_HINT` text.
- `mcp/tests/mcpb.test.ts` (runs when `dist-mcpb` exists; `check -w mcp` builds it first):
  `mcpb validate` passes; manifest version equals `mcp/package.json`; archive contents are exactly
  `manifest.json`, `icon.png`, `server/index.mjs`; `server/index.mjs` copied alone into an empty
  temp dir answers an MCP initialize + `tools/list`.
- `loadConfig`: empty strings are unset; `enable_graphql` accepts `"true"` and `"1"`.
- Manual, once, on the maintainer's Windows machine: double-click install; icon and tools appear;
  sign-in page flow with the real account; a follow-up read (e.g. sleep) succeeds.

## 7. Out of scope

Submission to Anthropic's extension directory; macOS/Linux manual install checks; signing the
bundle; a sign-out tool; storing credentials anywhere.
