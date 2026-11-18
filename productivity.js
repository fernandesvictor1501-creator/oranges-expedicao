/* Dashboard de produtividade — Oranges Alimentos. Sem alterações nos registros. */
(function(){
  const $d=id=>document.getElementById(id);
  const STEPS=['Aguardando chegada','Carregando','Finalizado / Faturando','Aguardando documentação','Aguardando liberação','Liberado','Não carregou'];
  const COLORS=['#7e6d7a','#4a7fa7','#8c6ab0','#a06b88','#c7963b','#5fa36e','#b93c60'];
  function safe(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function parseDate(value){
    const s=String(value||'').trim();
    let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,T]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if(m){const d=new Date(+m[3],+m[2]-1,+m[1],+(m[4]||0),+(m[5]||0),+(m[6]||0));return Number.isNaN(+d)?null:d;}
    m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if(m){const d=new Date(+m[1],+m[2]-1,+m[3],+(m[4]||0),+(m[5]||0),+(m[6]||0));return Number.isNaN(+d)?null:d;}
    return null;
  }
  const sameDay=(a,b)=>a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
  function duration(a,b){if(!a||!b)return null;const n=(+b-(+a))/60000;return n>=0&&Number.isFinite(n)?n:null;}
  function timeLabel(v){if(v===null||!Number.isFinite(v))return '—';const n=Math.round(v);return n<60?n+' min':Math.floor(n/60)+'h '+String(n%60).padStart(2,'0')+'min';}
  function mean(v){const a=v.filter(Number.isFinite);return a.length?a.reduce((p,c)=>p+c,0)/a.length:null;}
  function stepsFor(c,history,now){
    const plate=String(c.placa||'').toUpperCase().trim(),load=String(c.carga||'').trim();
    const registered=parseDate(c.dataProgramacao);
    const events=history.filter(x=>String(x.placa||'').toUpperCase().trim()===plate&&String(x.carga||'').trim()===load)
      .map(h=>({status:String(h.depois||''),at:parseDate(h.data)}))
      .filter(h=>h.at&&(!registered||h.at>=registered)).sort((a,b)=>a.at-b.at);
    const first=s=>events.find(h=>h.status===s)?.at||null;
    const loading=first('Carregando');
    const complete=first('Finalizado / Faturando')||first('Finalizado / aguardando documentação');
    const docsStart=first('Aguardando documentação')||first('Finalizado / aguardando documentação');
    const docs=first('Aguardando liberação'),released=first('Liberado');
    const st=Number(c.status),since=st===1?loading:st===2?complete:st===3?docsStart:st===4?docs:null;
    return {loading:duration(loading,complete),faturamento:duration(complete,docsStart),docs:duration(docsStart,docs),release:duration(docs,released),total:duration(loading,released),active:duration(since,now)};
  }
  function update(){
    if(typeof db==='undefined'||!db||!Array.isArray(db.cargas))return;
    const state=db,now=new Date(),scope=$d('prodScope').value;
    const loads=scope==='today'?state.cargas.filter(c=>sameDay(parseDate(c.dataProgramacao),now)):state.cargas;
    const history=Array.isArray(state.historico)?state.historico:[];
    const counts=STEPS.map((_,i)=>loads.filter(c=>Number(c.status)===i).length);
    const calculated=loads.map(c=>({load:c,ts:stepsFor(c,history,now)}));
    const averages={loading:mean(calculated.map(x=>x.ts.loading)),faturamento:mean(calculated.map(x=>x.ts.faturamento)),docs:mean(calculated.map(x=>x.ts.docs)),release:mean(calculated.map(x=>x.ts.release)),total:mean(calculated.map(x=>x.ts.total))};
    const released=counts[5],percentage=loads.length?Math.round(released*100/loads.length):0;
    const thresholds={1:120,2:90,3:60,4:60};
    const alerts=calculated.filter(x=>Number.isFinite(x.ts.active)&&Number(x.ts.active)>thresholds[Number(x.load.status)]).sort((a,b)=>b.ts.active-a.ts.active);
    const sufficient=calculated.filter(x=>x.ts.total!==null).length;
    const kpis=[
      ['Programados',loads.length,scope==='today'?'Cadastrados hoje':'Programação atualmente no painel'],
      ['Liberados',released,percentage+'% da programação selecionada'],
      ['Possíveis atrasos',alerts.length,'Limites de referência, não SLA'],
      ['Média até liberação',timeLabel(averages.total),sufficient+' carga(s) com tempos completos']
    ];
    $d('prodSummary').innerHTML=kpis.map(x=>'<div class="prod-kpi"><div class="prod-kpi-label">'+safe(x[0])+'</div><strong class="prod-kpi-number">'+safe(x[1])+'</strong><div class="prod-kpi-note">'+safe(x[2])+'</div></div>').join('');
    $d('prodStatusBars').innerHTML=counts.map((n,i)=>'<div class="prod-bar-row"><span>'+safe(STEPS[i])+'</span><div class="prod-track"><div class="prod-fill" style="width:'+(loads.length?n*100/loads.length:0)+'%;background:'+COLORS[i]+'"></div></div><b>'+n+'</b></div>').join('');
    const stages=[['Carregamento',averages.loading,'loading'],['Faturamento',averages.faturamento,'faturamento'],['Documentação',averages.docs,'docs'],['Espera pela liberação',averages.release,'release'],['Total até liberação',averages.total,'total']];
    $d('prodDurations').innerHTML=stages.map(([name,avg,key])=>'<div class="prod-stage"><div><span>'+safe(name)+'</span><small>'+calculated.filter(x=>x.ts[key]!==null).length+' carga(s) com dados</small></div><strong>'+timeLabel(avg)+'</strong></div>').join('');
    $d('prodAlertCount').textContent=alerts.length+' alerta'+(alerts.length===1?'':'s');
    $d('prodAlerts').innerHTML=alerts.length?'<div class="prod-table-scroll"><table><thead><tr><th>Placa</th><th>Carga</th><th>Cliente</th><th>Etapa atual</th><th>Tempo na etapa</th></tr></thead><tbody>'+alerts.slice(0,30).map(x=>'<tr><td>'+safe(x.load.placa)+'</td><td>'+safe(x.load.carga)+'</td><td>'+safe(x.load.cliente)+'</td><td>'+safe(STEPS[Number(x.load.status)]||'—')+'</td><td>'+timeLabel(x.ts.active)+'</td></tr>').join('')+'</tbody></table></div>':'<div class="prod-empty">Nenhum atraso calculável neste período. Movimentações sem horário não são estimadas.</div>';
  }
  function attach(){
    if(typeof render!=='function'||!$d('prodScope'))return;
    const old=render;
    render=function(){old();update();};
    $d('prodScope').addEventListener('change',update);
    update();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach,{once:true});else attach();
})();