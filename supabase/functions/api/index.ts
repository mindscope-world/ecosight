// The ecoSight API as a Supabase Edge Function. `bundle.js` is built from
// apps/api by `pnpm --filter @atlas/api build:edge` and is not kept in git.
import { handler } from './bundle.js';

Deno.serve(handler);
