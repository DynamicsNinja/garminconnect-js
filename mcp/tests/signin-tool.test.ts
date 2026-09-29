import { describe, expect, it } from "vitest";
import { Garmin, GarminAuthError, GarminClient } from "garminconnect-js";
import { signInTools } from "../src/signin-tool.js";
import type { Session } from "../src/session.js";
import { NotLoggedInError } from "../src/session.js";
import { connect, fakeFetch, PROFILE_ROUTE, sessionFor, testConfig, textOf } from "./helpers.js";

const neverSignedIn: Session & { resets: number } = {
  resets: 0,
  get: async () => {
    throw new NotLoggedInError("No saved Garmin login");
  },
  reset() {
    neverSignedIn.resets++;
  },
};

const unusedClient = () => ({
  login: async () => {
    throw new Error("not used");
  },
  resumeLogin: async () => {},
  displayName: async () => "x",
});

describe("sign_in_to_garmin", () => {
  it("says who is signed in and opens nothing when a session works", async () => {
    const opened: string[] = [];
    const { fetchImpl } = fakeFetch(PROFILE_ROUTE);
    const client = await connect({ config: testConfig(), session: sessionFor(fetchImpl) }, [
      signInTools({ openUrl: (u) => opened.push(u), createClient: unusedClient }),
    ]);
    const text = textOf(await client.callTool({ name: "sign_in_to_garmin", arguments: {} }));
    expect(text).toBe("Already signed in to Garmin as abc-display.");
    expect(opened).toEqual([]);
  });

  it("opens the sign-in page when there is no session, and reuses it on a second call", async () => {
    const opened: string[] = [];
    const client = await connect({ config: testConfig(), session: neverSignedIn }, [
      signInTools({ openUrl: (u) => opened.push(u), createClient: unusedClient, idleMs: 5_000 }),
    ]);
    const first = textOf(await client.callTool({ name: "sign_in_to_garmin", arguments: {} }));
    const second = textOf(await client.callTool({ name: "sign_in_to_garmin", arguments: {} }));
    expect(opened).toHaveLength(2);
    expect(opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}$/);
    expect(opened[1]).toBe(opened[0]);
    expect(first).toContain(opened[0]!);
    expect(first).toContain("tell me when you're done");
    expect(second).toContain(opened[0]!);
  });

  it("treats an expired session (profile call rejected) as not signed in", async () => {
    const opened: string[] = [];
    const expired: Session = {
      get: async () => {
        const g = new Garmin(new GarminClient());
        g.getUserProfile = async () => {
          throw new GarminAuthError("expired");
        };
        return g;
      },
      reset() {},
    };
    const client = await connect({ config: testConfig(), session: expired }, [
      signInTools({ openUrl: (u) => opened.push(u), createClient: unusedClient, idleMs: 5_000 }),
    ]);
    const text = textOf(await client.callTool({ name: "sign_in_to_garmin", arguments: {} }));
    expect(opened).toHaveLength(1);
    expect(text).toContain("sign-in page opened");
  });
});
