// Servidor da sala VR: arquivos estáticos + sinalização Networked-Aframe (Socket.IO)
// + proxy para o webhook do n8n (a URL do n8n nunca vai para o navegador).
require("dotenv").config({ path: require("node:path").join(__dirname, ".env") });
const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");

const PORT = Number(process.env.PORT || 8080);
const USE_HTTPS = process.env.HTTPS === "true";
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "";
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET || "";
const MAX_OCCUPANTS = 50;
const COOLDOWN_MS = 2000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data"); // fora de public/: nunca servido como estático

const { criarAuth } = require("./lib/auth");
const { criarStore, CODIGO_RE } = require("./lib/sessoes");
const { registrarSocket5b } = require("./lib/socket5b");

const auth = criarAuth({
  usuario: process.env.TERAPEUTA_USUARIO,
  senhaHash: process.env.TERAPEUTA_SENHA_HASH,
  segredo: process.env.SESSION_SECRET,
  cookieSeguro: USE_HTTPS || process.env.COOKIE_SECURE === "true"
});
const store = criarStore(DATA_DIR);

const app = express();
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1); // atrás do Easypanel/Traefik na VPS
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/troika", express.static(path.join(__dirname, "node_modules/aframe-troika-text/dist")));
app.use("/vendor/fonte", express.static(path.join(__dirname, "node_modules/@fontsource/atkinson-hyperlegible/files")));
app.use("/vendor/naf", express.static(path.join(__dirname, "node_modules/networked-aframe/dist")));

// ---------- Sala 5B: login e área do terapeuta ----------
app.post("/api/login", auth.rotaLogin);
app.post("/api/logout", auth.rotaLogout);
app.get("/terapeuta", auth.exigirTerapeuta, (_req, res) => res.sendFile(path.join(__dirname, "private", "terapeuta.html")));
app.use("/privado", auth.exigirTerapeuta, express.static(path.join(__dirname, "private")));

app.get("/api/eu", auth.exigirTerapeuta, (_req, res) => res.json({ ok: true }));
app.get("/api/sessoes", auth.exigirTerapeuta, (_req, res) => res.json(store.listar()));
app.post("/api/sessoes", auth.exigirTerapeuta, (req, res) => {
  const s = store.criar(req.body || {});
  res.json({ ok: true, codigo: s.codigo });
});

function sessaoDaRota(req, res) {
  const codigo = String(req.params.codigo || "").toUpperCase();
  if (!CODIGO_RE.test(codigo)) return res.status(400).json({ ok: false, erro: "Código inválido" }), null;
  const s = store.ler(codigo);
  if (!s) return res.status(404).json({ ok: false, erro: "Sessão não encontrada" }), null;
  return s;
}

app.get("/api/sessoes/:codigo", auth.exigirTerapeuta, (req, res) => {
  const s = sessaoDaRota(req, res);
  if (s) res.json({ sessao: s, resumo: store.resumo(s) });
});
app.get("/api/sessoes/:codigo/json", auth.exigirTerapeuta, (req, res) => {
  const s = sessaoDaRota(req, res);
  if (!s) return;
  res.setHeader("Content-Disposition", `attachment; filename="sessao-5b-${s.codigo}.json"`);
  res.json({ ...s, resumo: store.resumo(s) });
});
// Relatórios (HTML para imprimir / salvar PDF)
const relatorio = require("./lib/relatorio");
app.get("/relatorios/encontro/:codigo", auth.exigirTerapeuta, (req, res) => {
  const s = sessaoDaRota(req, res);
  if (!s) return;
  res.type("html").send(req.query.versao === "familia" ? relatorio.encontroFamilia(s) : relatorio.encontroProfissional(s, store.resumo(s)));
});
app.get("/relatorios/mensal", auth.exigirTerapeuta, (req, res) => {
  const paciente = String(req.query.paciente || "").trim().slice(0, 40);
  const mes = String(req.query.mes || "");
  if (!paciente || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).send("Informe paciente e mês (AAAA-MM).");
  const sessoes = store
    .listar()
    .filter((x) => x.paciente.toUpperCase() === paciente.toUpperCase() && relatorio.mesDe(x.criadaEm) === mes)
    .map((x) => store.ler(x.codigo))
    .filter(Boolean);
  res.type("html").send(relatorio.mensal(paciente, mes, sessoes));
});

