import { routePartykitRequest } from "partyserver";
import { verifyAccessToken } from "./auth";
import { RoomServer } from "./room-server";

export { RoomServer };

export function isAllowedOrigin(origin: string | null, allowed: string): boolean {
  if (!origin) return true;
  return allowed
    .split(",")
    .map((s) => s.trim())
    .includes(origin);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    const routed = await routePartykitRequest(request, env, {
      onBeforeConnect: async (req) => {
        if (!isAllowedOrigin(req.headers.get("Origin"), env.ALLOWED_ORIGINS)) {
          return new Response("Forbidden", { status: 403 });
        }
        const reqUrl = new URL(req.url);
        const token = reqUrl.searchParams.get("token");
        const uid = token ? await verifyAccessToken(token, env) : null;
        if (!uid) {
          return new Response("Unauthorized", { status: 401 });
        }
        reqUrl.searchParams.delete("token");
        const forwarded = new Request(reqUrl.toString(), req);
        forwarded.headers.set("x-user-id", uid);
        return forwarded;
      },
    });
    return routed ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
