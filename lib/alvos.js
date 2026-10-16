// Atividade Alvos (aquecimento): um círculo de cada vez em pontos diferentes do campo de visão.
// Serve para conferir se o laser ou o olhar estão confortáveis antes das atividades (sugerido no B1).
// Registra o uso do controle — tempo até acertar e toques fora do alvo — e não avalia a pessoa.

const TAMANHOS = { grande: 0.2, medio: 0.14, pequeno: 0.09 }; // raio em metros a ~2,2 m
const AREAS = { estreita: 15, ampla: 32 }; // graus para os lados a partir do centro

const embaralhar = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Posições em graus (azimute = lado, elevação = altura); o centro vem primeiro para começar fácil
function posicoes(qtd, area) {
  const a = AREAS[area] || AREAS.estreita;
  const e = Math.round(a * 0.4); // menos para cima/baixo: não cobrir o título
  const base = [
    [0, 0], [-a, 0], [a, 0], [0, e], [0, -e],
    [-a, e], [a, e], [-a, -e], [a, -e]
  ];
  const escolhidas = base.slice(0, qtd);
  return [escolhidas[0], ...embaralhar(escolhidas.slice(1))];
}

function gerar(cfg) {
  const qtd = [5, 9].includes(Number(cfg.qtdAlvos)) ? Number(cfg.qtdAlvos) : 5;
  const tamanho = TAMANHOS[cfg.tamanhoAlvo] ? cfg.tamanhoAlvo : "grande";
  const area = AREAS[cfg.area] ? cfg.area : "estreita";
  return {
    params: { qtdAlvos: qtd, tamanhoAlvo: tamanho, area },
    alvos: { pontos: posicoes(qtd, area), atual: 0, fora: 0, foraNoAlvo: 0, ultimoEm: null }
  };
}

// valor "alvo" = acertou o círculo; "fora" = tocou fora (só laser/mouse; o olhar não gera "fora")
function tocar(at, valor) {
  const c = at.alvos;
  if (valor !== "alvo" && valor !== "fora") return null;
  const agora = Date.now();
  const tempoMs = agora - (c.ultimoEm || at.enviadaEm);
  const indice = c.atual + 1;
  if (valor === "fora") {
    c.fora++;
    c.foraNoAlvo++;
    return { correta: false, indice, tempoMs, foraNoAlvo: c.foraNoAlvo };
  }
  const foraAntes = c.foraNoAlvo;
  c.ultimoEm = agora;
  c.atual++;
  c.foraNoAlvo = 0;
  if (c.atual >= c.pontos.length) at.resolvida = true;
  return { correta: true, indice, tempoMs, foraNoAlvo: foraAntes };
}

function publico(at) {
  const c = at.alvos;
  const ponto = c.pontos[c.atual] || null;
  return {
    id: at.id,
    tipo: "alvos",
    enunciado: at.resolvida ? "Pronto" : "Aponte e toque no círculo",
    total: c.pontos.length,
    feitos: c.atual,
    raio: TAMANHOS[at.params.tamanhoAlvo],
    ponto: at.resolvida ? null : { az: ponto[0], el: ponto[1] },
    removidas: []
  };
}

module.exports = { TAMANHOS, AREAS, gerar, tocar, publico };
