'use strict';
const normalize=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const plateValid=p=>/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p);
module.exports=function(app,adminAuth,pool,ready){
 // Finalização em lote de cargas de datas anteriores, inclusive registros arquivados.
 app.post('/api/admin/loads/finalize-previous',adminAuth,async(req,res)=>{
  const scope=String(req.body?.scope||''),selectedDate=String(req.body?.date||'');
  const confirmation=String(req.body?.confirmation||'');
  const expectedIds=req.body?.expected_ids;
  if(!['date','all'].includes(scope)||confirmation!=='FINALIZAR'||(scope==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate))||
     !Array.isArray(expectedIds)||expectedIds.length>10000||expectedIds.some(id=>typeof id!=='string'||id.length>150))
   return res.status(400).json({error:'Dados de confirmação inválidos.'});
  const dateOf=v=>{
   const raw=String(v||'').trim();
   const a=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
   if(a)return a[1]+'-'+a[2]+'-'+a[3];
   const b=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
   return b?b[3]+'-'+b[2]+'-'+b[1]:'';
  };
  const localDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const dateFor=c=>dateOf(c.dataProgramacao)||dateOf(c.atualizado);
  const eligible=c=>{
   const day=dateFor(c),status=Number(c.status);
   return day&&day<localDay&&(scope==='all'||day===selectedDate)&&status>=0&&(status<5||status===7);
  };
  let client;
  try{
   await ready;client=await pool.connect();await client.query('BEGIN');
   const q=await client.query('SELECT dados FROM app_state WHERE id=1 FOR UPDATE'),state=q.rows[0]?.dados;
   if(!state||!Array.isArray(state.cargas))throw Object.assign(new Error('Programação indisponível.'),{status:503});
   const archived=Array.isArray(state.cargasArquivadas)?state.cargasArquivadas:[];
   const all=[...state.cargas,...archived];
   const targets=[...new Set(all.filter(eligible).map(c=>String(c.id)))].sort();
   const expected=[...new Set(expectedIds)].sort();
   if(targets.length!==expected.length||targets.some((id,i)=>id!==expected[i]))
    throw Object.assign(new Error('A lista de cargas mudou. Atualize a tela e revise antes de confirmar.'),{status:409});
   if(!targets.length)throw Object.assign(new Error('Nenhuma carga pendente encontrada nas datas selecionadas.'),{status:400});
   const ids=new Set(targets),stamp=new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
   state.historico=Array.isArray(state.historico)?state.historico:[];
   const recorded=new Set();
   for(const c of all){
    const key=String(c.id);
    if(!ids.has(key)||!eligible(c))continue;
    if(!recorded.has(key)){
     const names=['Aguardando chegada','Carregando','Finalizado / Faturando','Aguardando documentação','Aguardando liberação','Liberado','Não carregou','Aguardando liberação PCP'];
     state.historico.unshift({data:stamp,placa:c.placa||'',carga:c.carga||'',antes:names[Number(c.status)]||'Pendente',depois:'Liberado',origem:'Finalização em lote de datas anteriores — Administrador'});
     recorded.add(key);
    }
    // Preserve a programação original for legacy records dated only by 'atualizado'.
    if(!dateOf(c.dataProgramacao))c.dataProgramacao=dateFor(c);
    c.status=5;c.atualizado=stamp;
   }
   await client.query('UPDATE app_state SET dados=$1::jsonb WHERE id=1',[JSON.stringify(state)]);
   await client.query('COMMIT');
   res.json({ok:true,updated:recorded.size,scope,date:scope==='date'?selectedDate:null});
  }catch(e){
   if(client)await client.query('ROLLBACK').catch(()=>{});
   console.error('bulk finalize past loads',e.message);
   res.status(e.status||503).json({error:e.status?e.message:'Falha ao finalizar cargas anteriores. Dados preservados.'});
  }finally{if(client)client.release()}
 });
 app.post('/api/admin/plate/delete',adminAuth,async(req,res)=>{
  const id=String(req.body?.id||'').trim();
  const expectedPlate=normalize(req.body?.plate);
  const confirmation=String(req.body?.confirmation||'').trim();
  if(!id||id.length>130||!plateValid(expectedPlate)||confirmation!=='EXCLUIR CARGA')
   return res.status(400).json({error:'Selecione a carga e confirme EXCLUIR CARGA.'});
  let client;
  try{
   await ready;client=await pool.connect();await client.query('BEGIN');
   const row=await client.query('SELECT dados FROM app_state WHERE id=1 FOR UPDATE');
   const state=row.rows[0]?.dados;
   if(!state||!Array.isArray(state.cargas))throw Object.assign(new Error('Programação indisponível.'),{status:503});
   const cargo=state.cargas.find(x=>String(x.id)===id);
   if(!cargo)throw Object.assign(new Error('Carga não encontrada ou já excluída.'),{status:404});
   const oldPlate=normalize(cargo.placa),load=String(cargo.carga||'').trim();
   if(oldPlate!==expectedPlate)throw Object.assign(new Error('Placa alterada. Atualize a lista e tente novamente.'),{status:409});
   if(!load)throw Object.assign(new Error('Carga sem número. Exclusão bloqueada para evitar remover dados incorretos.'),{status:400});
   const all=[...state.cargas,...(Array.isArray(state.cargasArquivadas)?state.cargasArquivadas:[])];
   if(all.some(x=>String(x.id)!==id&&normalize(x.placa)===oldPlate&&String(x.carga||'').trim()===load))
    throw Object.assign(new Error('Placa e carga também vinculadas a outro registro; exclusão bloqueada para proteger os dados.'),{status:409});
   // Só apaga dados associados à combinação exata de placa e número da carga.
   const docs=await client.query('DELETE FROM load_documents WHERE plate=$1 AND load_number=$2 RETURNING id,filename',[oldPlate,load]);
   const tickets=await client.query("DELETE FROM ais_tickets WHERE (linked_plate=$1 AND linked_load=$2) OR (plate=$1 AND load_number=$2) RETURNING ticket_number",[oldPlate,load]);
   const docKeys=new Set(docs.rows.map(d=>'NF_DOC_'+d.id+'_'+d.filename));
   const oldAnalysis=await client.query('SELECT items,files FROM nf_analysis_state WHERE id=1 FOR UPDATE');
   let removedAnalysis=0;
   if(oldAnalysis.rows.length){
    const items=Array.isArray(oldAnalysis.rows[0].items)?oldAnalysis.rows[0].items:[];
    const files=Array.isArray(oldAnalysis.rows[0].files)?oldAnalysis.rows[0].files:[];
    const remaining=items.filter(it=>{
     const isDoc=docKeys.has(String(it.file||''));
     const isMatch=normalize(it.placa)===oldPlate&&String(it.carga||'').trim()===load;
     if(isDoc||isMatch){removedAnalysis++;return false}
     return true;
    });
    const used=new Set(remaining.map(it=>String(it.file||'')));
    const remainingFiles=files.filter(f=>!docKeys.has(String(f))&&(used.has(String(f))||!items.some(it=>String(it.file||'')===String(f))));
    await client.query('UPDATE nf_analysis_state SET items=$1::jsonb,files=$2::jsonb,updated_at=now() WHERE id=1',[JSON.stringify(remaining),JSON.stringify(remainingFiles)]);
   }
   state.cargas=state.cargas.filter(x=>String(x.id)!==id);
   if(Array.isArray(state.cargasArquivadas))
    state.cargasArquivadas=state.cargasArquivadas.filter(x=>String(x.id)!==id);
   // Remove também ocorrências e movimentações do mesmo carregamento.
   state.historico=(Array.isArray(state.historico)?state.historico:[]).filter(h=>!(normalize(h.placa)===oldPlate&&String(h.carga||'').trim()===load));
   // Os tickets legados guardam apenas o número; remova somente números identificados neste carregamento.
   if(Array.isArray(state.tickets)){
    const numbers=new Set(tickets.rows.map(t=>String(t.ticket_number||'').trim()).filter(Boolean));
    state.tickets=state.tickets.filter(t=>!numbers.has(String(t||'').trim()));
   }
   await client.query('UPDATE app_state SET dados=$1::jsonb WHERE id=1',[JSON.stringify(state)]);
   await client.query('COMMIT');
   res.json({ok:true,deleted_load:load,deleted_plate:oldPlate,removed_tickets:tickets.rowCount,removed_documents:docs.rowCount,removed_analysis:removedAnalysis});
  }catch(e){
   if(client)await client.query('ROLLBACK').catch(()=>{});
   console.error('delete complete load',e.message);
   res.status(e.status||503).json({error:e.status?e.message:'Não foi possível excluir o carregamento. Nenhum dado foi alterado.'});
  }finally{if(client)client.release()}
 });
 // Atualiza um carregamento existente a partir da importação, sem redefinir status ou criar duplicata.
 app.post('/api/admin/import/update-load',adminAuth,async(req,res)=>{
  const id=String(req.body?.id||'').trim(),expected=req.body?.expected,fields=req.body?.fields;
  const keys=['certificacao','produto','codigo','pedido','placa','carga','cliente','quantidade','transportadora','cidade','frete','motorista'];
  if(!id||id.length>150||!expected||typeof expected!=='object'||!fields||typeof fields!=='object'||
     keys.some(k=>typeof fields[k]!=='string'||fields[k].length>20000))
   return res.status(400).json({error:'Dados de edição incompletos.'});
  let client;
  try{
   await ready;client=await pool.connect();await client.query('BEGIN');
   const row=await client.query('SELECT dados FROM app_state WHERE id=1 FOR UPDATE');
   const state=row.rows[0]?.dados;
   if(!state||!Array.isArray(state.cargas))throw Object.assign(Error('Programação indisponível.'),{http:503});
   const targets=[...state.cargas,...(Array.isArray(state.cargasArquivadas)?state.cargasArquivadas:[])];
   const found=targets.filter(c=>String(c.id)===id);
   if(!found.length)throw Object.assign(Error('Carregamento não encontrado. Atualize o painel.'),{http:404});
   const main=found[0];
   const before=keys.reduce((o,k)=>(o[k]=String(main[k]??''),o),{});
   if(String(main.placa??'')!==String(expected.placa??'')||
      String(main.carga??'')!==String(expected.carga??'')||
      String(main.atualizado??'')!==String(expected.atualizado??''))
    throw Object.assign(Error('O carregamento mudou no servidor. Atualize a prévia e selecione a carga novamente.'),{http:409});
   const oldPlate=normalize(main.placa),oldLoad=String(main.carga||'').trim();
   const newPlate=normalize(fields.placa),newLoad=String(fields.carga||'').trim();
   const linkedChange=oldPlate!==newPlate||oldLoad!==newLoad;
   if(linkedChange&&oldPlate&&oldLoad&&targets.some(x=>String(x.id)!==id&&normalize(x.placa)===oldPlate&&String(x.carga||'').trim()===oldLoad))
    throw Object.assign(Error('Há mais de uma carga com a mesma placa e número. Ajuste manualmente os vínculos antes de mudar a identificação.'),{http:409});
   const changed=keys.filter(k=>String(fields[k])!==before[k]);
   if(!changed.length){await client.query('ROLLBACK');return res.json({ok:true,updated:0,changed:[]})}
   const stamp=new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
   for(const c of found){for(const k of keys)c[k]=fields[k];c.atualizado=stamp}
   state.historico=Array.isArray(state.historico)?state.historico:[];
   state.historico.unshift({data:stamp,placa:fields.placa,carga:fields.carga,antes:'DADOS DO CARREGAMENTO',depois:changed.join(', '),origem:'Edição da importação — '+changed.map(k=>k+': '+before[k].slice(0,45)+' → '+fields[k].slice(0,45)).join('; ').slice(0,1500)});
   let tickets=0,documents=0;
   if(linkedChange&&oldPlate&&oldLoad&&newPlate&&newLoad){
    const t=await client.query("UPDATE ais_tickets SET linked_plate=$1,linked_load=$2 WHERE linked_plate=$3 AND linked_load=$4 AND match_status='linked'",[newPlate,newLoad,oldPlate,oldLoad]);tickets=t.rowCount;
    const d=await client.query("UPDATE load_documents SET plate=$1,load_number=$2 WHERE plate=$3 AND load_number=$4",[newPlate,newLoad,oldPlate,oldLoad]);documents=d.rowCount;
    const a=await client.query('SELECT items FROM nf_analysis_state WHERE id=1 FOR UPDATE');
    if(a.rows.length&&Array.isArray(a.rows[0].items)){
     let touched=false;
     for(const it of a.rows[0].items)if(normalize(it.placa)===oldPlate&&String(it.carga||'').trim()===oldLoad){it.placa=fields.placa;it.carga=fields.carga;touched=true}
     if(touched)await client.query('UPDATE nf_analysis_state SET items=$1::jsonb,updated_at=now() WHERE id=1',[JSON.stringify(a.rows[0].items)]);
    }
   }
   await client.query('UPDATE app_state SET dados=$1::jsonb WHERE id=1',[JSON.stringify(state)]);
   await client.query('COMMIT');
   res.json({ok:true,updated:1,changed,linked_tickets:tickets,linked_documents:documents});
  }catch(err){
   if(client)await client.query('ROLLBACK').catch(()=>{});
   console.error('import update existing load',err.message);
   res.status(err.http||503).json({error:err.http?err.message:'Falha ao atualizar carregamento. Nada foi alterado.'});
  }finally{if(client)client.release()}
 });
 app.post('/api/admin/load/edit',adminAuth,async(req,res)=>{
  const id=String(req.body?.id||'').trim(),values=req.body?.fields,expected=req.body?.expected;
  const keys=['certificacao','produto','codigo','pedido','placa','carga','cliente','quantidade','transportadora','cidade','frete','motorista','dataProgramacao'];
  if(!id||id.length>130||!values||typeof values!=='object'||Array.isArray(values)||!expected||typeof expected!=='object')
   return res.status(400).json({error:'Informações da carga inválidas.'});
  if(keys.some(k=>typeof values[k]!=='string'||values[k].length>500))
   return res.status(400).json({error:'Preencha os campos com textos de até 500 caracteres.'});
  const changes=Object.fromEntries(keys.map(k=>[k,values[k].trim()]));
  changes.placa=normalize(changes.placa);
  if(changes.placa&&!plateValid(changes.placa))return res.status(400).json({error:'Placa inválida.'});
  if(!changes.placa&&!changes.carga)return res.status(400).json({error:'Informe placa ou carga.'});
  if(changes.carga.length>40)return res.status(400).json({error:'Número da carga muito longo.'});
  if(changes.dataProgramacao&& !/^\d{4}-\d{2}-\d{2}$/.test(changes.dataProgramacao))
   return res.status(400).json({error:'Data da programação inválida.'});
  if(changes.dataProgramacao){
   const dt=new Date(changes.dataProgramacao+'T12:00:00Z');
   if(!Number.isFinite(dt.getTime())||dt.toISOString().slice(0,10)!==changes.dataProgramacao)
    return res.status(400).json({error:'Data da programação inválida.'});
  }
  let client;
  try{
   await ready;client=await pool.connect();await client.query('BEGIN');
   const row=await client.query('SELECT dados FROM app_state WHERE id=1 FOR UPDATE');
   const state=row.rows[0]?.dados;
   if(!state||!Array.isArray(state.cargas))throw Object.assign(new Error('Programação indisponível.'),{status:503});
   const cargo=state.cargas.find(c=>String(c.id)===id);
   if(!cargo)throw Object.assign(new Error('Carregamento não encontrado.'),{status:404});
   const oldPlate=normalize(cargo.placa),oldLoad=String(cargo.carga||'').trim();
   if(oldPlate!==normalize(expected.plate)||oldLoad!==String(expected.load||'').trim()||String(cargo.atualizado||'')!==String(expected.updated||''))
    throw Object.assign(new Error('Este carregamento foi alterado por outra pessoa. Atualize a lista antes de salvar.'),{status:409});
   const others=[...state.cargas,...(Array.isArray(state.cargasArquivadas)?state.cargasArquivadas:[])];
   if(others.some(c=>String(c.id)!==id&&normalize(c.placa)===changes.placa&&String(c.carga||'').trim()===changes.carga))
    throw Object.assign(new Error('Já existe outra carga com esta combinação de placa e número.'),{status:409});
   const oldShared=others.some(c=>String(c.id)!==id&&normalize(c.placa)===oldPlate&&String(c.carga||'').trim()===oldLoad);
   const referencesChanged=(oldPlate!==changes.placa||oldLoad!==changes.carga);
   if(referencesChanged&&oldShared&&oldPlate&&oldLoad)
    throw Object.assign(new Error('A placa/carga antiga também pertence a outro carregamento. Resolva a duplicidade antes de atualizar os vínculos.'),{status:409});
   const oldDate=String(cargo.dataProgramacao||'');
   const changed=keys.filter(k=>String(k==='dataProgramacao'?oldDate:(cargo[k]??'')).trim()!==changes[k]);
   if(!changed.length)throw Object.assign(new Error('Nenhuma informação alterada.'),{status:400});
   const previous=Object.fromEntries(keys.map(k=>[k,String(cargo[k]??'')]));
   for(const k of keys)cargo[k]=changes[k];
   const stamp=new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
   cargo.atualizado=stamp;
   state.historico=Array.isArray(state.historico)?state.historico:[];
   state.historico.unshift({data:stamp,placa:changes.placa,carga:changes.carga,antes:'Dados da carga',depois:changed.join(', '),origem:'Edição administrativa — '+changed.map(k=>k+': '+previous[k].slice(0,35)+' → '+changes[k].slice(0,35)).join('; ').slice(0,1200)});
   let tickets=0,docs=0,analysis=0;
   if(referencesChanged&&oldPlate&&oldLoad){
    const linked=await client.query("UPDATE ais_tickets SET linked_plate=$1,linked_load=$2 WHERE linked_plate=$3 AND linked_load=$4 AND match_status='linked'",[changes.placa,changes.carga,oldPlate,oldLoad]);
    tickets=linked.rowCount;
    const documents=await client.query('UPDATE load_documents SET plate=$1,load_number=$2 WHERE plate=$3 AND load_number=$4',[changes.placa,changes.carga,oldPlate,oldLoad]);
    docs=documents.rowCount;
    const q=await client.query('SELECT items FROM nf_analysis_state WHERE id=1 FOR UPDATE');
    if(q.rows.length&&Array.isArray(q.rows[0].items)){
     const items=q.rows[0].items;
     for(const item of items){
      if(normalize(item.placa)===oldPlate&&String(item.carga||'').trim()===oldLoad){
       item.placa=changes.placa;item.carga=changes.carga;analysis++;
      }
     }
     if(analysis)await client.query('UPDATE nf_analysis_state SET items=$1::jsonb,updated_at=now() WHERE id=1',[JSON.stringify(items)]);
    }
   }
   const updated=await client.query('UPDATE app_state SET dados=$1::jsonb WHERE id=1',[JSON.stringify(state)]);
   if(updated.rowCount!==1)throw new Error('Não foi possível salvar a carga.');
   await client.query('COMMIT');
   res.json({ok:true,changed_fields:changed,linked_tickets:tickets,linked_documents:docs,updated_analysis:analysis});
  }catch(err){
   if(client)await client.query('ROLLBACK').catch(()=>{});
   console.error('load edit',err.message);
   res.status(err.status||503).json({error:err.status?err.message:'Não foi possível atualizar a carga; dados preservados.'});
  }finally{if(client)client.release()}
 });
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