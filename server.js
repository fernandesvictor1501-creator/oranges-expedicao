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
// Correção pontual solicitada da carga 114735 / JCP0F90: status PCP em vez de NÃO CARREGOU.
// A transação é idempotente e NÃO altera outras cargas ou ocorrências.
ready=ready.then(async()=>{
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const q=await client.query('SELECT dados FROM app_state WHERE id=1 FOR UPDATE');
  const state=q.rows[0]?.dados;
  if(!state){console.warn('PCP 114735: app_state ausente');await client.query('COMMIT');return}
  const containers=[...(Array.isArray(state.cargas)?state.cargas:[]),...(Array.isArray(state.cargasArquivadas)?state.cargasArquivadas:[])];
  const normalizePlate=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const candidates=containers.filter(c=>String(c.carga??'').trim()==='114735');
  console.log('PCP 114735: candidatos=',candidates.map(c=>({placa:normalizePlate(c.placa),status:c.status,temMotivo:Boolean(String(c.motivoNaoCarregou||'').trim())})));
  const matches=candidates.filter(c=>normalizePlate(c.placa)==='JCP0F90');
  const wrong=matches.filter(c=>Number(c.status)===6);
  if(wrong.length){
   const stamp=new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
   for(const c of wrong){
    c.status=7;c.pdpStatusAnterior=4;
    delete c.motivoNaoCarregou;delete c.dataNaoCarregou;
    c.atualizado=stamp;
   }
   state.historico=Array.isArray(state.historico)?state.historico:[];
   state.historico.unshift({data:stamp,placa:'JCP0F90',carga:'114735',antes:'Não carregou',depois:'Aguardando liberação PCP',origem:'Correção de situação solicitada pelo administrador'});
   await client.query('UPDATE app_state SET dados=$1::jsonb WHERE id=1',[JSON.stringify(state)]);
   console.log('PCP 114735: corrigido(s) '+wrong.length+' registro(s).');
  }else console.log('PCP 114735: nenhuma carga com placa JCP0F90 e status NÃO CARREGOU.');
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('PCP 114735: erro ao corrigir',e.message);throw e}
 finally{client.release()}
});
app.use(session({name:'oranges.sid',secret:process.env.SESSION_SECRET||crypto.randomBytes(48).toString('hex'),resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:1000*60*60*12}}));
app.use((req,res,next)=>{res.set('Cache-Control','no-store');next()});
const aut=(req,res,next)=>{if(req.session?.admin)return next();return res.status(401).json({error:'Não autorizado'})};const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readerAuth=require('./reader-auth')(app,pool,ready,aut);
const readerGate=readerAuth.readerGate;
const allow=readerAuth.readerCapability;
const getReaderPermissions=readerAuth.getPermissions;
app.use((req,res,next)=>{
 const pathname=req.path;
 if(pathname==='/api/public')return readerGate(req,res,next);
 if(pathname==='/api/public/productivity')return readerGate(req,res,()=>allow('produtividade')(req,res,next));
 if(pathname==='/api/ais/summary'||pathname.startsWith('/api/ais/file/'))return readerGate(req,res,()=>allow('tickets')(req,res,next));
 if(pathname==='/api/documents/summary'||pathname.startsWith('/api/documents/file/'))return readerGate(req,res,()=>allow('documentos')(req,res,next));
 if(pathname==='/api/nf-analysis'&&req.method==='GET')return readerGate(req,res,()=>allow('analiseNF')(req,res,next));
 return next();
});
app.post('/api/login',(req,res)=>{const u=String(req.body?.username||'');const p=String(req.body?.password||'');const expected=process.env.ADMIN_PASSWORD||'';if(!expected)return res.status(503).json({error:'Administrador não configurado'});const ok=u===(process.env.ADMIN_USER||'victor.fernandes')&&crypto.timingSafeEqual(crypto.createHash('sha256').update(p).digest(),crypto.createHash('sha256').update(expected).digest());if(!ok)return res.status(401).json({error:'Credenciais inválidas'});req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Erro de sessão'});req.session.admin=true;res.json({ok:true})})});
app.get('/api/public',async(req,res)=>{try{
 await ready;
 const q=await pool.query('SELECT dados FROM app_state WHERE id=1');
 const d=q.rows[0].dados||{};
 const project=c=>({
  placa:c.placa,carga:c.carga,pedido:c.pedido,cliente:c.cliente,produto:c.produto,
  quantidade:c.quantidade,transportadora:c.transportadora,motorista:c.motorista,
  cidade:c.cidade,frete:c.frete,status:c.status,atualizado:c.atualizado,
  dataProgramacao:c.dataProgramacao||'',motivoNaoCarregou:c.motivoNaoCarregou||'',dataNaoCarregou:c.dataNaoCarregou||''
 });
 // Dados de cargas arquivadas continuam somente para consulta; não alteram as operações atuais.
 const permissions=await getReaderPermissions(req);
 res.json({cargas:(permissions.includes('dashboard')||permissions.includes('anteriores'))?(d.cargas||[]).map(project):[],arquivadas:permissions.includes('anteriores')?(d.cargasArquivadas||[]).map(project):[]});
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
app.get('/iphone-tutorial.svg',(req,res)=>res.type('image/svg+xml').sendFile(path.join(__dirname,'iphone-tutorial.svg')));
app.get('/iphone-original-photos.svg',(req,res)=>res.type('image/svg+xml').sendFile(path.join(__dirname,'iphone-original-photos.svg')));
app.get('/app-icon.svg',(req,res)=>res.type('image/svg+xml').sendFile(path.join(__dirname,'app-icon.svg')));
app.get('/app-icon.png',(req,res)=>{const html=require('fs').readFileSync(path.join(__dirname,'admin.html'),'utf8');const m=html.match(/<link rel="icon" type="image\/png" href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);if(!m)return res.status(404).end();res.type('png').send(Buffer.from(m[1],'base64'))});
app.get('/sw.js',(req,res)=>res.type('application/javascript').set('Service-Worker-Allowed','/').sendFile(path.join(__dirname,'sw.js')));
app.get('/public-productivity.js',(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'public-productivity.js')));
app.get('/documents-public.js',(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'documents-public.js')));
app.get('/documents-admin.js',aut,(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'documents-admin.js')));
app.get('/plate-edit-admin.js',aut,(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'plate-edit-admin.js')));
app.get('/plate-delete-admin.js',aut,(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'plate-delete-admin.js')));
app.get('/reader-approvals.js',aut,(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'reader-approvals.js')));
app.get('/reading-ui.js',(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'reading-ui.js')));
app.get('/productivity.js',aut,(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'productivity.js')));
app.get('/ais-clean.js',aut,(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'ais-clean.js')));
app.get('/ais-upload.js',aut,(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'ais-upload.js')));
app.get('/ais-panel.js',aut,(req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'ais-panel.js')));
require('./ais')(app,aut);
require('./documents')(app,aut,pool,ready);
require('./plate-editor')(app,aut,pool,ready);
require('./nf-data')(app,aut,pool,ready);
app.get('/nf-analysis',readerGate,allow('analiseNF'),(req,res)=>res.sendFile(path.join(__dirname,'nf-analysis.html')));
app.get('/acesso',(req,res)=>res.sendFile(path.join(__dirname,'reader-login.html')));app.get('/login',(req,res)=>res.sendFile(path.join(__dirname,'login.html')));app.get('/admin',(req,res)=>{if(!req.session?.admin)return res.redirect('/login');res.sendFile(path.join(__dirname,'admin.html'))});app.get('/',(req,res)=>{if(!req.session?.readerId&&!req.session?.admin)return res.redirect('/acesso');readerGate(req,res,async()=>{try{const perms=await getReaderPermissions(req);const html=require('fs').readFileSync(path.join(__dirname,'public.html'),'utf8');const script='<script>window.ORANGES_PERMISSIONS='+JSON.stringify(perms)+';</script>';res.type('html').send(html.replace('</head>',script+'</head>'))}catch(e){console.error('Reader home',e.message);res.status(503).send('Painel indisponível')}})});app.get('*',(req,res)=>res.redirect('/'));const port=process.env.PORT||3000;app.listen(port,'0.0.0.0',()=>console.log('Oranges pronto na porta '+port));