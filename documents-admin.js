(function(){
'use strict';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
if(!$('orangesDocsAdmin'))return;
const fmt=d=>new Date(d).toLocaleString('pt-BR');
const plate=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
let cargas=[];
async function listCargas(){
 try{
  const r=await fetch('/api/state',{cache:'no-store',credentials:'same-origin'});
  if(!r.ok)throw new Error('Não foi possível consultar as cargas');
  const data=await r.json();
  cargas=[...(Array.isArray(data.cargas)?data.cargas:[]),...(Array.isArray(data.cargasArquivadas)?data.cargasArquivadas:[])];
  const select=$('orangesDocsCargo'),current=select.value;
  select.innerHTML='<option value="">Escolha uma carga pela placa ou número...</option>';
  for(const c of cargas){
   const option=document.createElement('option');option.value=String(c.id);
   option.textContent='Carga '+(c.carga||'—')+' · '+(c.placa||'Sem placa')+' · '+(c.cliente||'Cliente não identificado');
   select.appendChild(option);
  }
  if(cargas.some(c=>String(c.id)===current))select.value=current;
 }catch(e){$('orangesDocsFeedback').textContent='Não foi possível carregar as cargas automaticamente. Informe a placa e o número da carga.'}
}
$('orangesDocsCargo').addEventListener('change',()=>{
 const c=cargas.find(x=>String(x.id)===$('orangesDocsCargo').value);
 if(c){$('orangesDocsPlate').value=String(c.placa||'');$('orangesDocsLoad').value=String(c.carga||'')}
});
$('orangesDocsPlate').addEventListener('change',()=>{
 const matches=cargas.filter(c=>plate(c.placa)===plate($('orangesDocsPlate').value));
 if(matches.length===1){$('orangesDocsCargo').value=String(matches[0].id);$('orangesDocsLoad').value=String(matches[0].carga||'')}
});
const updateButton=()=>{$('orangesDocsUpload').textContent=$('orangesDocsType').value==='nfe'?'Importar NF-e':'Importar romaneio'};
$('orangesDocsType').addEventListener('change',updateButton);

async function refresh(){
 const box=$('orangesDocsList');box.innerHTML='<p class="muted">Consultando documentos…</p>';
 try{const r=await fetch('/api/documents/summary',{cache:'no-store'});if(!r.ok)throw Error('Falha ao consultar documentos');
 const {documents=[]}=await r.json();
 $('orangesDocsCount').textContent=documents.length+' arquivo(s) vinculados';
 box.innerHTML=documents.length?'<div class="oranges-docs-list">'+documents.map(d=>
 '<article class="oranges-doc-entry"><div><strong>'+(d.kind==='nfe'?'NF-e':'Romaneio')+' · '+d.format.toUpperCase()+'</strong><small>'+esc(d.plate)+' · Carga '+esc(d.load_number)+' · '+esc(d.filename)+' · '+esc(fmt(d.uploaded_at))+'</small></div><div class="oranges-doc-actions"><a href="/api/documents/file/'+Number(d.id)+'" target="_blank" rel="noopener noreferrer" download="'+esc(d.filename)+'">Exportar '+d.format.toUpperCase()+'</a><button type="button" class="secondary" data-remove-doc="'+Number(d.id)+'">Excluir</button></div></article>'
 ).join('')+'</div>':'<div class="oranges-doc-empty">Nenhuma NF-e ou romaneio anexado.</div>';
 box.querySelectorAll('[data-remove-doc]').forEach(b=>b.addEventListener('click',async()=>{
  if(!confirm('Excluir este documento armazenado? Esta ação não exclui a carga.'))return;
  const resp=await fetch('/api/documents/'+b.dataset.removeDoc,{method:'DELETE'});
  if(!resp.ok){alert((await resp.json().catch(()=>({}))).error||'Falha ao excluir documento');return}
  refresh();
 }));
 }catch(e){box.textContent='Não foi possível consultar documentos: '+e.message}
}
$('orangesDocsUpload').addEventListener('click',async()=>{
 const file=$('orangesDocsFile').files?.[0];
 const plate=$('orangesDocsPlate').value.trim(),load=$('orangesDocsLoad').value.trim();
 if(!file||!plate||!load){$('orangesDocsFeedback').textContent='Informe placa, número da carga e selecione o documento.';return}
 const format=file.name.toLowerCase().endsWith('.pdf')?'pdf':file.name.toLowerCase().endsWith('.xml')?'xml':'';
 if(!format){$('orangesDocsFeedback').textContent='Selecione um PDF ou XML válido.';return}
 if(file.size>8*1024*1024){$('orangesDocsFeedback').textContent='O limite é 8 MB por arquivo.';return}
 const btn=$('orangesDocsUpload');btn.disabled=true;btn.textContent='Enviando documento…';
 try{
 const b64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('Não foi possível ler o arquivo'));reader.readAsDataURL(file)});
 const r=await fetch('/api/documents/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:$('orangesDocsType').value,format,plate,load_number:load,filename:file.name,file_base64:b64})});
 const result=await r.json();if(!r.ok)throw Error(result.error||'Falha ao salvar documento');
 const outcome=result.analysis;
 $('orangesDocsFeedback').textContent=outcome?.status==='imported'
  ?'NF-e importada na carga e na Análise de NF ('+outcome.count+' item(ns) reconhecido(s)). O botão Ver NF-e já está disponível no cartão do veículo.'
  :outcome?.status==='review'||outcome?.status==='failed'
  ?'Documento vinculado à carga e disponível no cartão. Atenção: '+(outcome.reason||'A análise automática requer conferência.')
  :'Romaneio armazenado e vinculado ao carregamento. O botão Ver romaneio está disponível no cartão.';
 $('orangesDocsFile').value='';refresh();
 }catch(e){$('orangesDocsFeedback').textContent=e.message}
 finally{btn.disabled=false;updateButton()}
});
$('orangesDocsRefresh').addEventListener('click',()=>{refresh();listCargas()});
document.querySelector('main>nav button[data-tab="documentos"]')?.addEventListener('click',()=>{refresh();listCargas()});
updateButton();listCargas();refresh();
})();