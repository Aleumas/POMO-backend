import { vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

export interface JwtStub {
  mintToken: (uid: string, overrides?: { iss?: string; aud?: string }) => Promise<string>;
  restore: () => void;
}

let keyPairPromise: ReturnType<typeof generateKeyPair> | null = null;
function getKeyPair() {
  if (!keyPairPromise) {
    keyPairPromise = generateKeyPair("EdDSA", { crv: "Ed25519" });
  }
  return keyPairPromise;
}

/**
 * Stubs global fetch to serve a JWKS document (matching a fixed test keypair)
 * for any `GET <origin>/api/auth/jwks` request, and exposes `mintToken` to
 * sign JWTs with that keypair — standing in for Better Auth's JWT plugin.
 */
export function installJwtStub(appOrigin: string): JwtStub {
  const realFetch = globalThis.fetch;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `${appOrigin}/api/auth/jwks`) {
        const { publicKey } = await getKeyPair();
        const jwk = await exportJWK(publicKey);
        jwk.kid = "test";
        jwk.alg = "EdDSA";
        return Response.json({ keys: [jwk] });
      }
      return realFetch(input as RequestInfo, init);
    }),
  );

  return {
    mintToken: async (uid, overrides) => {
      const { privateKey } = await getKeyPair();
      return new SignJWT({})
        .setProtectedHeader({ alg: "EdDSA", kid: "test" })
        .setSubject(uid)
        .setIssuer(overrides?.iss ?? appOrigin)
        .setAudience(overrides?.aud ?? appOrigin)
        .setExpirationTime("1h")
        .sign(privateKey);
    },
    restore: () => vi.unstubAllGlobals(),
  };
}
