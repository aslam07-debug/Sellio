import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { handleExport } from '@/lib/exportService';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const handler = request => handleExport(request, 'history', getSupabaseAdmin());
export { handler as GET, handler as POST, handler as PATCH, handler as PUT, handler as DELETE, handler as HEAD, handler as OPTIONS };
