import { describe, expect, it, vi } from "vitest";
import type { MfaState } from "garminconnect-js";
import { login, type LoginIo } from "../src/login.js";

const io = (answers: Record<string, string>): LoginIo => ({
  ask: async (q) => answers[q] ?? "",
  askHidden: async (q) => answers[q] ?? "",
  log: () => {},
});

describe("login", () => {
  it("logs in without MFA", async () => {
    const client = { login: vi.fn().mockResolvedValue({ state: "success" }), resumeLogin: vi.fn() };
    await login(io({ "Garmin email or username: ": "a@b.c", "Garmin password: ": "pw" }), client, {});
    expect(client.login).toHaveBeenCalledWith("a@b.c", "pw");
    expect(client.resumeLogin).not.toHaveBeenCalled();
  });

  it("asks for the MFA code when Garmin wants one", async () => {
    const mfaState = { flow: "mobile" } as unknown as MfaState;
    const client = {
      login: vi.fn().mockResolvedValue({ state: "mfa_required", mfaState }),
      resumeLogin: vi.fn().mockResolvedValue(undefined),
    };
    await login(io({ "Garmin email or username: ": "a@b.c", "Garmin password: ": "pw", "MFA code from Garmin: ": " 123456 " }), client, {});
    expect(client.resumeLogin).toHaveBeenCalledWith(mfaState, "123456");
  });

  it("uses GARMIN_EMAIL / GARMIN_PASSWORD when set", async () => {
    const client = { login: vi.fn().mockResolvedValue({ state: "success" }), resumeLogin: vi.fn() };
    await login(io({}), client, { GARMIN_EMAIL: "e@x.y", GARMIN_PASSWORD: "p" });
    expect(client.login).toHaveBeenCalledWith("e@x.y", "p");
  });

  it("refuses an empty password", async () => {
    const client = { login: vi.fn(), resumeLogin: vi.fn() };
    await expect(login(io({ "Garmin email or username: ": "a@b.c" }), client, {})).rejects.toThrow("Email (or username) and password are required.");
  });
});
