# Privacy — garminconnect-mcp

This extension/server runs entirely on your computer.

- **What it sends, and where:** only requests to Garmin Connect (`connectapi.garmin.com`,
  `sso.garmin.com`, `connect.garmin.com`), to read or change your Garmin data when you ask Claude
  to. Nothing is sent anywhere else. There is no analytics or telemetry.
- **Your password:** typed only into the local sign-in page (served on `127.0.0.1`) or the
  `garminconnect-mcp login` terminal prompt, and sent only to Garmin's sign-in service. It is never
  stored, logged, or shown to Claude.
- **What it stores:** your Garmin session tokens in a folder on this computer
  (`~/.garminconnect-mcp/tokens` by default), and files you ask it to download (default
  `~/Downloads/garmin`). Delete the token folder to sign out.
- **What Claude sees:** the results of the tools Claude calls — for example your sleep data when you
  ask about sleep. How Claude handles conversation data is covered by Anthropic's privacy policy.

Unofficial: not made by, or affiliated with, Garmin. Garmin's own privacy policy applies to the data
Garmin holds: https://www.garmin.com/privacy/
