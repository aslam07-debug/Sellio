import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { handleExport } from '@/lib/exportService';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const handler = async (request, { params }) => {
  const { id } = await params;
  return handleExport(request, 'regenerate', getSupabaseAdmin(), id);
};
export { handler as GET, handler as POST, handler as PATCH, handler as PUT, handler as DELETE, handler as HEAD, handler as OPTIONS };
