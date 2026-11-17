(function(){
'use strict';
const root=document.getElementById('readingView');
if(!root)return;
const $=id=>document.getElementById(id);
const statuses=['Aguardando chegada','Carregando','Finalizado / documentação','Aguardando liberação','Liberado'];
let mode='cards';
const readEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalized=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
function filtered(){
 const query=norm($('busca').value),s=$('filtro').value;
 return cargas.filter(c=>(s===''||String(c.status)===s)&&(!query||FIELDS.some(k=>norm(c[k]).includes(query))));
}
function draw(){
 const items=filtered();
 $('readingResultCount').textContent=items.length+' carga'+(items.length===1?'':'s')+' encontrada'+(items.length===1?'':'s');
 const working=cargas.filter(x=>Number(x.status)===1).length;
 const waiting=cargas.filter(x=>Number(x.status)===3).length;
 $('readingWorking').textContent=String(working);
 $('readingWaiting').textContent=String(waiting);
 $('readingFinished').textContent=String(cargas.filter(x=>Number(x.status)===4).length);
 $('readingTotal').textContent=String(cargas.length);
 const chips=$('readingQuickFilters');
 chips.innerHTML=[{id:'',title:'Todas',count:cargas.length},...statuses.map((title,i)=>({id:String(i),title,count:cargas.filter(c=>Number(c.status)===i).length}))].map(chip=>'<button class="reading-chip'+(String($('filtro').value)===chip.id?' is-selected':'')+'" data-filter="'+chip.id+'" type="button"><span>'+readEsc(chip.title)+'</span><b>'+chip.count+'</b></button>').join('');
 chips.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{$('filtro').value=button.dataset.filter;render()}));
 const dest=$('readingDesktopCards');
 const clones=$('mobileLoads').querySelectorAll('.mobile-load-card');
 dest.innerHTML=clones.length?Array.from(clones).map(card=>card.outerHTML).join(''):'<div class="reading-empty">Nenhum carregamento encontrado para os filtros escolhidos.</div>';
 dest.querySelectorAll('.mobile-load-card details').forEach(detail=>{
  detail.addEventListener('toggle',()=>{if(!detail.open)return;});
 });
 const table=mode==='table';
 dest.hidden=table;
 $('lista').classList.toggle('reading-table-active',table);
 $('lista').setAttribute('aria-hidden',String(!table));
 document.querySelectorAll('[data-reading-mode]').forEach(button=>{
  const selected=button.dataset.readingMode===mode;
  button.classList.toggle('is-active',selected);
  button.setAttribute('aria-pressed',String(selected));
 });
}
const previousRender=render;
render=function(){previousRender();draw()};
$('busca').setAttribute('aria-label','Pesquisar carregamentos');
$('filtro').setAttribute('aria-label','Filtrar por situação');
document.querySelectorAll('[data-reading-mode]').forEach(button=>button.addEventListener('click',()=>{
 mode=button.dataset.readingMode==='table'?'table':'cards';
 draw();
}));
$('readingClear').addEventListener('click',()=>{$('busca').value='';$('filtro').value='';render()});
$('readingRefresh').addEventListener('click',()=>carregar());
const oldCarregar=carregar;
carregar=async function(){await oldCarregar();if($('connection').classList.contains('ok')){$('readingUpdatedAt').textContent='Atualizado às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}else{$('readingUpdatedAt').textContent='Conexão indisponível';}};
draw();
})();