# garmin.ficdev.xyz product site — design

Date: 2026-10-07. Status: approved in conversation, awaiting written-spec review.
Home: this spec lives in the library repo until the new site repo exists, then moves there.

## 1. Intent

**Goal.** Turn `garmin.ficdev.xyz` from a single demo page into the one place where someone
learns what garminconnect-js can do and starts using it, either in Claude with no install or as
a developer with npm.

**Audience, in priority order (user decision: "both, Claude connector first").**
1. People who want their Garmin data in Claude, mostly non-developers. They arrive from a link
   or the Claude app and need: what it does, the connector URL, three steps, what to ask, and
   whether their data is safe.
2. Developers using the library. They need install, auth, examples, the workout builder, and a
   reference for all 193 methods.

**Decisions made in conversation.**
- A NEW repo, `DynamicsNinja/garminconnect-site` (name may change). `garminconnect-nextjs-starter`
  stays a clean, clonable starter; the demo code is copied, not moved, and the two may diverge.
- Docs are FULL and SYNCED AUTOMATICALLY: rendered at build time from the docs the
  `garminconnect-js` and `@dynamicsninja/garminconnect-mcp` npm packages ship, plus a reference
  generated from `garminconnect-js/manifest`. No hand-copied docs.
- The demo moves AS IS to `/demo`: sample data for visitors, optional sign-in with your own Garmin
  account (tokens in an encrypted cookie in your browser).
- One Next.js app (App Router) for landing, setup, docs and demo; no docs framework.
- Visual choices (from mockups): landing **B "two doors"**; `/claude` **C "tabs + things to
  ask"**; reference **A "one filterable table + a page per method"**.

**Success criteria.**
1. A phone visitor reaches "copy the URL" in one tap from the landing page, and the `/claude` page
   opens on the tab for their device.
2. Every page the library's npm package documents is on the site, and a library release reaches
   the site by merging one Dependabot PR.
3. CI fails if a docs link is broken, a required README section disappears, or a manifest method
   has no reference page.
4. `https://garmin.ficdev.xyz/demo` behaves exactly like today's demo; `/mcp` is untouched.

## 2. Routes

| Route | Content | Source |
|---|---|---|
| `/` | Landing: headline, two cards ("Use it in Claude" primary and larger, "Build with it"), then three tiles (What can I ask? · Workout builder · Live demo) | site-authored |
| `/claude` | Connector URL + copy button; tabs claude.ai & mobile / Claude Desktop / Claude Code / Other MCP clients (preselected from the user agent); compact 3-step instructions; "Things to ask" grouped by topic; "What's stored"; "Disconnect"; FAQ; link to the Desktop Extension for local use | site-authored, facts from `@dynamicsninja/garminconnect-mcp` README and PRIVACY |
| `/docs` | Getting started (install, Node runtime only, minimal example) | README sections |
| `/docs/authentication` | Auth, MFA, token stores | README "Authentication" |
| `/docs/examples` | Code examples | README "Code examples" |
| `/docs/workouts` | Workout builder guide | `WORKOUTS.md` |
| `/docs/api/[category]` | 13 category guides (activities, wellness, gear, …) | `docs/api/*.md` |
| `/docs/reference` | All methods: one table, filters by category / safety (read, write, destructive) / Connect+ | `GARMIN_METHODS` |
| `/docs/reference/[method]` | One method: signature, parameters (from JSON schema: type, optional, description), safety class, Connect+, category (links to its guide), Claude tool name | `GARMIN_METHODS` |
| `/docs/self-host` | Desktop Extension, npm stdio server | `@dynamicsninja/garminconnect-mcp` README |
| `/docs/changelog` | Release history | `CHANGELOG.md` |
| `/demo` | Today's demo (sleep & HRV dashboard), moved unchanged in behaviour | copied from the starter |
| `/privacy` | One page: the Claude connector (grant row, nothing else stored) and the demo (cookie-only tokens) | site-authored; replaces the demo's `/privacy` at the same URL |
| `/mcp`, `/.well-known/oauth-*` | Not this app — the MCP container (Traefik routes by path) | — |

