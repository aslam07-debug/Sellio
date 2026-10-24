import { handleKaspi } from '@/lib/kaspiRoute';
import { syncPage } from '@/lib/kaspiService';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const POST = (request) => handleKaspi(request, syncPage);
