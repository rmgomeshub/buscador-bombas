/**
 * BUSCADOR DE BOMBAS — Google Apps Script
 * Fonte: "Info Técnicas de Bombas.xlsx" convertido para Google Planilhas.
 * A estrutura ORIGINAL é mantida: uma aba, uma linha por bomba e
 * matriz de vazões de M:BO (m³/h) x alturas na linha 2 (mca).
 *
 * IMPORTANTE: abra Apps Script via Extensões > Apps Script
 * dentro da própria Planilha Google. Não precisa informar ID.
 */

const CONFIG = {
  NOME_ABA: 'CADASTRO DE MÁQUINAS',
  LINHA_CABECALHO_ALTURAS: 2,
  LINHA_INICIAL_BOMBAS: 3,
  COLUNA_INICIAL_CURVAS: 13, // coluna M, base 1
  PASSO_MAXIMO_INTERPOLACAO: 2.001 // permite interp. só entre colunas vizinhas de 2 mca
};

function doGet(e) {
  // Endpoint público para o PWA em outro domínio (JSONP).
  // Não inclua senhas nem dados privados na planilha: o catálogo será público.
  if (e && e.parameter && e.parameter.api === 'catalogo') {
    const dados = lerBanco_();
    const resposta = JSON.stringify({
      bombas: dados.bombas,
      pontosCadastrados: dados.pontosCadastrados,
      atualizadoEm: new Date().toISOString()
    }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    // Callback FIXO: não executa JavaScript arbitrário enviado por URL.
    return ContentService.createTextOutput('receberBombasPWA(' + resposta + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Buscador Técnico de Bombas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function normalizar_(v) {
  return String(v == null ? '' : v).normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

function numero_(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (valor === null || valor === undefined) return null;
  let txt = String(valor).trim().replace(/\s+/g, '');
  if (!txt) return null;
  if (txt.includes(',') && txt.includes('.')) {
    txt = txt.lastIndexOf(',') > txt.lastIndexOf('.')
      ? txt.replace(/\./g, '').replace(',', '.')
      : txt.replace(/,/g, '');
  } else if (txt.includes(',')) {
    txt = txt.replace(',', '.');
  }
  const n = Number(txt);
  return Number.isFinite(n) ? n : null;
}

function texto_(valor) {
  return valor === null || valor === undefined ? '' : String(valor).trim();
}

function arred_(valor, casas) {
  return Math.round((valor + Number.EPSILON) * Math.pow(10, casas)) / Math.pow(10, casas);
}

function obterAba_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Abra o editor pelo menu Extensões > Apps Script da planilha convertida para Planilhas Google.');
  }
  const aba = ss.getSheets().find(a => normalizar_(a.getName()) === normalizar_(CONFIG.NOME_ABA));
  if (!aba) {
    throw new Error('Não encontrei a aba "CADASTRO DE MÁQUINAS". Abas encontradas: ' +
      ss.getSheets().map(a => a.getName()).join(', '));
  }
  return aba;
}

/**
 * Lê sua única aba sem criar ou alterar qualquer célula.
 * A: Modelo, B: série, C: categoria, D: diâmetro (pol), E: sólidos (mm)
 * F: potência CV, G: potência kW, H: alimentação, I: peso (kg)
 * J/K/L: correntes A em 220/380/440 V
 * M:BO: vazões (m³/h), com alturas (mca) na linha 2.
 */
function lerBanco_() {
  const aba = obterAba_();
  const linhas = aba.getDataRange().getValues();
  if (linhas.length < CONFIG.LINHA_INICIAL_BOMBAS) {
    throw new Error('A planilha precisa ter as 2 linhas de cabeçalho e pelo menos uma bomba.');
  }
  if (normalizar_(linhas[0][0]) !== normalizar_('Modelo da Bomba')) {
    throw new Error('A coluna A1 precisa conter "Modelo da Bomba". Confirme que está usando a planilha enviada.');
  }

  const linhaAlturas = linhas[CONFIG.LINHA_CABECALHO_ALTURAS - 1];
  const colunasAlturas = [];
  for (let col = CONFIG.COLUNA_INICIAL_CURVAS - 1; col < linhaAlturas.length; col++) {
    const altura = numero_(linhaAlturas[col]);
    if (altura !== null && altura >= 0) {
      colunasAlturas.push({ col: col, altura: altura });
    }
  }
  if (!colunasAlturas.length) {
    throw new Error('Não encontrei alturas numéricas na linha 2, a partir da coluna M.');
  }

  const bombas = [];
  let pontosCadastrados = 0;
  for (let linha = CONFIG.LINHA_INICIAL_BOMBAS - 1; linha < linhas.length; linha++) {
    const r = linhas[linha];
    const modelo = texto_(r[0]);
    if (!modelo) continue;

    const pontos = [];
    for (const coluna of colunasAlturas) {
      const vazao = numero_(r[coluna.col]);
      // Vazio significa ausência de informação. Vazão zero é um valor válido.
      if (vazao !== null && vazao >= 0) {
        pontos.push({ coluna: coluna.col, altura: coluna.altura, vazao: vazao });
      }
    }
    pontos.sort((a, b) => a.altura - b.altura);
    pontosCadastrados += pontos.length;

    bombas.push({
      linha: linha + 1,
      modelo: modelo,
      serie: texto_(r[1]),
      categoria: texto_(r[2]),
      diametroPol: numero_(r[3]),
      solidosMM: numero_(r[4]),
      potenciaCV: numero_(r[5]),
      potenciaKW: numero_(r[6]),
      alimentacao: texto_(r[7]),
      pesoKG: numero_(r[8]),
      corrente220: numero_(r[9]),
      corrente380: numero_(r[10]),
      corrente440: numero_(r[11]),
      pontos: pontos
    });
  }
  return { bombas: bombas, pontosCadastrados: pontosCadastrados };
}

/**
 * Interpolação linear SEM extrapolação e SEM atravessar células vazias.
 * O programa só interpola entre duas colunas de alturas consecutivas.
 */
function vazaoNaAltura_(pontos, alturaPedida) {
  if (!pontos.length) return null;
  const margem = 0.000001;
  for (const ponto of pontos) {
    if (Math.abs(ponto.altura - alturaPedida) <= margem) {
      return { vazao: ponto.vazao, metodo: 'Valor cadastrado', intervalo: [ponto.altura, ponto.altura] };
    }
  }
  for (let i = 0; i < pontos.length - 1; i++) {
    const a = pontos[i];
    const b = pontos[i + 1];
    if (a.altura < alturaPedida && alturaPedida < b.altura &&
        b.coluna === a.coluna + 1 &&
        b.altura - a.altura <= CONFIG.PASSO_MAXIMO_INTERPOLACAO) {
      const proporcao = (alturaPedida - a.altura) / (b.altura - a.altura);
      return {
        vazao: a.vazao + (b.vazao - a.vazao) * proporcao,
        metodo: 'Interpolação entre ' + a.altura + ' e ' + b.altura + ' mca',
        intervalo: [a.altura, b.altura]
      };
    }
  }
  return null;
}

/** Retorna categorias e alimentações existentes na planilha. */
function listarOpcoes() {
  const dados = lerBanco_();
  const distintos = campo => [...new Set(dados.bombas.map(b => b[campo]).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return {
    categorias: distintos('categoria'),
    alimentacoes: distintos('alimentacao'),
    totalModelos: dados.bombas.length,
    pontosCadastrados: dados.pontosCadastrados
  };
}

/**
 * filtros: { altura, vazao, modo: 'aproximada'|'minima',
 *            tolerancia: 0..100, categoria: 'Todas'|valor,
 *            alimentacao: 'Todas'|valor }
 */
function pesquisarBombas(filtros) {
  filtros = filtros || {};
  const altura = numero_(filtros.altura);
  const vazaoAlvo = numero_(filtros.vazao);
  const tolerancia = numero_(filtros.tolerancia);
  const modo = filtros.modo === 'minima' ? 'minima' : 'aproximada';
  const categoria = texto_(filtros.categoria) || 'Todas';
  const alimentacao = texto_(filtros.alimentacao) || 'Todas';

  if (altura === null || altura < 0) throw new Error('Digite uma altura válida em mca (0 ou maior).');
  if (vazaoAlvo === null || vazaoAlvo <= 0) throw new Error('Digite uma vazão maior que zero, em m³/h.');
  if (tolerancia === null || tolerancia < 0 || tolerancia > 100) {
    throw new Error('A tolerância precisa estar entre 0 e 100%.');
  }

  const dados = lerBanco_();
  const avaliaveis = [];
  let bombasFiltradas = 0;
  for (const b of dados.bombas) {
    if (categoria !== 'Todas' && b.categoria !== categoria) continue;
    if (alimentacao !== 'Todas' && b.alimentacao !== alimentacao) continue;
    bombasFiltradas++;

    const operacao = vazaoNaAltura_(b.pontos, altura);
    if (operacao === null) continue;

    const diferencaPct = (operacao.vazao - vazaoAlvo) / vazaoAlvo * 100;
    const atende = modo === 'minima'
      ? operacao.vazao + 1e-9 >= vazaoAlvo
      : Math.abs(diferencaPct) <= tolerancia + 1e-9;

    avaliaveis.push({
      linha: b.linha,
      modelo: b.modelo,
      serie: b.serie,
      categoria: b.categoria,
      alimentacao: b.alimentacao,
      potenciaCV: b.potenciaCV,
      potenciaKW: b.potenciaKW,
      diametroPol: b.diametroPol,
      solidosMM: b.solidosMM,
      pesoKG: b.pesoKG,
      corrente220: b.corrente220,
      corrente380: b.corrente380,
      corrente440: b.corrente440,
      vazao: arred_(operacao.vazao, 1),
      diferencaPct: arred_(diferencaPct, 1),
      metodo: operacao.metodo,
      atende: atende
    });
  }

  avaliaveis.sort((a, b) => {
    const criterio = modo === 'minima'
      ? (a.atende && b.atende ? (a.vazao - b.vazao) : Math.abs(a.diferencaPct) - Math.abs(b.diferencaPct))
      : Math.abs(a.diferencaPct) - Math.abs(b.diferencaPct);
    return criterio || a.modelo.localeCompare(b.modelo, 'pt-BR');
  });

  return {
    encontrados: avaliaveis.filter(b => b.atende),
    avaliaveis: avaliaveis,
    totalModelos: dados.bombas.length,
    bombasFiltradas: bombasFiltradas,
    pontosCadastrados: dados.pontosCadastrados,
    observacao: 'Resultados calculados com os dados da planilha. Não há RPM, disponibilidade, eficiência nem NPSH cadastrados: conferir a curva original e as condições reais antes de selecionar o equipamento.'
  };
}

/** Teste opcional no editor: execute e veja o log de execução. */
function testarBusca() {
  const resultado = pesquisarBombas({
    altura: 90,
    vazao: 500,
    modo: 'aproximada',
    tolerancia: 15,
    categoria: 'Todas',
    alimentacao: 'Todas'
  });
  Logger.log(JSON.stringify(resultado.encontrados, null, 2));
}
