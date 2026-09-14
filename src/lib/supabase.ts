import { createClient, type SupabaseClient } from '@supabase/supabase-js';
let instance: SupabaseClient | undefined;
export function db() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Add your Supabase settings to .env.local and restart the application.');
  return instance ??= createClient(url,key);
}
export async function rpc<T>(name:string,args:Record<string,unknown>={}) : Promise<T> {
  const {data,error}=await db().rpc(name,args); if(error) throw new Error(error.message); return data as T;
}
export async function adminAccount(body:unknown) {
  const {data:{session}}=await db().auth.getSession();
  const res=await fetch('/api/students',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session?.access_token},body:JSON.stringify(body)});
  const result=await res.json(); if(!res.ok) throw new Error(result.error||'Account operation failed'); return result;
}
