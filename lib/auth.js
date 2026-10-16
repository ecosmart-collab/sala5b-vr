// Login do terapeuta: usuário/senha do .env (senha em hash scrypt) + cookie assinado (HMAC).
const crypto = require("node:crypto");

const COOKIE = "sala5b_sessao";
const VALIDADE_MS = 12 * 60 * 60 * 1000; // 12h
const MAX_TENTATIVAS = 5;
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(senha, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function conferirSenha(senha, armazenado) {
  const [salt, hash] = String(armazenado || "").split(":");
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(String(senha), salt, 64);
  const esperado = Buffer.from(hash, "hex");
  return esperado.length === calc.length && crypto.timingSafeEqual(calc, esperado);
}

function lerCookies(header) {
  const out = {};
  for (const parte of String(header || "").split(";")) {
    const i = parte.indexOf("=");
    if (i > 0) out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

function criarAuth({ usuario, senhaHash, segredo, cookieSeguro }) {
  if (!usuario || !senhaHash || !segredo) {
    console.warn("[auth] TERAPEUTA_USUARIO, TERAPEUTA_SENHA_HASH e SESSION_SECRET precisam estar no .env — login desativado.");
  }

  const assinar = (dados) => crypto.createHmac("sha256", segredo || "x").update(dados).digest("base64url");

  function emitirToken() {
    const dados = Buffer.from(JSON.stringify({ u: usuario, exp: Date.now() + VALIDADE_MS })).toString("base64url");
    return `${dados}.${assinar(dados)}`;
  }

  function validarToken(token) {
    if (!segredo || !token) return null;
    const [dados, assinatura] = String(token).split(".");
    if (!dados || !assinatura) return null;
    const esperado = Buffer.from(assinar(dados));
    const recebido = Buffer.from(assinatura);
    if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
    try {
      const payload = JSON.parse(Buffer.from(dados, "base64url").toString());
      return payload.exp > Date.now() ? payload : null;
    } catch {
      return null;
    }
  }

  const terapeutaDoHeader = (cookieHeader) => validarToken(lerCookies(cookieHeader)[COOKIE]);

  // Anti força-bruta simples por IP
  const tentativas = new Map();
  function bloqueado(ip) {
    const t = tentativas.get(ip);
    if (!t) return false;
    if (Date.now() - t.inicio > JANELA_TENTATIVAS_MS) {
      tentativas.delete(ip);
      return false;
    }
    return t.n >= MAX_TENTATIVAS;
  }
  function falhou(ip) {
    const t = tentativas.get(ip) || { n: 0, inicio: Date.now() };
    t.n++;
    tentativas.set(ip, t);
  }

  const atributosCookie = `Path=/; HttpOnly; SameSite=Strict${cookieSeguro ? "; Secure" : ""}`;

  function rotaLogin(req, res) {
    const ip = req.ip;
    if (bloqueado(ip)) return res.status(429).json({ ok: false, erro: "Muitas tentativas. Aguarde 15 minutos." });
    const { usuario: u, senha } = req.body || {};
    const ok = usuario && senhaHash && segredo && u === usuario && conferirSenha(senha, senhaHash);
    if (!ok) {
      falhou(ip);
      return res.status(401).json({ ok: false, erro: "Usuário ou senha inválidos" });
    }
    tentativas.delete(ip);
    res.setHeader("Set-Cookie", `${COOKIE}=${emitirToken()}; Max-Age=${VALIDADE_MS / 1000}; ${atributosCookie}`);
    res.json({ ok: true });
  }

  function rotaLogout(_req, res) {
    res.setHeader("Set-Cookie", `${COOKIE}=; Max-Age=0; ${atributosCookie}`);
    res.json({ ok: true });
  }

  function exigirTerapeuta(req, res, next) {
    if (terapeutaDoHeader(req.headers.cookie)) return next();
    if (req.accepts("html") && req.method === "GET" && !req.path.startsWith("/api/")) return res.redirect("/login.html");
    res.status(401).json({ ok: false, erro: "Login necessário" });
  }

  return { rotaLogin, rotaLogout, exigirTerapeuta, terapeutaDoHeader };
}

module.exports = { criarAuth, hashSenha, conferirSenha };
