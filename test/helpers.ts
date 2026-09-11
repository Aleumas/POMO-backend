import { vi } from "vitest";

export interface SupabaseStub {
  focusSessions: Array<Record<string, unknown>>;
  failInserts: boolean;
  restore: () => void;
}

const headerOf = (input: RequestInfo | URL, init: RequestInit | undefined, name: string) => {
  if (input instanceof Request) return input.headers.get(name);
  return new Headers(init?.headers).get(name);
};

export function installSupabaseStub(): SupabaseStub {
  const stub: SupabaseStub = {
    focusSessions: [],
    failInserts: false,
    restore: () => vi.unstubAllGlobals(),
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);

      if (url === "https://supabase.test/auth/v1/user") {
        const auth = headerOf(input, init, "Authorization") ?? "";
        const match = /^Bearer tok-(.+)$/.exec(auth);
        if (!match) return new Response("unauthorized", { status: 401 });
        return Response.json({ id: match[1] });
      }

      if (url === "https://supabase.test/rest/v1/focus_session") {
        if (stub.failInserts) return new Response("boom", { status: 500 });
        const body = input instanceof Request ? await input.text() : String(init?.body);
        stub.focusSessions.push(JSON.parse(body));
        return new Response(null, { status: 201 });
      }

      return new Response("unexpected fetch " + url, { status: 599 });
    }),
  );

  return stub;
}
