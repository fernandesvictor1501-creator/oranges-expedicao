(function(){
'use strict';
const $=id=>document.getElementById(id);if(!$('rvDocumentsCentral'))return;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normPlate=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const normal=v=>String(v||'').trim();
let documents=[],ready=false;
const title=d=>d.kind==='nfe'?'NF-e':'Romaneio';
const fileLink=(d,text)=>'<a class="rv-ticket-link" href="/api/documents/file/'+Number(d.id)+'" target="_blank" rel="noopener noreferrer">'+escape(text||'Abrir '+d.format.toUpperCase())+'</a>';
function match(c){return documents.filter(d=>normPlate(d.plate)===normPlate(c.placa)&&normal(d.load_number)===normal(c.carga))}
function draw(){
 const target=$('rvDocumentsList'),q=normal($('rvDocumentsSearch').value).toUpperCase();
 const filtered=documents.filter(d=>[d.plate,d.load_number,d.filename,title(d)].some(v=>String(v||'').toUpperCase().includes(q)));
 $('rvDocumentsCount').textContent=filtered.length+' documento(s)';
 target.innerHTML=!ready?'<div class="rv-empty">Consultando documentos…</div>':filtered.length?filtered.map(d=>
 '<article class="rv-ticket-card"><div class="rv-ticket-card-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM15 3v5h4M9 13h7M9 17h7"/></svg></div><div class="rv-ticket-description"><span>'+title(d)+' · '+escape(d.format.toUpperCase())+'</span><strong>'+escape(d.plate)+' · Carga '+escape(d.load_number)+'</strong><small>'+escape(d.filename)+'</small></div><div class="rv-ticket-card-action">'+fileLink(d,d.format==='pdf'?'Visualizar PDF':'Baixar XML')+'</div></article>'
 ).join(''):'<div class="rv-empty">Nenhuma NF-e ou romaneio vinculado corresponde à busca.</div>';
}
function drawLoadDocuments(){
 const cards=document.querySelectorAll('.rv-load');
 cards.forEach(c=>{
  const plate=c.querySelector('.rv-load-plate strong')?.textContent;
  const load=[...c.querySelectorAll('.rv-field')].find(el=>el.querySelector('span')?.textContent==='CARGA')?.querySelector('strong')?.textContent;
  const foot=c.querySelector('.rv-ticket-actions');if(!foot||!plate||!load)return;
  let section=foot.querySelector('.rv-load-doc-links');if(section)section.remove();
  const found=match({placa:plate,carga:load});if(!found.length)return;
  section=document.createElement('span');section.className='rv-load-doc-links';
  section.innerHTML=found.slice(0,8).map(d=>fileLink(d,d.kind==='nfe'?(d.format==='pdf'?'↗ Ver NF-e · PDF':'↓ Baixar NF-e · XML'):(d.format==='pdf'?'↗ Ver romaneio · PDF':'↓ Baixar romaneio · XML'))).join('');
  foot.appendChild(section);
 });
}
async function refresh(){
 try{const response=await fetch('/api/documents/summary',{cache:'no-store'});if(!response.ok)throw Error('Não foi possível consultar documentos');
 const data=await response.json();documents=Array.isArray(data.documents)?data.documents:[];ready=true;draw();drawLoadDocuments();
 }catch(e){if(!ready){ready=true;$('rvDocumentsList').innerHTML='<div class="rv-empty">Documentos indisponíveis. Tente atualizar a página.</div>';}}
}
$('rvDocumentsSearch').addEventListener('input',draw);
document.querySelectorAll('[data-rv-tab="documentos"]').forEach(b=>b.addEventListener('click',refresh));
const observer=new MutationObserver(()=>{if(ready)drawLoadDocuments()});
observer.observe($('readingCards'),{childList:true});
observer.observe($('rvPreviousCards'),{childList:true});
refresh();setInterval(()=>{if(!document.hidden)refresh()},30000);
})();