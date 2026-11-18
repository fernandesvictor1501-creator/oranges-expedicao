(function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SECTORS=['Faturamento','Expedição','Logística','Administrativo','Outros'];
const ITEMS=[['dashboard','Visão operacional'],['tickets','Consultar tickets AIS'],['documentos','NF-e e Romaneios'],['analiseNF','Análise de NF'],['produtividade','Produtividade'],['anteriores','Datas anteriores']];
const fmt=s=>{try{return new Date(s).toLocaleString('pt-BR')}catch{return ''}};
const requests=document.getElementById('readerApprovalsList'),accounts=document.getElementById('readerAccessList');
if(!requests||!accounts)return;
let users=[];
function form(u,editable){
 const options=SECTORS.map(x=>'<option value="'+esc(x)+'"'+(x===(u.sector||'Outros')?' selected':'')+'>'+esc(x)+'</option>').join('');
 const permissions=Array.isArray(u.permissions)?u.permissions:[];
 const checks=ITEMS.map(([v,label])=>'<label><input type="checkbox" value="'+v+'" '+(permissions.includes(v)?'checked':'')+'> '+esc(label)+'</label>').join('');
 return '<div class="reader-access-fields"><label>Setor<select class="reader-sector">'+options+'</select></label><div><strong style="display:block;margin-bottom:8px">Permissões do painel</strong><div class="reader-permissions">'+checks+'</div></div></div>';
}
function card(u,editable){
 return '<article class="reader-access-card" data-user="'+Number(u.id)+'"><strong>'+esc(u.full_name)+'</strong><small>'+esc(u.email)+' · '+esc(u.google?'Google':'E-mail e senha')+' · '+esc(fmt(u.created_at))+'</small>'+form(u,editable)
 +'<div class="toolbar">'+(editable?'<button type="button" data-act="save">Salvar alterações</button>':'<button type="button" data-act="approve">Aprovar acesso</button><button type="button" class="secondary" data-act="reject">Recusar</button>')+'</div><p class="reader-access-feedback" role="status"></p></article>';
}
function draw(){
 const pending=users.filter(u=>u.status==='pending'),approved=users.filter(u=>u.status==='approved');
 document.getElementById('readerApprovalsCount').textContent=pending.length+' solicitação(ões) aguardando aprovação · '+users.length+' contas';
 const groups=SECTORS.filter(x=>pending.some(u=>(u.sector||'Outros')===x));
 requests.innerHTML=groups.length?groups.map(sector=>'<div class="reader-sector-group"><h3>'+esc(sector)+' · '+pending.filter(u=>(u.sector||'Outros')===sector).length+' pendente(s)</h3>'+pending.filter(u=>(u.sector||'Outros')===sector).map(u=>card(u,false)).join('')+'</div>').join(''):'<p class="muted">Nenhuma solicitação aguardando aprovação.</p>';
 accounts.innerHTML=approved.length?SECTORS.filter(x=>approved.some(u=>(u.sector||'Outros')===x)).map(sector=>'<div class="reader-sector-group"><h3>'+esc(sector)+'</h3>'+approved.filter(u=>(u.sector||'Outros')===sector).map(u=>card(u,true)).join('')+'</div>').join(''):'<p class="muted">Nenhuma conta aprovada.</p>';
 [requests,accounts].forEach(root=>root.querySelectorAll('button[data-act]').forEach(btn=>btn.addEventListener('click',()=>action(btn))));
}
async function action(button){
 const card=button.closest('[data-user]'),id=Number(card.dataset.user),user=users.find(u=>Number(u.id)===id);
 if(!user)return;
 const type=button.dataset.act,sector=card.querySelector('.reader-sector').value,permissions=[...card.querySelectorAll('.reader-permissions input:checked')].map(x=>x.value),info=card.querySelector('.reader-access-feedback');
 if(type!=='reject'&&!permissions.length){info.textContent='Selecione pelo menos uma das seis abas.';return}
 const operation=type==='save'?'salvar novas permissões':type==='approve'?'aprovar o acesso':'recusar a solicitação';
 if(!confirm('Deseja '+operation+' de '+user.full_name+'?'))return;
 button.disabled=true;info.textContent='Salvando...';
 try{
  const url=type==='save'?'/api/reader/admin/accounts/'+id:'/api/reader/admin/requests/'+id;
  const body=type==='save'?{sector,permissions}:{decision:type==='approve'?'approved':'rejected',sector,permissions};
  const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Erro ao salvar');
  await load();
 }catch(e){info.textContent=e.message;button.disabled=false}
}
async function load(){
 try{
  const r=await fetch('/api/reader/admin/requests',{credentials:'same-origin',cache:'no-store'});
  if(!r.ok)throw Error('Não foi possível buscar as contas.');
  const j=await r.json();users=Array.isArray(j.accounts)?j.accounts:[];draw();
 }catch(e){requests.textContent=e.message;accounts.textContent=e.message}
}
document.getElementById('readerApprovalsRefresh')?.addEventListener('click',load);
document.getElementById('readerAccessRefresh')?.addEventListener('click',load);
document.querySelectorAll('main>nav button[data-tab="readerApprovals"],main>nav button[data-tab="readerAccess"]').forEach(x=>x.addEventListener('click',load));
load();
})();