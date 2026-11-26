// Buscador de Bombas — versão frota 2026-11-26.
const PREFIX='bombas-pwa-frota-'+encodeURIComponent(self.registration.scope)+'-';
const CACHE=PREFIX+'v4';
const CORE=['./','./index.html','./style.css?v=20261126-frota1','./app.js?v=20261126-frota1','./config.js?v=20261126-frota1','./manifest.webmanifest'];
// Os arquivos opcionais não impedem a instalação se uma imagem ainda
// estiver sendo publicada ou se o catálogo original usar outro formato.
const OPTIONAL=['./catalogo-inicial.json','./icons/icon-192.png','./icons/icon-512.png','./obracon-logo-branca.webp','./obracon-logo.webp'];
self.addEventListener('install',e=>{
 e.waitUntil((async()=>{const c=await caches.open(CACHE);
 await c.addAll(CORE.map(url=>new Request(url,{cache:'reload'})));
 await Promise.allSettled(OPTIONAL.map(url=>c.add(new Request(url,{cache:'reload'}))));
 await self.skipWaiting();})());
});
self.addEventListener('activate',e=>{
 e.waitUntil((async()=>{const nomes=await caches.keys();
 await Promise.all(nomes.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)));
 await self.clients.claim();})());
});
self.addEventListener('fetch',e=>{
 const req=e.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
 e.respondWith((async()=>{
 const c=await caches.open(CACHE);
 try{
  const r=await fetch(req,{cache:'no-cache'});
  if(r.ok){try{await c.put(req,r.clone());}catch(_){}}
  return r;
 }catch(_){
  const saved=await c.match(req);
  if(saved)return saved;
  if(req.mode==='navigate')return (await c.match('./index.html'))||Response.error();
  return Response.error();
 }
 })());
});
