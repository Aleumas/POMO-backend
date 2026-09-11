import { routePartykitRequest } from "partyserver";
import { RoomServer } from "./room-server";

export { RoomServer };

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }
    const routed = await routePartykitRequest(request, env);
    return routed ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
