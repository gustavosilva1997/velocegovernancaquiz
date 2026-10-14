const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'quiz-state.json');
const PORT = Number(process.env.PORT || 3000);
fs.mkdirSync(DATA_DIR, { recursive: true });
function blankState() { return { initialized:false, users:null, scores:{}, attempts:{}, qstats:{}, campaign:{start:'2026-10-01',end:'2026-10-04'}, questionsPt:null, questionsEs:null, finishedRounds:{}, statEvents:{}, updatedAt:null }; }
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
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end();}
 if(url.pathname==='/api/health'&&req.method==='GET')return send(res,200,{ok:true,service:'quiz-veloce'});
 if(url.pathname==='/api/state'&&req.method==='GET')return send(res,200,readState());
 if(url.pathname==='/api/finish'&&req.method==='POST'){
  try{const input=await bodyJson(req);const userId=String(input.userId||'');const day=Number(input.day);const date=String(input.date||'');const score=Math.max(0,Math.floor(Number(input.score)||0));const attemptId=String(input.attemptId||'');if(!userId||!attemptId||!date||!Number.isInteger(day)||day<1||day>4)return send(res,400,{ok:false,error:'Dados da partida incompletos.'});
   const state=readState();state.scores=state.scores||{};state.attempts=state.attempts||{};state.finishedRounds=state.finishedRounds||{};
   if(state.finishedRounds[attemptId])return send(res,200,{ok:true,alreadyRegistered:true,totalScore:Number(state.scores[userId]||0),attempt:state.attempts[userId]});
   const existing=state.attempts[userId];if(existing&&typeof existing==='object'&&(Number(existing.day)===day||existing.date===date))return send(res,200,{ok:true,alreadyCompleted:true,totalScore:Number(state.scores[userId]||0),attempt:existing});
   state.scores[userId]=Number(state.scores[userId]||0)+score;state.attempts[userId]={day,date,attemptId,score};state.finishedRounds[attemptId]={userId,day,date,score,at:new Date().toISOString()};writeState(state);return send(res,200,{ok:true,totalScore:state.scores[userId],attempt:state.attempts[userId]});
  }catch(e){return send(res,400,{ok:false,error:e.message});}
 }
 if(url.pathname==='/api/answer-stat'&&req.method==='POST'){
  try{const input=await bodyJson(req);const eventId=String(input.eventId||'');const qid=String(input.questionId||'');if(!eventId||!qid)return send(res,400,{ok:false,error:'Identificador da resposta ausente.'});const state=readState();state.qstats=state.qstats||{};state.statEvents=state.statEvents||{};if(!state.statEvents[eventId]){const s=state.qstats[qid]||{attempts:0,correct:0,wrong:0};s.attempts=Number(s.attempts||0)+1;if(input.correct)s.correct=Number(s.correct||0)+1;else s.wrong=Number(s.wrong||0)+1;state.qstats[qid]=s;state.statEvents[eventId]=new Date().toISOString();writeState(state);}return send(res,200,{ok:true,qstats:readState().qstats});}catch(e){return send(res,400,{ok:false,error:e.message});}
 }
 const saveMatch=url.pathname.match(/^\/api\/state\/(pt|es)$/);
 if(saveMatch&&req.method==='PUT'){
  try{const input=await bodyJson(req);const state=readState();if(Array.isArray(input.users))state.users=mergeUsers(state.users,input.users);if(input.scores&&typeof input.scores==='object')state.scores=mergeMap(state.scores,input.scores,'max');if(input.attempts&&typeof input.attempts==='object')state.attempts=mergeMap(state.attempts,input.attempts,'attempt');if(input.qstats&&typeof input.qstats==='object'){state.qstats=state.qstats||{};for(const [id,v] of Object.entries(input.qstats)){const old=state.qstats[id]||{};state.qstats[id]={attempts:Math.max(Number(old.attempts||0),Number(v.attempts||0)),correct:Math.max(Number(old.correct||0),Number(v.correct||0)),wrong:Math.max(Number(old.wrong||0),Number(v.wrong||0))};}}if(input.campaign&&input.campaign.start&&input.campaign.end&&input.campaignDirty===true)state.campaign=input.campaign;syncCommonQuestionRules(state,saveMatch[1],input.questions);writeState(state);return send(res,200,{ok:true,updatedAt:state.updatedAt});}catch(e){return send(res,400,{ok:false,error:e.message});}
 }
 if(url.pathname.startsWith('/api/'))return send(res,404,{error:'Endpoint não encontrado'});
 let requested=decodeURIComponent(url.pathname);if(requested==='/')requested='/index.html';const filePath=path.resolve(ROOT,'.'+requested);if(!filePath.startsWith(ROOT+path.sep))return send(res,403,'Forbidden','text/plain');fs.readFile(filePath,(err,content)=>{if(err)return send(res,404,'Arquivo não encontrado','text/plain; charset=utf-8');res.writeHead(200,{'Content-Type':MIME[path.extname(filePath)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':path.extname(filePath)==='.html'?'no-cache':'public, max-age=3600'});res.end(content);});
}).listen(PORT,'0.0.0.0',()=>console.log(`Quiz Veloce disponível na porta ${PORT}`));
