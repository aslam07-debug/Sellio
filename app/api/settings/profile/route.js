import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { handleLocal } from '@/lib/localService';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = request => handleLocal(request, 'profile', getSupabaseAdmin());
export const PATCH = request => handleLocal(request, 'profile', getSupabaseAdmin());
