// Structural (not `Pick<Env, ...>`) because wrangler types generates literal
// string types for `vars` in wrangler.jsonc, which would reject plain `string`
// values (e.g. in tests). `Env` still satisfies this interface structurally.
export interface AuthEnv {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
}

export async function verifyAccessToken(
  token: string,
  env: AuthEnv,
): Promise<string | null> {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { id?: unknown };
  return typeof body.id === "string" && body.id.length > 0 ? body.id : null;
}