app.get("/api/sessoes/:codigo/csv", auth.exigirTerapeuta, (req, res) => {
  const s = sessaoDaRota(req, res);
  if (!s) return;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="respostas-5b-${s.codigo}.csv"`);
  res.send("﻿" + store.csv(s));
});

// ---------- Proxy do botão -> n8n ----------
const lastCall = new Map(); // ip -> timestamp (anti-spam simples)

app.post("/api/acionar", async (req, res) => {
  if (!N8N_WEBHOOK_URL) {
    return res.status(500).json({ ok: false, erro: "N8N_WEBHOOK_URL não configurada no .env" });
  }

  const ip = req.ip;
  const now = Date.now();
  if (now - (lastCall.get(ip) || 0) < COOLDOWN_MS) {
    return res.status(429).json({ ok: false, erro: "Aguarde um instante antes de apertar de novo" });
  }
  lastCall.set(ip, now);

  const { botao, sala, usuario } = req.body || {};
  const payload = {
    evento: "botao_vr_pressionado",
    botao: String(botao || "principal").slice(0, 50),
    sala: String(sala || "").slice(0, 50),
    usuario: String(usuario || "anonimo").slice(0, 50),
    timestamp: new Date().toISOString()
  };

  try {
    const headers = { "Content-Type": "application/json" };
    if (N8N_WEBHOOK_SECRET) headers["X-VR-Secret"] = N8N_WEBHOOK_SECRET;

    const r = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { resposta: text }; }

    console.log(`[n8n] ${r.status} <- ${payload.usuario} / ${payload.botao}`);
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, n8n: data });
  } catch (err) {
    console.error("[n8n] falha:", err.message);
    res.status(502).json({ ok: false, erro: "n8n indisponível: " + err.message });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, n8nConfigurado: Boolean(N8N_WEBHOOK_URL) }));

// ---------- Servidor HTTP/HTTPS ----------
function createServer() {
  if (!USE_HTTPS) return http.createServer(app);

  // Certificado autoassinado (necessário p/ WebXR no óculos acessando pelo IP da rede)
  const certDir = path.join(__dirname, "certs");
  const keyFile = path.join(certDir, "key.pem");
  const certFile = path.join(certDir, "cert.pem");
  if (!fs.existsSync(keyFile)) {
    const selfsigned = require("selfsigned");
    const pems = selfsigned.generate([{ name: "commonName", value: "vr-sala.local" }], {
      days: 365,
      keySize: 2048
    });
    fs.mkdirSync(certDir, { recursive: true });
    fs.writeFileSync(keyFile, pems.private);
    fs.writeFileSync(certFile, pems.cert);
    console.log("Certificado autoassinado gerado em ./certs");
  }
  return https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, app);
}

const server = createServer();
const io = require("socket.io")(server);
registrarSocket5b(io, store, auth);

// ---------- Sinalização Networked-Aframe (adapter "socketio") ----------
// Baseado em networked-aframe/server/socketio-server.js
const rooms = new Map();

io.on("connection", (socket) => {
  let curRoom = null;

  socket.on("joinRoom", ({ room }) => {
    curRoom = room;
    let roomInfo = rooms.get(room);
    if (!roomInfo) {
      roomInfo = { name: room, occupants: {}, occupantsCount: 0 };
      rooms.set(room, roomInfo);
    }

    if (roomInfo.occupantsCount >= MAX_OCCUPANTS) {
      // Sala cheia: procura/cria instância "sala--N"
      const prefix = `${room}--`;
      let instances = 1;
      let found = false;
      for (const [name, data] of rooms.entries()) {
        if (name.startsWith(prefix)) {
          instances++;
          if (data.occupantsCount < MAX_OCCUPANTS) {
            curRoom = name;
            roomInfo = data;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        curRoom = `${prefix}${instances + 1}`;
        roomInfo = { name: curRoom, occupants: {}, occupantsCount: 0 };
        rooms.set(curRoom, roomInfo);
      }
    }

    const joinedTime = Date.now();
    roomInfo.occupants[socket.id] = joinedTime;
    roomInfo.occupantsCount++;
    socket.join(curRoom);
    console.log(`[sala] ${socket.id} entrou em ${curRoom} (${roomInfo.occupantsCount})`);

    socket.emit("connectSuccess", { joinedTime });
    io.in(curRoom).emit("occupantsChanged", { occupants: roomInfo.occupants });
  });

  socket.on("send", (data) => io.to(data.to).emit("send", data));
  socket.on("broadcast", (data) => socket.to(curRoom).emit("broadcast", data));

  socket.on("disconnect", () => {
    const roomInfo = rooms.get(curRoom);
    if (!roomInfo) return;
    delete roomInfo.occupants[socket.id];
    roomInfo.occupantsCount--;
    socket.to(curRoom).emit("occupantsChanged", { occupants: roomInfo.occupants });
    if (roomInfo.occupantsCount === 0) rooms.delete(curRoom);
  });
});

// Grava sessões ativas antes de sair
for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => {
    store.gravarTodas();
    process.exit(0);
  });
}

server.listen(PORT, "0.0.0.0", () => {
  const proto = USE_HTTPS ? "https" : "http";
  console.log(`\nSala VR rodando:`);
  console.log(`  ${proto}://localhost:${PORT}`);
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === "IPv4" && !i.internal) console.log(`  ${proto}://${i.address}:${PORT}  (rede local / óculos)`);
    }
  }
  console.log(`  Painel do terapeuta: ${proto}://localhost:${PORT}/terapeuta`);
  console.log(`  n8n webhook: ${N8N_WEBHOOK_URL ? "configurado" : "NÃO configurado (.env)"}\n`);
});
