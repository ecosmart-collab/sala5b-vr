// Gera atividades lógico-matemáticas. A resposta correta fica no servidor;
// o paciente só recebe a versão "publica" e o servidor corrige.
const crypto = require("node:crypto");
const cubo = require("./cubo2x2");
const categorias = require("./categorias");

const TIPOS = ["contagem", "comparacao", "soma", "cubo", "palavra", "categorias"];

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const embaralhar = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const limitar = (v, min, max, padrao) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : padrao;
};

function opcoesNumericas(correta, qtd, maxValor) {
  const set = new Set([correta]);
  let delta = 1;
  while (set.size < qtd && delta < 30) {
    for (const c of [correta + delta, correta - delta]) {
      if (set.size < qtd && c >= 0 && c <= maxValor) set.add(c);
    }
    delta++;
  }
  return embaralhar([...set]);
}

/**
 * cfg: { tipo, max, numOpcoes, destacar, a, b, n, pergunta }
 * a/b/n opcionais (o terapeuta pode fixar valores); senão aleatórios até "max".
 */
function gerarAtividade(cfg = {}, anterior = null) {
  const tipo = TIPOS.includes(cfg.tipo) ? cfg.tipo : "contagem";
  const max = limitar(cfg.max, 2, 10, 5);
  const numOpcoes = limitar(cfg.numOpcoes, 2, 4, 3);
  const destacar = Boolean(cfg.destacar);
  const limiteSeg = Number(cfg.limiteResposta);
  const base = {
    id: crypto.randomUUID(),
    tipo,
    criadaEm: Date.now(),
    apoios: { numOpcoes, destacar },
    limiteMs: [10, 20, 30, 60].includes(limiteSeg) ? limiteSeg * 1000 : 0
  };

  if (tipo === "categorias") {
    return { ...base, apoios: { destacar }, correta: null, ...categorias.gerar(cfg, anterior) };
  }

  if (tipo === "palavra") {
    const lista = listaPalavras(cfg.palavras);
    if (!lista.length) return null;
    const indice = limitar(cfg.indice, 0, lista.length - 1, 0);
    const palavra = lista[indice];
    const unidade = cfg.unidade === "silaba" ? "silaba" : "letra";
    const unidades = unidade === "silaba" ? palavra.split("-").filter(Boolean) : [...palavra.replace(/-/g, "")];
    const arranjo = cfg.arranjo === "arco" ? "arco" : "ordem";
    let pecas = unidades.map((texto, i) => ({ id: "p" + i, texto }));
    if (arranjo === "arco" && pecas.length > 1) {
      const original = pecas.map((p) => p.texto).join();
      for (let t = 0; t < 10 && pecas.map((p) => p.texto).join() === original; t++) pecas = embaralhar(pecas);
    }
    return {
      ...base,
      apoios: { destacar, falar: Boolean(cfg.falar) },
      params: { palavra, unidade, arranjo, indice, totalLista: lista.length, tamanho: [1, 1.3, 1.6].includes(Number(cfg.tamanho)) ? Number(cfg.tamanho) : 1 },
      correta: unidades.join(unidade === "silaba" ? "-" : ""),
      palavra: { unidades, pecas, usadas: [], progresso: 0, ultimoEm: null }
    };
  }

  if (tipo === "cubo") {
    const profundidade = limitar(cfg.profundidade, 1, 8, 3);
    const numMov = [2, 3, 6].includes(Number(cfg.numMov)) ? Number(cfg.numMov) : 6;
    const idx = cubo.embaralhar(profundidade);
    return {
      ...base,
      apoios: { numMov, destacar, mapa: Boolean(cfg.mapa) },
      params: { profundidade },
      correta: null,
      cubo: { idx, passos: 0, distInicial: profundidade, opcoes: opcoesCubo(idx, numMov), ultimo: null, ultimoEm: null }
    };
  }

  if (tipo === "contagem") {
    const n = cfg.n ? limitar(cfg.n, 1, 10, 3) : rand(1, max);
    return {
      ...base,
      params: { n },
      correta: n,
      publico: { enunciado: "Quantos há?", n, opcoes: opcoesNumericas(n, numOpcoes, Math.max(max, n + 2)) }
    };
  }

  if (tipo === "comparacao") {
    let a = cfg.a ? limitar(cfg.a, 1, 10, 2) : rand(1, max);
    let b = cfg.b ? limitar(cfg.b, 1, 10, 4) : rand(1, max);
    if (a === b) b = a < max ? a + 1 : a - 1;
    if (b < 1) b = 2;
    const pergunta = cfg.pergunta === "menos" ? "menos" : "mais";
    const correta = (pergunta === "mais") === a > b ? "esquerda" : "direita";
    return {
      ...base,
      apoios: { numOpcoes: 2, destacar },
      params: { a, b, pergunta },
      correta,
      publico: { enunciado: `Qual grupo tem ${pergunta}?`, a, b, opcoes: ["esquerda", "direita"] }
    };
  }

  // soma
  const a = cfg.a ? limitar(cfg.a, 0, 10, 2) : rand(1, Math.max(1, max - 1));
  const b = cfg.b ? limitar(cfg.b, 0, 10, 1) : rand(1, Math.max(1, max - a));
  const correta = a + b;
  return {
    ...base,
    params: { a, b },
    correta,
    publico: { enunciado: `${a} + ${b} = ?`, a, b, opcoes: opcoesNumericas(correta, numOpcoes, Math.max(max, correta + 2)) }
  };
}

