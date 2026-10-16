// Atividade Categorias ("supermercado"): coletar só os itens da categoria pedida.
// O profissional escolhe categoria, quantos coletar e quantos itens de outras categorias aparecem;
// a troca de regra mantém a mesma prateleira e muda só a categoria-alvo.
const crypto = require("node:crypto");

const CATEGORIAS = {
  frutas: "Frutas",
  bebidas: "Bebidas",
  limpeza: "Limpeza",
  padaria: "Padaria"
};

// Formas simples (primitivas do A-Frame); medidas em metros
const CATALOGO = [
  { id: "maca", nome: "Maçã", categoria: "frutas", forma: "a-sphere", geo: { radius: 0.085 }, cor: "#d63b2f" },
  { id: "banana", nome: "Banana", categoria: "frutas", forma: "a-cylinder", geo: { radius: 0.035, height: 0.24 }, rot: "0 0 70", cor: "#f2c94c" },
  { id: "uva", nome: "Uva", categoria: "frutas", forma: "a-sphere", geo: { radius: 0.07 }, cor: "#7b3fa0" },
  { id: "laranja", nome: "Laranja", categoria: "frutas", forma: "a-sphere", geo: { radius: 0.09 }, cor: "#f2912c" },
  { id: "pera", nome: "Pera", categoria: "frutas", forma: "a-cone", geo: { radiusBottom: 0.08, radiusTop: 0.04, height: 0.18 }, cor: "#a5c25a" },
  { id: "leite", nome: "Leite", categoria: "bebidas", forma: "a-box", geo: { width: 0.12, height: 0.24, depth: 0.12 }, cor: "#f4f6f7" },
  { id: "suco", nome: "Suco", categoria: "bebidas", forma: "a-box", geo: { width: 0.1, height: 0.22, depth: 0.1 }, cor: "#f39c3d" },
  { id: "agua", nome: "Água", categoria: "bebidas", forma: "a-cylinder", geo: { radius: 0.05, height: 0.26 }, cor: "#8fd3f4" },
  { id: "refrigerante", nome: "Refrigerante", categoria: "bebidas", forma: "a-cylinder", geo: { radius: 0.045, height: 0.2 }, cor: "#c0392b" },
  { id: "cafe", nome: "Café", categoria: "bebidas", forma: "a-box", geo: { width: 0.11, height: 0.16, depth: 0.08 }, cor: "#6e4a2f" },
  { id: "sabao", nome: "Sabão", categoria: "limpeza", forma: "a-box", geo: { width: 0.16, height: 0.08, depth: 0.1 }, cor: "#2bb3c0" },
  { id: "esponja", nome: "Esponja", categoria: "limpeza", forma: "a-box", geo: { width: 0.14, height: 0.06, depth: 0.09 }, cor: "#9bc53d" },
  { id: "detergente", nome: "Detergente", categoria: "limpeza", forma: "a-cylinder", geo: { radius: 0.045, height: 0.24 }, cor: "#3fae5a" },
  { id: "papel", nome: "Papel-toalha", categoria: "limpeza", forma: "a-cylinder", geo: { radius: 0.07, height: 0.2 }, cor: "#ecf0f1" },
  { id: "desinfetante", nome: "Desinfetante", categoria: "limpeza", forma: "a-box", geo: { width: 0.09, height: 0.22, depth: 0.07 }, cor: "#5b7fd6" },
  { id: "pao", nome: "Pão", categoria: "padaria", forma: "a-sphere", geo: { radius: 0.09 }, escala: "1.4 0.7 0.9", cor: "#d9a35f" },
  { id: "bolo", nome: "Bolo", categoria: "padaria", forma: "a-cylinder", geo: { radius: 0.1, height: 0.1 }, cor: "#8b5a3c" },
  { id: "biscoito", nome: "Biscoito", categoria: "padaria", forma: "a-cylinder", geo: { radius: 0.07, height: 0.03 }, cor: "#c98b4f" },
  { id: "rosquinha", nome: "Rosquinha", categoria: "padaria", forma: "a-torus", geo: { radius: 0.06, radiusTubular: 0.025 }, rot: "90 0 0", cor: "#e3b15f" },
  { id: "croissant", nome: "Croissant", categoria: "padaria", forma: "a-cone", geo: { radiusBottom: 0.05, radiusTop: 0.0, height: 0.18 }, rot: "0 0 90", cor: "#e0a85a" }
];

