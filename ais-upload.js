(function(){
  'use strict';
  const input=document.getElementById('aisFiles');
  const button=document.getElementById('aisUploadFiles');
  const status=document.getElementById('aisUploadStatus');
  const results=document.getElementById('aisUploadResults');
  if(!input||!button||!status||!results)return;
  const MAX=8*1024*1024;
  let uploading=false;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const say=(s,error=false)=>{status.textContent=s;status.style.color=error?'#ffb7b7':'#e3d5c0';};
  input.addEventListener('change',()=>{
    const n=input.files?.length||0;
    say(n?n+' arquivo(s) selecionado(s). Clique em Importar arquivos selecionados.':'Nenhum arquivo selecionado.');
    results.innerHTML='';
  });
  const base64=buffer=>{
    const a=new Uint8Array(buffer),chunks=[],step=16384;
    for(let i=0;i<a.length;i+=step)chunks.push(String.fromCharCode.apply(null,a.subarray(i,i+step)));
    return btoa(chunks.join(''));
  };
  button.addEventListener('click',async()=>{
    if(uploading)return;
    const files=[...(input.files||[])];
    if(!files.length){say('Selecione um ou mais arquivos PDF ou XML antes de importar.',true);return;}
    uploading=true;button.disabled=true;input.disabled=true;results.innerHTML='';
    let ok=0,pending=0,duplicates=0,fail=0;
    for(let i=0;i<files.length;i++){
      const file=files[i];
      say('Importando '+(i+1)+' de '+files.length+': '+file.name);
      let message='',good=false;
      try{
        if(!/\.(pdf|xml)$/i.test(file.name))throw Error('Formato não permitido. Use PDF ou XML.');
        if(!file.size||file.size>MAX)throw Error('Arquivo vazio ou maior que 8 MB.');
        const data=base64(await file.arrayBuffer());
        const r=await fetch('/api/ais/ingest',{
          method:'POST',credentials:'same-origin',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({filename:file.name,file_base64:data})
        });
        let result={};try{result=await r.json()}catch(_){}
        if(r.status===401){throw Error('Sessão expirada: faça login novamente.');}
        if(!r.ok)throw Error(result.error||'Erro no processamento (HTTP '+r.status+').');
        good=true;ok++;
        if(result.duplicate){duplicates++;message='Arquivo já importado';}
        else if(result.status==='linked'){message='Ticket '+(result.ticket||'')+' vinculado à placa '+(result.plate||'');}
        else{pending++;message='Recebido para conferência: '+(result.reason||'informações incompletas');}
      }catch(e){fail++;message=e.message||String(e);}
      const item=document.createElement('div');
      item.className='ais-upload-result '+(good?'ais-upload-ok':'ais-upload-error');
      item.innerHTML='<strong>'+esc(file.name)+'</strong><span>'+esc(message)+'</span>';
      results.appendChild(item);
    }
    say('Finalizado: '+ok+' recebido(s), '+duplicates+' repetido(s), '+pending+' para conferência e '+fail+' falha(s).',fail>0);
    if(typeof window.aisRefreshTickets==='function')await window.aisRefreshTickets();
    uploading=false;button.disabled=false;input.disabled=false;
  });
})();