'use strict';
/* Importação de DANFE/XML para a análise compartilhada. Sem inventar campos ausentes. */
const pdfjs=require('pdfjs-dist/legacy/build/pdf.js');
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const number=v=>{const n=Number(String(v||'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'));return Number.isFinite(n)?n:null};
const decode=s=>String(s||'').replace(/&(?:amp|lt|gt|quot|apos);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"})[x]);
const tag=(s,name)=>{const m=String(s).match(new RegExp('<(?:[\\w.-]+:)?'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?'+name+'>','i'));return m?decode(clean(m[1])):''};
const parts=(s,name)=>[...String(s).matchAll(new RegExp('<(?:[\\w.-]+:)?'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?'+name+'>','gi'))].map(m=>m[1]);
const day=v=>{const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:String(v||'').slice(0,10)};
const pnorm=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const fromXml=(buf,filename,plate,load)=>{
 const xml=buf.toString('utf8').replace(/^\uFEFF/,'').trim();
 if(!/^<\?xml\b|^<[A-Za-z_]/.test(xml)||/<!DOCTYPE|<!ENTITY/i.test(xml))return {items:[],reason:'XML inválido ou não permitido'};
 const nf=tag(xml,'nNF');
 if(!nf)return {items:[],reason:'XML sem número de NF-e (nNF)'};
 const ide=tag(xml,'ide')||xml,transport=tag(xml,'transp')||xml;
 const base={file:filename,nf,serie:tag(ide,'serie'),data:day(tag(ide,'dhEmi')||tag(ide,'dEmi')),placa:pnorm(tag(transport,'placa')),carga:load,obs:tag(xml,'infCpl'),ref:null};
 const nodes=parts(xml,'det');
 const items=nodes.map(node=>{const product=tag(node,'prod')||node;return {...base,produto:tag(product,'xProd')||'(produto não identificado)',qtd:number(tag(product,'qCom')),un:tag(product,'uCom')}});
 return {items:items.length?items:[{...base,produto:'(sem itens detalhados no XML)',qtd:null,un:''}],reason:null,nf};
};
const fromPdf=async(buf,filename,plate,load)=>{
 const pdf=await pdfjs.getDocument({data:new Uint8Array(buf),disableFontFace:true,useSystemFonts:false,disableWorker:true}).promise;
 const texts=[];
 try{
  for(let p=1;p<=Math.min(pdf.numPages,80);p++){
   const page=await pdf.getPage(p);
   const contents=await page.getTextContent();
   const value=clean(contents.items.map(item=>item.str||'').join(' '));
   if(value)texts.push(value);
  }
 }finally{pdf.destroy().catch(()=>{})}
 if(!texts.length)return {items:[],reason:'PDF sem texto selecionável. Importe o XML da NF-e ou confira manualmente.'};
 const docs=[];
 for(const text of texts){
  const hasHeader=/DANFE|NF-?E|NOTA FISCAL/i.test(text);
  const m=hasHeader&&text.match(/N[º°o]\.?\s*:?\s*([\d.]{3,13})/i);
  if(m)docs.push({nf:m[1].replace(/\./g,'').replace(/^0+(?=\d)/,''),text});
  else if(docs.length)docs[docs.length-1].text+=' '+text;
 }
 if(!docs.length)return {items:[],reason:'Número da NF-e não identificado no PDF. Importação para análise exige conferência ou XML.'};
 const items=[];
 for(const doc of docs){
  const t=doc.text,g=re=>t.match(re)?.[1]||'';
  const serie=g(/S[ÉE]RIE\s*:?\s*(\d{1,3})/i),data=g(/EMISS[ÃA]O\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i)||g(/(\d{2}\/\d{2}\/\d{4})/);
  const ti=t.search(/TRANSPORTADOR/i),pi=t.search(/DADOS DOS PRODUTOS|DADOS DO PRODUTO/i);
  const block=ti>=0?t.slice(ti,pi>ti?pi:ti+600):'';
  const foundPlate=(block.match(/\b[A-Z]{3}-?\d[A-Z0-9]\d{2}\b/)||[''])[0];
  const oi=t.search(/INFORMA[ÇC][ÕO]ES COMPLEMENTARES|DADOS ADICIONAIS/i);
  const obs=oi>=0?t.slice(oi).replace(/RESERVADO AO FISCO.*/i,'').slice(0,2000):'';
  const base={file:filename,nf:doc.nf,serie,data,placa:pnorm(foundPlate),carga:load,obs,ref:null,pdf:true};
  const chunk=pi>=0?t.slice(pi):'',re=/\s(\d{8})\s+(\d{3,4})\s+(\d{4})\s+([A-Za-z]{1,4})\s+([\d.]+,\d{1,4})\s/g;
  let match,prev=0,count=0;
  while((match=re.exec(chunk))){
   const desc=clean(chunk.slice(prev,match.index).replace(/^.*(?:IPI|ICMS|%)\s+/,'').replace(/^\S*\d\S*\s+/,'')).slice(-90);
   prev=re.lastIndex;count++;
   items.push({...base,produto:desc||'(descrição não lida)',qtd:number(match[5]),un:match[4].toUpperCase()});
  }
  if(!count)items.push({...base,produto:'(itens do PDF não lidos: conferir)',qtd:null,un:''});
 }
 return {items,reason:null,nf:docs.map(d=>d.nf).join(', ')};
};
async function analyze(buf,format,filename,plate,load){
 try{return format==='xml'?fromXml(buf,filename,plate,load):await fromPdf(buf,filename,plate,load)}
 catch(e){console.error('NF-e parsing:',e.message);return {items:[],reason:'Falha ao interpretar documento. Utilize XML válido ou confira a NF-e manualmente.'}}
}
module.exports={analyze};
