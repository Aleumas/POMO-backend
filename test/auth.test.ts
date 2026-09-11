import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAccessToken } from "../src/auth";
import { installSupabaseStub, type SupabaseStub } from "./helpers";

const env = { SUPABASE_URL: "https://supabase.test", SUPABASE_PUBLISHABLE_KEY: "pk_test" };

describe("verifyAccessToken", () => {
  let stub: SupabaseStub;
  beforeEach(() => {
    stub = installSupabaseStub();
  });
  afterEach(() => stub.restore());

  it("returns the user id for a valid token", async () => {
    expect(await verifyAccessToken("tok-u1", env)).toBe("u1");
  });

  it("returns null for an invalid token", async () => {
    expect(await verifyAccessToken("nope", env)).toBeNull();
  });
});
