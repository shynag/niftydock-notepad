import { createServerClient } from "@supabase/ssr";
import { type cookies } from "next/headers";
import { getSupabasePublicConfig } from "@/utils/supabase/env";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export function createClient(cookieStore: CookieStore) {
  const { url, publishableKey } = getSupabasePublicConfig();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components can't write cookies. Middleware handles session refreshes.
        }
      },
    },
  });
}
