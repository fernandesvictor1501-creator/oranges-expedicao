'use strict';
const crypto=require('crypto');
const attempts=new Map();
const email=v=>String(v||'').trim().toLowerCase();
function rate(req,label,max){const key=label+':'+req.ip,now=Date.now();const q=attempts.get(key);if(!q||now>q.until){attempts.set(key,{count:1,until:now+900000});return false}return ++q.count>max}
function hashPass(pass){const salt=crypto.randomBytes(16).toString('hex');return salt+':'+crypto.scryptSync(pass,salt,64).toString('hex')}
function validPass(pass,hash){try{const [salt,digest]=String(hash).split(':');const a=Buffer.from(digest,'hex'),b=crypto.scryptSync(pass,salt,64);return a.length===b.length&&crypto.timingSafeEqual(a,b)}catch(e){return false}}
module.exports=function(app,pool,ready,adminAuth){
const SECTORS=['Faturamento','Expedição','Logística','Administrativo','Outros'];
const PERMS=['dashboard','tickets','documentos','analiseNF','produtividade','anteriores'];
const checkPerms=p=>Array.isArray(p)&&p.length<=6&&p.every(v=>PERMS.includes(v))?[...new Set(p)]:null;
const init=Promise.resolve(ready).then(async()=>{
 await pool.query("CREATE TABLE IF NOT EXISTS reader_accounts (id BIGSERIAL PRIMARY KEY,full_name VARCHAR(130) NOT NULL,email VARCHAR(255) NOT NULL UNIQUE,password_hash TEXT,google_sub TEXT UNIQUE,status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),reviewed_at TIMESTAMPTZ,last_login_at TIMESTAMPTZ)");
 await pool.query("ALTER TABLE reader_accounts ADD COLUMN IF NOT EXISTS sector VARCHAR(40) NOT NULL DEFAULT 'Outros'");
 await pool.query("ALTER TABLE reader_accounts ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[\"dashboard\",\"tickets\",\"documentos\",\"analiseNF\",\"produtividade\",\"anteriores\"]'::jsonb");
});
const googleReady=()=>!!(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET);
const redirectUri=()=>process.env.GOOGLE_REDIRECT_URI||'https://oranges-expedicao-online.onrender.com/auth/google/callback';
const error=(res,message,code=400)=>res.status(code).json({error:message});
const safe=u=>({id:u.id,name:u.full_name,email:u.email,status:u.status,sector:u.sector||'Outros',permissions:checkPerms(u.permissions)||[]});
const readerGate=async(req,res,next)=>{
 if(req.session?.admin)return next();
 const id=Number(req.session?.readerId);
 if(!Number.isSafeInteger(id)||id<1)return error(res,'Entre com uma conta aprovada.',401);
 try{await init;const q=await pool.query('SELECT status FROM reader_accounts WHERE id=$1',[id]);if(q.rows[0]?.status==='approved')return next();delete req.session.readerId;return error(res,'Acesso ainda não aprovado ou revogado.',403)}
 catch(e){console.error('reader gate',e.message);return error(res,'Acesso indisponível.',503)}
};
const getPermissions=async req=>{
 if(req.session?.admin)return PERMS;
 const id=Number(req.session?.readerId);if(!Number.isSafeInteger(id)||id<1)return [];
 await init;const q=await pool.query("SELECT permissions FROM reader_accounts WHERE id=$1 AND status='approved'",[id]);
 return checkPerms(q.rows[0]?.permissions)||[];
};
const readerCapability=cap=>async(req,res,next)=>{
 try{const p=await getPermissions(req);if(!p.includes(cap))return error(res,'Acesso não permitido para este setor/usuário.',403);next()}
 catch(e){console.error('permission',e.message);error(res,'Não foi possível verificar permissões.',503)}
};
app.get('/api/reader/config',(req,res)=>res.json({google_enabled:googleReady(),sectors:SECTORS}));
app.get('/api/reader/me',async(req,res)=>{
 if(req.session?.admin)return res.json({authenticated:true,admin:true,name:'Administrador'});
 if(!req.session?.readerId)return res.json({authenticated:false});
 try{await init;const q=await pool.query('SELECT id,full_name,email,status,sector,permissions FROM reader_accounts WHERE id=$1',[req.session.readerId]);const u=q.rows[0];res.json({authenticated:!!u&&u.status==='approved',user:u?safe(u):null})}
 catch(e){res.status(503).json({authenticated:false,error:'Indisponível'})}
});
app.post('/api/reader/register',async(req,res)=>{
 if(rate(req,'register',12))return error(res,'Muitas tentativas. Tente novamente mais tarde.',429);
 const name=String(req.body?.name||'').trim().replace(/\s+/g,' '),mail=email(req.body?.email),pass=String(req.body?.password||''),sector=String(req.body?.sector||'');
 if(!SECTORS.includes(sector))return error(res,'Selecione seu setor.');
 if(name.length<3||name.length>130)return error(res,'Informe seu nome completo.');
 if(mail.length>255||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail))return error(res,'E-mail inválido.');
 if(pass.length<10||pass.length>128)return error(res,'A senha deve ter entre 10 e 128 caracteres.');
 try{await init;await pool.query('INSERT INTO reader_accounts(full_name,email,password_hash,sector,permissions) VALUES($1,$2,$3,$4,$5::jsonb)',[name,mail,hashPass(pass),sector,JSON.stringify([])]);res.status(201).json({ok:true,message:'Cadastro enviado para aprovação.'})}
 catch(e){if(e.code==='23505')return error(res,'Este e-mail já está cadastrado ou possui solicitação.',409);console.error('reader register',e.message);return error(res,'Cadastro indisponível.',503)}
});
app.post('/api/reader/login',async(req,res)=>{
 if(rate(req,'login',32))return error(res,'Muitas tentativas. Tente novamente mais tarde.',429);
 const mail=email(req.body?.email),pass=String(req.body?.password||'');
 if(!mail||!pass)return error(res,'Informe e-mail e senha.');
 try{
  await init;const q=await pool.query('SELECT id,full_name,email,password_hash,status,sector,permissions FROM reader_accounts WHERE email=$1',[mail]);
  const u=q.rows[0];if(!u?.password_hash||!validPass(pass,u.password_hash))return error(res,'Credenciais inválidas.',401);
  if(u.status==='pending')return error(res,'Seu cadastro aguarda aprovação do administrador.',403);
  if(u.status!=='approved')return error(res,'Acesso recusado. Procure o administrador.',403);
  req.session.regenerate(err=>{if(err)return error(res,'Falha ao iniciar sessão.',503);req.session.readerId=u.id;pool.query('UPDATE reader_accounts SET last_login_at=now() WHERE id=$1',[u.id]).catch(()=>{});res.json({ok:true,user:safe(u)})});
 }catch(e){console.error('reader login',e.message);error(res,'Login indisponível.',503)}
});
app.post('/api/reader/logout',(req,res)=>req.session.destroy(()=>{res.clearCookie('oranges.sid');res.json({ok:true})}));
app.get('/auth/google',(req,res)=>{
 if(!googleReady())return res.redirect('/acesso?erro=google');
 if(rate(req,'google',30))return res.redirect('/acesso?erro=limite');
 const state=crypto.randomBytes(24).toString('hex');req.session.googleState=crypto.createHash('sha256').update(state).digest('hex');
 req.session.save(err=>{if(err)return res.redirect('/acesso?erro=servidor');const p=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:redirectUri(),response_type:'code',scope:'openid email profile',state,prompt:'select_account'});res.redirect('https://accounts.google.com/o/oauth2/v2/auth?'+p)});
});
app.get('/auth/google/callback',async(req,res)=>{
 const state=String(req.query.state||''),expected=req.session?.googleState,code=String(req.query.code||'');delete req.session.googleState;
 const computed=crypto.createHash('sha256').update(state).digest('hex');
 if(!expected||!state||!code||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(computed))||!googleReady())return res.redirect('/acesso?erro=google');
 try{
  await init;
  const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:redirectUri(),grant_type:'authorization_code'})});
  if(!tokenResponse.ok)throw Error('token');const tok=await tokenResponse.json();if(!tok.access_token)throw Error('token empty');
  const infoResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+tok.access_token}});
  if(!infoResponse.ok)throw Error('userinfo');const info=await infoResponse.json();
  if(info.email_verified!==true||!info.sub||!info.email)throw Error('unverified email');
  const mail=email(info.email),sub=String(info.sub),name=String(info.name||mail.split('@')[0]).slice(0,130);
  const q=await pool.query('INSERT INTO reader_accounts(full_name,email,google_sub,sector,permissions) VALUES($1,$2,$3,'Outros','[]'::jsonb) ON CONFLICT(email) DO UPDATE SET google_sub=COALESCE(reader_accounts.google_sub, EXCLUDED.google_sub) RETURNING id,full_name,email,status,google_sub,sector,permissions',[name,mail,sub]);
  const u=q.rows[0];if(u.google_sub!==sub)throw Error('different Google identity');
  if(u.status==='pending')return res.redirect('/acesso?status=pendente');
  if(u.status!=='approved')return res.redirect('/acesso?status=recusado');
  req.session.regenerate(err=>{if(err)return res.redirect('/acesso?erro=servidor');req.session.readerId=u.id;pool.query('UPDATE reader_accounts SET last_login_at=now() WHERE id=$1',[u.id]).catch(()=>{});res.redirect('/')});
 }catch(e){console.error('Google OAuth',e.message);res.redirect('/acesso?erro=google')}
});
app.get('/api/reader/admin/requests',adminAuth,async(req,res)=>{
 try{await init;const q=await pool.query("SELECT id,full_name,email,status,sector,permissions,created_at,reviewed_at,last_login_at,(google_sub IS NOT NULL) AS google FROM reader_accounts ORDER BY (status='pending') DESC,created_at DESC LIMIT 500");res.json({accounts:q.rows})}
 catch(e){console.error('requests',e.message);error(res,'Não foi possível consultar solicitações.',503)}
});
app.post('/api/reader/admin/requests/:id',adminAuth,async(req,res)=>{
 const id=Number(req.params.id),decision=String(req.body?.decision||''),sector=String(req.body?.sector||''),permissions=checkPerms(req.body?.permissions);
 if(!Number.isSafeInteger(id)||id<1||!['approved','rejected'].includes(decision))return error(res,'Solicitação ou decisão inválida.');
 if(decision==='approved'&&(!SECTORS.includes(sector)||!permissions||!permissions.length))return error(res,'Selecione setor e pelo menos uma permissão.');
 try{await init;const q=await pool.query("UPDATE reader_accounts SET status=$1,sector=CASE WHEN $1='approved' THEN $3 ELSE sector END,permissions=CASE WHEN $1='approved' THEN $4::jsonb ELSE permissions END,reviewed_at=now() WHERE id=$2 AND status='pending' RETURNING id",[decision,id,sector,JSON.stringify(permissions||[])]);if(!q.rowCount)return error(res,'Solicitação já analisada.',409);res.json({ok:true,status:decision})}
 catch(e){console.error('approval',e.message);error(res,'Falha ao avaliar solicitação.',503)}
});
app.post('/api/reader/admin/accounts/:id',adminAuth,async(req,res)=>{
 const id=Number(req.params.id),sector=String(req.body?.sector||''),permissions=checkPerms(req.body?.permissions);
 if(!Number.isSafeInteger(id)||id<1||!SECTORS.includes(sector)||!permissions||!permissions.length)return error(res,'Selecione setor e pelo menos uma permissão.');
 try{await init;const q=await pool.query("UPDATE reader_accounts SET sector=$1,permissions=$2::jsonb WHERE id=$3 AND status='approved' RETURNING id",[sector,JSON.stringify(permissions),id]);
 if(!q.rowCount)return error(res,'Conta aprovada não encontrada.',404);res.json({ok:true});}
 catch(e){console.error('edit permissions',e.message);error(res,'Não foi possível alterar o acesso.',503)}
});
return {readerGate,readerCapability,getPermissions,googleReady};
};