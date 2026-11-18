/* Oranges · cache apenas de recursos visuais públicos.
   Sessões, HTML com dados operacionais, APIs, NF-e e documentos nunca ficam no cache. */
const VERSION='oranges-static-v3';
const PREFIX='oranges-';
const ASSETS=['/oranges-symbol.svg','/app-icon.svg','/app-icon.png','/manifest.webmanifest'];
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(VERSION);
  await Promise.allSettled(ASSETS.map(async url=>{
   const r=await fetch(url,{cache:'reload',credentials:'same-origin'});
   if(r.ok&&r.type==='basic')await cache.put(url,r);
  }));
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==VERSION).map(key=>caches.delete(key)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||request.mode==='navigate')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin||!ASSETS.includes(url.pathname))return;
 event.respondWith((async()=>{
  const cache=await caches.open(VERSION);
  const cached=await cache.match(url.pathname);
  if(cached)return cached;
  const r=await fetch(request);if(r.ok&&r.type==='basic')event.waitUntil(cache.put(url.pathname,r.clone()));
  return r;
 })());
});