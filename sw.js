/* Oranges Cargas · app shell PWA para abertura imediata nos próximos acessos.
   Não armazena sessões, admin, respostas de API nem documentos fiscais. */
const PREFIX='oranges-mobile-';
const CACHE=PREFIX+'shell-v2';
const PUBLIC_SHELL='/';
const ASSETS=[
  '/reading-ui.js',
  '/public-productivity.js',
  '/documents-public.js',
  '/oranges-symbol.svg',
  '/app-icon.svg',
  '/app-icon.png',
  '/manifest.webmanifest'
];
const isCacheable=(res,url)=>res&&res.ok&&res.type==='basic'&&(url!==PUBLIC_SHELL||String(res.headers.get('content-type')||'').includes('text/html'));
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.allSettled([PUBLIC_SHELL,...ASSETS].map(async url=>{
   const response=await fetch(url,{cache:'reload',credentials:'same-origin'});
   if(isCacheable(response,url))await cache.put(url,response);
  }));
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 // Nunca interceptar área administrativa, APIs, documentos ou autenticação.
 if(url.pathname.startsWith('/api/')||url.pathname==='/login'||url.pathname==='/admin')return;
 const isPublicNavigation=request.mode==='navigate'&&url.pathname==='/';
 const staticAsset=ASSETS.includes(url.pathname);
 if(!isPublicNavigation&&!staticAsset)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  const key=isPublicNavigation?PUBLIC_SHELL:url.pathname;
  const cached=await cache.match(key);
  if(cached){
   // Entrega o app imediatamente, enquanto atualiza os arquivos de forma silenciosa.
   event.waitUntil(fetch(request).then(async response=>{
    if(isCacheable(response,key))await cache.put(key,response.clone());
   }).catch(()=>{}));
   return cached;
  }
  // Primeira visita ainda depende de o serviço Render responder.
  const response=await fetch(request);
  if(isCacheable(response,key))event.waitUntil(cache.put(key,response.clone()).catch(()=>{}));
  return response;
 })());
});
