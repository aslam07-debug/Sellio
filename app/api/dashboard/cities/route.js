import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { handleReport } from '@/lib/reportService';
export const dynamic = 'force-dynamic';
export const GET = request => handleReport(request, 'cities', getSupabaseAdmin());
