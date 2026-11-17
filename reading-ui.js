(function(){
'use strict';
const $=id=>document.getElementById(id);
if(!$('readingView'))return;
const ST=['Aguardando chegada','Carregando','Finalizado / documentação','Aguardando liberação','Liberado'];
const icons=['◷','♧','▤','◴','✓'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normPlate=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
let tickets=[],mode='cards',sort='updated';
let lastSuccess=null;
const all=()=>Array.isArray(cargas)?cargas:[];
const key=c=>normPlate(c.placa)+'|'+String(c.carga||'').trim();
function ticketFor(c){
 const matches=tickets.filter(t=>normPlate(t.linked_plate)===normPlate(c.placa)&&String(t.linked_load||'').trim()===String(c.carga||'').trim());
 return matches.find(x=>x.file_available)||matches[0]||null;
}
function filtered(){
 const q=norm($('readingSearch').value),filter=$('readingStatus').value;
 const results=all().filter(c=>(filter===''||String(c.status)===filter)&&(!q||FIELDS.some(k=>norm(c[k]).includes(q))));
 return results.sort((a,b)=>{if(sort==='plate')return String(a.placa||'').localeCompare(String(b.placa||''),'pt-BR');if(sort==='load')return String(a.carga||'').localeCompare(String(b.carga||''),'pt-BR',{numeric:true});return String(b.atualizado||'').localeCompare(String(a.atualizado||''),'pt-BR')});
}
function cell(name,value){return '<div class="rv-field"><span>'+esc(name)+'</span><strong>'+esc(value||'—')+'</strong></div>'}
function link(t){
 if(!t)return '<span class="rv-ticket-missing">⚖ Ticket AIS não vinculado</span>';
 const number=t.ticket_number?'<span class="rv-ticket-number">⚖ Ticket AIS '+esc(t.ticket_number)+'</span>':'<span class="rv-ticket-number">⚖ Ticket AIS vinculado</span>';
 return number+(t.file_available?'<a class="rv-ticket-link" href="/api/ais/file/'+Number(t.id)+'" target="_blank" rel="noopener noreferrer" aria-label="Abrir ticket AIS '+esc(t.ticket_number||'')+'">↗ Ver ticket AIS</a>':'<span class="rv-ticket-unavailable" title="Arquivo ainda não foi armazenado no servidor">Reimporte para abrir o PDF</span>');
}
function card(c){
 const st=Number.isInteger(Number(c.status))?Math.max(0,Math.min(4,Number(c.status))):0;
 const ticket=ticketFor(c);
 return '<article class="rv-load rv-s'+st+'"><div class="rv-load-head"><div class="rv-load-plate"><span class="rv-load-icon">♧</span><div><small>PLACA</small><strong>'+esc(c.placa||'—')+'</strong></div></div><span class="rv-pill rv-pill-'+st+'">'+icons[st]+' '+esc(ST[st])+'</span></div>'
 +'<div class="rv-load-fields">'+cell('CARGA',c.carga)+cell('PEDIDO',c.pedido)+cell('CLIENTE',c.cliente)+cell('PRODUTO',c.produto)+cell('QUANTIDADE',c.quantidade)+cell('TRANSPORTADORA',c.transportadora)+cell('MOTORISTA',c.motorista)+cell('CIDADE',c.cidade)+cell('FRETE',c.frete)+'</div>'
 +'<div class="rv-load-foot"><span class="rv-updated">◷ Atualizado: '+esc(c.atualizado||'—')+'</span><div class="rv-ticket-actions">'+link(ticket)+'</div></div></article>';
}
function stats(){
 const count=all().length;
 const byStatus=ST.map((_,i)=>all().filter(c=>Number(c.status)===i).length);
 const released=byStatus[4],progress=count?Math.round(released/count*100):0;
 const linked=all().filter(c=>Boolean(ticketFor(c))).length;
 const withFile=all().filter(c=>Boolean(ticketFor(c)?.file_available)).length;
 const items=[['▦','Programados',count],['♧','Aguardando chegada',byStatus[0]],['♧','Carregando',byStatus[1]],['▤','Finalizado / documentação',byStatus[2]],['◷','Aguardando liberação',byStatus[3]],['✓','Liberado',released]];
 $('readingStats').innerHTML=items.map(([icon,title,value],i)=>'<div class="rv-kpi rv-kpi-'+i+'"><div class="rv-kpi-title"><span aria-hidden="true">'+icon+'</span><b>'+title+'</b></div><strong>'+value+'</strong><span class="rv-kpi-note">'+(i===5?'Concluídos da programação':'Programação atual')+'</span></div>').join('');
 $('readingProgress').textContent=progress+'%';$('readingProgressRing').style.setProperty('--pct',progress+'%');
 $('readingProgressNote').textContent=released+' de '+count+' cargas liberadas';
 $('readingLinked').textContent=String(linked);
 $('readingFileCount').textContent=withFile+' arquivo(s) disponíveis para abrir';
 $('readingAttention').textContent=String(byStatus[0]+byStatus[3]);
 $('readingAttentionNote').textContent='Aguardando chegada ou liberação';
}
function draw(){
 stats();
 const rows=filtered();const count=rows.length;
 $('readingCount').textContent=count+' carga'+(count===1?'':'s')+' encontrada'+(count===1?'':'s');
 $('readingCards').innerHTML=count?rows.map(card).join(''):'<div class="rv-empty">Nenhum carregamento encontrado. Altere a busca ou os filtros.</div>';
 const showTable=mode==='table';
 $('readingCards').hidden=showTable;
 $('readingTable').hidden=!showTable;
 if(showTable){$('readingTable').innerHTML=count?'<div class="rv-table-scroll"><table><thead><tr><th>Placa</th><th>Carga</th><th>Cliente</th><th>Produto</th><th>Motorista</th><th>Situação</th><th>Ticket AIS</th></tr></thead><tbody>'+rows.map(c=>{const st=Number(c.status)||0;const t=ticketFor(c);return '<tr><td><strong>'+esc(c.placa)+'</strong></td><td>'+esc(c.carga)+'</td><td>'+esc(c.cliente)+'</td><td>'+esc(c.produto)+'</td><td>'+esc(c.motorista)+'</td><td><span class="rv-pill rv-pill-'+st+'">'+esc(ST[st]||ST[0])+'</span></td><td>'+link(t)+'</td></tr>'}).join('')+'</tbody></table></div>':'<div class="rv-empty">Nenhum carregamento encontrado.</div>'}
 $('readingChips').innerHTML=[['','Todos',all().length],...ST.map((name,i)=>[String(i),name,all().filter(c=>Number(c.status)===i).length])].map(([id,label,n])=>'<button type="button" data-filter="'+id+'" class="rv-chip'+($('readingStatus').value===id?' active':'')+'">'+esc(label)+' <b>'+n+'</b></button>').join('');
 $('readingChips').querySelectorAll('button').forEach(btn=>btn.onclick=()=>{$('readingStatus').value=btn.dataset.filter;draw()});
 document.querySelectorAll('[data-reading-mode]').forEach(btn=>{let active=btn.dataset.readingMode===mode;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',String(active))});
 $('readingStamp').textContent=lastSuccess?'Atualizado às '+lastSuccess.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'Sincronizando…';
 const ok=$('connection').classList.contains('ok');$('readingLive').textContent=ok?'● Ao vivo':'● Sem conexão';$('readingLive').className='rv-live '+(ok?'rv-online':'rv-offline');
}
const previousRender=render;
render=function(){previousRender();draw()};
$('readingSearch').addEventListener('input',draw);
$('readingStatus').addEventListener('change',draw);
$('readingSort').addEventListener('change',()=>{sort=$('readingSort').value;draw()});
$('readingClear').addEventListener('click',()=>{$('readingSearch').value='';$('readingStatus').value='';draw()});
$('readingRefresh').addEventListener('click',()=>carregar());
$('readingTicketsNav').addEventListener('click',()=>{ $('readingStatus').value='';$('readingSearch').value='';draw();$('readingLoads').scrollIntoView({behavior:'smooth'})});
document.querySelectorAll('[data-reading-mode]').forEach(btn=>btn.onclick=()=>{mode=btn.dataset.readingMode;draw()});
const originalCarregar=carregar;
carregar=async function(){await originalCarregar();if($('connection').classList.contains('ok'))lastSuccess=new Date();draw()};
async function refreshTickets(){try{const r=await fetch('/api/ais/summary',{cache:'no-store'});if(r.ok){const json=await r.json();tickets=Array.isArray(json.tickets)?json.tickets:[];draw()}}catch(e){}}
refreshTickets();setInterval(()=>{if(!document.hidden)refreshTickets()},15000);
if($('connection').classList.contains('ok'))lastSuccess=new Date();
draw();
})();