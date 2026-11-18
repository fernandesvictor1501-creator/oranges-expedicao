'use strict';
const path=require('path');
const plate=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const load=v=>String(v||'').trim();
const {analyze}=require('./nf-document-analyzer');
module.exports=function(app,adminAuth,pool,ready){
 const ensure=Promise.resolve(ready).then(()=>pool.query("CREATE TABLE IF NOT EXISTS load_documents (id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, format TEXT NOT NULL, plate TEXT NOT NULL, load_number TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL, file_bytes BYTEA NOT NULL, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT doc_kind CHECK (kind IN ('nfe','romaneio')), CONSTRAINT doc_format CHECK (format IN ('pdf','xml')))")).then(()=>pool.query("CREATE INDEX IF NOT EXISTS load_docs_by_load ON load_documents (plate,load_number)")).then(async()=>{await pool.query("CREATE TABLE IF NOT EXISTS nf_analysis_state (id INTEGER PRIMARY KEY,items JSONB NOT NULL DEFAULT '[]'::jsonb,files JSONB NOT NULL DEFAULT '[]'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");await pool.query("INSERT INTO nf_analysis_state(id,items,files) VALUES(1,'[]'::jsonb,'[]'::jsonb) ON CONFLICT(id) DO NOTHING")});
 async function knownLoads(){
  const q=await pool.query('SELECT dados FROM app_state WHERE id=1');const state=q.rows[0]?.dados||{};
  return [...(Array.isArray(state.cargas)?state.cargas:[]),...(Array.isArray(state.cargasArquivadas)?state.cargasArquivadas:[])];
 }
 function exists(cargas,p,l){return cargas.some(c=>plate(c.placa)===p&&load(c.carga)===l)}
 app.post('/api/documents/upload',adminAuth,async(req,res)=>{
  const kind=String(req.body?.kind||''),format=String(req.body?.format||''),p=plate(req.body?.plate),l=load(req.body?.load_number);
  const filename=path.basename(String(req.body?.filename||'arquivo')).replace(/[\x00-\x1f]/g,'_').slice(0,160);
  const encoded=String(req.body?.file_base64||'');
  if(!['nfe','romaneio'].includes(kind)||!['pdf','xml'].includes(format))return res.status(400).json({error:'Tipo ou formato inválido'});
  if(!p||!l||p.length>10||l.length>30)return res.status(400).json({error:'Informe placa e número da carga válidos'});
  if(encoded.length>11184812||encoded.length<8||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))return res.status(400).json({error:'Arquivo inválido ou superior a 8 MB'});
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length<8||bytes.length>8*1024*1024)return res.status(400).json({error:'O limite por documento é 8 MB'});
  const ext=path.extname(filename).toLowerCase();
  if(ext!=='.'+format)return res.status(400).json({error:'A extensão do arquivo não corresponde ao formato'});
  if(format==='pdf'&&bytes.subarray(0,5).toString()!=='%PDF-')return res.status(400).json({error:'Arquivo PDF inválido'});
  if(format==='xml'){
   const head=bytes.toString('utf8').replace(/^\uFEFF/,'').trim();
   if(!/^(<\?xml\b[^>]*>\s*)?<[A-Za-z_][\w:.-]*(?:\s|>|\/>)/.test(head)||/<!DOCTYPE|<!ENTITY/i.test(head))return res.status(400).json({error:'Arquivo XML inválido ou com conteúdo não permitido'});
  }
  try{
   await ensure;
   const cargas=await knownLoads();
   if(!exists(cargas,p,l))return res.status(404).json({error:'Carga não encontrada. Cadastre ou importe a carga antes de anexar o documento.'});
   const mime=format==='pdf'?'application/pdf':'application/xml';
   const q=await pool.query('INSERT INTO load_documents(kind,format,plate,load_number,filename,mime,file_bytes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[kind,format,p,l,filename,mime,bytes]);
   const id=Number(q.rows[0].id);
   let analysis={status:'not_applicable',count:0};
   if(kind==='nfe'){
    const parsed=await analyze(bytes,format,filename,p,l);
    if(parsed.items.length){
     const fileKey='NF_DOC_'+id+'_'+filename;
     const items=parsed.items.map(item=>({...item,file:fileKey}));
     let client;
     try{
      client=await pool.connect();
      await client.query('BEGIN');
      const state=await client.query("SELECT items,files FROM nf_analysis_state WHERE id=1 FOR UPDATE");
      if(!state.rows.length)throw new Error('Análise ainda não foi inicializada');
      const oldItems=Array.isArray(state.rows[0].items)?state.rows[0].items:[];
      const oldFiles=Array.isArray(state.rows[0].files)?state.rows[0].files:[];
      const mergedItems=[...oldItems.filter(it=>it.file!==fileKey),...items];
      const mergedFiles=[...new Set([...oldFiles,fileKey])];
      await client.query("UPDATE nf_analysis_state SET items=$1::jsonb,files=$2::jsonb,updated_at=now() WHERE id=1",[JSON.stringify(mergedItems),JSON.stringify(mergedFiles)]);
      await client.query('COMMIT');
      analysis={status:'imported',count:items.length,nf:parsed.nf||null};
     }catch(e){
      if(client)await client.query('ROLLBACK').catch(()=>{});
      console.error('NF analysis sync failed:',e.message);
      analysis={status:'failed',count:0,reason:'NF-e anexada, mas a análise não foi atualizada. Reimporte ou confira a análise.'};
     }finally{if(client)client.release()}
    }else{
     analysis={status:'review',count:0,reason:parsed.reason||'NF-e anexada; conteúdo não reconhecido para análise.'};
    }
   }
   res.status(201).json({ok:true,id,analysis});
  }catch(e){console.error('Document upload:',e.message);res.status(503).json({error:'Não foi possível armazenar o documento'})}
 });
 app.get('/api/documents/summary',async(req,res)=>{
  try{await ensure;const cargas=await knownLoads();const q=await pool.query("SELECT id,kind,format,plate,load_number,filename,uploaded_at FROM load_documents ORDER BY uploaded_at DESC LIMIT 2000");
   res.json({documents:q.rows.filter(d=>exists(cargas,d.plate,d.load_number))});
  }catch(e){console.error('Document summary:',e.message);res.status(503).json({error:'Documentos indisponíveis'})}
 });
 app.get('/api/documents/file/:id',async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(404).end();
  try{await ensure;const q=await pool.query('SELECT kind,format,plate,load_number,filename,mime,file_bytes FROM load_documents WHERE id=$1',[id]);
   const d=q.rows[0];if(!d)return res.status(404).send('Documento não encontrado');
   if(!exists(await knownLoads(),d.plate,d.load_number))return res.status(404).send('Documento sem carga vinculada');
   res.set('X-Content-Type-Options','nosniff');
   res.set('Content-Security-Policy',"default-src 'none'; sandbox");
   const fallback=(d.kind==='nfe'?'nfe':'romaneio')+'-'+d.load_number+'.'+d.format;
   res.set('Content-Disposition',(d.format==='pdf'?'inline':'attachment')+'; filename="'+fallback.replace(/[^a-zA-Z0-9._-]/g,'_')+'"');
   res.type(d.format==='pdf'?'application/pdf':'application/xml').send(d.file_bytes);
  }catch(e){console.error('Document file:',e.message);res.status(503).send('Documento temporariamente indisponível')}
 });
 app.delete('/api/documents/:id',adminAuth,async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'ID inválido'});
  let client;
  try{
   await ensure;client=await pool.connect();await client.query('BEGIN');
   const q=await client.query('DELETE FROM load_documents WHERE id=$1 RETURNING id,kind,filename',[id]);
   if(!q.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Documento não encontrado'})}
   if(q.rows[0].kind==='nfe'){
    const fileKey='NF_DOC_'+id+'_'+q.rows[0].filename;
    const state=await client.query('SELECT items,files FROM nf_analysis_state WHERE id=1 FOR UPDATE');
    if(state.rows.length){
     const oldItems=Array.isArray(state.rows[0].items)?state.rows[0].items:[];
     const oldFiles=Array.isArray(state.rows[0].files)?state.rows[0].files:[];
     await client.query("UPDATE nf_analysis_state SET items=$1::jsonb,files=$2::jsonb,updated_at=now() WHERE id=1",[JSON.stringify(oldItems.filter(x=>x.file!==fileKey)),JSON.stringify(oldFiles.filter(x=>x!==fileKey))]);
    }
   }
   await client.query('COMMIT');res.json({ok:true});
  }
  catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});console.error('document delete',e.message);res.status(503).json({error:'Não foi possível excluir o documento'})}finally{if(client)client.release()}
 });
};
