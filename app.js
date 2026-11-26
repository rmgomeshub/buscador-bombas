'use strict';
const $ = id => document.getElementById(id);
const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
const fmt = n => n == null || n === '' ? '—' : typeof n === 'number' ? n.toLocaleString('pt-BR',{maximumFractionDigits:1}) : String(n);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATUS = {
 disponivel:{label:'Disponível',plural:'Disponíveis',color:'#36a06a'},
 locada:{label:'Locada',plural:'Locadas',color:'#4a87cc'},
 indisponivel:{label:'Indisponível',plural:'Indisponíveis',color:'#d65d5d'},
 manutencao:{label:'Manutenção',plural:'Em manutenção',color:'#d69b3b'},
 nao_informado:{label:'Não informado / conferir',plural:'A conferir',color:'#929fad'}
};
const keys=Object.keys(STATUS);
const FROTA_KEY='bombas-frota-v2';
const LEGADO_KEY='bombas-catalogo-publico-v1';
const MAX_IDADE=5*60*1000;
let banco=null, unidades=null, ultimaFrota=null, origemFrota='ausente', buscando=false, pesquisou=false;
let agrupadas=new Map();

function valido(d){return d && Array.isArray(d.bombas) && typeof d.pontosCadastrados==='number'}
function statusValido(s){return Object.hasOwn(STATUS,s)?s:'nao_informado'}
function dataValida(d){return typeof d==='string' && Number.isFinite(Date.parse(d))}
function dataFmt(d){return dataValida(d)?new Date(d).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Não sincronizado'}
function frotaRecente(){return origemFrota==='rede' && navigator.onLine && dataValida(ultimaFrota) && Date.now()-Date.parse(ultimaFrota)<=MAX_IDADE;}
function syncUI(msg){
 const recente=frotaRecente();
 $('status').textContent=msg;
 $('syncTime').textContent=Array.isArray(unidades)?'Disponibilidade consultada em '+dataFmt(ultimaFrota)+' (horário de Brasília)'+(recente?'':' · pode estar desatualizada'):'Disponibilidade ainda não sincronizada';
 document.querySelector('.syncbar').classList.toggle('warning',!recente);
 $('somenteDisponiveis').disabled=!recente;
 if(!recente)$('somenteDisponiveis').checked=false;
 $('avisoFiltro').textContent=recente?'Filtra modelos com pelo menos uma unidade marcada como disponível. Confirme antes de reservar.':'Filtro de disponibilidade desativado até uma sincronização recente.';
}
function reindex(){
 agrupadas=new Map();
 if(!Array.isArray(unidades))return;
 for(const u of unidades){
  const k=norm(u.modelo); if(!agrupadas.has(k))agrupadas.set(k,[]);
  agrupadas.get(k).push(u);
 }
}
function contar(lista){
 const c=Object.fromEntries(keys.map(k=>[k,0]));
 for(const u of lista)c[statusValido(u.status)]++;
 return c;
}
function listaModelo(modelo){
 return (agrupadas.get(norm(modelo))||[]).filter(u=>u.modeloCadastrado!==false);
}
function atualizarSelect(id,lista,todos,valorDe=x=>x){
 const select=$(id),prev=select.value;
 select.replaceChildren(new Option(todos,id==='filtroModelo'?'':'Todas'));
 for(const v of lista)select.add(new Option(v,valorDe(v)));
 if([...select.options].some(o=>o.value===prev))select.value=prev;
}
function distintos(arr){return [...new Set(arr.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'))}
function atualizarUI(){
 if(banco){
  $('total').textContent=banco.bombas.length;$('pontos').textContent=banco.pontosCadastrados;
  atualizarSelect('categoria',distintos(banco.bombas.map(b=>b.categoria)),'Todas as categorias');
  atualizarSelect('alimentacao',distintos(banco.bombas.map(b=>b.alimentacao)),'Todos os tipos');
 }
 atualizarSelect('filtroModelo',distintos((unidades||[]).map(u=>u.modelo)),'Todos');
 renderFrota();renderPainel();
 if(pesquisou)buscar(null,false);
}
function aceitarTecnico(d){if(!valido(d))throw Error('Catálogo técnico inválido');banco={bombas:d.bombas,pontosCadastrados:d.pontosCadastrados,atualizadoEm:d.atualizadoEm||null};}
function aceitarFrota(d,origem){
 if(!Array.isArray(d.unidades)||!dataValida(d.disponibilidadeAtualizadaEm))return false;
 unidades=d.unidades.map(u=>({...u,status:statusValido(u.status)}));ultimaFrota=d.disponibilidadeAtualizadaEm;origemFrota=origem;reindex();return true;
}
function salvar(){
 if(!banco)return;
 try{localStorage.setItem(FROTA_KEY,JSON.stringify({...banco,unidades,disponibilidadeAtualizadaEm:ultimaFrota}));}catch(_){}
}
function finalizarSync(){buscando=false;$('sincronizar').disabled=false;}
function atualizarRemoto(){
 if(buscando)return;
 const url=window.BOMBAS_API_URL;
 if(!url||!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec(?:\?.*)?$/.test(url)){
  origemFrota=unidades?'cache':'ausente';syncUI('Configure a URL /exec em config.js.');atualizarUI();return;
 }
 if(!navigator.onLine){origemFrota=unidades?'cache':'ausente';syncUI('Sem internet. Exibindo apenas dados salvos.');atualizarUI();return;}
 buscando=true;$('sincronizar').disabled=true;
 syncUI('Sincronizando com o Google Planilhas…');
 let script=document.createElement('script'), finalizado=false;
 function fim(erro){
  if(finalizado)return;finalizado=true;clearTimeout(timer);script.remove();
  if(window.__jsonpFrota===callback)window.__jsonpFrota=null;
  finalizarSync();
  if(erro){origemFrota=unidades?'cache':'ausente';syncUI(erro);atualizarUI();}
 }
 function callback(d){
  if(finalizado)return;
  try{
   aceitarTecnico(d);
   const ok=aceitarFrota(d,'rede');
   if(!ok)origemFrota=unidades?'cache':'ausente';
   salvar();
   syncUI(ok?'Catálogo e frota sincronizados.':(d.erroDisponibilidade||'O Apps Script ainda não fornece disponibilidade. Publique a nova versão.'));
   atualizarUI();fim(null);
  }catch(_){fim('Resposta inválida. Confira a implantação do Apps Script.');}
 }
 const timer=setTimeout(()=>fim('Falha de sincronização. Últimos dados salvos, se disponíveis.'),15000);
 window.__jsonpFrota=callback;
 script.onerror=()=>fim('Não foi possível consultar a planilha. Verifique a internet e a URL.');
 script.onload=()=>{if(!finalizado)fim('O endpoint não retornou o catálogo esperado. Verifique a implantação pública.');};
 script.src=url+(url.includes('?')?'&':'?')+'api=catalogo&t='+Date.now();document.head.appendChild(script);
}
window.receberBombasPWA=d=>{if(window.__jsonpFrota)window.__jsonpFrota(d);};

async function iniciar(){
 try{
  const local=JSON.parse(localStorage.getItem(FROTA_KEY)||'null');
  if(valido(local)){aceitarTecnico(local);aceitarFrota(local,'cache');}
  else {const legado=JSON.parse(localStorage.getItem(LEGADO_KEY)||'null');if(valido(legado))aceitarTecnico(legado);}
 }catch(_){}
 if(!banco){
  try{const r=await fetch('./catalogo-inicial.json');if(!r.ok)throw Error();aceitarTecnico(await r.json());}catch(_){}
 }
 syncUI(banco?'Catálogo salvo. Consultando a planilha…':'Aguardando catálogo da planilha…');atualizarUI();atualizarRemoto();
}

function vazaoNaAltura(pontos,h){
 for(const p of pontos){if(Math.abs(p.altura-h)<1e-6)return {vazao:p.vazao,metodo:'Valor cadastrado'}}
 for(let i=0;i<pontos.length-1;i++){
  const a=pontos[i],b=pontos[i+1];
  if(a.altura<h&&h<b.altura&&b.coluna===a.coluna+1&&b.altura-a.altura<=2.001)
   return {vazao:a.vazao+(b.vazao-a.vazao)*(h-a.altura)/(b.altura-a.altura),metodo:`Interpolação entre ${a.altura} e ${b.altura} mca`};
 }return null;
}
function badge(s,t){s=statusValido(s);return `<span class="badge status-${s}">${esc(t??STATUS[s].label)}</span>`;}
function resumoBadges(c){return keys.filter(k=>c[k]>0).map(k=>badge(k,`${c[k]} ${STATUS[k].plural.toLowerCase()}`)).join('');}
function unidadeRow(u){
 return `<div class="unit-row"><div><div class="unit-id">${esc(u.patrimonio||'Patrimônio não informado')}</div>${!u.patrimonio?'<div class="unit-detail">Linha '+esc(u.linha)+' da planilha</div>':''}${u.conflito?'<div class="unit-detail">Patrimônio duplicado; conferir cadastro</div>':''}</div>${badge(u.status)}</div>`;
}
function disponibilidadeCard(modelo){
 if(!Array.isArray(unidades))return '<div class="avail"><p class="note">Disponibilidade não consultada.</p></div>';
 const lista=listaModelo(modelo);
 if(!lista.length)return '<div class="avail"><p class="note">Sem unidades vinculadas na aba DISPONIBILIDADE.</p></div>';
 const c=contar(lista);
 return `<div class="avail"><div>${(c.disponivel?badge('disponivel',c.disponivel+' '+(c.disponivel===1?'disponível':'disponíveis')):'<span class="badge status-neutro">0 disponíveis</span>')}${keys.filter(k=>k!=='disponivel'&&c[k]>0).map(k=>badge(k,c[k]+' '+(c[k]===1?STATUS[k].label:STATUS[k].plural).toLowerCase())).join('')}</div>
 ${!frotaRecente()?'<p class="fleet-warning">Disponibilidade da última consulta, não confirmada agora.</p>':''}
 <details><summary>Ver ${lista.length} unidade(s) por patrimônio</summary><div class="unit-list">${lista.map(unidadeRow).join('')}</div></details></div>`;
}
function card(r){
 return `<article class="card"><div class="card-top"><div><h3>${esc(r.modelo)}</h3><p class="note">Linha técnica ${esc(r.linha)}${r.serie?' · Série '+esc(r.serie):''}</p></div><div class="flow">${esc(fmt(r.vazao))}<small>m³/h nesta altura</small></div></div>
 <div class="specs"><div><span>Diferença</span><b>${r.diferencaPct>0?'+':''}${esc(fmt(r.diferencaPct))}%</b></div><div><span>Categoria</span><b>${esc(r.categoria||'—')}</b></div><div><span>Alimentação</span><b>${esc(r.alimentacao||'—')}</b></div><div><span>Potência</span><b>${esc(fmt(r.potenciaCV))} CV / ${esc(fmt(r.potenciaKW))} kW</b></div></div>
 <p class="note">${esc(r.metodo)}</p>${disponibilidadeCard(r.modelo)}</article>`;
}
function buscar(e,scroll=true){
 if(e)e.preventDefault();if(!banco){$('resumo').textContent='Catálogo indisponível. Atualize os dados.';return;}
 const h=Number($('altura').value),q=Number($('vazao').value),tol=Number($('tolerancia').value),modo=$('modo').value;
 if($('altura').value===''||$('vazao').value===''||!Number.isFinite(h)||h<0||!Number.isFinite(q)||q<=0||!Number.isFinite(tol)||tol<0||tol>100){$('resumo').textContent='Verifique altura, vazão e tolerância.';return;}
 pesquisou=true;let filtradas=0;const avaliaveis=[];
 const soDisp=$('somenteDisponiveis').checked&&frotaRecente();
 for(const b of banco.bombas){
  if($('categoria').value!=='Todas'&&b.categoria!==$('categoria').value)continue;
  if($('alimentacao').value!=='Todas'&&b.alimentacao!==$('alimentacao').value)continue;
  if(soDisp&&!listaModelo(b.modelo).some(u=>u.status==='disponivel'))continue;
  filtradas++;
  const p=vazaoNaAltura(b.pontos,h);if(!p)continue;const dif=(p.vazao-q)/q*100;
  const atende=modo==='minima'?p.vazao+1e-9>=q:Math.abs(dif)<=tol+1e-9;
  avaliaveis.push({...b,vazao:Math.round(p.vazao*10)/10,diferencaPct:Math.round(dif*10)/10,metodo:p.metodo,atende});
 }
 avaliaveis.sort((a,b)=>Math.abs(a.diferencaPct)-Math.abs(b.diferencaPct)||a.modelo.localeCompare(b.modelo,'pt-BR'));
 const encontrados=avaliaveis.filter(b=>b.atende);
 $('resumo').textContent=`${encontrados.length} modelo(s) compatível(is). ${filtradas} passaram nos filtros; ${avaliaveis.length} têm dados válidos nesta altura.`+(soDisp?' Somente modelos com unidade disponível.':'');
 $('lista').innerHTML=encontrados.length?encontrados.map(card).join(''):'<p class="empty">Nenhuma bomba comprovou atendimento com os filtros escolhidos. Dados ausentes não significam vazão zero.</p>';
 $('avaliadas').innerHTML=avaliaveis.length?avaliaveis.map(card).join(''):'<p class="empty">Nenhuma bomba pôde ser avaliada nesta altura.</p>';
 $('detalhes').hidden=false;if(scroll)$('resultados').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderFrota(){
 const destino=$('listaFrota');
 if(!Array.isArray(unidades)){$('resumoFrota').textContent='';destino.innerHTML='<p class="empty">Aguardando a primeira sincronização da aba DISPONIBILIDADE.</p>';return;}
 const termo=norm($('consultaFrota').value),modelo=$('filtroModelo').value,st=$('filtroStatus').value;
 const filtradas=unidades.filter(u=>(!modelo||u.modelo===modelo)&&(!st||u.status===st)&&(!termo||norm(u.modelo+' '+(u.patrimonio||'Patrimônio não informado')).includes(termo)));
 $('resumoFrota').textContent=`${filtradas.length} de ${unidades.length} unidade(s)`+(frotaRecente()?'':' · última consulta, pode estar desatualizada');
 if(!filtradas.length){destino.innerHTML='<p class="empty">Nenhuma unidade encontrada.</p>';return;}
 const grupos=new Map();
 for(const u of filtradas){if(!grupos.has(u.modelo))grupos.set(u.modelo,[]);grupos.get(u.modelo).push(u);}
 destino.innerHTML=[...grupos].sort(([a],[b])=>a.localeCompare(b,'pt-BR')).map(([m,l])=>`<section class="model-group"><h3>${esc(m)}</h3><small>${l.length} unidade(s) nos filtros${l.some(x=>!x.modeloCadastrado)?' · sem correspondência técnica':''}</small>${resumoBadges(contar(l))}<div class="unit-list">${l.map(unidadeRow).join('')}</div></section>`).join('');
}
function renderPainel(){
 if(!Array.isArray(unidades)){
  $('painelKpis').innerHTML='<p class="empty">Painel aguardando dados da aba DISPONIBILIDADE.</p>';
  $('painelBarras').innerHTML='';$('painelNotas').textContent='';$('painelModelos').innerHTML='';return;
 }
 const c=contar(unidades),total=unidades.length;
 const pct=n=>total?(100*n/total):0;
 $('painelKpis').innerHTML=`<div class="kpi-grid"><div class="kpi"><b>${total}</b><span>Unidades físicas</span><small>Cadastro de disponibilidade</small></div>${keys.map(k=>`<div class="kpi"><b style="color:${STATUS[k].color}">${c[k]}</b><span>${STATUS[k].plural}</span><small>${fmt(pct(c[k]))}% do total</small></div>`).join('')}</div>`;
 $('painelBarras').innerHTML=keys.map(k=>`<div class="bar-label"><span>${STATUS[k].plural}</span><strong>${fmt(pct(c[k]))}%</strong></div><div class="bar-track"><div class="bar-value" style="width:${pct(c[k])}%;background:${STATUS[k].color}"></div></div>`).join('');
 const sem=unidades.filter(u=>!u.patrimonio).length,nao=unidades.filter(u=>!u.modeloCadastrado).length,dup=unidades.filter(u=>u.conflito).length;
 $('painelNotas').textContent=`${sem} unidade(s) sem patrimônio informado · ${nao} sem correspondência técnica · ${dup} patrimônio(s) duplicado(s) a conferir.`+(frotaRecente()?'':' Dados da última consulta; não representam confirmação atual.');
 $('painelModelos').innerHTML=[...agrupadas].sort(([,a],[,b])=>b.length-a.length).map(([,l])=>`<div class="panel-model"><strong>${esc(l[0].modelo)} · ${l.length}</strong>${resumoBadges(contar(l))}</div>`).join('')||'<p class="empty">Nenhuma unidade cadastrada.</p>';
}
function pagina(p){
 if(!['busca','frota','painel'].includes(p))p='busca';
 document.querySelectorAll('.page').forEach(el=>el.hidden=el.id!=='page-'+p);
 document.querySelectorAll('.nav button').forEach(b=>{if(b.dataset.page===p)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelectorAll('.nav button').forEach(b=>b.addEventListener('click',()=>pagina(b.dataset.page)));
$('formBusca').addEventListener('submit',buscar);
$('modo').addEventListener('change',()=>{$('campoTolerancia').hidden=$('modo').value==='minima';$('tolerancia').required=$('modo').value!=='minima';});
$('sincronizar').addEventListener('click',atualizarRemoto);
$('consultaFrota').addEventListener('input',renderFrota);
$('filtroModelo').addEventListener('change',renderFrota);
$('filtroStatus').addEventListener('change',renderFrota);
$('somenteDisponiveis').addEventListener('change',()=>{if(pesquisou)buscar(null,false);});
window.addEventListener('offline',()=>{origemFrota=unidades?'cache':'ausente';syncUI('Sem internet. Dados salvos podem estar desatualizados.');atualizarUI();});
window.addEventListener('online',atualizarRemoto);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)atualizarRemoto();});
setInterval(()=>{if(!document.hidden)atualizarRemoto();},120000);
setInterval(()=>{if(origemFrota==='rede'&&!frotaRecente()){origemFrota='cache';syncUI('Disponibilidade antiga. Atualize antes de utilizar.');atualizarUI();}},30000);
if('serviceWorker' in navigator){
 window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{}));
}
iniciar();

