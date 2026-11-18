'use strict';
const $=id=>document.getElementById(id);
const fmt=n=>n==null||n===''?'—':typeof n==='number'?n.toLocaleString('pt-BR',{maximumFractionDigits:1}):String(n);
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let banco=null;
const STORAGE='bombas-catalogo-publico-v1';
function status(t,erro=false){$('status').textContent=t;$('status').classList.toggle('error',erro)}
function valido(d){return d&&Array.isArray(d.bombas)&&typeof d.pontosCadastrados==='number'}
function opcoes(){
 $('total').textContent=banco.bombas.length;$('pontos').textContent=banco.pontosCadastrados;
 for(const [id,key] of [['categoria','categoria'],['alimentacao','alimentacao']]){
  const select=$(id),prev=select.value;select.replaceChildren(new Option(id==='categoria'?'Todas as categorias':'Todos os tipos','Todas'));
  [...new Set(banco.bombas.map(b=>b[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')).forEach(v=>select.add(new Option(v,v)));
  if([...select.options].some(o=>o.value===prev))select.value=prev;
 }
}
function aceitar(d,origem){if(!valido(d))throw new Error('Catálogo inválido');banco=d;opcoes();status(origem);}
// Callback de nome fixo: evita depender de CORS do Apps Script.
window.receberBombasPWA=function(d){
 try{aceitar(d,'Catálogo atualizado diretamente do Google Planilhas.');try{localStorage.setItem(STORAGE,JSON.stringify(d))}catch(_){}}catch(e){status('Falha ao ler os dados recebidos: '+e.message,true)}
 window.__jsonpDone?.();
};
function atualizarRemoto(){
 const url=window.BOMBAS_API_URL;
 if(!url||!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec(?:\?.*)?$/.test(url)){
  status('Modo demonstração: configure a URL /exec em config.js para atualizar pela planilha.');return;
 }
 let script=document.createElement('script');let terminou=false;
 const timeout=setTimeout(()=>finish(false),15000);
 function finish(ok){if(terminou)return;terminou=true;clearTimeout(timeout);script.remove();window.__jsonpDone=null;if(!ok)status('Não foi possível atualizar agora. Usando o último catálogo disponível.',true)}
 window.__jsonpDone=()=>finish(true);
 script.onerror=()=>finish(false);
 const sep=url.includes('?')?'&':'?';script.src=url+sep+'api=catalogo&t='+Date.now();document.head.appendChild(script);
}
async function iniciar(){
 try{const local=localStorage.getItem(STORAGE);if(local)aceitar(JSON.parse(local),'Catálogo salvo anteriormente. Atualizando…')}catch(_){}
 if(!banco){try{const r=await fetch('./catalogo-inicial.json');if(!r.ok)throw Error();aceitar(await r.json(),'Catálogo inicial da planilha (cópia estática). Atualizando…')}catch(e){status('Não foi possível carregar o catálogo inicial.',true)}}
 atualizarRemoto();
}
function vazaoNaAltura(pontos,h){
 for(const p of pontos){if(Math.abs(p.altura-h)<1e-6)return {vazao:p.vazao,metodo:'Valor cadastrado'}}
 for(let i=0;i<pontos.length-1;i++){
  const a=pontos[i],b=pontos[i+1];
  if(a.altura<h&&h<b.altura&&b.coluna===a.coluna+1&&b.altura-a.altura<=2.001)
   return {vazao:a.vazao+(b.vazao-a.vazao)*(h-a.altura)/(b.altura-a.altura),metodo:`Interpolação entre ${a.altura} e ${b.altura} mca`};
 }return null;
}
function card(r){return `<article class="card"><div class="card-top"><div><h3>${esc(r.modelo)}</h3><p class="note">Linha ${esc(r.linha)}${r.serie?' · Série '+esc(r.serie):''}</p></div><div class="flow">${esc(fmt(r.vazao))}<small>m³/h nesta altura</small></div></div><div class="specs"><div><span>Diferença</span><b>${r.diferencaPct>0?'+':''}${esc(fmt(r.diferencaPct))}%</b></div><div><span>Categoria</span><b>${esc(r.categoria||'—')}</b></div><div><span>Alimentação</span><b>${esc(r.alimentacao||'—')}</b></div><div><span>Potência</span><b>${esc(fmt(r.potenciaCV))} CV / ${esc(fmt(r.potenciaKW))} kW</b></div></div><p class="note">${esc(r.metodo)}</p></article>`}
function buscar(e){e.preventDefault();if(!banco){status('Catálogo indisponível. Aguarde e tente novamente.',true);return}
 const h=Number($('altura').value),q=Number($('vazao').value),tol=Number($('tolerancia').value),modo=$('modo').value;
 if(!Number.isFinite(h)||h<0||!Number.isFinite(q)||q<=0||!Number.isFinite(tol)||tol<0||tol>100){status('Verifique altura, vazão e tolerância.',true);return}
 let filtradas=0;const avaliaveis=[];
 for(const b of banco.bombas){if($('categoria').value!=='Todas'&&b.categoria!==$('categoria').value)continue;if($('alimentacao').value!=='Todas'&&b.alimentacao!==$('alimentacao').value)continue;filtradas++;
 const p=vazaoNaAltura(b.pontos,h);if(!p)continue;const dif=(p.vazao-q)/q*100;
 const atende=modo==='minima'?p.vazao+1e-9>=q:Math.abs(dif)<=tol+1e-9;
 avaliaveis.push({...b,vazao:Math.round(p.vazao*10)/10,diferencaPct:Math.round(dif*10)/10,metodo:p.metodo,atende});
 }
 avaliaveis.sort((a,b)=>{const delta=modo==='minima'&&a.atende&&b.atende?a.vazao-b.vazao:Math.abs(a.diferencaPct)-Math.abs(b.diferencaPct);return delta||a.modelo.localeCompare(b.modelo,'pt-BR')});
 const encontrados=avaliaveis.filter(b=>b.atende);
 $('resumo').textContent=`${encontrados.length} bomba(s) compatível(is). ${filtradas} passaram nos filtros; ${avaliaveis.length} têm dados válidos nesta altura.`;
 $('lista').innerHTML=encontrados.length?encontrados.map(card).join(''):'<p class="sub">Nenhuma bomba compatível nos pontos cadastrados. Dados ausentes não significam vazão zero.</p>';
 $('avaliadas').innerHTML=avaliaveis.length?avaliaveis.map(card).join(''):'<p class="sub">Nenhuma bomba pôde ser avaliada nesta altura.</p>';
 $('detalhes').hidden=false;$('resultados').scrollIntoView({behavior:'smooth',block:'start'});
}
$('formBusca').addEventListener('submit',buscar);
$('modo').addEventListener('change',()=>{$('campoTolerancia').hidden=$('modo').value==='minima'});
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
iniciar();
