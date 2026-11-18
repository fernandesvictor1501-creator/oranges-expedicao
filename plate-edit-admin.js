(function(){
'use strict';
const $=id=>document.getElementById(id),loadSelect=$('plateEditorLoad');
if(!loadSelect)return;
const clean=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const message=(text,ok=false)=>{const f=$('plateEditorFeedback');f.textContent=text;f.style.color=ok?'#21845a':'#a34455'};
let latest=[];
function fill(){
 const old=loadSelect.value;
 latest=typeof db!=='undefined'&&Array.isArray(db.cargas)?db.cargas.slice().sort((a,b)=>String(a.carga||'').localeCompare(String(b.carga||''),'pt-BR',{numeric:true})):[];
 loadSelect.innerHTML='<option value="">Selecione uma carga...</option>';
 for(const cargo of latest){
  const opt=document.createElement('option');
  opt.value=String(cargo.id);opt.textContent='Carga '+(cargo.carga||'—')+' • '+(cargo.placa||'Sem placa')+' • '+(cargo.cliente||'Cliente não informado');
  loadSelect.appendChild(opt);
 }
 if(latest.some(c=>String(c.id)===old))loadSelect.value=old;
 show();
}
function show(){
 const cargo=latest.find(c=>String(c.id)===loadSelect.value);
 $('plateEditorCurrent').value=cargo?.placa||'';
 if(!cargo)$('plateEditorNew').value='';
}
async function sync(){
 try{
  await filaSalvamento;
  const response=await fetch('/api/state',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw new Error('Não foi possível buscar as cargas atualizadas.');
  const payload=await response.json();if(!Array.isArray(payload.cargas))throw new Error('Dados inválidos.');
  db=payload;render();fill();
 }catch(e){message(e.message);throw e}
}
loadSelect.addEventListener('change',show);
$('plateEditorRefresh').addEventListener('click',sync);
document.querySelector('main>nav button[data-tab="editarPlaca"]')?.addEventListener('click',fill);
$('plateEditorNew').addEventListener('input',e=>{const p=clean(e.target.value).slice(0,7);if(e.target.value!==p)e.target.value=p});
$('plateEditorForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=$('plateEditorSubmit'),id=loadSelect.value,cargo=latest.find(c=>String(c.id)===id);
 const plate=clean($('plateEditorNew').value);
 if(!cargo)return message('Selecione uma carga para editar.');
 if(!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate))return message('Placa inválida. Exemplos: ABC1234 ou ABC1D23.');
 if(plate===clean(cargo.placa))return message('A nova placa é igual à atual.');
 if(!confirm('Confirmar alteração da placa da carga '+cargo.carga+' de '+(cargo.placa||'sem placa')+' para '+plate+'? Os documentos e tickets vinculados serão atualizados.'))return;
 btn.disabled=true;btn.textContent='Atualizando...';message('Atualizando placa e documentos vinculados...');
 try{
  await filaSalvamento;
  const response=await fetch('/api/admin/plate/change',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({id,new_plate:plate})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Não foi possível atualizar a placa.');
  await sync();
  loadSelect.value=String(id);show();$('plateEditorNew').value='';
  message('Placa alterada para '+data.new_plate+'! '+data.linked_tickets+' ticket(s) AIS e '+data.linked_documents+' documento(s) atualizados. Histórico preservado.',true);
 }catch(err){message('Erro: '+err.message)}
 finally{btn.disabled=false;btn.textContent='Salvar alteração'}
});
fill();
})();