// ============================================================================
// VetEvidence — Supabase Client (service role for server-side operations)
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Service role client — full access, server-side only */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  db: { schema: "vet_ai" },
});

/** Public schema client — for drugs table etc. */
export const supabasePublic = createClient(supabaseUrl, supabaseServiceKey, {
  db: { schema: "public" },
});
