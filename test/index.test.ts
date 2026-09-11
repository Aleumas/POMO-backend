import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAllowedOrigin } from "../src/index";
import { installSupabaseStub, type SupabaseStub } from "./helpers";

describe("worker routing", () => {
  it("answers /health", async () => {
    const res = await exports.default.fetch("http://example.com/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown paths", async () => {
    const res = await exports.default.fetch("http://example.com/nope");
    expect(res.status).toBe(404);
  });
});

describe("isAllowedOrigin", () => {
  const allowed = "https://tomatera.netlify.app, http://localhost:3001";
  it("accepts listed origins and missing origin", () => {
    expect(isAllowedOrigin("http://localhost:3001", allowed)).toBe(true);
    expect(isAllowedOrigin("https://tomatera.netlify.app", allowed)).toBe(true);
    expect(isAllowedOrigin(null, allowed)).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isAllowedOrigin("https://evil.example", allowed)).toBe(false);
  });
});

describe("websocket gate", () => {
  let stub: SupabaseStub;
  beforeEach(() => {
    stub = installSupabaseStub();
  });
  afterEach(() => stub.restore());

  const upgrade = (query: string, origin = "http://localhost:3001") =>
    exports.default.fetch(`http://example.com/parties/room-server/r1?${query}`, {
      headers: { Upgrade: "websocket", Origin: origin },
    });

  it("rejects a disallowed origin with 403", async () => {
    const res = await upgrade("token=tok-u1", "https://evil.example");
    expect(res.status).toBe(403);
  });

  it("rejects a missing or invalid token with 401", async () => {
    expect((await upgrade("")).status).toBe(401);
    expect((await upgrade("token=bad")).status).toBe(401);
  });

  it("upgrades with a valid token", async () => {
    const res = await upgrade("token=tok-u1&displayName=Maya");
    expect(res.status).toBe(101);
    expect(res.webSocket).not.toBeNull();
    res.webSocket!.accept();
    res.webSocket!.close(1000, "done");
  });
});
