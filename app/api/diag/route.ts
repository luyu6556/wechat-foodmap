// Retired diagnostic endpoint.
//
// It was deployed once to diagnose why requests carrying `Authorization: Bearer`
// were treated as anonymous on the WorkBuddy sandbox. That is now understood (the
// platform's reverse proxy replaces the `Authorization` header), and the app moves
// its member token in `X-Food-Map-Token` instead — see lib/server.ts and
// lib/client-api.ts.
//
// The file is kept, rather than deleted, because the publishing pipeline uploads
// incrementally and never removes files that disappeared locally: simply deleting
// it left the live endpoint serving real data. Overwriting it at the same path is
// what actually retires the route. Delete this file only alongside a deploy to a
// brand-new sandbox.
export async function GET() {
  return new Response("Not found", { status: 404 });
}
