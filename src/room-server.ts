import { Server } from "partyserver";

export class RoomServer extends Server<Env> {
  static options = { hibernate: true };
}
