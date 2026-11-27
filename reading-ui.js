(function(){
'use strict';
const $=id=>document.getElementById(id);
if(!$('readingView'))return;
const ST=['Aguardando chegada','Carregando','Finalizado / Faturando','Aguardando documentação','Aguardando liberação','Liberado','Não carregou','Aguardando liberação PCP'];
const icons=[
'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6.5" width="13" height="10" rx="1.8"/><path d="M15.5 9h3l3 3.5v4h-6M6 16.5v2m12-2v2"/><circle cx="7" cy="18.5" r="2"/><circle cx="18" cy="18.5" r="2"/></svg>',
'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h8l3 9v4H3zM5 9h5M14 13h5M19 9v9h3M14 18h8M14 9l2 4"/></svg>',
'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.5h8l4 4V21H6zM14 2.5v4h4"/><path d="M14.2 10c-.7-.7-3.9-.7-3.9 1.1 0 1.8 4.5.8 4.5 3 0 2.1-3.9 2.3-4.8 1.3M12 8.5v8.5"/></svg>',
'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.5h8l4 4V21H6zM14 2.5v4h4M9 11h6M9 15h6M9 18h4"/></svg>',
'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6.5V12l4 2.5"/></svg>',
'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m7.5 12 3 3 6-6"/></svg>',
'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 8 8 8m0-8-8 8"/></svg>'
];
icons.push(icons[4]);
const plannedIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/></svg>';
const iconTile=(icon,status)=>'<span class="oranges-icon-tile oranges-icon-'+status+'" aria-hidden="true">'+icon+'</span>';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normPlate=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
let tickets=[],mode='cards',sort='updated';
let lastSuccess=null;
const localDay=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const normalizeDay=v=>{let s=String(v||'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return m[1]+'-'+m[2]+'-'+m[3];m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);return m?m[3]+'-'+m[2]+'-'+m[1]:''};
const dayFor=c=>normalizeDay(c.dataProgramacao)||normalizeDay(c.atualizado);
const allRecords=()=>[...(Array.isArray(cargas)?cargas:[]),...(Array.isArray(window.orangesArchivedLoads)?window.orangesArchivedLoads:[])];
const all=()=>Array.isArray(cargas)?cargas.filter(c=>dayFor(c)===localDay()):[];
const historical=()=>allRecords().filter(c=>dayFor(c)&&dayFor(c)!==localDay());
const dateLabel=day=>{let v=String(day||'').split('-');return v.length===3?v[2]+'/'+v[1]+'/'+v[0]:'—'};
let dayOnScreen=localDay();
function drawHistory(){
 const date=$('rvPreviousDate'),container=$('rvPreviousCards'),summary=$('rvPreviousCount');if(!date||!container)return;
 const dates=[...new Set(historical().map(dayFor))].sort().reverse();
 const oldValue=date.value;
 date.innerHTML=dates.length?dates.map(d=>'<option value="'+d+'">'+dateLabel(d)+'</option>').join(''):'<option value="">Nenhuma data anterior</option>';
 if(dates.includes(oldValue))date.value=oldValue;
 else if(dates.includes(dayOnScreen))date.value=dayOnScreen;
 const selected=date.value,rows=historical().filter(c=>dayFor(c)===selected).sort((a,b)=>String(b.atualizado||'').localeCompare(String(a.atualizado||'')));
 dayOnScreen=selected||localDay();
 summary.textContent=rows.length+' carregamento(s) em '+(selected?dateLabel(selected):'datas anteriores');
 container.innerHTML=rows.length?rows.map(card).join(''):'<div class="rv-empty">Nenhum lançamento registrado nesta data.</div>';
}

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
 return number+(t.file_available?'<a class="rv-ticket-link" href="/api/ais/file/'+Number(t.id)+'" target="_blank" rel="noopener noreferrer" aria-label="Abrir ticket AIS '+esc(t.ticket_number||'')+'">↗ Ver ticket AIS</a>':'<span class="rv-ticket-unavailable" title="Arquivo ainda não foi armazenado no servidor">Reimporte para abrir PDF</span>');
}
function card(c){
 const st=Number.isInteger(Number(c.status))?Math.max(0,Math.min(6,Number(c.status))):0;
 const ticket=ticketFor(c);
 const reason=st===6?'<div class="rv-no-load-reason"><strong>Motivo do não carregamento</strong><span>'+esc(c.motivoNaoCarregou||'Não informado')+'</span></div>':'';
 return '<article class="rv-load rv-s'+st+'"><div class="rv-load-head"><div class="rv-load-plate"><span class="rv-load-icon">'+icons[st]+'</span><div><small>PLACA</small><strong>'+esc(c.placa||'—')+'</strong></div></div><span class="rv-pill rv-pill-'+st+'">'+icons[st]+' '+esc(ST[st])+'</span></div>'
 +'<div class="rv-load-fields">'+cell('CARGA',c.carga)+cell('PEDIDO',c.pedido)+cell('CLIENTE',c.cliente)+cell('PRODUTO',c.produto)+cell('QUANTIDADE',c.quantidade)+cell('TRANSPORTADORA',c.transportadora)+cell('MOTORISTA',c.motorista)+cell('CIDADE',c.cidade)+cell('FRETE',c.frete)+'</div>'+reason
 +'<div class="rv-load-foot"><span class="rv-updated">◷ Atualizado: '+esc(c.atualizado||'—')+'</span><div class="rv-ticket-actions">'+link(ticket)+'</div></div></article>';
}

function drawTicketCentral(){
 const input=$('rvTicketSearch');if(!input)return;
 const q=normPlate(input.value);
 const available=tickets.map(t=>({...t,truck:allRecords().find(c=>normPlate(c.placa)===normPlate(t.linked_plate)&&String(c.carga||'')===String(t.linked_load||''))})).filter(t=>t.truck);
 const filteredTickets=available.filter(t=>!q||[t.ticket_number,t.linked_plate,t.linked_load,t.truck?.cliente].some(v=>normPlate(v).includes(q)));
 $('rvTicketCount').textContent=filteredTickets.length+' ticket(s) vinculado(s)';
 $('rvTicketList').innerHTML=filteredTickets.length?filteredTickets.map(t=>'<article class="rv-ticket-card"><div class="rv-ticket-card-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM12 7v10" /></svg></div><div class="rv-ticket-description"><span>Ticket AIS</span><strong>'+esc(t.ticket_number||'Não identificado')+'</strong><small>Placa '+esc(t.linked_plate)+' · Carga '+esc(t.linked_load)+' · '+esc(t.truck?.cliente||'')+'</small></div><div class="rv-ticket-card-action">'+(t.file_available?'<a class="rv-ticket-link" href="/api/ais/file/'+Number(t.id)+'" target="_blank" rel="noopener noreferrer">↗ Abrir '+(t.file_type==='xml'?'XML':'PDF')+'</a>':'<span class="rv-ticket-unavailable">Documento original indisponível</span>')+'</div></article>').join(''):'<div class="rv-empty">Nenhum ticket vinculado corresponde à busca. Quando o arquivo original estiver disponível, o botão de consulta aparecerá aqui.</div>';
}
const accessPerms=Array.isArray(window.ORANGES_PERMISSIONS)?window.ORANGES_PERMISSIONS:['dashboard','tickets','documentos','analiseNF','produtividade','anteriores'];
const canAccess=name=>accessPerms.includes(name);
document.querySelectorAll('[data-rv-tab]').forEach(btn=>{
 if(!canAccess(btn.dataset.rvTab)){btn.hidden=true;btn.style.display='none'}
});
function openTab(name){
 if(!canAccess(name))return;
 const ticketsTab=name==='tickets',prodTab=name==='produtividade',pastTab=name==='anteriores',docsTab=name==='documentos',nfTab=name==='analiseNF';
 $('rvDashboardTab').hidden=ticketsTab||prodTab||pastTab||docsTab||nfTab;
 $('rvTicketCentral').hidden=!ticketsTab;
 $('rvDocumentsCentral').hidden=!docsTab;
 $('rvNFAnalysis').hidden=!nfTab;
 $('rvProductivity').hidden=!prodTab;
 $('rvPreviousLoads').hidden=!pastTab;
 document.querySelectorAll('[data-rv-tab]').forEach(btn=>{const selected=btn.dataset.rvTab===name;btn.classList.toggle('active',selected);btn.setAttribute('aria-selected',String(selected))});
 if(ticketsTab)drawTicketCentral();
 if(pastTab)drawHistory();
 if(nfTab){const frame=$('rvNFAnalysisFrame');if(frame&&frame.contentWindow)frame.contentWindow.postMessage({source:'oranges-nf-refresh'},location.origin)}
}
function stats(){
 const count=all().length;
 const byStatus=ST.map((_,i)=>all().filter(c=>Number(c.status)===i).length);
 const released=byStatus[5],progress=count?Math.round(released/count*100):0;
 const linked=all().filter(c=>Boolean(ticketFor(c))).length;
 const withFile=all().filter(c=>Boolean(ticketFor(c)?.file_available)).length;
 const items=[[plannedIcon,'Programados',count],...ST.map((name,i)=>[icons[i],name,byStatus[i]])];
 $('readingStats').innerHTML=items.map(([icon,title,value],i)=>'<div class="rv-kpi rv-kpi-'+i+'"><div class="rv-kpi-title">'+iconTile(icon,i)+'<b>'+title+'</b></div><strong>'+value+'</strong><span class="rv-kpi-note">'+(i===6?'Liberados da programação':i===7?'Ocorrências registradas':'Programação atual')+'</span></div>').join('');
 $('readingProgress').textContent=progress+'%';$('readingProgressRing').style.setProperty('--pct',progress+'%');
 $('readingProgressNote').textContent=released+' de '+count+' cargas liberadas';
 $('readingLinked').textContent=String(linked);
 $('readingFileCount').textContent=withFile+' arquivo(s) disponíveis para abrir';
 $('readingAttention').textContent=String(byStatus[0]+byStatus[4]);
 $('readingAttentionNote').textContent='Aguardando chegada ou liberação';
}
function draw(){
 stats();
 if($('rvPreviousLoads')&&!$('rvPreviousLoads').hidden)drawHistory();
 const rows=filtered();const count=rows.length;
 $('readingCount').textContent=count+' carga'+(count===1?'':'s')+' encontrada'+(count===1?'':'s');
 $('readingCards').innerHTML=count?rows.map(card).join(''):'<div class="rv-empty">Nenhum carregamento encontrado. Altere a busca ou os filtros.</div>';
 const showTable=mode==='table';
 $('readingCards').hidden=showTable;
 $('readingTable').hidden=!showTable;
 if(showTable){$('readingTable').innerHTML=count?'<div class="rv-table-scroll"><table><thead><tr><th>Placa</th><th>Carga</th><th>Cliente</th><th>Produto</th><th>Motorista</th><th>Situação</th><th>Ticket AIS</th></tr></thead><tbody>'+rows.map(c=>{const st=Number(c.status)||0;const t=ticketFor(c);return '<tr><td><strong>'+esc(c.placa)+'</strong></td><td>'+esc(c.carga)+'</td><td>'+esc(c.cliente)+'</td><td>'+esc(c.produto)+'</td><td>'+esc(c.motorista)+'</td><td><span class="rv-pill rv-pill-'+st+'">'+esc(ST[st]||ST[0])+'</span>'+(st===6?'<div class="rv-no-load-table-reason">Motivo: '+esc(c.motivoNaoCarregou||'Não informado')+'</div>':'')+'</td><td>'+link(t)+'</td></tr>'}).join('')+'</tbody></table></div>':'<div class="rv-empty">Nenhum carregamento encontrado.</div>'}
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
$('readingTicketsNav').addEventListener('click',()=>{openTab('tickets');$('readingView').scrollIntoView({behavior:'smooth'})});
document.querySelectorAll('[data-reading-mode]').forEach(btn=>btn.onclick=()=>{mode=btn.dataset.readingMode;draw()});
const originalCarregar=carregar;
carregar=async function(){await originalCarregar();if($('connection').classList.contains('ok'))lastSuccess=new Date();draw()};
async function refreshTickets(){try{const r=await fetch('/api/ais/summary',{cache:'no-store'});if(r.ok){const json=await r.json();tickets=Array.isArray(json.tickets)?json.tickets:[];draw();drawTicketCentral()}}catch(e){}}
document.querySelectorAll('[data-rv-tab]').forEach(b=>b.addEventListener('click',()=>openTab(b.dataset.rvTab)));
$('rvTicketSearch').addEventListener('input',drawTicketCentral);
$('rvPreviousDate').addEventListener('change',()=>{dayOnScreen=$('rvPreviousDate').value;drawHistory()});
refreshTickets();setInterval(()=>{if(!document.hidden)refreshTickets()},15000);
if($('connection').classList.contains('ok'))lastSuccess=new Date();
openTab(['dashboard','tickets','documentos','analiseNF','produtividade','anteriores'].find(canAccess)||'dashboard');draw();
})();