const VAGAS = 15; // 3 prateleiras × 5 posições
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

function novoItem(produto, vaga) {
  return { uid: crypto.randomBytes(4).toString("hex"), produtoId: produto.id, vaga };
}
const produto = (id) => CATALOGO.find((p) => p.id === id);

/**
 * cfg: { categoria, meta (1–5), distratores (0–10), nomes (bool), trocarRegra (bool) }
 * anterior: atividade de categorias anterior (para trocar a regra mantendo a prateleira)
 */
function gerar(cfg, anterior) {
  const categoria = CATEGORIAS[cfg.categoria] ? cfg.categoria : "frutas";
  const doAlvo = CATALOGO.filter((p) => p.categoria === categoria);
  const meta = limitar(cfg.meta, 1, doAlvo.length, 3);
  let itens;
  let trocaDe = null;

  if (cfg.trocarRegra && anterior && anterior.tipo === "categorias") {
    // Mesma prateleira (sem os itens já coletados); completa com itens do novo alvo se faltar
    trocaDe = anterior.categorias.alvo;
    itens = anterior.categorias.itens.filter((i) => !anterior.categorias.coletados.includes(i.uid));
    const livres = embaralhar([...Array(VAGAS).keys()].filter((v) => !itens.some((i) => i.vaga === v)));
    const presentes = itens.filter((i) => produto(i.produtoId).categoria === categoria).length;
    const faltam = embaralhar(doAlvo.filter((p) => !itens.some((i) => i.produtoId === p.id)));
    for (let k = 0; k < meta - presentes && faltam[k] && livres.length; k++) itens.push(novoItem(faltam[k], livres.shift()));
  } else {
    const outros = embaralhar(CATALOGO.filter((p) => p.categoria !== categoria));
    const distratores = limitar(cfg.distratores, 0, Math.min(10, VAGAS - meta), 4);
    const escolhidos = [...embaralhar(doAlvo).slice(0, meta), ...outros.slice(0, distratores)];
    const vagas = embaralhar([...Array(VAGAS).keys()]);
    itens = embaralhar(escolhidos).map((p, k) => novoItem(p, vagas[k]));
  }

  return {
    params: { categoria, meta, distratores: itens.length - itens.filter((i) => produto(i.produtoId).categoria === categoria).length, trocaDe },
    categorias: { alvo: categoria, meta, nomes: cfg.nomes !== false, itens, coletados: [], ultimoEm: null }
  };
}

// Toque num item: certo = item da categoria-alvo ainda não coletado
function tocar(at, uid) {
  const c = at.categorias;
  const item = c.itens.find((i) => i.uid === uid);
  if (!item || c.coletados.includes(uid)) return null;
  const p = produto(item.produtoId);
  const correta = p.categoria === c.alvo;
  const agora = Date.now();
  const tempoMs = agora - (c.ultimoEm || at.enviadaEm);
  c.ultimoEm = agora;
  if (correta) {
    c.coletados.push(uid);
    if (c.coletados.length >= c.meta) at.resolvida = true;
  }
  return { correta, nome: p.nome, categoria: p.categoria, tempoMs };
}

function publico(at, destacar) {
  const c = at.categorias;
  const livres = c.itens.filter((i) => !c.coletados.includes(i.uid));
  const proximo = livres.find((i) => produto(i.produtoId).categoria === c.alvo);
  const vista = (i) => {
    const p = produto(i.produtoId);
    return { uid: i.uid, nome: p.nome, forma: p.forma, geo: p.geo, rot: p.rot || null, escala: p.escala || null, cor: p.cor, vaga: i.vaga };
  };
  return {
    id: at.id,
    tipo: "categorias",
    enunciado: `Coloque no carrinho: ${CATEGORIAS[c.alvo].toUpperCase()}`,
    trocaDeRegra: Boolean(at.params.trocaDe),
    meta: c.meta,
    nomes: c.nomes,
    itens: livres.map(vista),
    noCarrinho: c.coletados.map((uid) => vista(c.itens.find((i) => i.uid === uid))),
    destaque: destacar && proximo ? proximo.uid : null,
    removidas: []
  };
}

module.exports = { CATEGORIAS, CATALOGO, gerar, tocar, publico };
