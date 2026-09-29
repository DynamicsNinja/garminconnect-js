# Privacy — garminconnect-mcp

This extension/server runs entirely on your computer.

- **What it sends, and where:** requests to Garmin Connect's own services, `connectapi.garmin.com`
  (reading and changing your Garmin data) and `sso.garmin.com` (signing in), and, during sign-in
  and the periodic token refresh only, one request to `thegarth.s3.amazonaws.com` to fetch a
  public, fixed OAuth consumer key that every client of this API needs — it sends no personal data
  (no email, password or token) and receives no personal data back. Some data Garmin returns
  (badge images) is a `connect.garmin.com` URL handed to Claude as a link; this software never
  fetches it itself. Nothing else is contacted. There is no analytics or telemetry.
- **Your password:** typed only into the local sign-in page (served on `127.0.0.1`) or the
  `garminconnect-mcp login` terminal prompt, and sent only to Garmin's sign-in service
  (`sso.garmin.com`). It is never stored, logged, or shown to Claude.
- **What it stores:** your Garmin session tokens in a folder on this computer
  (`~/.garminconnect-mcp/tokens` by default), and files you ask it to download (`~/Downloads/garmin`
  by default; the extension's "Download folder" setting overrides it only when set to an absolute
  path). Delete the token folder to sign out.
- **What Claude sees:** the results of the tools Claude calls — for example your sleep data when you
  ask about sleep. How Claude handles conversation data is covered by Anthropic's privacy policy.

Unofficial: not made by, or affiliated with, Garmin. Garmin's own privacy policy applies to the data
Garmin holds: https://www.garmin.com/privacy/
