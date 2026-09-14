'use client';
import {useEffect,useState} from 'react';import {db} from '@/lib/supabase';
export function Notice({message}:{message:string}){return message?<div className="notice" role="status">{message}</div>:null}
export function Pager({page,setPage,more}:{page:number;setPage:(p:number)=>void;more:boolean}){return <div className="pager"><button type="button" className="ghost" disabled={!page} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page+1}</span><button type="button" className="ghost" disabled={!more} onClick={()=>setPage(page+1)}>Next</button></div>}
export function ImageAttachment({path,bucket='question-images'}:{path:string|null;bucket?:string}){const [url,setUrl]=useState('');useEffect(()=>{let live=true;setUrl('');if(path)db().storage.from(bucket).createSignedUrl(path,3600).then(({data})=>{if(live)setUrl(data?.signedUrl||'')});return()=>{live=false}},[path,bucket]);return path?(url?<img className={bucket==='branding'?'brand-logo':'question-image'} src={url} alt={bucket==='branding'?'System logo':'Question attachment'}/>:<p>Image unavailable. Reload to try again.</p>):null}
export async function uploadImage(file:File,bucket='question-images'){
 const max=bucket==='branding'?2097152:5242880;
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>max)throw new Error('Use PNG, JPEG or WebP, up to '+Math.round(max/1048576)+' MB.');
 const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type];const path=crypto.randomUUID()+'.'+extension;
 const {error}=await db().storage.from(bucket).upload(path,file,{contentType:file.type,upsert:false});if(error)throw error;return path;
}
export function Check({label,checked,onChange}:{label:string;checked:boolean;onChange:(v:boolean)=>void}){return <label className="check"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span>{label}</span></label>}
export const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
