import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
      );
    }
    client = createClient(url, key);
  }
  return client;
}

/**
 * 빌드 시 정적 프리렌더에서 env가 없어도 모듈 평가만으로는 createClient가 호출되지 않도록 Proxy 사용.
 * 런타임에 처음 접근할 때 초기화됨.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const c = getClient();
    const value = Reflect.get(c as object, prop, receiver);
    if (typeof value === "function") {
      return value.bind(c);
    }
    return value;
  },
});
