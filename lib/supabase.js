import { createClient } from '@supabase/supabase-js';
import { createAuthStorage, createRecoveryGate } from './utils.js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);
const authStorage = createAuthStorage();
export const setAuthPersistence = (remember) => authStorage.setPersistence(remember);
export const recoveryGate = createRecoveryGate();

// One public, RLS-protected client. Never put a service-role key in a client bundle.
export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

if (supabase && typeof window !== 'undefined') {
  // Subscribe immediately, before SDK initialization can clear the recovery hash.
  // Never await or call another auth method inside this callback (SDK lock).
  supabase.auth.onAuthStateChange((event, session) => recoveryGate.observe(event, session));
  supabase.auth.initialize().then(
    ({ error }) => recoveryGate.initialized(error),
    (error) => recoveryGate.initialized(error)
  );
} else {
  recoveryGate.initialized(new Error('Recovery requires configured browser auth'));
}
