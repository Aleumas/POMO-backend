import { describe, it, expect } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { verifyToken } from "../src/auth";

async function setup(claims: { sub?: string; iss?: string; aud?: string }) {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test";
  const keySet = createLocalJWKSet({ keys: [jwk] });
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", kid: "test" })
    .setSubject(claims.sub ?? "user-1")
    .setIssuer(claims.iss ?? "https://app.test")
    .setAudience(claims.aud ?? "https://app.test")
    .setExpirationTime("1h")
    .sign(privateKey);
  return { token, keySet };
}

describe("verifyToken", () => {
  it("returns sub for a valid token", async () => {
    const { token, keySet } = await setup({ sub: "user-1" });
    const uid = await verifyToken(token, keySet, { issuer: "https://app.test", audience: "https://app.test" });
    expect(uid).toBe("user-1");
  });

  it("returns null on issuer mismatch", async () => {
    const { token, keySet } = await setup({ iss: "https://evil.test" });
    const uid = await verifyToken(token, keySet, { issuer: "https://app.test", audience: "https://app.test" });
    expect(uid).toBeNull();
  });
});
