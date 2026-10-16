// Cubo 2x2 como grafo de estados.
// Vértices: as 3.674.160 configurações (canto DBL fixo). Arestas: giros de 1/4 em U, R e F.
// Uma busca em largura (BFS) a partir do cubo resolvido dá a distância de todo estado até a solução;
// o caminho mais curto é seguir sempre uma aresta que reduz a distância em 1.
//
// Convenção das posições dos cantos (padrão de Kociemba):
// 0 URF, 1 UFL, 2 ULB, 3 UBR, 4 DFR, 5 DLF, 6 DBL (fixo), 7 DRB

const BASE = {
  U: { cp: [3, 0, 1, 2, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0] },
  R: { cp: [4, 1, 2, 0, 7, 5, 6, 3], co: [2, 0, 0, 1, 1, 0, 0, 2] },
  F: { cp: [1, 5, 2, 3, 0, 4, 6, 7], co: [1, 2, 0, 0, 2, 1, 0, 0] }
};
const MOVIMENTOS = ["U", "U'", "R", "R'", "F", "F'"];
const N_PERM = 5040; // 7!
const N_ORI = 729; // 3^6
const TOTAL = N_PERM * N_ORI;
const POS = [0, 1, 2, 3, 4, 5, 7]; // posições móveis

function aplicarBase(est, m) {
  const b = BASE[m];
  const cp = new Array(8);
  const co = new Array(8);
  for (let i = 0; i < 8; i++) {
    cp[i] = est.cp[b.cp[i]];
    co[i] = (est.co[b.cp[i]] + b.co[i]) % 3;
  }
  return { cp, co };
}
function aplicar(est, mov) {
  const vezes = mov.endsWith("'") ? 3 : 1;
  let e = est;
  for (let k = 0; k < vezes; k++) e = aplicarBase(e, mov[0]);
  return e;
}

// ---- coordenadas (permutação 0..5039, orientação 0..728)
const fatorial = [1, 1, 2, 6, 24, 120, 720, 5040];
function rankPerm(cp) {
  const p = POS.map((pos) => (cp[pos] === 7 ? 6 : cp[pos]));
  let r = 0;
  for (let i = 0; i < 7; i++) {
    let menores = 0;
    for (let j = i + 1; j < 7; j++) if (p[j] < p[i]) menores++;
    r += menores * fatorial[6 - i];
  }
  return r;
}
function unrankPerm(r) {
  const disp = [0, 1, 2, 3, 4, 5, 6];
  const cp = [0, 0, 0, 0, 0, 0, 6, 0];
  for (let i = 0; i < 7; i++) {
    const f = fatorial[6 - i];
    const k = Math.floor(r / f);
    r %= f;
    const v = disp.splice(k, 1)[0];
    cp[POS[i]] = v === 6 ? 7 : v;
  }
  return cp;
}
function rankOri(co) {
  let r = 0;
  for (let i = 0; i < 6; i++) r = r * 3 + co[i];
  return r;
}
function unrankOri(r) {
  const co = [0, 0, 0, 0, 0, 0, 0, 0];
  let soma = 0;
  for (let i = 5; i >= 0; i--) {
    co[i] = r % 3;
    soma += co[i];
    r = Math.floor(r / 3);
  }
  co[7] = (3 - (soma % 3)) % 3;
  return co;
}

const indice = (est) => rankPerm(est.cp) * N_ORI + rankOri(est.co);
const estadoDe = (idx) => ({ cp: unrankPerm(Math.floor(idx / N_ORI)), co: unrankOri(idx % N_ORI) });

// ---- tabelas de movimento e BFS (calculadas uma vez, ~1 s)
const IDENT = { cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0] };
const movPerm = new Uint16Array(N_PERM * 6);
const movOri = new Uint16Array(N_ORI * 6);
for (let p = 0; p < N_PERM; p++) {
  const e = { cp: unrankPerm(p), co: IDENT.co };
  MOVIMENTOS.forEach((m, k) => (movPerm[p * 6 + k] = rankPerm(aplicar(e, m).cp)));
}
for (let o = 0; o < N_ORI; o++) {
  const e = { cp: IDENT.cp, co: unrankOri(o) };
  MOVIMENTOS.forEach((m, k) => (movOri[o * 6 + k] = rankOri(aplicar(e, m).co)));
}

function vizinho(idx, k) {
  const p = Math.floor(idx / N_ORI);
  const o = idx % N_ORI;
  return movPerm[p * 6 + k] * N_ORI + movOri[o * 6 + k];
}

const dist = new Uint8Array(TOTAL).fill(255);
(function bfs() {
  const fila = new Int32Array(TOTAL);
  let ini = 0;
  let fim = 0;
  dist[0] = 0;
  fila[fim++] = 0;
  while (ini < fim) {
    const v = fila[ini++];
    const d = dist[v] + 1;
    for (let k = 0; k < 6; k++) {
      const w = vizinho(v, k);
      if (dist[w] === 255) {
        dist[w] = d;
        fila[fim++] = w;
      }
    }
  }
})();

const DIST_MAX = dist.reduce((m, d) => (d !== 255 && d > m ? d : m), 0);

// ---- API
const distancia = (idx) => dist[idx];
const mover = (idx, mov) => vizinho(idx, MOVIMENTOS.indexOf(mov));

function vizinhos(idx) {
  return MOVIMENTOS.map((mov, k) => ({ mov, dist: dist[vizinho(idx, k)] }));
}

// Caminho mais curto até resolvido (sequência de movimentos)
function caminho(idx) {
  const seq = [];
  let atual = idx;
  while (dist[atual] > 0) {
    const d = dist[atual];
    const opcoes = MOVIMENTOS.map((m, k) => [m, vizinho(atual, k)]).filter(([, w]) => dist[w] === d - 1);
    const [m, w] = opcoes[0];
    seq.push(m);
    atual = w;
  }
  return seq;
}

// Estado aleatório a exatamente "profundidade" movimentos da solução
function embaralhar(profundidade) {
  const alvo = Math.max(1, Math.min(DIST_MAX, profundidade));
  let idx = 0;
  while (dist[idx] < alvo) {
    const subir = MOVIMENTOS.map((_, k) => vizinho(idx, k)).filter((w) => dist[w] === dist[idx] + 1);
    idx = subir[Math.floor(Math.random() * subir.length)];
  }
  return idx;
}

module.exports = { MOVIMENTOS, TOTAL, DIST_MAX, distancia, mover, vizinhos, caminho, embaralhar, estadoDe, indice, aplicar };
