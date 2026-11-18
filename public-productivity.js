(function(){
'use strict';
const $=id=>document.getElementById(id);if(!$('rvProductivity'))return;
const STEPS=['Aguardando chegada','Carregando','Finalizado / Faturando','Aguardando documentação','Aguardando liberação','Liberado','Não carregou'];
const COLORS=['#8994a3','#4187bf','#9b77c6','#b788a9','#cca15a','#40aa78','#b93c60'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cached={cargas:[],historico:[]};let hasData=false;let updatedAt=0;let fetching=false;
function parseDate(value){
 const s=String(value||'').trim();
 let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,T]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
 if(m){const d=new Date(+m[3],+m[2]-1,+m[1],+(m[4]||0),+(m[5]||0),+(m[6]||0));return Number.isNaN(+d)?null:d;}
 m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
 if(m){const d=new Date(+m[1],+m[2]-1,+m[3],+(m[4]||0),+(m[5]||0),+(m[6]||0));return Number.isNaN(+d)?null:d;}
 return null;
}
const sameDay=(a,b)=>a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
const minutes=(a,b)=>{if(!a||!b)return null;const delta=(+b-(+a))/60000;return Number.isFinite(delta)&&delta>=0?delta:null};
const fmt=v=>v===null||!Number.isFinite(v)?'—':Math.round(v)<60?Math.round(v)+' min':Math.floor(Math.round(v)/60)+'h '+String(Math.round(v)%60).padStart(2,'0')+'min';
const mean=arr=>{const v=arr.filter(Number.isFinite);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
function times(c,history,now){
 const plate=String(c.placa||'').toUpperCase().replace(/[^A-Z0-9]/g,''),load=String(c.carga||'').trim();
 const register=parseDate(c.dataProgramacao);
 const events=history.filter(h=>String(h.placa||'').toUpperCase().replace(/[^A-Z0-9]/g,'')===plate&&String(h.carga||'').trim()===load)
   .map(h=>({status:String(h.depois||''),at:parseDate(h.data)}))
   .filter(e=>e.at&&(!register||e.at>=register)).sort((a,b)=>a.at-b.at);
 const first=name=>events.find(e=>e.status===name)?.at||null;
 const loading=first('Carregando');
 const billing=first('Finalizado / Faturando')||first('Finalizado / aguardando documentação');
 const documentation=first('Aguardando documentação')||first('Finalizado / aguardando documentação');
 const approval=first('Aguardando liberação'),released=first('Liberado');
 const stage=Number(c.status);
 const activeStart=stage===1?loading:stage===2?billing:stage===3?documentation:stage===4?approval:null;
 return {
  loading:minutes(loading,billing),billing:minutes(billing,documentation),
  documents:minutes(documentation,approval),approval:minutes(approval,released),
  total:minutes(loading,released),active:minutes(activeStart,now)
 };
}
function draw(){
 if(!hasData){$('rvProdSummary').innerHTML='<div class="rv-prod-empty">Carregando indicadores…</div>';return}
 const now=new Date(),today=$('rvProdPeriod').value==='today';
 const loads=today?cached.cargas.filter(c=>sameDay(parseDate(c.dataProgramacao),now)):cached.cargas;
 const history=cached.historico;
 const counts=STEPS.map((_,i)=>loads.filter(c=>Number(c.status)===i).length);
 const rows=loads.map(c=>({load:c,time:times(c,history,now)}));
 const averages={loading:mean(rows.map(x=>x.time.loading)),billing:mean(rows.map(x=>x.time.billing)),documents:mean(rows.map(x=>x.time.documents)),approval:mean(rows.map(x=>x.time.approval)),total:mean(rows.map(x=>x.time.total))};
 const thresholds={1:120,2:90,3:60,4:60};
 const alerts=rows.filter(x=>Number.isFinite(x.time.active)&&x.time.active>thresholds[Number(x.load.status)]).sort((a,b)=>b.time.active-a.time.active);
 const released=counts[5],percent=loads.length?Math.round(100*released/loads.length):0;
 const completed=rows.filter(x=>x.time.total!==null).length;
 const stats=[
  ['Programados',loads.length,'Cargas na seleção'],
  ['Liberados',released,percent+'% da programação'],
  ['Possíveis atrasos',alerts.length,'Limites de referência, não SLA'],
  ['Média até liberação',fmt(averages.total),completed+' carga(s) com dados completos']
 ];
 $('rvProdSummary').innerHTML=stats.map(([title,value,note])=>'<div class="rv-prod-kpi"><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></div>').join('');
 $('rvProdBars').innerHTML=counts.map((n,i)=>'<div class="rv-prod-row"><span>'+esc(STEPS[i])+'</span><div class="rv-prod-track"><div class="rv-prod-fill" style="width:'+(loads.length?100*n/loads.length:0)+'%;background:'+COLORS[i]+'"></div></div><b>'+n+'</b></div>').join('');
 const stages=[['Carregamento','loading'],['Faturamento','billing'],['Documentação','documents'],['Espera pela liberação','approval'],['Total até liberação','total']];
 $('rvProdDurations').innerHTML=stages.map(([label,k])=>'<div class="rv-prod-duration"><div><span>'+esc(label)+'</span><small>'+rows.filter(x=>x.time[k]!==null).length+' carga(s) com dados</small></div><strong>'+fmt(averages[k])+'</strong></div>').join('');
 $('rvProdAlertCount').textContent=alerts.length+' alerta'+(alerts.length===1?'':'s');
 $('rvProdAlerts').innerHTML=alerts.length?'<div class="rv-prod-table-wrap"><table class="rv-prod-table"><thead><tr><th>Placa</th><th>Carga</th><th>Cliente</th><th>Etapa atual</th><th>Tempo na etapa</th></tr></thead><tbody>'+alerts.slice(0,50).map(x=>'<tr><td>'+esc(x.load.placa)+'</td><td>'+esc(x.load.carga)+'</td><td>'+esc(x.load.cliente)+'</td><td>'+esc(STEPS[x.load.status]||'—')+'</td><td>'+fmt(x.time.active)+'</td></tr>').join('')+'</tbody></table></div>':'<div class="rv-prod-empty">Nenhum possível atraso calculável com os horários disponíveis.</div>';
}
async function refresh(force=false){
 if(fetching||(!force&&Date.now()-updatedAt<14000))return;
 fetching=true;
 try{
  const r=await fetch('/api/public/productivity',{cache:'no-store'});
  if(!r.ok)throw Error('Falha ao consultar indicadores');
  const d=await r.json();if(!Array.isArray(d.cargas)||!Array.isArray(d.historico))throw Error('Dados incompletos');
  cached=d;hasData=true;updatedAt=Date.now();draw();
 }catch(e){if(!hasData)$('rvProdSummary').innerHTML='<div class="rv-prod-empty">Não foi possível carregar os indicadores. Tente novamente ao atualizar a página.</div>';console.warn('Public productivity',e.message)}
 finally{fetching=false}
}
$('rvProdPeriod').addEventListener('change',draw);
document.querySelectorAll('[data-rv-tab="produtividade"]').forEach(btn=>btn.addEventListener('click',()=>refresh(true)));
refresh(true);setInterval(()=>{if(!document.hidden&&$('rvProductivity')&&!$('rvProductivity').hidden)refresh()},15000);
})();
