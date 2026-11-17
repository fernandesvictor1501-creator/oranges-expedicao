'use strict';
const crypto=require('crypto'), pdf=require('pdf-parse'),pg=require('pg');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});
const ready=pool.query("CREATE TABLE IF NOT EXISTS ais_tickets (id BIGSERIAL PRIMARY KEY,digest TEXT UNIQUE NOT NULL,filename TEXT NOT NULL,ticket_number TEXT,plate TEXT,load_number TEXT,gross_kg NUMERIC,tare_kg NUMERIC,net_kg NUMERIC,linked_plate TEXT,linked_load TEXT,match_status TEXT NOT NULL DEFAULT 'review',review_reason TEXT,imported_at TIMESTAMPTZ DEFAULT NOW())");
const plate=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const load=v=>String(v||'').trim();
function parse(text){
 const s=String(text||'').replace(/\s+/g,' '),p=[...s.matchAll(/\b([A-Z]{3}[-\s]?\d[A-Z0-9][0-9]{2})\b/gi)].map(x=>plate(x[1])),plates=[...new Set(p)];
 const ticket=s.match(/\bticket(?:\s*(?:de|da)\s*(?:pesagem|balan[cç]a))?\s*(?:n[º°o.]?\s*|n[uú]mero\s*|[:#-]\s*)(\d{3,15})\b/i);
 const carga=s.match(/\b(?:carga|carregamento)\s*(?:n[º°o.]?\s*|[:#-]\s*)(\d{3,14})\b/i);
 const weight=(label)=>{let m=s.match(new RegExp('\\b'+label+'\\s*[:=-]?\\s*([\\d.,]+)\\s*(?:kg)?','i'));if(!m)return null;let v=m[1];if(v.includes(',')&&v.includes('.'))v=v.replace(/\./g,'').replace(',','.');else if(v.includes(','))v=v.replace(',','.');else if(/^\d{1,3}(?:\.\d{3})+$/.test(v))v=v.replace(/\./g,'');let n=Number(v);return n>0&&n<120000?n:null};
 return {plates,plate:plates.length===1?plates[0]:null,ticket_number:ticket?.[1]||null,load_number:carga?.[1]||null,gross_kg:weight('peso\\s*bruto|bruto'),tare_kg:weight('tara'),net_kg:weight('peso\\s*l[ií]quido|l[ií]quido')};
}
async function cargos(){const q=await pool.query('SELECT dados FROM app_state WHERE id=1');return q.rows[0]?.dados?.cargas||[]}
function tokenAuth(req,res,next){const a=String(process.env.AIS_SYNC_TOKEN||''),b=String(req.get('x-ais-token')||'');if(!a||!b||b.length>256||!crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest()))return res.status(401).json({error:'Não autorizado'});next()}
module.exports=function(app,adminAuth){
 app.post('/api/ais/ingest',(req,res,next)=>req.session?.admin?next():tokenAuth(req,res,next),async(req,res)=>{
 const enc=String(req.body?.pdf_base64||''),filename=String(req.body?.filename||'ticket.pdf').replace(/[\/\\\x00-\x1f]/g,'_').slice(0,150);
 if(!enc||enc.length>11000000||!/^[A-Za-z0-9+/=]+$/.test(enc))return res.status(400).json({error:'PDF inválido ou maior que 8 MB'});
 const buf=Buffer.from(enc,'base64');if(buf.length>8388608||buf.subarray(0,5).toString()!=='%PDF-')return res.status(400).json({error:'PDF inválido ou maior que 8 MB'});
 const digest=crypto.createHash('sha256').update(buf).digest('hex');
 try{await ready;let old=await pool.query('SELECT id,match_status,review_reason FROM ais_tickets WHERE digest=$1',[digest]);if(old.rows.length)return res.json({ok:true,duplicate:true,id:old.rows[0].id,status:old.rows[0].match_status,reason:old.rows[0].review_reason});
 const parsed=parse((await pdf(buf,{max:8})).text);
 let match=[];if(parsed.plate)match=(await cargos()).filter(c=>plate(c.placa)===parsed.plate&&(!parsed.load_number||load(c.carga)===parsed.load_number));
 let status=parsed.ticket_number&&parsed.plates.length===1&&match.length===1?'linked':'review';
 let reason=status==='linked'?null:!parsed.ticket_number?'Número do ticket não identificado':parsed.plates.length!==1?'Placa ausente ou ambígua':match.length===0?'Carga não encontrada':'Mais de uma carga com a placa';
 let selected=status==='linked'?match[0]:null;
 let q=await pool.query('INSERT INTO ais_tickets(digest,filename,ticket_number,plate,load_number,gross_kg,tare_kg,net_kg,linked_plate,linked_load,match_status,review_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',[digest,filename,parsed.ticket_number,parsed.plate,parsed.load_number,parsed.gross_kg,parsed.tare_kg,parsed.net_kg,selected?plate(selected.placa):null,selected?load(selected.carga):null,status,reason]);
 res.json({ok:true,id:q.rows[0].id,status,reason,ticket:parsed.ticket_number,plate:parsed.plate});
 }catch(e){console.error('AIS PDF error',e.message);res.status(422).json({error:'Falha ao interpretar PDF. Verifique se o texto é selecionável'})}
 });
 app.get('/api/ais/tickets',adminAuth,async(req,res)=>{try{await ready;const q=await pool.query('SELECT id,filename,ticket_number,plate,load_number,gross_kg,tare_kg,net_kg,linked_plate,linked_load,match_status,review_reason,imported_at FROM ais_tickets ORDER BY imported_at DESC LIMIT 500');res.json({tickets:q.rows})}catch(e){res.status(503).json({error:'Tickets indisponíveis'})}});
 app.get('/api/ais/summary',async(req,res)=>{try{await ready;const q=await pool.query("SELECT linked_plate,linked_load,ticket_number FROM ais_tickets WHERE match_status='linked' ORDER BY imported_at DESC LIMIT 2000");res.json({tickets:q.rows})}catch(e){res.status(503).json({error:'Tickets indisponíveis'})}});
 app.post('/api/ais/tickets/:id/link',adminAuth,async(req,res)=>{let id=Number(req.params.id),p=plate(req.body?.plate),l=load(req.body?.carga);if(!Number.isSafeInteger(id)||id<1||!p||!l)return res.status(400).json({error:'Preencha placa e carga'});try{await ready;const found=(await cargos()).filter(c=>plate(c.placa)===p&&load(c.carga)===l);if(found.length!==1)return res.status(409).json({error:'Placa e carga não correspondem a uma única carga'});const q=await pool.query("UPDATE ais_tickets SET linked_plate=$1,linked_load=$2,match_status='linked',review_reason=NULL WHERE id=$3 RETURNING id",[p,l,id]);if(!q.rows.length)return res.status(404).json({error:'Ticket não encontrado'});res.json({ok:true})}catch(e){res.status(503).json({error:'Erro ao vincular'})}});
};