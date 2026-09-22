# garminconnect-js

TypeScript client for the Garmin Connect API. A port of
[python-garminconnect](https://github.com/cyberjunky/python-garminconnect) and
[garth](https://github.com/matin/garth), built for Node and Next.js server runtimes.

Zero runtime dependencies. Node 18+.

## Install

```bash
npm install garminconnect-js
```

## Node runtime only

This library uses `node:crypto` and `Buffer`. It does not run on the Edge runtime.
In a Next.js route handler:

```ts
export const runtime = "nodejs";
```

Never import it into a Client Component — credentials and tokens must stay on the server.

## One-time login

Log in once, persist the tokens, and never send credentials again:

```ts
import { GarminClient, FileTokenStore } from "garminconnect-js";

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
const result = await client.login(process.env.GARMIN_EMAIL!, process.env.GARMIN_PASSWORD!);

if (result.state === "mfa_required") {
  const code = await promptForCode(); // your UI
  await client.resumeLogin(result.mfaState, code);
}
```

## MFA across two HTTP requests

`mfaState` is plain JSON with no password in it, so it survives a round trip through a
session store. This is what makes MFA work on serverless, where the code arrives in a
different request than the one that started the login.

```ts
// app/api/garmin/login/route.ts
export const runtime = "nodejs";

export async function POST(req: Request) {
  const { email, password } = await req.json();
  const client = new GarminClient({ tokenStore: myStore });
  const result = await client.login(email, password);

  if (result.state === "mfa_required") {
    await session.set("garminMfa", result.mfaState); // encrypted session
    return Response.json({ mfaRequired: true, method: result.mfaState.mfaMethod });
  }
  return Response.json({ mfaRequired: false });
}

// app/api/garmin/mfa/route.ts
export async function POST(req: Request) {
  const { code } = await req.json();
  const mfaState = await session.get("garminMfa");
  const client = new GarminClient({ tokenStore: myStore });
  await client.resumeLogin(mfaState, code);
  await session.delete("garminMfa");
  return Response.json({ ok: true });
}
```

Treat `mfaState` as a short-lived secret: encrypt it at rest and delete it once used.

## Reading data

```ts
// lib/garmin.ts
import { GarminClient, Garmin } from "garminconnect-js";

export async function getGarmin() {
  const client = new GarminClient({ tokenStore: myStore });
  if (!(await client.loadTokens())) throw new Error("Not connected to Garmin");
  return new Garmin(client);
}

// app/api/sleep/route.ts
export const runtime = "nodejs";

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date")!;
  const garmin = await getGarmin();
  return Response.json(await garmin.getSleepData(date));
}
```

The OAuth2 token refreshes automatically before it expires and the refreshed token is
written back to your store. You never call refresh yourself.

Dates are interpreted as UTC calendar dates, not local ones. Passing a `Date` object
(instead of a `"YYYY-MM-DD"` string) is formatted with `toISOString().slice(0, 10)`, so a
caller in a negative UTC-offset timezone (e.g. US Pacific) who calls `new Date()` late in
their local day can get tomorrow's date, because it's already tomorrow in UTC. Pass an
explicit `"YYYY-MM-DD"` string when you need the calendar date in the user's own timezone.

Methods like `getSleepData` return `null`, not a thrown error, when Garmin has no data
for the requested date — check for `null` before using the result.

## Bring your own token storage

`FileTokenStore` suits scripts and a single long-lived server. On serverless, implement
the three-method interface against whatever you already run:

```ts
import type { TokenStore, Tokens } from "garminconnect-js";
// `Redis` here is illustrative — bring your own client's type
// (e.g. `import type { Redis } from "ioredis";`).
type Redis = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<unknown>; del(key: string): Promise<unknown> };

export class RedisTokenStore implements TokenStore {
  constructor(private redis: Redis, private userId: string) {}

  async load(): Promise<Tokens | null> {
    const raw = await this.redis.get(`garmin:${this.userId}`);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  }
  async save(tokens: Tokens): Promise<void> {
    await this.redis.set(`garmin:${this.userId}`, JSON.stringify(tokens));
  }
  async clear(): Promise<void> {
    await this.redis.del(`garmin:${this.userId}`);
  }
}
```

`FileTokenStore` uses garth's on-disk format, so tokens produced by Python `garth` load
here unchanged.

## Errors

| Error | Meaning |
|---|---|
| `GarminAuthError` | 401/403, failed SSO, or expired tokens. Log in again. |
| `GarminRateLimitError` | 429. Carries `retryAfter` seconds when Garmin sends it. |
| `GarminConnectionError` | Network failure or timeout, after retries. |
| `GarminHttpError` | Any other non-2xx. Carries `status`, `url`, `body`. |

## Caveats

Garmin Connect has no public API. This library talks to the endpoints the mobile app
uses, with credentials fetched from the same third-party source `garth` uses. Garmin can
change or break any of it without notice. Don't build anything safety-critical on it, and
expect to update when login stops working.

## License

MIT. See `NOTICE` for attribution to python-garminconnect and garth.
