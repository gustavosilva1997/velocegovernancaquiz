const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'quiz-state.json');
const PORT = Number(process.env.PORT || 3000);
fs.mkdirSync(DATA_DIR, { recursive: true });
function blankState() { return { initialized:false, users:null, scores:{}, times:{}, attempts:{}, qstats:{}, campaign:{start:'',end:''}, questionsPt:null, questionsEs:null, finishedRounds:{}, statEvents:{}, userResetVersions:{}, dailyResetVersion:0, resetVersion:0, updatedAt:null }; }
function readState() { try { return { ...blankState(), ...JSON.parse(fs.readFileSync(DATA_FILE,'utf8')) }; } catch { return blankState(); } }
function writeState(state) { state.initialized=true; state.updatedAt=new Date().toISOString(); const tmp=DATA_FILE+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(state,null,2),'utf8'); fs.renameSync(tmp,DATA_FILE); }
function send(res,code,data,type='application/json; charset=utf-8') { res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(type.startsWith('application/json')?JSON.stringify(data):data); }
function bodyJson(req) { return new Promise((resolve,reject)=>{let data='';req.on('data',chunk=>{data+=chunk;if(data.length>8*1024*1024)reject(new Error('Payload muito grande'));});req.on('end',()=>{try{resolve(JSON.parse(data||'{}'));}catch{reject(new Error('JSON inválido'));}});req.on('error',reject);}); }
function mergeMap(target, incoming, mode='replace') { if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))return target||{}; const out={...(target||{})}; for(const [key,value] of Object.entries(incoming)){ if(mode==='max' && Number.isFinite(Number(value))) out[key]=Math.max(Number(out[key]||0),Number(value)); else if(mode==='attempt'){const old=out[key];const oldDate=old&&typeof old==='object'?(old.date||''):String(old||'');const newDate=value&&typeof value==='object'?(value.date||''):String(value||'');if(!old||newDate>=oldDate)out[key]=value;} else out[key]=value; } return out; }
function mergeUsers(existing,incoming){ if(!Array.isArray(incoming))return existing; const map=new Map((Array.isArray(existing)?existing:[]).map(u=>[String(u.id),u])); for(const u of incoming)if(u&&u.id)map.set(String(u.id),u); return [...map.values()]; }
function syncCommonQuestionRules(state,lang,questions){const otherKey=lang==='pt'?'questionsEs':'questionsPt';const currentKey=lang==='pt'?'questionsPt':'questionsEs';if(Array.isArray(questions)){state[currentKey]=questions;if(Array.isArray(state[otherKey])){const byId=new Map(questions.map(q=>[String(q.id),q]));state[otherKey]=state[otherKey].map(q=>{const match=byId.get(String(q.id));return match?{...q,c:match.c,w:match.w}:q;});}}}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.json':'application/json; charset=utf-8'};
http.createServer(async(req,res)=>{
 const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
 const apiPath = url.pathname.includes('/api/') ? url.pathname.slice(url.pathname.indexOf('/api/')) : url.pathname;
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end();}
 if(apiPath==='/api/health'&&req.method==='GET')return send(res,200,{ok:true,service:'quiz-veloce'});
 if(apiPath==='/api/state'&&req.method==='GET')return send(res,200,readState());
 if(apiPath==='/api/finish'&&req.method==='POST'){
  try{const input=await bodyJson(req);const userId=String(input.userId||'');const day=Number(input.day);const date=String(input.date||'');const score=Math.max(0,Math.floor(Number(input.score)||0));const attemptId=String(input.attemptId||'');if(!userId||!attemptId||!date||!Number.isInteger(day)||day<1||day>4)return send(res,400,{ok:false,error:'Dados da partida incompletos.'});
   const state=readState();if(input.resetVersion!==undefined&&Number(input.resetVersion)<Number(state.resetVersion||0))return send(res,409,{ok:false,error:'O jogo foi zerado pelo administrador durante esta sessão. Atualize a página e inicie uma nova rodada.'});if(input.userResetVersion!==undefined&&Number(input.userResetVersion)<Number((state.userResetVersions||{})[userId]||0))return send(res,409,{ok:false,error:'A rodada deste usuário foi reiniciada pelo administrador durante esta sessão. Atualize a página e inicie uma nova rodada.'});state.scores=state.scores||{};state.times=state.times||{};state.attempts=state.attempts||{};state.finishedRounds=state.finishedRounds||{};
   if(state.finishedRounds[attemptId])return send(res,200,{ok:true,alreadyRegistered:true,totalScore:Number(state.scores[userId]||0),totalTimeSeconds:Number(state.times[userId]||0),attempt:state.attempts[userId]});
   const existing=state.attempts[userId];if(existing&&typeof existing==='object'&&Number(existing.day)===day)return send(res,200,{ok:true,alreadyCompleted:true,totalScore:Number(state.scores[userId]||0),totalTimeSeconds:Number(state.times[userId]||0),attempt:existing});
   const timeSeconds=Math.max(0,Math.floor(Number(input.timeSeconds)||0));state.scores[userId]=Number(state.scores[userId]||0)+score;state.times[userId]=Number(state.times[userId]||0)+timeSeconds;state.attempts[userId]={day,date,attemptId,score,timeSeconds};state.finishedRounds[attemptId]={userId,day,date,score,timeSeconds,at:new Date().toISOString()};writeState(state);return send(res,200,{ok:true,totalScore:state.scores[userId],totalTimeSeconds:state.times[userId],attempt:state.attempts[userId]});
  }catch(e){return send(res,400,{ok:false,error:e.message});}
 }
 if(apiPath==='/api/answer-stat'&&req.method==='POST'){
  try{const input=await bodyJson(req);const eventId=String(input.eventId||'');const qid=String(input.questionId||'');const userId=String(input.userId||'');const day=Number(input.day);if(!eventId||!qid||!userId||!Number.isInteger(day)||day<1||day>4)return send(res,400,{ok:false,error:'Identificador da resposta ausente.'});const state=readState();state.qstats=state.qstats||{};state.statEvents=state.statEvents||{};const uniqueKey=String(state.dailyResetVersion||0)+':'+userId+':'+day+':'+qid;if(!state.statEvents[uniqueKey]){const s=state.qstats[qid]||{attempts:0,correct:0,wrong:0};s.attempts=Number(s.attempts||0)+1;if(input.correct)s.correct=Number(s.correct||0)+1;else s.wrong=Number(s.wrong||0)+1;state.qstats[qid]=s;state.statEvents[uniqueKey]={eventId,at:new Date().toISOString(),userId,day,correct:!!input.correct,questionId:qid};writeState(state);}return send(res,200,{ok:true,qstats:readState().qstats});}catch(e){return send(res,400,{ok:false,error:e.message});}
 }


 if(apiPath==='/api/admin/reset-user-day'&&req.method==='POST'){
  try{
   const input=await bodyJson(req);const userId=String(input.userId||'');if(!userId)return send(res,400,{ok:false,error:'Usuário não informado.'});
   const state=readState();state.attempts=state.attempts||{};state.scores=state.scores||{};state.times=state.times||{};state.finishedRounds=state.finishedRounds||{};state.statEvents=state.statEvents||{};state.qstats=state.qstats||{};state.userResetVersions=state.userResetVersions||{};
   const attempt=state.attempts[userId];const requestedDay=Number(input.day)||0;const day=requestedDay||(attempt&&typeof attempt==='object'?Number(attempt.day):0);
   if(!attempt||typeof attempt!=='object'||(day&&Number(attempt.day)!==day))return send(res,404,{ok:false,error:'Não há rodada registrada para este usuário no dia selecionado.'});
   state.scores[userId]=Math.max(0,Number(state.scores[userId]||0)-Number(attempt.score||0));
   state.times[userId]=Math.max(0,Number(state.times[userId]||0)-Number(attempt.timeSeconds||0));
   delete state.attempts[userId];state.userResetVersions[userId]=Number(state.userResetVersions[userId]||0)+1;
   for(const [id,round] of Object.entries(state.finishedRounds)){if(round&&String(round.userId)===userId&&Number(round.day)===Number(attempt.day))delete state.finishedRounds[id];}
   for(const [key,event] of Object.entries(state.statEvents)){
    if(event&&String(event.userId)===userId&&Number(event.day)===Number(attempt.day)){
     const qid=String(event.questionId||key.split(':').pop());const stat=state.qstats[qid];
     if(stat){stat.attempts=Math.max(0,Number(stat.attempts||0)-1);if(typeof event.correct==='boolean'){if(event.correct)stat.correct=Math.max(0,Number(stat.correct||0)-1);else stat.wrong=Math.max(0,Number(stat.wrong||0)-1);}else{stat.correct=Math.min(Number(stat.correct||0),stat.attempts);stat.wrong=Math.max(0,stat.attempts-stat.correct);}}
     delete state.statEvents[key];
    }
   }
   writeState(state);return send(res,200,{ok:true,scores:state.scores,times:state.times,attempts:state.attempts,userResetVersions:state.userResetVersions,day:Number(attempt.day),userId});
  }catch(e){return send(res,400,{ok:false,error:e.message||'Falha ao zerar a rodada.'});}
 }
 if(apiPath==='/api/admin/reset-day'&&req.method==='POST'){
  try{const input=await bodyJson(req);const day=Number(input.day);if(!Number.isInteger(day)||day<1||day>4)return send(res,400,{ok:false,error:'Dia da rodada inválido.'});const state=readState();state.attempts=state.attempts||{};for(const [uid,a] of Object.entries(state.attempts)){if(a&&typeof a==='object'&&Number(a.day)===day)delete state.attempts[uid];}state.finishedRounds=state.finishedRounds||{};for(const [id,a] of Object.entries(state.finishedRounds)){if(a&&Number(a.day)===day)delete state.finishedRounds[id];}state.dailyResetVersion=Number(state.dailyResetVersion||0)+1;writeState(state);return send(res,200,{ok:true,attempts:state.attempts,dailyResetVersion:state.dailyResetVersion,resetVersion:state.resetVersion});}catch(e){return send(res,400,{ok:false,error:e.message});}
 }
 if(apiPath==='/api/admin/reset-all'&&req.method==='POST'){
  try{const state=readState();state.scores={};state.times={};state.attempts={};state.qstats={};state.finishedRounds={};state.statEvents={};state.campaign={start:'',end:''};state.dailyResetVersion=Number(state.dailyResetVersion||0)+1;state.resetVersion=Number(state.resetVersion||0)+1;writeState(state);return send(res,200,{ok:true,resetVersion:state.resetVersion,dailyResetVersion:state.dailyResetVersion});}
  catch(e){return send(res,500,{ok:false,error:e.message||'Falha ao zerar o jogo/período.'});}
 }
 if(apiPath==='/api/import-xlsx'&&req.method==='POST'){
  try{
   const input=await bodyJson(req);if(!['questions','users'].includes(input.type)||!input.contentBase64)return send(res,400,{ok:false,error:'Tipo de importação ou arquivo ausente.'});
   const XLSX=require('xlsx');const workbook=XLSX.read(Buffer.from(input.contentBase64,'base64'),{type:'buffer'});const preferred=input.type==='questions'?'Perguntas':'Usuarios';const sheet=workbook.Sheets[preferred]||workbook.Sheets[workbook.SheetNames[0]];if(!sheet)return send(res,400,{ok:false,error:'A planilha não contém uma aba válida.'});const rows=XLSX.utils.sheet_to_json(sheet,{defval:''});if(!rows.length)return send(res,400,{ok:false,error:'A aba selecionada está vazia.'});const state=readState();
   const norm=v=>String(v??'').trim();const truth=v=>['1','true','sim','yes','s','admin','x'].includes(norm(v).toLowerCase());const idx=v=>{const t=norm(v).toUpperCase();if(['A','B','C','D'].includes(t))return t.charCodeAt(0)-65;const n=Number(t);return Number.isInteger(n)&&n>=0&&n<=3?n:-1;};
   if(input.type==='questions'){
    if(rows.length!==40)throw new Error(`A planilha deve conter exatamente 40 perguntas. Foram encontradas ${rows.length}. Nenhuma alteração foi aplicada.`);
    const pt=[],es=[];for(let i=0;i<rows.length;i++){const r=rows[i];const id=Number(r.id)||i+1;const c=idx(r.correta??r.correct??r.resposta_correta);const w=truth(r.coringa??r.wild??r.joker);const qpt=norm(r.pergunta_pt??r.q_pt),qes=norm(r.pergunta_es??r.q_es);const apt=[norm(r.a_pt??r.alternativa_a_pt),norm(r.b_pt??r.alternativa_b_pt),norm(r.c_pt??r.alternativa_c_pt),norm(r.d_pt??r.alternativa_d_pt)];const aes=[norm(r.a_es??r.alternativa_a_es),norm(r.b_es??r.alternativa_b_es),norm(r.c_es??r.alternativa_c_es),norm(r.d_es??r.alternativa_d_es)];if(!qpt||!qes||apt.some(x=>!x)||aes.some(x=>!x)||c<0)throw new Error(`Linha ${i+2}: preencha pergunta e alternativas nos dois idiomas e indique correta como A, B, C ou D.`);pt.push({id,q:qpt,a:apt,c,w});es.push({id,q:qes,a:aes,c,w});}
    if(pt.length!==40)throw new Error('A planilha deve conter exatamente 40 perguntas.');state.questionsPt=pt;state.questionsEs=es;writeState(state);return send(res,200,{ok:true,questionsPt:pt,questionsEs:es,count:pt.length});
   } else {
    state.users=Array.isArray(state.users)?state.users:[];const byId=new Map(state.users.map(u=>[String(u.id),u]));for(let i=0;i<rows.length;i++){const r=rows[i];const username=norm(r.usuario??r.username??r.login);const password=norm(r.senha??r.password);if(!username||!password)throw new Error(`Linha ${i+2}: login e senha são obrigatórios.`);const id=norm(r.id)||('import-'+username.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]/g,'').toLowerCase()+'-'+(i+1));const prior=byId.get(id)||{};byId.set(id,{...prior,id,username,password,admin:truth(r.admin??r.administrador),system:prior.system===true});}state.users=[...byId.values()];writeState(state);return send(res,200,{ok:true,users:state.users,count:rows.length});
   }
  }catch(e){return send(res,400,{ok:false,error:e.message||'Falha na importação.'});}
 }

 const saveMatch=apiPath.match(/^\/api\/state\/(pt|es)$/);
 if(saveMatch&&req.method==='PUT'){
  try{const input=await bodyJson(req);const state=readState();if(Array.isArray(input.users)&&(input.usersDirty===true||!Array.isArray(state.users)))state.users=mergeUsers(state.users,input.users);if(input.campaign&&input.campaign.start&&input.campaign.end&&input.campaignDirty===true)state.campaign=input.campaign;if(Array.isArray(input.questions)&&(input.questionsDirty===true||!Array.isArray(state[saveMatch[1]==='pt'?'questionsPt':'questionsEs']))){if(input.questions.length!==40)return send(res,400,{ok:false,error:'A base deve conter exatamente 40 perguntas. A alteração não foi salva.'});syncCommonQuestionRules(state,saveMatch[1],input.questions);}writeState(state);return send(res,200,{ok:true,updatedAt:state.updatedAt});}catch(e){return send(res,400,{ok:false,error:e.message});}
 }
 if(apiPath.startsWith('/api/'))return send(res,404,{error:'Endpoint não encontrado'});
 let requested=decodeURIComponent(url.pathname);
 if(requested!=='/'&&!fs.existsSync(path.resolve(ROOT,'.'+requested))){const prefixEnd=requested.indexOf('/',1);if(prefixEnd>=0)requested=requested.slice(prefixEnd);}
 if(requested==='/')requested='/index.html';
 const filePath=path.resolve(ROOT,'.'+requested);if(!filePath.startsWith(ROOT+path.sep))return send(res,403,'Forbidden','text/plain');fs.readFile(filePath,(err,content)=>{if(err)return send(res,404,'Arquivo não encontrado','text/plain; charset=utf-8');res.writeHead(200,{'Content-Type':MIME[path.extname(filePath)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':path.extname(filePath)==='.html'?'no-cache':'public, max-age=3600'});res.end(content);});
}).listen(PORT,'0.0.0.0',()=>console.log(`Quiz Veloce disponível na porta ${PORT}`));
