// Tempo de uso do óculos por sessão.
// "Em uso" = pessoa conectada e sala fora de pausa. Um intervalo de pelo menos
// 1 minuto fora de uso (pausa, óculos desconectado) conta como descanso e zera o tempo contínuo.
const DESCANSO_MS = 60 * 1000;

function garantir(s) {
  if (!s.oculos) {
    s.oculos = {
      limiteMin: 20,
      avisoNoOculos: false,
      emVR: false,
      usoDesde: null,
      paradoDesde: null,
      continuoMs: 0,
      totalMs: 0,
      maiorContinuoMs: 0,
      avisado: false
    };
  }
  return s.oculos;
}

// Recalcula o estado de uso; chamar sempre que mudar conexão ou pausa
function atualizar(s, conectado) {
  const o = garantir(s);
  const agora = Date.now();
  const emUso = conectado && !s.pausa;
  if (emUso && !o.usoDesde) {
    if (o.paradoDesde && agora - o.paradoDesde >= DESCANSO_MS) {
      o.continuoMs = 0;
      o.avisado = false;
    }
    o.usoDesde = agora;
    o.paradoDesde = null;
  } else if (!emUso && o.usoDesde) {
    const d = agora - o.usoDesde;
    o.totalMs += d;
    o.continuoMs += d;
    o.maiorContinuoMs = Math.max(o.maiorContinuoMs, o.continuoMs);
    o.usoDesde = null;
    o.paradoDesde = agora;
  }
}

function resumo(s) {
  const o = garantir(s);
  const agora = Date.now();
  const corrente = o.usoDesde ? agora - o.usoDesde : 0;
  const descansou = !o.usoDesde && o.paradoDesde && agora - o.paradoDesde >= DESCANSO_MS;
  const continuoMs = descansou ? 0 : o.continuoMs + corrente;
  return {
    emUso: Boolean(o.usoDesde),
    emVR: o.emVR,
    continuoMs,
    totalMs: o.totalMs + corrente,
    maiorContinuoMs: Math.max(o.maiorContinuoMs, continuoMs),
    paradoMs: o.paradoDesde ? agora - o.paradoDesde : 0,
    limiteMin: o.limiteMin,
    avisoNoOculos: o.avisoNoOculos,
    alerta: continuoMs >= o.limiteMin * 60000
  };
}

// Após reiniciar o servidor, o período em andamento não pode ser contado
function aoCarregar(s) {
  if (!s.oculos) return;
  s.oculos.usoDesde = null;
  s.oculos.paradoDesde = Date.now();
}

module.exports = { garantir, atualizar, resumo, aoCarregar, DESCANSO_MS };
