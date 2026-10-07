import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

const directory = process.env.FRAMME_TEST_DATA_DIR ? pathToFileURL(process.env.FRAMME_TEST_DATA_DIR + "/") : new URL(".data/", import.meta.url);
export class AccountError extends Error {}
const path = new URL("account.json", directory);
type Account = { name: string; avatar: string; salt?: string; hash?: string };
let account: Account = { name: "Minha conta", avatar: "" };
try { account = JSON.parse(await readFile(path, "utf8")); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Não foi possível carregar a conta local.");
}
const sessions = new Map<string, number>();
let changing = false;
export function authorized(req: IncomingMessage) {
  if (!account.hash) return true; // Initial setup is accessible only on the loopback-bound server.
  const token = req.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith("framme_session="))?.slice(15);
  return Boolean(token && (sessions.get(token) ?? 0) > Date.now());
}
export function publicAccount() {
  return { name: account.name, avatar: account.avatar, hasPassword: Boolean(account.hash), plan: null, credits: null };
}
function session(res: ServerResponse) {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  for (const [key, expiry] of sessions) if (expiry <= now) sessions.delete(key);
  sessions.set(token, now + 24 * 60 * 60 * 1000);
  res.setHeader("Set-Cookie", `framme_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
}
function passwordMatches(value: unknown) {
  if (typeof value !== "string" || value.length > 256 || !account.salt || !account.hash) return false;
  return timingSafeEqual(scryptSync(value, account.salt, 64), Buffer.from(account.hash, "hex"));
}
let failures = 0, lockedUntil = 0;
export function login(password: unknown, res: ServerResponse) {
  if (Date.now() < lockedUntil) throw new Error("Aguarde um minuto antes de tentar novamente.");
  if (!passwordMatches(password)) {
    if (++failures >= 5) { lockedUntil = Date.now() + 60000; failures = 0; }
    throw new Error("Senha incorreta.");
  }
  failures = 0; session(res);
}
export async function updateAccount(data: Record<string, unknown>, res: ServerResponse) {
  if (changing) throw new AccountError("Uma alteração já está sendo salva.");
  changing = true;
  try {
    const next = { ...account };
    if (typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 80) throw new AccountError("Use um nome de 1 a 80 caracteres.");
    next.name = data.name.trim();
    if (typeof data.avatar !== "string" || data.avatar.length > 2800000 || (data.avatar && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data.avatar))) throw new AccountError("Use uma foto JPG, PNG ou WebP de até 2 MiB.");
    next.avatar = data.avatar;
    let passwordChanged = false;
    if (data.newPassword) {
      if (account.hash && !passwordMatches(data.currentPassword)) throw new AccountError("A senha atual está incorreta.");
      if (typeof data.newPassword !== "string" || data.newPassword.length < 12 || data.newPassword.length > 256) throw new AccountError("A nova senha deve ter entre 12 e 256 caracteres.");
      next.salt = randomBytes(32).toString("hex");
      next.hash = scryptSync(data.newPassword, next.salt, 64).toString("hex");
      passwordChanged = true;
    }
    await mkdir(directory, { recursive: true });
    const temporary = new URL("account.tmp", directory);
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await rename(temporary, path);
    account = next;
    if (passwordChanged) { sessions.clear(); session(res); }
    return publicAccount();
  } finally { changing = false; }
}
