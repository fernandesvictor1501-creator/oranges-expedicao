(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const total=$('aisCleanTotal'),linked=$('aisCleanLinked'),review=$('aisCleanReview');
  const refresh=$('aisCleanRefresh'),backup=$('aisCleanBackup'),execute=$('aisCleanExecute');
  const agree=$('aisCleanAgree'),phrase=$('aisCleanPhrase'),message=$('aisCleanMessage');
  if(!total||!linked||!review||!refresh||!backup||!execute||!agree||!phrase||!message)return;
  let count=null,busy=false;
  function say(text,error=false){message.textContent=text;message.style.color=error?'#ffc0c0':'#e3d5c0'}
  function valid(){execute.disabled=busy||count===null||count===0||!agree.checked||phrase.value.trim()!=='LIMPAR TICKETS AIS'}
  async function getStats(){
    count=null;valid();say('Consultando tickets...');
    try{
      const response=await fetch('/api/ais/admin/stats',{credentials:'same-origin',cache:'no-store'});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Não foi possível consultar os tickets');
      count=data.total;total.textContent=data.total;linked.textContent=data.linked;review.textContent=data.review;
      say(data.total?'Nenhum ticket foi excluído. Confira a quantidade antes de continuar.':'Não há tickets para excluir.');
    }catch(error){say(error.message,true);total.textContent=linked.textContent=review.textContent='—'}
    valid();
  }
  agree.addEventListener('change',valid);
  phrase.addEventListener('input',valid);
  refresh.addEventListener('click',getStats);
  backup.addEventListener('click',async()=>{
    backup.disabled=true;say('Preparando backup dos tickets...');
    try{
      const response=await fetch('/api/ais/admin/backup',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok){const d=await response.json().catch(()=>({}));throw Error(d.error||'Falha ao baixar backup')}
      const blob=await response.blob(),url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;
      a.download='backup_tickets_ais_'+new Date().toISOString().slice(0,10)+'.json';
      document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
      say('Download do backup solicitado. Confira a pasta Downloads do navegador.');
    }catch(error){say(error.message,true)}
    finally{backup.disabled=false}
  });
  execute.addEventListener('click',async()=>{
    if(execute.disabled||count===null)return;
    const expectedCount=count;
    if(!confirm('EXCLUIR '+expectedCount+' TICKET(S) AIS?\n\nOs registros de tickets e seus vínculos serão removidos do sistema. Cargas e histórico operacional serão preservados.\n\nEsta ação não pode ser desfeita automaticamente.'))return;
    busy=true;valid();refresh.disabled=true;
    try{
      const response=await fetch('/api/ais/admin/clear',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation:'LIMPAR TICKETS AIS',expectedCount})});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Não foi possível limpar os tickets');
      agree.checked=false;phrase.value='';say('Limpeza concluída: '+data.deleted+' ticket(s) AIS excluído(s). As cargas continuam preservadas.');
      if(typeof window.aisRefreshTickets==='function')await window.aisRefreshTickets();
    }catch(error){say(error.message,true)}
    finally{busy=false;refresh.disabled=false;await getStats();valid()}
  });
  getStats();
})();