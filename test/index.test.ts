import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

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
