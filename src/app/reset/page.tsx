'use client';
import {useState} from 'react';
import {db} from '@/lib/supabase';
export default function Reset(){const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
return <main className="auth-wrap"><form className="auth-card" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const f=new FormData(e.currentTarget);const {error}=await db().auth.updateUser({password:String(f.get('password'))});if(error)throw error;setMessage('Password updated. You can return to sign in.');}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}}><span className="eyebrow">REVIEW HUB</span><h1>A fresh start.</h1><p>Choose a strong, unique password.</p><label>New password<input name="password" type="password" minLength={12} autoComplete="new-password" required/></label><button disabled={busy}>Update password</button><p role="status">{message}</p><a href="/">Return to ReviewHub</a></form></main>}
