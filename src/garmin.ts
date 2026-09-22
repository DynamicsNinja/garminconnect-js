import type { GarminClient } from "./client.js";
import { GarminError } from "./errors.js";

export interface SocialProfile {
  displayName: string;
  userName: string;
  fullName: string;
  profileId: number;
  measurementSystem?: string;
  [key: string]: unknown;
}

export class Garmin {
  #profile: Promise<SocialProfile> | null = null;

  constructor(readonly client: GarminClient) {}

  /** Cached per instance; every date-scoped endpoint needs the display name. */
  getUserProfile(): Promise<SocialProfile> {
    this.#profile ??= (async () => {
      const profile = await this.client.connectapi<SocialProfile>(
        "/userprofile-service/socialProfile",
      );
      if (!profile) throw new GarminError("Garmin returned no user profile");
      return profile;
    })().catch((error: unknown) => {
      this.#profile = null; // allow a retry on the next call
      throw error;
    });
    return this.#profile;
  }

  async displayName(): Promise<string> {
    return (await this.getUserProfile()).displayName;
  }

  async fullName(): Promise<string> {
    return (await this.getUserProfile()).fullName;
  }

  async userName(): Promise<string> {
    return (await this.getUserProfile()).userName;
  }

  async unitSystem(): Promise<string | undefined> {
    return (await this.getUserProfile()).measurementSystem;
  }
}
