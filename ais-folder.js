(function(){
  const $=id=>document.getElementById(id);
  const status=$('aisFolderStatus'), choose=$('aisChooseFolder'), scan=$('aisScanFolder'), pause=$('aisPauseFolder');
  if(!status||!choose||!scan||!pause)return;
  let handle=null,busy=false,active=false,lastCheck=0;
  const done=new Set();
  function say(msg,failed=false){status.textContent=msg;status.style.color=failed?'#ffb7b7':'#e3d5c0';}
  async function getFiles(dir,depth=0){
    const files=[];
    for await(const entry of dir.values()){
      if(entry.kind==='file'&&entry.name.toLowerCase().endsWith('.pdf'))files.push(entry);
      else if(entry.kind==='directory'&&depth<1)files.push(...await getFiles(entry,depth+1));
    }
    return files;
  }
  async function upload(file){
    const buffer=await file.arrayBuffer();
    if(buffer.byteLength>8*1024*1024)throw Error(file.name+': PDF maior que 8 MB');
    const bytes=new Uint8Array(buffer);
    if(String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')throw Error(file.name+': arquivo não é PDF válido');
    const step=32768,parts=[];
    for(let i=0;i<bytes.length;i+=step)parts.push(String.fromCharCode(...bytes.subarray(i,i+step)));
    const base64=btoa(parts.join(''));
    const response=await fetch('/api/ais/ingest',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name,pdf_base64:base64})});
    let result={};try{result=await response.json()}catch(e){}
    if(response.status===401){active=false;throw Error('Sessão encerrada. Entre novamente no painel administrativo.')}
    if(!response.ok)throw Error(file.name+': '+(result.error||'Erro de importação'));
    return result;
  }
  async function inspect(){
    if(!handle||busy||!active)return;
    if(document.hidden)return;
    busy=true;scan.disabled=true;
    try{
      const permission=await handle.queryPermission({mode:'read'});
      if(permission!=='granted'){active=false;say('Permissão da pasta não está ativa. Clique em Selecionar pasta AIS novamente.',true);return;}
      const entries=await getFiles(handle);
      const ordered=[];
      for(const entry of entries){
        const file=await entry.getFile();
        ordered.push({file,key:file.name+'|'+file.size+'|'+file.lastModified});
      }
      ordered.sort((a,b)=>a.file.lastModified-b.file.lastModified);
      let processed=0,newOnes=0,failed=[];
      for(const item of ordered){
        if(!active)break;
        if(done.has(item.key))continue;
        // Início recente de gravação pode ser arquivo incompleto.
        if(Date.now()-item.file.lastModified<3000)continue;
        try{
          const result=await upload(item.file);
          done.add(item.key);processed++;
          if(!result.duplicate)newOnes++;
         }catch(e){failed.push(e.message);continue;}
      }
      if(active){lastCheck=Date.now();say('Pasta: '+handle.name+'. '+processed+' PDF(s) recebido(s); '+newOnes+' novo(s); '+failed.length+' falha(s). '+(failed.length?'Primeira falha: '+failed[0]:'Nova verificação em até 15 segundos.'),failed.length>0);}
      if(processed&&typeof window.aisRefreshTickets==='function')window.aisRefreshTickets();
    }catch(e){
      active=false;say('Acesso à pasta interrompido: '+e.message+'. Selecione a pasta novamente.',true);
    }finally{busy=false;scan.disabled=!active;}
  }
  choose.onclick=async()=>{
    if(typeof window.showDirectoryPicker!=='function'){
      say('Este navegador não permite monitorar pastas. Use Google Chrome ou Microsoft Edge atualizado no computador.',true);
      return;
    }
    try{
      const chosen=await window.showDirectoryPicker({mode:'read',id:'oranges-tickets-ais'});
      if(!chosen)return;
      const permission=await chosen.requestPermission({mode:'read'});
      if(permission!=='granted'){say('O navegador não recebeu permissão para ler a pasta.',true);return;}
      handle=chosen;done.clear();active=true;pause.disabled=false;scan.disabled=false;
      say('Pasta '+chosen.name+' conectada; verificando PDFs...');
      await inspect();
    }catch(e){if(e.name!=='AbortError')say('Não foi possível selecionar a pasta: '+e.message,true);}
  };
  scan.onclick=inspect;
  pause.onclick=()=>{active=false;handle=null;pause.disabled=true;scan.disabled=true;done.clear();say('Monitoramento pausado. Selecione a pasta AIS para reconectar.');};
  scan.disabled=true;pause.disabled=true;
  say(typeof window.showDirectoryPicker==='function'?'Aguardando você selecionar C:\\Oranges\\Tickets AIS. A página precisa permanecer aberta.':'A seleção automática da pasta requer Chrome ou Edge no computador.');
  setInterval(()=>{if(active&&Date.now()-lastCheck>=14000)inspect()},15000);
})();