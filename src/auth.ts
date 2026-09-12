import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";

export interface AuthEnv {
  APP_ORIGIN: string;
}

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedOrigin: string | null = null;

function jwksFor(origin: string) {
  if (!cachedJwks || cachedOrigin !== origin) {
    cachedJwks = createRemoteJWKSet(new URL(`${origin}/api/auth/jwks`));
    cachedOrigin = origin;
  }
  return cachedJwks;
}

export async function verifyToken(
  token: string,
  keySet: JWTVerifyGetKey,
  opts: { issuer: string; audience: string },
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, keySet, {
      issuer: opts.issuer,
      audience: opts.audience,
    });
    return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function verifyAccessToken(token: string, env: AuthEnv): Promise<string | null> {
  return verifyToken(token, jwksFor(env.APP_ORIGIN), {
    issuer: env.APP_ORIGIN,
    audience: env.APP_ORIGIN,
  });
}
