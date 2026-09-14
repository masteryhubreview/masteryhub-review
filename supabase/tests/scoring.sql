-- Run in staging SQL Editor as project owner. Does not create users or mutate application data.
begin;
do $$declare q jsonb;g numeric;begin
q:='{"type":"mc_single","points":2,"choices":[{"id":"a","text":"4"},{"id":"b","text":"5"}],"correct":["a"],"accepted":[],"strict":false}';
assert private.grade(q,'["a"]')=2,'Single choice correct';
assert private.grade(q,'["b"]')=0,'Single choice incorrect';
q:=q||'{"type":"mc_multi","correct":["a","b"]}';
assert private.grade(q,'["b","a"]')=2,'Multiple choice order independent';
assert private.grade(q,'["a"]')=0,'Partial multi-select is zero';
q:='{"type":"fill_blank","points":1,"accepted":[["New York"]],"strict":false}';
assert private.grade(q,'["  NEW   YORK  "]')=1,'Whitespace and case normalization';
assert private.grade(q||'{"strict":true}','["new york"]')=0,'Strict case sensitive';
q:='{"type":"multi_blank","points":3,"accepted":[["red"],["green"],["blue"]],"strict":false}';
assert private.grade(q,'["red","wrong","blue"]')=2,'Partial typed blank credit';
q:='{"type":"short_answer","points":5,"accepted":[],"strict":false}';
assert private.grade(q,'["Needs human review"]') is null,'Manual short answer';
assert private.grade(q,'[""]')=0,'Optional blank is zero';
q:=q||'{"type":"long_answer"}';
assert private.grade(q,'["A paragraph"]') is null,'Paragraph manual';
raise notice 'Scoring assertions passed';end$$;
rollback;
