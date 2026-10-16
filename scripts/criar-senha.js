// Gera TERAPEUTA_SENHA_HASH e SESSION_SECRET para o .env
// Uso: npm run criar-senha -- "minha senha forte"
const crypto = require("node:crypto");
const { hashSenha } = require("../lib/auth");

const senha = process.argv[2];
if (!senha || senha.length < 8) {
  console.error('Informe uma senha com pelo menos 8 caracteres: npm run criar-senha -- "sua senha"');
  process.exit(1);
}
console.log(`TERAPEUTA_SENHA_HASH=${hashSenha(senha)}`);
console.log(`SESSION_SECRET=${crypto.randomBytes(32).toString("hex")}`);
