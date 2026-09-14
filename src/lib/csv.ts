// RFC 4180-style parser with quoted cells, embedded newlines and UTF-8 BOM handling.
export function parseCSV(text:string):Record<string,string>[] {
  text=text.replace(/^\uFEFF/,''); const rows:string[][]=[]; let row:string[]=[],field='',quoted=false;
  for(let i=0;i<text.length;i++) {const c=text[i];
    if(c==='"') {if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(!quoted&&field.length) throw new Error('Unexpected quote');else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted) throw new Error('Unclosed quoted cell');
  if(field||row.length){row.push(field);rows.push(row);}
  if(!rows.length) return [];
  const headers=rows.shift()!.map(h=>h.trim());
  if(new Set(headers).size!==headers.length||headers.some(h=>!h))throw new Error('Headers must be unique and non-empty');
  return rows.map((r,i)=>{if(r.length!==headers.length)throw new Error('Row '+(i+2)+': expected '+headers.length+' columns');return Object.fromEntries(headers.map((h,j)=>[h,r[j]]));});
}
export function makeCSV(rows:Record<string,unknown>[]):string {
  if(!rows.length)return '';
  const keys=Object.keys(rows[0]);
  const cell=(v:unknown)=>{let s=typeof v==='object'&&v!==null?JSON.stringify(v):String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return [keys.map(cell).join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\r\n');
}
export function download(name:string,text:string,type='text/csv;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