// Palavras digitadas pelo profissional: "BO-LA, CA-SA" (hífen separa sílabas)
function listaPalavras(txt) {
  return String(txt || "")
    .toUpperCase()
    .split(/[,;\n]+/)
    .map((p) => p.trim().replace(/\s+/g, ""))
    .filter((p) => /^[A-ZÀ-ÖØ-Ý-]{1,20}$/.test(p) && /[A-ZÀ-ÖØ-Ý]/.test(p))
    .slice(0, 30);
}

// Toque em uma peça (letra ou sílaba); certo = é a próxima da palavra
function tocarPeca(at, pecaId) {
  const w = at.palavra;
  const peca = w.pecas.find((p) => p.id === pecaId);
  if (!peca || w.usadas.includes(pecaId)) return null;
  const esperado = w.unidades[w.progresso];
  const posicao = w.progresso + 1;
  const correta = peca.texto === esperado;
  const agora = Date.now();
  const tempoMs = agora - (w.ultimoEm || at.enviadaEm);
  w.ultimoEm = agora;
  if (correta) {
    w.usadas.push(pecaId);
    w.progresso++;
    if (w.progresso === w.unidades.length) at.resolvida = true;
  }
  return { correta, texto: peca.texto, esperado, posicao, tempoMs };
}

function publicoPalavra(at) {
  const w = at.palavra;
  const esperado = w.unidades[w.progresso];
  const livres = w.pecas.filter((p) => !w.usadas.includes(p.id));
  const silaba = at.params.unidade === "silaba";
  return {
    id: at.id,
    tipo: "palavra",
    enunciado: at.params.arranjo === "arco" ? "Monte a palavra" : silaba ? "Toque as sílabas em ordem" : "Toque as letras em ordem",
    unidade: at.params.unidade,
    arranjo: at.params.arranjo,
    tamanho: at.params.tamanho || 1,
    total: w.unidades.length,
    colocadas: w.unidades.slice(0, w.progresso),
    pecas: livres,
    destaque: at.apoios.destacar && esperado ? (livres.find((p) => p.texto === esperado) || {}).id || null : null,
    falar: at.apoios.falar ? w.unidades.join("") : null,
    removidas: []
  };
}

// Movimentos mostrados: todos, ou uma escolha reduzida com pelo menos um que aproxima
function opcoesCubo(idx, numMov) {
  if (numMov >= 6) return [...cubo.MOVIMENTOS];
  const viz = cubo.vizinhos(idx);
  const d = cubo.distancia(idx);
  const bons = embaralhar(viz.filter((v) => v.dist < d).map((v) => v.mov));
  const outros = embaralhar(viz.map((v) => v.mov).filter((m) => m !== bons[0]));
  const escolhidos = new Set([bons[0], ...outros.slice(0, numMov - 1)]);
  return cubo.MOVIMENTOS.filter((m) => escolhidos.has(m));
}

// Aplica um movimento do paciente; devolve o registro do passo
function moverCubo(at, mov) {
  const c = at.cubo;
  if (!c.opcoes.includes(mov)) return null;
  const de = cubo.distancia(c.idx);
  c.idx = cubo.mover(c.idx, mov);
  const para = cubo.distancia(c.idx);
  c.passos++;
  const agora = Date.now();
  const tempoMs = agora - (c.ultimoEm || at.enviadaEm);
  c.ultimoEm = agora;
  c.ultimo = { mov, n: c.passos };
  if (para === 0) at.resolvida = true;
  else c.opcoes = opcoesCubo(c.idx, at.apoios.numMov);
  return { de, para, aproximou: para < de, tempoMs };
}

function publicoCubo(at) {
  const c = at.cubo;
  const d = cubo.distancia(c.idx);
  const rota = d > 0 ? cubo.caminho(c.idx) : [];
  return {
    id: at.id,
    tipo: "cubo",
    enunciado: d === 0 ? "Cubo resolvido" : "Leve o cubo até resolvido",
    ...cubo.estadoDe(c.idx),
    dist: d,
    distInicial: c.distInicial,
    passos: c.passos,
    opcoes: c.opcoes,
    ultimo: c.ultimo,
    mapa: at.apoios.mapa,
    vizinhos: cubo.vizinhos(c.idx).map((v) => ({ mov: v.mov, aproxima: at.apoios.mapa ? v.dist < d : null })),
    destaque: at.apoios.destacar && d > 0 ? c.opcoes.find((m) => cubo.distancia(cubo.mover(c.idx, m)) < d) || null : null,
    removidas: []
  };
}

// Versão enviada ao paciente (sem a resposta; inclui "destaque" só se o apoio visual estiver ligado)
function paraPaciente(at) {
  if (!at) return null;
  if (at.tipo === "cubo") return publicoCubo(at);
  if (at.tipo === "palavra") return publicoPalavra(at);
  if (at.tipo === "categorias") return categorias.publico(at, at.apoios.destacar);
  return {
    id: at.id,
    tipo: at.tipo,
    ...at.publico,
    destaque: at.apoios.destacar ? at.correta : null,
    removidas: at.removidas || []
  };
}

function corrigir(at, valor) {
  return String(at.correta) === String(valor);
}

const tocarItem = (at, uid) => categorias.tocar(at, uid);

module.exports = { TIPOS, gerarAtividade, paraPaciente, corrigir, moverCubo, tocarPeca, tocarItem, listaPalavras };
