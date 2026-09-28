# garminconnect-mcp

Talk to Claude to create Garmin workouts, and read or manage the rest of your Garmin Connect data,
through an [MCP](https://modelcontextprotocol.io) server built on
[garminconnect-js](https://github.com/DynamicsNinja/garminconnect-js).

> "Make me a 6×400 m session at 5k pace with 2-minute jog recoveries, put it on Thursday, and send
> it to my watch."

Claude previews the workout, waits for your OK, saves it to your Garmin workout library, schedules
it, and pushes it to your device.

## Set up

1. **Sign in once** (in a terminal; your password never passes through Claude):

   ```sh
   npx garminconnect-mcp login
   ```

   It asks for your Garmin email, password and, if enabled, your MFA code. The session is saved to
   `~/.garminconnect-mcp/tokens` and renews itself as long as you use it at least once every 30 days.

2. **Add it to Claude Desktop**: Settings → Developer → Edit Config, then in
   `claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "garmin": { "command": "npx", "args": ["-y", "garminconnect-mcp"] }
     }
   }
   ```

   On Windows, if Claude Desktop cannot start `npx`, use
   `"command": "cmd", "args": ["/c", "npx", "-y", "garminconnect-mcp"]`.

3. Restart Claude Desktop.

## What it can do

- **Workouts**: `preview_workout`, `create_workout`, `update_workout`, `search_exercises`, for every
  sport the builder supports (running, cycling, swimming, strength, HIIT, yoga, pilates, mobility,
  cardio, rucking, multi-sport). Workouts are checked before anything is sent: an unknown exercise
  name or a malformed step is reported back to Claude with exactly where the problem is.
- **Everything else in garminconnect-js**: sleep, HRV, stress, training readiness and status, race
  predictions, activities (list, details, download, upload files), gear, courses, devices, badges,
  weigh-ins, and more. One tool per library method.

Tools that delete or overwrite data are marked destructive, so Claude Desktop asks before running
them even if you auto-approve the rest.

**Not exposed:** `logout` (it would delete your saved session), the raw-JSON workout uploads (the
checked `create_workout` replaces them), and the raw GraphQL passthrough unless you opt in.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `GARMIN_MCP_TOKEN_DIR` | `~/.garminconnect-mcp/tokens` | Where the session is saved |
| `GARMIN_MCP_DOWNLOAD_DIR` | `~/Downloads/garmin` | Where downloaded files (FIT, GPX, …) go |
| `GARMIN_MCP_GROUPS` | all | Comma-separated tool groups: `wellness`, `activities`, `metrics`, `workouts`, `gear`, `courses`, `devices`, `badges-challenges`, `body-composition-weight`, `womens-health`, `golf`, `profile-and-misc`. The workout-builder tools are always on. Fewer groups means less of Claude's context used. |
| `GARMIN_MCP_ENABLE_GRAPHQL` | off | Set to `1` to expose `query_garmin_graphql` |

Set them under `"env"` in the Claude Desktop config entry.

## Good to know

- Dates are calendar dates in UTC (`YYYY-MM-DD`).
- Everything runs on your machine. Your Garmin session stays in your token folder and is sent only
  to Garmin.
- Garmin Connect's API is unofficial and can change; this server moves in lockstep with
  garminconnect-js, and each release is tested against the library version it contains.
