'use strict';
const normalize=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const plateValid=p=>/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p);
module.exports=function(app,adminAuth,pool,ready){
 app.post('/api/admin/plate/change',adminAuth,async(req,res)=>{
  const id=String(req.body?.id||'').trim();
  const newPlate=normalize(req.body?.new_plate);
  if(!id||id.length>130)return res.status(400).json({error:'Selecione uma carga válida.'});
  if(!plateValid(newPlate))return res.status(400).json({error:'Placa inválida. Informe 7 caracteres, como ABC1D23 ou ABC1234.'});
  let client;
  try{
   await ready;client=await pool.connect();
   await client.query('BEGIN');
   const row=await client.query('SELECT dados FROM app_state WHERE id=1 FOR UPDATE');
   const state=row.rows[0]?.dados;
   if(!state||!Array.isArray(state.cargas))throw Object.assign(new Error('Cargas não disponíveis.'),{http:503});
   const cargo=state.cargas.find(c=>String(c.id)===id);
   if(!cargo)throw Object.assign(new Error('Carga não encontrada na programação atual.'),{http:404});
   const oldPlate=normalize(cargo.placa),load=String(cargo.carga||'').trim();
   if(oldPlate===newPlate)throw Object.assign(new Error('A nova placa é igual à atual.'),{http:400});
   if(!load)throw Object.assign(new Error('A carga precisa ter um número antes da alteração.'),{http:400});
   const others=[...state.cargas,...(Array.isArray(state.cargasArquivadas)?state.cargasArquivadas:[])];
   if(others.some(c=>String(c.id)!==id&&normalize(c.placa)===newPlate&&String(c.carga||'').trim()===load))
    throw Object.assign(new Error('Essa placa já está vinculada ao mesmo número de carga.'),{http:409});
   const reused=others.some(c=>String(c.id)!==id&&normalize(c.placa)===oldPlate&&String(c.carga||'').trim()===load);
   if(reused)throw Object.assign(new Error('Há outra carga com a mesma placa e número: ajuste manual necessário para proteger os anexos.'),{http:409});
   cargo.placa=newPlate;
   const timestamp=new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
   cargo.atualizado=timestamp;
   if(!Array.isArray(state.historico))state.historico=[];
   state.historico.unshift({data:timestamp,placa:newPlate,carga:load,antes:'Placa '+(oldPlate||'não informada'),depois:'Placa '+newPlate,origem:'Correção de placa — Administrador'});
   const updated=await client.query('UPDATE app_state SET dados=$1::jsonb WHERE id=1',[JSON.stringify(state)]);
   if(updated.rowCount!==1)throw new Error('Não foi possível atualizar a programação');
   const linked=await client.query("UPDATE ais_tickets SET linked_plate=$1 WHERE linked_plate=$2 AND linked_load=$3 AND match_status='linked'",[newPlate,oldPlate,load]);
   const docs=await client.query('UPDATE load_documents SET plate=$1 WHERE plate=$2 AND load_number=$3',[newPlate,oldPlate,load]);
   await client.query('COMMIT');
   res.json({ok:true,old_plate:oldPlate,new_plate:newPlate,load,linked_tickets:linked.rowCount,linked_documents:docs.rowCount});
  }catch(e){
   if(client)await client.query('ROLLBACK').catch(()=>{});
   console.error('plate change',e.message);
   res.status(e.http||503).json({error:e.http?e.message:'Não foi possível alterar a placa. Os dados foram mantidos.'});
  }finally{if(client)client.release()}
 });
};