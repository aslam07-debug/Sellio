import { handleKaspi } from '@/lib/kaspiRoute';
import { verifyStore } from '@/lib/kaspiService';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const POST = (request) => handleKaspi(request, verifyStore);
