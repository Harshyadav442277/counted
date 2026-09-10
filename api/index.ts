import { getRequestListener } from "@hono/node-server";
import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "../src/app.js";
import { config } from "../src/config.js";

/**
 * Vercel entrypoint. vercel.json rewrites every path here. Exported as a classic
 * Node `(req, res)` listener: the Node runtime always recognises that signature.
 *
 * Vercel terminates TLS at the edge, so the socket the listener sees is plain HTTP
 * and it builds an `http://` request URL. x402 copies that URL into the 402 challenge
 * as the resource being bought, so a buyer was quoted `http://counted-gamma...` for a
 * page they had fetched over HTTPS. An absolute `incoming.url` is used verbatim by the
 * listener, so rewriting it here is enough; the canonical origin comes from PUBLIC_URL
 * rather than the Host header, which a client controls.
 */
const listener = getRequestListener(app.fetch);

function origin(incoming: IncomingMessage): string | null {
  const configured = config().PUBLIC_URL;
  if (configured) return configured;
  const header = (name: string) => {
    const v = incoming.headers[name];
    return (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim();
  };
  const proto = header("x-forwarded-proto");
  const host = header("x-forwarded-host") ?? header("host");
  return proto && host ? `${proto}://${host}` : null;
}

export default function handler(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
  if (incoming.url?.startsWith("/")) {
    const base = origin(incoming);
    if (base) incoming.url = base.replace(/\/+$/, "") + incoming.url;
  }
  return listener(incoming, outgoing);
}
