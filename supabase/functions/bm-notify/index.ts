// Supabase Edge Function entry point (Deno). Logic lives in handler.ts.
import { handle, type Env } from './handler.ts';

Deno.serve((req: Request) => handle(req, Deno.env.toObject() as unknown as Env));
