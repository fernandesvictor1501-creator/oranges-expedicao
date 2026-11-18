(function(){
'use strict';
const root=document.getElementById('readerApprovals');if(!root)return;
const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const status={pending:'Pendente',approved:'Aprovado',rejected:'Recusado'};
const fmt=s=>{try{return new Date(s).toLocaleString('pt-BR')}catch(e){return ''}};
async function load(){
 const list=document.getElementById('readerApprovalsList');
 list.innerHTML='<p class="muted">Carregando solicitações…</p>';
 try{
  const r=await fetch('/api/reader/admin/requests',{cache:'no-store'});
  if(!r.ok)throw Error('Acesso indisponível');
  const result=await r.json();
  const users=Array.isArray(result.accounts)?result.accounts:[];
  const pending=users.filter(u=>u.status==='pending').length;
  document.getElementById('readerApprovalsCount').textContent=pending+' solicitação(ões) aguardando aprovação · '+users.length+' contas';
  list.innerHTML=users.length?users.map(u=>
   '<article class="reader-request '+esc(u.status)+'"><div><strong>'+esc(u.full_name)+'</strong><span>'+esc(u.email)+'</span><small>'+esc(u.google?'Google':'E-mail e senha')+' · '+esc(fmt(u.created_at))+'</small></div><div class="reader-request-side"><span class="reader-request-status '+esc(u.status)+'">'+esc(status[u.status]||u.status)+'</span>'+(u.status==='pending'?'<div class="reader-request-actions"><button type="button" data-id="'+Number(u.id)+'" data-decision="approved">Aprovar</button><button type="button" data-id="'+Number(u.id)+'" data-decision="rejected">Recusar</button></div>':'')+'</div></article>'
  ).join(''):'<div class="reader-request-empty">Nenhuma solicitação de cadastro recebida.</div>';
  list.querySelectorAll('button[data-decision]').forEach(b=>b.addEventListener('click',async()=>{
   const id=Number(b.dataset.id),decision=b.dataset.decision;
   const message=decision==='approved'?'Aprovar acesso desta conta ao painel de leitura?':'Recusar a solicitação desta conta?';
   if(!confirm(message))return;
   b.disabled=true;
   try{
    const r=await fetch('/api/reader/admin/requests/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision})});
    const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível analisar o cadastro');
    await load();
   }catch(err){alert(err.message);b.disabled=false}
  }));
 }catch(e){list.textContent='Não foi possível carregar os cadastros: '+e.message}
}
document.getElementById('readerApprovalsRefresh').addEventListener('click',load);
document.querySelector('main>nav button[data-tab="readerApprovals"]')?.addEventListener('click',load);
load();
})();