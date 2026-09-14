import {createClient} from '@supabase/supabase-js';
import {readFileSync} from 'node:fs';
try{for(const line of readFileSync('.env.local','utf8').split(/\r?\n/)){const i=line.indexOf('=');if(i>0&&!line.startsWith('#'))process.env[line.slice(0,i).trim()]??=line.slice(i+1).trim().replace(/^['"]|['"]$/g,'');}}catch{}
const email=process.env.ADMIN_EMAIL,password=process.env.ADMIN_PASSWORD;
if(!email||!password||password.length<12)throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) in the terminal environment.');
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const {data,error}=await client.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:'Administrator'}});if(error)throw error;
const {error:profileError}=await client.from('profiles').update({role:'admin',display_name:'Administrator'}).eq('id',data.user.id);if(profileError)throw profileError;
console.log('Administrator created. Clear ADMIN_PASSWORD from your environment.');
