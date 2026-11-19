(function(){
'use strict';
const $=id=>document.getElementById(id),loadSelect=$('plateEditorLoad'),form=$('plateEditorForm'),fields=$('plateEditorFields');
if(!loadSelect||!fields)return;
const FIELD_LABELS=[['certificacao','Certificação'],['produto','Produto'],['codigo','Código do produto'],['pedido','Pedido'],['placa','Placa'],['carga','Carga'],['cliente','Cliente'],['quantidade','Quantidade'],['transportadora','Transportadora'],['cidade','Cidade'],['frete','Frete CIF/FOB'],['motorista','Motorista'],['dataProgramacao','Data da programação']];
const clean=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const message=(text,ok=false)=>{const f=$('plateEditorFeedback');f.textContent=text;f.style.color=ok?'#21845a':'#e6a4aa'};
let latest=[],initial=null;
fields.innerHTML=FIELD_LABELS.map(([k,label])=>'<label class="field">'+esc(label)+'<input data-field="'+k+'" '+(k==='placa'?'maxlength="7" style="text-transform:uppercase" placeholder="ABC1D23"':k==='dataProgramacao'?'type="date"':'maxlength="500"')+'></label>').join('');
function dateValue(x){
 const v=String(x||'').trim();
 if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;
 const m=v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
 return m?m[3]+'-'+m[2]+'-'+m[1]:'';
}
function show(){
 const cargo=latest.find(c=>String(c.id)===loadSelect.value);
 initial=cargo?{...cargo}:null;
 $('plateEditorCurrent').value=cargo?.placa||'';
 fields.querySelectorAll('[data-field]').forEach(el=>{
  el.value=cargo?(el.dataset.field==='dataProgramacao'?dateValue(cargo.dataProgramacao):String(cargo[el.dataset.field]??'')):'';
  el.disabled=!cargo;
 });
 $('plateEditorSubmit').disabled=!cargo;
}
function fill(selected){
 const old=selected??loadSelect.value;
 latest=Array.isArray(db?.cargas)?db.cargas.slice().sort((a,b)=>String(a.carga||'').localeCompare(String(b.carga||''),'pt-BR',{numeric:true})):[];
 loadSelect.innerHTML='<option value="">Selecione uma carga...</option>';
 for(const c of latest){
  const opt=document.createElement('option');opt.value=String(c.id);
  opt.textContent='Carga '+(c.carga||'—')+' • '+(c.placa||'Sem placa')+' • '+(c.cliente||'Cliente não informado');
  loadSelect.appendChild(opt);
 }
 if(latest.some(c=>String(c.id)===String(old)))loadSelect.value=String(old);
 show();
}
async function sync(selected){
 await filaSalvamento;
 const response=await fetch('/api/state',{credentials:'same-origin',cache:'no-store'});
 if(!response.ok)throw Error('Não foi possível buscar a programação atualizada.');
 const payload=await response.json();
 if(!Array.isArray(payload.cargas))throw Error('Resposta inválida do servidor.');
 db=payload;render();fill(selected);
}
loadSelect.addEventListener('change',show);
$('plateEditorRefresh').addEventListener('click',()=>sync().then(()=>message('Lista atualizada.',true)).catch(e=>message(e.message)));
document.querySelector('main>nav button[data-tab="editarPlaca"]')?.addEventListener('click',()=>sync().catch(e=>message(e.message)));
fields.querySelector('[data-field="placa"]').addEventListener('input',e=>{
 const p=clean(e.target.value).slice(0,7);if(e.target.value!==p)e.target.value=p;
});
form.addEventListener('submit',async e=>{
 e.preventDefault();
 const id=loadSelect.value,cargo=latest.find(c=>String(c.id)===id);
 if(!cargo||!initial)return message('Selecione um carregamento para editar.');
 const values={};
 fields.querySelectorAll('[data-field]').forEach(el=>values[el.dataset.field]=el.value.trim());
 values.placa=clean(values.placa);
 if(values.placa&&!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(values.placa))return message('Placa inválida. Exemplo: ABC1D23.');
 if(!values.placa&&!values.carga)return message('Informe placa ou número da carga.');
 const changed=FIELD_LABELS.filter(([k])=>String(k==='dataProgramacao'?dateValue(initial[k]):initial[k]??'')!==String(values[k]));
 if(!changed.length)return message('Nenhuma informação foi alterada.');
 const summary=changed.map(([k,label])=>label+': '+(initial[k]||'—')+' → '+(values[k]||'—')).join('\n');
 if(!confirm('Confirmar atualização da carga '+(cargo.carga||'—')+'?\n\n'+summary+'\n\nDocumentos e tickets vinculados serão atualizados quando placa ou carga mudar.'))return;
 const btn=$('plateEditorSubmit');btn.disabled=true;btn.textContent='Salvando...';
 try{
  await filaSalvamento;
  const response=await fetch('/api/admin/load/edit',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,fields:values,expected:{plate:initial.placa||'',load:initial.carga||'',updated:initial.atualizado||''}})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Não foi possível salvar os dados.');
  await sync(id);
  message('Alterações salvas! '+data.changed_fields.length+' campo(s) atualizado(s). '+data.linked_tickets+' ticket(s) e '+data.linked_documents+' documento(s) sincronizados.',true);
 }catch(err){message('Erro: '+err.message)}
 finally{btn.disabled=false;btn.textContent='Salvar todas as alterações'}
});
fill();
})();