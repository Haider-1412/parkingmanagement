import { Hono } from "hono";

const requestHeaders = ["accept", "authorization", "content-type"];
const responseHeaders = ["content-type", "www-authenticate", "allow", "retry-after"];

function apiError(status, detail) {
  return Response.json({ detail }, { status, headers: { "cache-control": "no-store" } });
}

const app = new Hono();
app.all("/api/*", async ({ req }) => {
  const request = req.raw;
  const incoming = new URL(request.url);
  const binding = process.env.BACKEND_URL;
  if (!binding) return apiError(503, "Parking API binding is unavailable");

  const target = new URL(binding);
  const basePath = target.pathname.replace(/\/$/, "");
  target.pathname = basePath + incoming.pathname;
  target.search = incoming.search;

  const headers = new Headers();
  for (const name of requestHeaders) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  const timeout = AbortSignal.timeout(18000);
  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.body ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      signal: AbortSignal.any([request.signal, timeout]),
    });
  } catch {
    return timeout.aborted
      ? apiError(504, "The parking API took too long to respond")
      : apiError(502, "The parking API could not be reached");
  }

  const outgoing = new Headers({ "cache-control": "no-store" });
  for (const name of responseHeaders) {
    const value = upstream.headers.get(name);
    if (value !== null) outgoing.set(name, value);
  }

  const location = upstream.headers.get("location");
  if (location) {
    const destination = new URL(location, target);
    if (destination.origin !== target.origin || !destination.pathname.startsWith(basePath + "/api/")) {
      return apiError(502, "The parking API returned an unexpected redirect");
    }
    outgoing.set("location", destination.pathname.slice(basePath.length) + destination.search);
  }

  return new Response(upstream.body, { status: upstream.status, headers: outgoing });
});

export default app;
