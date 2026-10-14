const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'quiz-state.json');
const PORT = Number(process.env.PORT || 3000);
fs.mkdirSync(DATA_DIR, { recursive: true });

function blankState() {
  return { initialized: false, users: null, scores: {}, attempts: {}, qstats: {},
    campaign: { start: '2026-10-01', end: '2026-10-04' }, questionsPt: null, questionsEs: null,
    updatedAt: null };
}
function readState() {
  try { return { ...blankState(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; }
  catch { return blankState(); }
}
function writeState(state) {
  state.initialized = true;
  state.updatedAt = new Date().toISOString();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}
function send(res, code, data, type='application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'same-origin', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 8 * 1024 * 1024) reject(new Error('Payload muito grande')); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}
function syncCommonQuestionRules(state, lang, questions) {
  const otherKey = lang === 'pt' ? 'questionsEs' : 'questionsPt';
  const currentKey = lang === 'pt' ? 'questionsPt' : 'questionsEs';
  state[currentKey] = Array.isArray(questions) ? questions : state[currentKey];
  // The correct-answer index and joker flag are language-neutral; mirror those
  // settings by question ID without overwriting the translated text/options.
  if (Array.isArray(questions) && Array.isArray(state[otherKey])) {
    const byId = new Map(questions.map(q => [String(q.id), q]));
    state[otherKey] = state[otherKey].map(q => {
      const match = byId.get(String(q.id));
      return match ? { ...q, c: match.c, w: match.w } : q;
    });
  }
}
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml',
  '.txt':'text/plain; charset=utf-8', '.json':'application/json; charset=utf-8' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods':'GET,PUT,OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type', 'Access-Control-Allow-Origin':'same-origin' }); return res.end();
  }
  if (url.pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok:true, service:'quiz-veloce' });
  if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, readState());
  const saveMatch = url.pathname.match(/^\/api\/state\/(pt|es)$/);
  if (saveMatch && req.method === 'PUT') {
    try {
      const input = await bodyJson(req);
      const state = readState();
      if (Array.isArray(input.users)) state.users = input.users;
      if (input.scores && typeof input.scores === 'object') state.scores = input.scores;
      if (input.attempts && typeof input.attempts === 'object') state.attempts = input.attempts;
      if (input.qstats && typeof input.qstats === 'object') state.qstats = input.qstats;
      if (input.campaign && input.campaign.start && input.campaign.end) state.campaign = input.campaign;
      syncCommonQuestionRules(state, saveMatch[1], input.questions);
      writeState(state);
      return send(res, 200, { ok:true, updatedAt:state.updatedAt });
    } catch (e) { return send(res, 400, { ok:false, error:e.message }); }
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error:'Endpoint não encontrado' });

  let requested = decodeURIComponent(url.pathname);
  if (requested === '/') requested = '/index.html';
  const filePath = path.resolve(ROOT, '.' + requested);
  if (!filePath.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  fs.readFile(filePath, (err, content) => {
    if (err) return send(res, 404, 'Arquivo não encontrado', 'text/plain; charset=utf-8');
    res.writeHead(200, { 'Content-Type':MIME[path.extname(filePath)] || 'application/octet-stream',
      'X-Content-Type-Options':'nosniff', 'Cache-Control': path.extname(filePath)==='.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(content);
  });
}).listen(PORT, '0.0.0.0', () => console.log(`Quiz Veloce disponível na porta ${PORT}`));
