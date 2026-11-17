'use strict';
const crypto=require('crypto'),pdfjs=require('pdfjs-dist/legacy/build/pdf.js'),pg=require('pg');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});
const ready=pool.query("CREATE TABLE IF NOT EXISTS ais_tickets (id BIGSERIAL PRIMARY KEY,digest TEXT UNIQUE NOT NULL,filename TEXT NOT NULL,ticket_number TEXT,plate TEXT,load_number TEXT,gross_kg NUMERIC,tare_kg NUMERIC,net_kg NUMERIC,linked_plate TEXT,linked_load TEXT,match_status TEXT NOT NULL DEFAULT 'review',review_reason TEXT,imported_at TIMESTAMPTZ DEFAULT NOW())");
const plate=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const load=v=>String(v||'').trim();
function parse(text){
 const source=String(text||'').normalize('NFKC').replace(/\s+/g,' ').trim();
 const ticket_number=[
   /\bTicket\s*(?:de\s*)?(?:Peso|Pesagem|Balan[cç]a)?\s*(?:N[º°o]\.?\s*|N[uú]mero\s*|#\s*|:\s*|-+\s*)(\d{5,15})\b/i,
   /\bN[º°o]\.?\s*(\d{6,15})\b/i
 ].map(re=>source.match(re)?.[1]).find(Boolean)||null;
 const plates=[...new Set([...source.matchAll(/\b([A-Z]{3}[-\s]?\d[A-Z0-9]\d{2})\b/gi)].map(x=>plate(x[1])))];
 const carga=source.match(/\b(?:OE\s*\/\s*)?Carga\s*(?:N[º°o]\.?\s*|:|#|-)?\s*(\d{3,14})\b/i);
 function value(labels){
   const m=source.match(new RegExp('(?:^|\\b)(?:'+labels+')\\s*[:=]\\s*(-?\\d[\\d.,]*)\\s*(?:kg)?','i'));
   if(!m?.[1])return null;
   const raw=m[1].trim();
   const cleaned=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'): /^-?\d{1,3}(?:\.\d{3})+$/.test(raw)?raw.replace(/\./g,''):raw;
   const n=Number(cleaned);
   // 1a pesagem AIS: bruto zero e líquido negativo não representam o peso final.
   return Number.isFinite(n)&&n>0&&n<=120000?n:null;
 }
 const firstWeighing=/\b(?:SA[IÍ]DA|ENTRADA)\s*\(\s*1[aª]?\s*Pes\.?\s*\)/i.test(source);
 return {plates,plate:plates.length===1?plates[0]:null,ticket_number,load_number:carga?.[1]||null,gross_kg:value('Peso\\s*Bruto'),tare_kg:value('Tara(?!\\s*Adicional)'),net_kg:value('Peso\\s*L[ií]quido|Peso\\s*L[ií]q\\.?\\s*\\(Ve[ií]culo\\)'),firstWeighing};
}
async function cargos(){const q=await pool.query('SELECT dados FROM app_state WHERE id=1');return q.rows[0]?.dados?.cargas||[]}
function tokenAuth(req,res,next){const a=String(process.env.AIS_SYNC_TOKEN||''),b=String(req.get('x-ais-token')||'');if(!a||!b||b.length>256||!crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest()))return res.status(401).json({error:'Não autorizado'});next()}
module.exports=function(app,adminAuth){
 app.post('/api/ais/ingest',(req,res,next)=>req.session?.admin?next():tokenAuth(req,res,next),async(req,res)=>{
 const enc=String(req.body?.file_base64||req.body?.pdf_base64||''),filename=String(req.body?.filename||'ticket.pdf').replace(/[\/\\\x00-\x1f]/g,'_').slice(0,150);
 if(!enc||enc.length>11000000||!/^[A-Za-z0-9+/=]+$/.test(enc))return res.status(400).json({error:'Arquivo inválido ou maior que 8 MB'});
 const buf=Buffer.from(enc,'base64');const isPdf=filename.toLowerCase().endsWith('.pdf'),isXml=filename.toLowerCase().endsWith('.xml');if(buf.length>8388608||!buf.length||(!isPdf&&!isXml)||(isPdf&&buf.subarray(0,5).toString()!=='%PDF-'))return res.status(400).json({error:'Envie um PDF ou XML válido de até 8 MB'});
 const digest=crypto.createHash('sha256').update(buf).digest('hex');
 try{await ready;let old=await pool.query('SELECT id,match_status,review_reason FROM ais_tickets WHERE digest=$1',[digest]);if(old.rows.length&&old.rows[0].match_status==='linked'&&old.rows[0].review_reason!=='1ª pesagem: aguardando pesagem final')return res.json({ok:true,duplicate:true,id:old.rows[0].id,status:old.rows[0].match_status,reason:old.rows[0].review_reason});
 let extracted='';
 if(isXml){
   let xmlText=buf.toString('utf8').replace(/^\uFEFF/,'').trim();
   if(!/^<\?xml\b|^<[A-Za-z_][\w:.-]*[\s>]/i.test(xmlText)||/<!DOCTYPE|<!ENTITY/i.test(xmlText))return res.status(422).json({error:'XML inválido ou com conteúdo não permitido'});
   // Textos e campos explícitos são preservados para a identificação, sem executar entidades externas.
   extracted=xmlText.replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos);/g,' ');
   const field=(names)=>{for(const name of names){const match=xmlText.match(new RegExp('<(?:[\\w-]+:)?'+name+'(?:\\s[^>]*)?>([^<]{1,140})<\\/(?:[\\w-]+:)?'+name+'>','i'));if(match)return match[1].trim()}return null};
   const maybeTicket=field(['numeroTicket','numTicket','nTicket','ticket','numero_tiquete','nrTicket','numeroPesagem']);
   const maybePlate=field(['placa','placaVeiculo','placaCavalo','placa_veiculo']);
   const maybeLoad=field(['carga','numeroCarga','numCarga']);
   const pairs=[maybeTicket&&' Ticket: '+maybeTicket,maybePlate&&' Placa: '+maybePlate,maybeLoad&&' Carga: '+maybeLoad].filter(Boolean);
   extracted=pairs.join(' ')+ ' ' + extracted;
 }else{
 try{
   const loading=pdfjs.getDocument({data:new Uint8Array(buf),useSystemFonts:true,disableFontFace:true,isEvalSupported:false,stopAtErrors:false});
   const document=await loading.promise;
   try{
     const count=Math.min(document.numPages,12);
     for(let page=1;page<=count;page++){
       const p=await document.getPage(page);
       const content=await p.getTextContent({disableCombineTextItems:false});
       extracted+=' '+content.items.map(item=>item.str||'').join(' ');
       p.cleanup();
     }
   }finally{await document.destroy()}
 }catch(error){
   console.error('AIS PDF parsing failed',filename,error.message);
   return res.status(422).json({error:'Não foi possível extrair texto deste PDF. Se ele for uma imagem digitalizada, envie um exemplo para configurar leitura OCR.',code:'PDF_READ_ERROR'});
 }
 }
 if(!extracted.trim())return res.status(422).json({error:'O arquivo não possui texto legível; para PDFs digitalizados será necessário OCR.',code:'NO_TEXT'});
 const parsed=parse(extracted);
 let match=[];if(parsed.plate)match=(await cargos()).filter(c=>plate(c.placa)===parsed.plate&&(!parsed.load_number||load(c.carga)===parsed.load_number));
 let status=parsed.ticket_number&&parsed.plates.length===1&&match.length===1?'linked':'review';
 let reason=status==='linked'?(parsed.firstWeighing?'1ª pesagem: aguardando pesagem final':null):!parsed.ticket_number?'Número do ticket não identificado':parsed.plates.length!==1?'Placa ausente ou ambígua':match.length===0?'Carga não encontrada':'Mais de uma carga com a placa';
 let selected=status==='linked'?match[0]:null;
 let q;
 const values=[digest,filename,parsed.ticket_number,parsed.plate,parsed.load_number,parsed.gross_kg,parsed.tare_kg,parsed.net_kg,selected?plate(selected.placa):null,selected?load(selected.carga):null,status,reason];
 if(old.rows.length){
  q=await pool.query('UPDATE ais_tickets SET filename=$2,ticket_number=$3,plate=$4,load_number=$5,gross_kg=$6,tare_kg=$7,net_kg=$8,linked_plate=$9,linked_load=$10,match_status=$11,review_reason=$12 WHERE digest=$1 RETURNING id',values);
 }else{
  q=await pool.query('INSERT INTO ais_tickets(digest,filename,ticket_number,plate,load_number,gross_kg,tare_kg,net_kg,linked_plate,linked_load,match_status,review_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',values);
 }
 res.json({ok:true,id:q.rows[0].id,status,reason,ticket:parsed.ticket_number,plate:parsed.plate});
 }catch(e){console.error('AIS PDF error',e.message);res.status(503).json({error:'Erro interno no processamento do ticket. Consulte o painel de logs.',code:'AIS_PROCESSING_ERROR'})}
 });
 app.get('/api/ais/tickets',adminAuth,async(req,res)=>{try{await ready;const q=await pool.query('SELECT id,filename,ticket_number,plate,load_number,gross_kg,tare_kg,net_kg,linked_plate,linked_load,match_status,review_reason,imported_at FROM ais_tickets ORDER BY imported_at DESC LIMIT 500');res.json({tickets:q.rows})}catch(e){res.status(503).json({error:'Tickets indisponíveis'})}});
 app.get('/api/ais/summary',async(req,res)=>{try{await ready;const q=await pool.query("SELECT linked_plate,linked_load,ticket_number FROM ais_tickets WHERE match_status='linked' ORDER BY imported_at DESC LIMIT 2000");res.json({tickets:q.rows})}catch(e){res.status(503).json({error:'Tickets indisponíveis'})}});

 // Exclusão administrativa exclusivamente da tabela de tickets AIS.
 app.get('/api/ais/admin/stats',adminAuth,async(req,res)=>{
  try{await ready;const q=await pool.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE match_status='linked')::int AS linked, COUNT(*) FILTER (WHERE match_status<>'linked')::int AS review FROM ais_tickets");res.json(q.rows[0])}
  catch(e){console.error('AIS stats',e.message);res.status(503).json({error:'Não foi possível consultar tickets'})}
 });
 app.get('/api/ais/admin/backup',adminAuth,async(req,res)=>{
  try{await ready;const q=await pool.query('SELECT * FROM ais_tickets ORDER BY id');
  res.set('Content-Disposition','attachment; filename="backup_tickets_ais.json"');
  res.type('application/json').send(JSON.stringify({exportedAt:new Date().toISOString(),system:'Oranges Alimentos',tickets:q.rows},null,2));
  }catch(e){console.error('AIS backup',e.message);res.status(503).json({error:'Não foi possível gerar o backup'})}
 });
 app.post('/api/ais/admin/clear',adminAuth,async(req,res)=>{
  const origin=req.get('origin');
  if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Origem não permitida'})}catch(e){return res.status(403).json({error:'Origem inválida'})}}
  if(req.body?.confirmation!=='LIMPAR TICKETS AIS'||!Number.isSafeInteger(req.body?.expectedCount)||req.body.expectedCount<0)
   return res.status(400).json({error:'Confirmação inválida'});
  const client=await pool.connect().catch(()=>null);
  if(!client)return res.status(503).json({error:'Banco indisponível'});
  try{
   await ready;
   await client.query('BEGIN');
   await client.query('LOCK TABLE ais_tickets IN EXCLUSIVE MODE');
   const before=await client.query('SELECT COUNT(*)::int AS total FROM ais_tickets');
   const total=before.rows[0].total;
   if(total!==req.body.expectedCount){await client.query('ROLLBACK');return res.status(409).json({error:'A lista de tickets mudou. Atualize a contagem antes de limpar.',total})}
   const result=await client.query('DELETE FROM ais_tickets');
   await client.query('COMMIT');
   res.json({ok:true,deleted:result.rowCount});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('AIS clean',e.message);res.status(503).json({error:'Não foi possível limpar os tickets'})}
  finally{client.release()}
 });
 app.post('/api/ais/tickets/:id/link',adminAuth,async(req,res)=>{let id=Number(req.params.id),p=plate(req.body?.plate),l=load(req.body?.carga);if(!Number.isSafeInteger(id)||id<1||!p||!l)return res.status(400).json({error:'Preencha placa e carga'});try{await ready;const found=(await cargos()).filter(c=>plate(c.placa)===p&&load(c.carga)===l);if(found.length!==1)return res.status(409).json({error:'Placa e carga não correspondem a uma única carga'});const q=await pool.query("UPDATE ais_tickets SET linked_plate=$1,linked_load=$2,match_status='linked',review_reason=NULL WHERE id=$3 RETURNING id",[p,l,id]);if(!q.rows.length)return res.status(404).json({error:'Ticket não encontrado'});res.json({ok:true})}catch(e){res.status(503).json({error:'Erro ao vincular'})}});
};