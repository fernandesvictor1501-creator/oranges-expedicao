(function(){
'use strict';
const $=id=>document.getElementById(id),sel=$('plateDeleteLoad'),clean=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
if(!sel)return;
function fill(){
 const old=sel.value;sel.innerHTML='<option value="">Selecione uma carga...</option>';
 for(const c of db.cargas.filter(x=>clean(x.placa))){const o=document.createElement('option');o.value=String(c.id);o.textContent='Carga '+c.carga+' · '+c.placa;sel.appendChild(o)}
 if([...sel.options].some(x=>x.value===old))sel.value=old;
 const c=db.cargas.find(x=>String(x.id)===sel.value);
 $('plateDeleteCurrent').textContent=c?'Placa atual: '+c.placa:'Selecione uma carga com placa';
}
const say=t=>$('plateDeleteFeedback').textContent=t;
sel.onchange=fill;document.querySelector('main>nav button[data-tab="excluirPlaca"]')?.addEventListener('click',fill);
$('plateDeleteForm').onsubmit=async e=>{
 e.preventDefault();const c=db.cargas.find(x=>String(x.id)===sel.value);
 if(!c||!c.placa)return say('Selecione uma carga com placa');
 if(!confirm('ATENÇÃO: excluir definitivamente o carregamento '+c.carga+' da placa '+c.placa+' e seus dados vinculados (ticket, NF-e, romaneio, análise e histórico)? Esta ação não pode ser desfeita.'))return;
 if(clean(prompt('Digite a placa '+c.placa+' para continuar:'))!==clean(c.placa))return say('Operação cancelada.');
 if(prompt('Para EXCLUIR DEFINITIVAMENTE a carga '+c.carga+', digite EXCLUIR CARGA:')!=='EXCLUIR CARGA')return say('Operação cancelada.');
 const btn=$('plateDeleteSubmit');btn.disabled=true;
 try{
  await filaSalvamento;
  const r=await fetch('/api/admin/plate/delete',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({id:c.id,plate:c.placa,confirmation:'EXCLUIR CARGA'})});
  const result=await r.json();if(!r.ok)throw Error(result.error||'Erro na exclusão');
  const state=await fetch('/api/state',{credentials:'same-origin',cache:'no-store'});
  if(!state.ok)throw Error('Placa removida; atualize a página');db=await state.json();render();fill();
  say('Carga '+result.deleted_load+' e placa '+result.deleted_plate+' excluídas. '+result.removed_tickets+' ticket(s), '+result.removed_documents+' documento(s) e '+result.removed_analysis+' item(ns) da análise removidos.');
 }catch(err){say(err.message)}finally{btn.disabled=false}
};
fill();
})();