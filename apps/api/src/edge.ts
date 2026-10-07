import { buildApp, type App } from './app.js';
import { supabaseVerifier } from './auth.js';
import { connect } from './db.js';

// The API as one function, for hosts that hand over a web Request and expect a
// Response (Supabase Edge Functions). Nothing listens on a port: each request is
// passed straight to the same routes the server uses.

let app: Promise<App> | undefined;

function start(): Promise<App> {
  const accessKey = process.env.ACCESS_KEY;
  // The data is private. A deployment with no key would be open to anyone, so it does not start.
  if (!accessKey) throw new Error('ACCESS_KEY is not set');
  // Set as AUTH_URL and AUTH_KEY; failing that, what the host supplies to its own functions.
  const authUrl = process.env.AUTH_URL ?? process.env.SUPABASE_URL;
  const authKey = process.env.AUTH_KEY ?? process.env.SUPABASE_ANON_KEY;
  return buildApp({
    // Each running copy keeps few connections: the host may run several at once.
    sql: connect(process.env.DATABASE_URL, { max: 2 }),
    rateLimit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120),
    corsOrigins: process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean),
    trustProxy: true,
    accessKey,
    verify: authUrl && authKey ? supabaseVerifier(authUrl, authKey) : undefined,
  });
}

export async function handler(request: Request): Promise<Response> {
  app ??= start();
  const url = new URL(request.url);
  // The host serves the function under its name; the routes know nothing of that prefix.
  const path = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
  const answer = await (await app).inject({
    method: request.method as 'GET',
    url: path + url.search,
    headers: Object.fromEntries(request.headers),
    payload: request.body ? Buffer.from(await request.arrayBuffer()) : undefined,
  });
  const headers = new Headers();
  for (const [name, value] of Object.entries(answer.headers))
    for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) headers.append(name, String(item));
  const empty = answer.statusCode === 204 || answer.statusCode === 304 || request.method === 'HEAD';
  return new Response(empty ? null : new Uint8Array(answer.rawPayload), { status: answer.statusCode, headers });
}
