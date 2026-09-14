import type {QuestionData,Settings} from './types.ts';
const types=['mc_single','mc_multi','fill_blank','short_answer','long_answer','multi_blank'];
export function validateQuestion(input: unknown): string[] {
  const q=input as QuestionData; const errors:string[]=[];
  if(!q||typeof q!=='object') return ['Question must be an object'];
  if(!types.includes(q.type)) errors.push('Unknown question type');
  if(typeof q.text!=='string'||!q.text.trim()||q.text.length>20000) errors.push('Question text is required (maximum 20,000 characters)');
  if(!Number.isFinite(q.points)||q.points<=0||q.points>10000) errors.push('Points must be between 0 and 10,000');
  if(typeof q.strict!=='boolean') errors.push('strict must be true or false');
  if(!Array.isArray(q.choices)||!Array.isArray(q.correct)||!Array.isArray(q.accepted)) return [...errors,'choices, correct and accepted must be arrays'];
  if(q.type.startsWith('mc_')) {
    if(q.choices.length<2||q.choices.some(c=>!c.id||typeof c.text!=='string'||!c.text.trim())) errors.push('At least two non-empty choices are required');
    if(new Set(q.choices.map(c=>c.id)).size!==q.choices.length) errors.push('Choice IDs must be unique');
    if(!q.correct.length||new Set(q.correct).size!==q.correct.length||q.correct.some(id=>!q.choices.some(c=>c.id===id))) errors.push('Correct answers must reference distinct choices');
    if(q.type==='mc_single'&&q.correct.length!==1) errors.push('Single answer requires exactly one correct choice');
  }
  if(['fill_blank','multi_blank'].includes(q.type)&&!q.accepted.length) errors.push('Accepted answers are required');
  if(q.accepted.some(a=>!Array.isArray(a)||!a.length||a.some(s=>typeof s!=='string'||!s.trim()))) errors.push('Each blank needs at least one non-empty accepted answer');
  if(['fill_blank','short_answer'].includes(q.type)&&q.accepted.length>1) errors.push('This type supports one text field');
  return errors;
}
export function validateStudent(row:Record<string,string>):string[] {
  const e:string[]=[];
  if(!row.display_name?.trim()) e.push('Display name is required');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email||'')) e.push('Valid email required');
  if((row.password||'').length<12) e.push('Temporary password must contain at least 12 characters');
  return e;
}
export function validateSettings(s:Settings):string[] {
  const e:string[]=[];
  if(!['fixed','random'].includes(s.selection)) e.push('Invalid selection mode');
  if(s.selection==='random'&&(!Number.isInteger(s.count)||s.count<1)) e.push('Random count must be a positive integer');
  if(s.max_attempts!==null&&(!Number.isInteger(s.max_attempts)||s.max_attempts<1)) e.push('Attempt limit must be a positive integer or unlimited');
  return e;
}
