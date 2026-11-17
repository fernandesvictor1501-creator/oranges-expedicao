(function(){
const $=id=>document.getElementById(id),host=$('aisTickets');
if(!host)return;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const weight=v=>v===null||v===undefined?'—':Number(v).toLocaleString('pt-BR')+' kg';
async function list(){
 try{
 const response=await fetch('/api/ais/tickets',{credentials:'same-origin',cache:'no-store'});
 if(!response.ok)throw Error('Falha ao consultar tickets AIS');
 const {tickets=[]}=await response.json();
 $('aisCount').textContent=tickets.length+' ticket(s) recebido(s)';
 $('aisReview').textContent=tickets.filter(t=>t.match_status!=='linked').length+' para conferir';
 host.innerHTML=tickets.length?tickets.map(t=>{
 const ok=t.match_status==='linked';
 return '<article class="ais-item"><div class="ais-item-head"><strong>⚖ Ticket '+esc(t.ticket_number||'não identificado')+'</strong><span class="ais-state '+(ok?'ais-good':'ais-pending')+'">'+(ok?'Vinculado':'Conferir')+'</span></div>'
 +'<div class="ais-data"><span>Arquivo: '+esc(t.filename)+'</span><span>Placa: '+esc(t.plate||'—')+'</span><span>Carga PDF: '+esc(t.load_number||'—')+'</span><span>Bruto: '+weight(t.gross_kg)+'</span><span>Tara: '+weight(t.tare_kg)+'</span><span>Líquido: '+weight(t.net_kg)+'</span><span>Carga vinculada: '+esc(t.linked_load||'—')+'</span></div>'
 +(ok?'':'<p>'+esc(t.review_reason||'Vínculo pendente')+'</p><div class="ais-link"><input data-field="plate" aria-label="Placa" placeholder="Placa" value="'+esc(t.plate||'')+'"><input data-field="load" aria-label="Número da carga" placeholder="Carga" value="'+esc(t.load_number||'')+'"><button type="button" data-ticket="'+t.id+'">Vincular</button></div>')+'</article>';
 }).join(''):'<div class="notice">Nenhum ticket AIS recebido. Instale o sincronizador no computador e salve um PDF na pasta.</div>';
 host.querySelectorAll('[data-ticket]').forEach(btn=>btn.onclick=async()=>{
 const article=btn.closest('article'),plate=article.querySelector('[data-field="plate"]').value,carga=article.querySelector('[data-field="load"]').value;
 if(!plate||!carga){alert('Informe placa e carga');return}
 if(!confirm('Vincular este ticket à placa '+plate+' e carga '+carga+'?'))return;
 btn.disabled=true;
 try{const r=await fetch('/api/ais/tickets/'+btn.dataset.ticket+'/link',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({plate,carga})});const data=await r.json();if(!r.ok)throw Error(data.error||'Falha ao vincular');await list()}catch(e){alert(e.message);btn.disabled=false}
 });
 }catch(e){host.textContent=e.message}
}
window.aisRefreshTickets=list;
$('aisRefresh').addEventListener('click',list);
setInterval(()=>{if(!document.hidden&&!$('ticketsAis').classList.contains('hidden'))list()},15000);
list();
})();