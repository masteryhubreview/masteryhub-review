import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {validateStudent} from '@/lib/validation';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 try {
  const token=req.headers.get('authorization');
  if(!token?.startsWith('Bearer '))return NextResponse.json({error:'Sign in required'},{status:401});
  if(Number(req.headers.get('content-length')||0)>100000)return NextResponse.json({error:'Request too large'},{status:413});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL!,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const scoped=createClient(url,key,{global:{headers:{Authorization:token}},auth:{persistSession:false}});
  const {data:{user},error:authError}=await scoped.auth.getUser(token.slice(7));
  if(authError||!user)return NextResponse.json({error:'Session expired'},{status:401});
  const {data:actor}=await scoped.from('profiles').select('role,is_active').eq('id',user.id).single();
  if(actor?.role!=='admin'||!actor.is_active)return NextResponse.json({error:'Administrator required'},{status:403});
  const {error:limit}=await scoped.rpc('admin_rate_limit');if(limit)return NextResponse.json({error:limit.message},{status:429});
  const raw=await req.text();if(raw.length>100000)return NextResponse.json({error:'Request too large'},{status:413});
  const body=JSON.parse(raw); const action=body.action;
  if(!['create','update','delete'].includes(action))throw new Error('Unknown account action');
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceKey)throw new Error('Server account management is not configured');
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  if(action==='create'){
    const errors=validateStudent(body);if(errors.length)throw new Error(errors.join('; '));
    const {data,error}=await admin.auth.admin.createUser({email:String(body.email).trim(),password:body.password,email_confirm:true,user_metadata:{display_name:body.display_name}});if(error)throw error;
    const {error:pError}=await admin.from('profiles').update({display_name:body.display_name.trim(),student_number:body.student_number?.trim()||null,term_id:body.term_id||null}).eq('id',data.user.id);
    if(pError){await admin.from('profiles').delete().eq('id',data.user.id);await admin.auth.admin.deleteUser(data.user.id);throw pError;}
    return NextResponse.json({id:data.user.id});
  }
  const {data:target,error:targetError}=await admin.from('profiles').select('id,role').eq('id',body.id).single();
  if(targetError||target?.role!=='student')throw new Error('Student not found');
  if(action==='delete'){
    if(body.backup_verified!==true)throw new Error('Verify an exported backup first');
    const {count,error:cError}=await admin.from('attempts').select('id',{count:'exact',head:true}).eq('student_id',body.id);if(cError)throw cError;
    if(count)throw new Error('This student has historical attempts. Deactivate instead; history is preserved.');
    // Auth is banned first; a partial cleanup cannot leave an active orphan account.
    const {error:banError}=await admin.auth.admin.updateUserById(body.id,{ban_duration:'876000h'});if(banError)throw banError;
    const {error:eError}=await admin.from('enrollments').delete().eq('student_id',body.id);if(eError)throw eError;
    const {error:pError}=await admin.from('profiles').delete().eq('id',body.id);if(pError)throw pError;
    const {error:deleteError}=await admin.auth.admin.deleteUser(body.id);if(deleteError)throw deleteError;
    return NextResponse.json({ok:true});
  }
  if(typeof body.display_name!=='string'||!body.display_name.trim())throw new Error('Display name required');
  if(body.password&&body.password.length<12)throw new Error('Password must contain at least 12 characters');
  const {error:profileError}=await admin.from('profiles').update({display_name:body.display_name.trim(),student_number:body.student_number?.trim()||null,term_id:body.term_id||null,is_active:body.is_active===true}).eq('id',body.id);if(profileError)throw profileError;
  const {error:accountError}=await admin.auth.admin.updateUserById(body.id,{email:body.email,...(body.password?{password:body.password}:{}),ban_duration:body.is_active?'none':'876000h'});if(accountError)throw new Error('Profile saved, but account credentials were not updated: '+accountError.message);
  return NextResponse.json({ok:true});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Request failed'},{status:400});}
}
