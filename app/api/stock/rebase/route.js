import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { handleLocal } from '@/lib/localService';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const POST = request => handleLocal(request, 'rebase', getSupabaseAdmin());
