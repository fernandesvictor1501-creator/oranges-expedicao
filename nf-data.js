'use strict';
module.exports=function(app,auth,pool,ready){
 const ensure=Promise.resolve(ready).then(async()=>{
  await pool.query("CREATE TABLE IF NOT EXISTS nf_analysis_state (id INTEGER PRIMARY KEY, items JSONB NOT NULL DEFAULT '[]'::jsonb, files JSONB NOT NULL DEFAULT '[]'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  await pool.query("INSERT INTO nf_analysis_state(id,items,files) VALUES (1,'[]'::jsonb,'[]'::jsonb) ON CONFLICT(id) DO NOTHING");
 });
 app.get('/api/nf-analysis',async(req,res)=>{
  try{await ensure;const result=await pool.query("SELECT items,files,updated_at FROM nf_analysis_state WHERE id=1");const row=result.rows[0]||{};res.json({items:row.items||[],files:row.files||[],updated_at:row.updated_at||null})}
  catch(e){console.error('NF-analysis read',e.message);res.status(503).json({error:'Análise de NF temporariamente indisponível'})}
 });
 app.put('/api/nf-analysis',auth,async(req,res)=>{
  try{
   const items=req.body?.items,files=req.body?.files;
   if(!Array.isArray(items)||!Array.isArray(files)||items.length>30000||files.length>500)return res.status(400).json({error:'Lista de notas ou arquivos inválida'});
   const allowed=['file','nf','serie','data','produto','qtd','un','placa','carga','obs','ref','pdf','kg','fx'];
   const cleaned=items.map(it=>{
    if(!it||typeof it!=='object'||Array.isArray(it))throw Error('Item inválido');
    let obj={};
    for(const k of allowed){
     const v=it[k];if(v===undefined||v===null)continue;
     if(typeof v==='string')obj[k]=v.slice(0,k==='obs'?2000:500);
     else if(typeof v==='number'&&Number.isFinite(v))obj[k]=v;
     else if(typeof v==='boolean')obj[k]=v;
    }
    return obj;
   });
   const list=files.map(f=>String(f).slice(0,160));
   await ensure;
   const saved=await pool.query('UPDATE nf_analysis_state SET items=$1::jsonb,files=$2::jsonb,updated_at=now() WHERE id=1 RETURNING updated_at',[JSON.stringify(cleaned),JSON.stringify(list)]);
   res.json({ok:true,count:cleaned.length,updated_at:saved.rows[0].updated_at});
  }catch(e){
   if(e.message==='Item inválido')return res.status(400).json({error:'Dados inválidos'});
   console.error('NF-analysis write',e.message);res.status(503).json({error:'Não foi possível salvar a análise no banco de dados'});
  }
 });
};