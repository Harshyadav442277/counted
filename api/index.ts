import { getRequestListener } from "@hono/node-server";
import { app } from "../src/app.js";

/**
 * Vercel entrypoint. vercel.json rewrites every path here. Exported as a classic
 * Node `(req, res)` listener: the Node runtime always recognises that signature.
 */
export default getRequestListener(app.fetch);