Navigation: top bar with the wordmark, Claude · Docs · Demo · GitHub, and search (Ctrl K / a
search button on mobile). Docs pages: left sidebar (Guides, API, Reference), content, "On this
page" list on wide screens; the sidebar collapses to a menu on mobile.

## 3. Docs pipeline

- The site depends on exact versions of `garminconnect-js` and `@dynamicsninja/garminconnect-mcp`.
  At build time a loader reads their shipped files from `node_modules` (`README.md`,
  `WORKOUTS.md`, `CHANGELOG.md`, `docs/api/*.md`; the MCP package's `README.md`).
- README splitting: the loader extracts named sections (by heading text) into the docs pages
  above. The list of required headings lives in one config file; a missing heading fails the
  build with its name.
- Rendering: `remark` + `rehype`, GitHub-flavoured markdown, heading anchors, `shiki` highlighting
  at build time (no client-side highlighter), emoji in headings stripped from anchors.
- Link rewriting: links to files the site renders become site routes (`docs/api/gear.md` →
  `/docs/api/gear`, `WORKOUTS.md` → `/docs/workouts`, README anchors → the page that section
  landed on); every other relative link becomes a GitHub URL at the tag `v<version>`; images
  likewise resolve to GitHub raw at that tag. A link that resolves nowhere fails the build.
- Reference: generated from `GARMIN_METHODS` (name, category, description, params with JSON
  schema and roles, safety, io, requiresConnectPlus). Claude tool name = the MCP server's
  snake_case rule (`getSleepData` → `get_sleep_data`), computed the same way and pinned by a test
  against a few known names.
- Search: a build-time index of guide sections (page, heading, text) and methods (name,
  description, category), searched in the browser with one small library (MiniSearch or
  equivalent). No external service.
- Updates: Dependabot (daily) for the two packages. CI runs on the PR; merging to `main`
  deploys.

## 4. Look and feel

- Branding matches the library and the new login page: the README wordmark
  (`docs/assets/title-light.svg` / `title-dark.svg`, embedded), the `#0969DA → #0A8F7F`
  gradient for primary actions, GitHub-like neutrals.
- Light and dark mode follow the system. Mobile-first; nothing scrolls sideways at 360 px.
- Open Graph image: the library's `docs/assets/social-preview.png`.
- No analytics, no third-party scripts, no external fonts.
- `/claude` steps ship as text; screenshots are a later addition (image files only).

## 5. The demo

- Copied from `garminconnect-nextjs-starter` (`src/app/page.tsx`, `actions.ts`, components,
  `lib/*`) under `/demo`, keeping its modes and env: `GARMIN_PUBLIC=1`, `SESSION_SECRET`
  (unchanged value, so existing visitors stay signed in), optional `PRIVACY_CONTACT`.
- Its sign-in form is restyled to the branded login look; its behaviour (rate limit, MFA across
  requests, cookie token store) is unchanged.
- Cookie path stays `/` so existing sessions remain valid.

## 6. Quality gates (CI)

- Typecheck, lint, `next build`.
- Build-time checks: required README sections present; every internal link resolves; one
  reference page per manifest method; tool-name rule matches known MCP names.
- Playwright smoke at 375 px and 1280 px: landing (both cards, copy button), `/claude` (tab
  preselected for a mobile UA, copy works), one guide page, `/docs/reference` filtering, one
  method page, `/demo` with sample data.

## 7. Deployment

- Dockerfile, Next.js `output: "standalone"`, Node 22, non-root.
- Replaces the current demo application in Dokploy on `garmin.ficdev.xyz` path `/`; the MCP
  container keeps `/mcp` and `/.well-known/oauth-*` (longer Traefik rules win). The site sits
  behind the same Cloudflare Tunnel.
- Env: `SESSION_SECRET` (copied from the demo app), `GARMIN_PUBLIC=1`, optional `PRIVACY_CONTACT`.
- Auto-deploy on push to `main` in the site repo (it has no npm release cycle of its own).

## 8. Out of scope (v1)

Localisation; versioned docs (the site documents the pinned version only); a blog; a bigger
demo; screenshots on `/claude`; changes to the MCP server or the library.
