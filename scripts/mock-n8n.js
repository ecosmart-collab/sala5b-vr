// Simula o webhook do n8n para testar a sala sem a instância real.
// Uso: npm run mock-n8n  e no .env: N8N_WEBHOOK_URL=http://localhost:5678/webhook/vr-botao
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const http = require("node:http");
const SECRET = process.env.N8N_WEBHOOK_SECRET || "";

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== "/webhook/vr-botao") {
        res.writeHead(404).end();
        return;
      }
      if (SECRET && req.headers["x-vr-secret"] !== SECRET) {
        res.writeHead(403, { "Content-Type": "application/json" }).end('{"message":"Authorization data is wrong!"}');
        return;
      }
      const data = JSON.parse(body || "{}");
      console.log("[mock-n8n] recebido:", data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, mensagem: `n8n (mock) recebeu, ${data.usuario}!`, recebido_em: new Date().toISOString() }));
    });
  })
  .listen(5678, () => console.log("mock n8n em http://localhost:5678/webhook/vr-botao"));
