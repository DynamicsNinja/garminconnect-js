# @dynamicsninja/garminconnect-mcp

Talk to Claude to create Garmin workouts, and read or manage the rest of your Garmin Connect data,
through an [MCP](https://modelcontextprotocol.io) server built on
[garminconnect-js](https://github.com/DynamicsNinja/garminconnect-js).

> "Make me a 6×400 m session at 5k pace with 2-minute jog recoveries, put it on Thursday, and send
> it to my watch."

Claude previews the workout, waits for your OK, saves it to your Garmin workout library, schedules
it, and pushes it to your device.

Unofficial: not made by, or affiliated with, Garmin.

## What you need

- [Node.js](https://nodejs.org) 18 or newer (`node --version` to check).
- A Garmin Connect account.
- [Claude Desktop](https://claude.ai/download), or any other MCP client (see
  [Other MCP clients](#other-mcp-clients)).

## Set up

### Easiest: the Claude Desktop Extension

1. Download `garminconnect-mcp-<version>.mcpb` from the
   [latest release](https://github.com/DynamicsNinja/garminconnect-js/releases/latest).
2. Double-click it (or drag it onto Claude Desktop's Settings → Extensions) and choose **Install**.
3. Ask Claude something about your Garmin data. The first time, Claude opens a Garmin sign-in page
   in your browser; sign in there (with your MFA code if you use one) and tell Claude you're done.

Optional settings (tool groups, download folder) are under Settings → Extensions → Garmin Connect.

### Other ways to install: npm

#### 1. Install

```sh
npm install -g @dynamicsninja/garminconnect-mcp
```

Install it once rather than running it through `npx`: Claude Desktop starts several copies of a
server at the same moment, and parallel `npx` installs into one cache folder can break each other
(`ERR_MODULE_NOT_FOUND … ajv/dist/2020.js`).

#### 2. Sign in to Garmin

In a terminal (your password never passes through Claude):

```sh
garminconnect-mcp login
```

It asks for your Garmin email (or, on older accounts, your username), password and, if you use it, your MFA code. The session is saved to
`~/.garminconnect-mcp/tokens` and renews itself as long as it is used at least once every 30 days.

#### 3. Add it to Claude Desktop

Settings → Developer → **Edit Config**, and add a `garmin` entry to `claude_desktop_config.json`.
Point `node` at the installed server. To find the path, run `npm root -g` and append
`/@dynamicsninja/garminconnect-mcp/dist/cli.js`.

**Windows** (use forward slashes):

```json
{
  "mcpServers": {
    "garmin": {
      "command": "node",
      "args": ["C:/Users/<you>/AppData/Roaming/npm/node_modules/@dynamicsninja/garminconnect-mcp/dist/cli.js"]
    }
  }
}
```

**macOS / Linux**:

```json
{
  "mcpServers": {
    "garmin": {
      "command": "node",
      "args": ["/usr/local/lib/node_modules/@dynamicsninja/garminconnect-mcp/dist/cli.js"]
    }
  }
}
```

If `node` itself is not found (common with nvm), use its full path from `which node` as `command`.

#### 4. Restart Claude Desktop

**Quit it completely**: tray / menu-bar icon → Quit. Closing the window leaves it running, and it
will not read the new config. Start it again, open a new chat, and the Garmin tools appear under
the tools icon in the message box.

## Using it

Just ask. Some things to try:

- "Create a strength workout: 3 rounds of 10 back squats at 60 kg, 12 push-ups and a 1-minute
  plank, 90 s rest between rounds."
- "Build a swim set for a 25 m pool: 400 easy, 8×100 free on 15 s rest, 200 cool-down."
- "Schedule that workout for Thursday and send it to my watch."
- "How did I sleep last night, and what's my training readiness today?"
- "Summarise my last run: distance, pace, average heart rate and training effect."
- "What are my race predictions, and how has my HRV trended this month?"

**Workouts are always previewed first.** Claude shows the workout in readable form (steps, targets,
paces in /km and /mi) and saves nothing until you confirm. Exercise names are checked against
Garmin's catalogue, and a mistake in a workout comes back to Claude with exactly where it is, so
it can fix it.

**Claude Desktop asks before each tool call.** You can allow a tool once or always. Tools that
delete or overwrite data (deleting activities, workouts, gear, weigh-ins, and so on) are marked
destructive, and Claude is told to confirm with you before using them.

## What it can do

- **`sign_in_to_garmin`**: signs you in through a page that opens in your browser, MFA included —
  no terminal needed. See [Easiest: the Claude Desktop Extension](#easiest-the-claude-desktop-extension) above.
- **Workouts**: `preview_workout`, `create_workout`, `update_workout`, `search_exercises`, for
  running, cycling, swimming, strength, HIIT, yoga, pilates, mobility, cardio, rucking and
  multi-sport; plus listing, scheduling, sending to your watch and deleting.
- **Everything else in garminconnect-js**: sleep, HRV, stress, Body Battery, training readiness and
  status, race predictions, activities (list, details, download, upload files, RPE and feel), gear, courses, race calendar,
  devices, badges, weigh-ins, and more. One tool per library method.

**Not exposed:** `logout` (it would delete your saved session), the raw-JSON workout uploads (the
checked `create_workout` replaces them), and the raw GraphQL passthrough unless you opt in.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `GARMIN_MCP_TOKEN_DIR` | `~/.garminconnect-mcp/tokens` | Where the session is saved |
| `GARMIN_MCP_DOWNLOAD_DIR` | `~/Downloads/garmin` | Where downloaded files (FIT, GPX, …) go |
| `GARMIN_MCP_GROUPS` | all | Comma-separated tool groups: `wellness`, `activities`, `metrics`, `workouts`, `gear`, `courses`, `calendar-events`, `devices`, `badges-challenges`, `body-composition-weight`, `womens-health`, `golf`, `profile-and-misc`. Matched case-insensitively; an unknown name is ignored (and if none you list are valid, everything loads). The workout-builder tools are always on. Fewer groups means less of Claude's context used. |
| `GARMIN_MCP_ENABLE_GRAPHQL` | off | Set to `1` to expose `query_garmin_graphql` |

Set them under `"env"` in the config entry, for example:

```json
"garmin": {
  "command": "node",
  "args": ["…/dist/cli.js"],
  "env": { "GARMIN_MCP_GROUPS": "workouts,metrics,wellness,activities" }
}
```

`GARMIN_EMAIL` (an email or, on older accounts, a username) and `GARMIN_PASSWORD`, when both are set, work like the extension's email and password
settings: the server signs in by itself when there is no saved session (not with MFA).

If you change `GARMIN_MCP_TOKEN_DIR`, sign in with the same value
(`GARMIN_MCP_TOKEN_DIR=/path/to/dir garminconnect-mcp login`), or the server won't find your
session.

## Troubleshooting

- **The tools don't appear.** Make sure Claude Desktop was fully quit and restarted (step 4). Then
  Settings → Developer → `garmin` shows the server's status and a link to its log.
- **"Not logged in to Garmin"** or **"session expired"**: ask Claude to sign in again (it calls
  `sign_in_to_garmin`), or run `garminconnect-mcp login` again. The running server picks up the new
  session on the next request; no restart needed.
- **Sign-in page didn't open**: Claude's reply includes the link; open it in any browser on this
  computer. It expires after 15 minutes — ask Claude to sign in again.
- **`ERR_MODULE_NOT_FOUND`** after trying `npx`: delete the `_npx` folder in your npm cache
  (`npm config get cache` shows where) and use the global install above.
- **"Garmin is rate limiting requests"**: Garmin throttles bursts of calls. Wait a minute and ask
  again.
- **HTTP 412 when saving anything (EU accounts)**: grant upload consent in Garmin Connect's
  settings once; until then Garmin refuses every write.
- **Very detailed activity data looks cut off**: a single tool result is capped at 100,000
  characters, and per-second activity data (`get_activity_details`) is usually larger. Ask for a
  summary instead, or download the activity file (`download_activity`) and open it elsewhere.

## Updating

```sh
npm install -g @dynamicsninja/garminconnect-mcp@latest
```

then quit and restart Claude Desktop. Your saved session is kept.

## Other MCP clients

Any client that can start a stdio server works. The command is `garminconnect-mcp` (or
`node …/dist/cli.js`). For example, in Claude Code:

```sh
claude mcp add garmin -- garminconnect-mcp
```

## Good to know

- Dates are calendar dates in UTC (`YYYY-MM-DD`).
- Everything runs on your machine. Your Garmin session stays in your token folder and is sent only
  to Garmin. See [PRIVACY.md](PRIVACY.md) for the full picture.
- Garmin Connect's API is unofficial and can change. This server is released in lockstep with
  garminconnect-js, and each release is tested against the library version it contains.
