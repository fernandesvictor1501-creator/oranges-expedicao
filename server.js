const express=require('express');const session=require('express-session');const pg=require('pg');const crypto=require('crypto');const path=require('path');const app=express();app.disable('x-powered-by');app.set('trust proxy',1);app.use(express.json({limit:'12mb'}));
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});
const empty={cargas:[],historico:[],tickets:[]};let ready=pool.query("CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY, dados JSONB NOT NULL)").then(()=>pool.query("INSERT INTO app_state(id,dados) VALUES(1,$1::jsonb) ON CONFLICT (id) DO NOTHING",[JSON.stringify(empty)]));
// Migração idempotente da sequência de 5 para 6 etapas, preservando cargas e histórico.
const FLOW_VERSION=2;
function upgradeFlow(state){
  if(!state || Number(state.statusFlowVersion)>=FLOW_VERSION)return state;
  const convert=n=>({0:0,1:1,2:3,3:4,4:5}[Number(n)]??0);
  const next={...state,statusFlowVersion:FLOW_VERSION};
  next.cargas=(Array.isArray(state.cargas)?state.cargas:[]).map(c=>({...c,status:convert(c.status)}));
  return next;
}
ready=ready.then(async()=>{
  const result=await pool.query('SELECT dados FROM app_state WHERE id=1');
  if(!result.rows.length)return;
  const current=result.rows[0].dados;
  if(Number(current?.statusFlowVersion)>=FLOW_VERSION)return;
  const changed=upgradeFlow(current);
  await pool.query("UPDATE app_state SET dados=$1::jsonb WHERE id=1 AND (dados->>'statusFlowVersion') IS DISTINCT FROM '2'",[JSON.stringify(changed)]);
  console.log('Etapas de carregamento atualizadas para 6 fases');
});
app.use(session({name:'oranges.sid',secret:process.env.SESSION_SECRET||crypto.randomBytes(48).toString('hex'),resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:1000*60*60*12}}));
app.use((req,res,next)=>{res.set('Cache-Control','no-store');next()});
const aut=(req,res,next)=>{if(req.session?.admin)return next();return res.status(401).json({error:'Não autorizado'})};const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
app.post('/api/login',(req,res)=>{const u=String(req.body?.username||'');const p=String(req.body?.password||'');const expected=process.env.ADMIN_PASSWORD||'';if(!expected)return res.status(503).json({error:'Administrador não configurado'});const ok=u===(process.env.ADMIN_USER||'victor.fernandes')&&crypto.timingSafeEqual(crypto.createHash('sha256').update(p).digest(),crypto.createHash('sha256').update(expected).digest());if(!ok)return res.status(401).json({error:'Credenciais inválidas'});req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Erro de sessão'});req.session.admin=true;res.json({ok:true})})});
app.get('/api/public',async(req,res)=>{try{
 await ready;
 const q=await pool.query('SELECT dados FROM app_state WHERE id=1');
 const d=q.rows[0].dados||{};
 const project=c=>({
  placa:c.placa,carga:c.carga,pedido:c.pedido,cliente:c.cliente,produto:c.produto,
  quantidade:c.quantidade,transportadora:c.transportadora,motorista:c.motorista,
  cidade:c.cidade,frete:c.frete,status:c.status,atualizado:c.atualizado,
  dataProgramacao:c.dataProgramacao||''
 });
 // Dados de cargas arquivadas continuam somente para consulta; não alteram as operações atuais.
 res.json({cargas:(d.cargas||[]).map(project),arquivadas:(d.cargasArquivadas||[]).map(project)});
 }catch(e){console.error(e);res.status(503).json({error:'Banco indisponível'})}
});
// Histórico público limitado ao cálculo de duração das etapas. Dados de usuários e observações não são divulgados.
app.get('/api/public/productivity',async(req,res)=>{
 try{
  await ready;
  const q=await pool.query('SELECT dados FROM app_state WHERE id=1');
  const d=q.rows[0].dados||{};
  const loads=(Array.isArray(d.cargas)?d.cargas:[]).map(c=>({
   placa:String(c.placa||''),carga:String(c.carga||''),cliente:String(c.cliente||''),
   status:Number(c.status)||0,dataProgramacao:String(c.dataProgramacao||'')
  }));
  const allowed=new Set(loads.map(c=>c.placa.toUpperCase().replace(/[^A-Z0-9]/g,'')+'|'+c.carga.trim()));
  const historico=(Array.isArray(d.historico)?d.historico:[]).filter(h=>allowed.has(String(h.placa||'').toUpperCase().replace(/[^A-Z0-9]/g,'')+'|'+String(h.carga||'').trim())).slice(-6000).map(h=>({
   placa:String(h.placa||''),carga:String(h.carga||''),depois:String(h.depois||''),data:String(h.data||'')
  }));
  res.set('Cache-Control','no-store').json({cargas:loads,historico});
 }catch(e){console.error('Public productivity',e.message);res.status(503).json({error:'Indicadores indisponíveis'})}
});
app.get('/api/state',aut,async(req,res)=>{try{await ready;const q=await pool.query('SELECT dados FROM app_state WHERE id=1');res.json(q.rows[0].dados)}catch(e){console.error(e);res.status(503).json({error:'Banco indisponível'})}});
app.put('/api/state',aut,async(req,res)=>{const d=upgradeFlow(req.body);if(!d||!Array.isArray(d.cargas)||!Array.isArray(d.historico)||!Array.isArray(d.tickets))return res.status(400).json({error:'Formato inválido'});try{await ready;await pool.query('UPDATE app_state SET dados=$1::jsonb WHERE id=1',[JSON.stringify(d)]);res.json({ok:true})}catch(e){console.error(e);res.status(503).json({error:'Não foi possível salvar'})}});
app.get('/health',async(req,res)=>{try{await ready;await pool.query('SELECT 1');res.json({ok:true})}catch(e){res.status(503).json({ok:false})}});
app.get('/manifest.webmanifest',(req,res)=>res.type('application/manifest+json').sendFile(path.join(__dirname,'manifest.webmanifest')));
app.get('/barra-mansa-symbol.svg',(req,res)=>res.type('image/svg+xml').sendFile(path.join(__dirname,'barra-mansa-symbol.svg')));
app.get('/oranges-symbol.svg',(req,res)=>res.type('image/svg+xml').sendFile(path.join(__dirname,'oranges-symbol.svg')));
app.get('/app-icon.svg',(req,res)=>res.type('image/svg+xml').sendFile(path.join(__dirname,'app-icon.svg')));
app.get('/app-icon.png',(req,res)=>{const html=require('fs').readFileSync(path.join(__dirname,'admin.html'),'utf8');const m=html.match(/<link rel="icon" type="image\/png" href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);if(!m)return res.status(404).end();res.type('png').send(Buffer.from(m[1],'base64'))});
app.get('/sw.js',(req,res)=>res.type('application/javascript').set('Service-Worker-Allowed','/').sendFile(path.join(__dirname,'sw.js')));
app.get('/public-productivity.js',(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'public-productivity.js')));
app.get('/documents-public.js',(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'documents-public.js')));
app.get('/documents-admin.js',aut,(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'documents-admin.js')));
app.get('/reading-ui.js',(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'reading-ui.js')));
app.get('/productivity.js',aut,(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'productivity.js')));
app.get('/ais-clean.js',aut,(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'ais-clean.js')));
app.get('/ais-upload.js',aut,(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'ais-upload.js')));
app.get('/ais-panel.js',aut,(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'ais-panel.js')));
require('./ais')(app,aut);
require('./documents')(app,aut,pool,ready);
require('./nf-data')(app,aut,pool,ready);
app.get('/nf-analysis',(req,res)=>res.sendFile(path.join(__dirname,'nf-analysis.html')));
app.get('/login',(req,res)=>res.sendFile(path.join(__dirname,'login.html')));app.get('/admin',aut,(req,res)=>res.sendFile(path.join(__dirname,'admin.html')));app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public.html')));app.get('*',(req,res)=>res.redirect('/'));const port=process.env.PORT||3000;app.listen(port,'0.0.0.0',()=>console.log('Oranges pronto na porta '+port));