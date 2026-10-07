import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import { createHiggsfieldClient } from "@higgsfield/client/v2";
import { models, mediaUrl, validateInput, type Mode } from "./genjutsu.js";
import { authorized, publicAccount, updateAccount, login, AccountError } from "./account.js";
import { mp4Duration, videoCost } from "./video-cost.js";

const port = Number(process.env.PORT ?? 3210);
const origin = `http://127.0.0.1:${port}`;
const api = "https://api.higgsfield.ai";
type Job = { id: string; status: string; message: string; mode: Mode; url?: string; startedAt?: number; completedAt?: number; phase?: string; requestId?: string; statusUrl?: string; credits?: number; count?: number; activeIndex?: number; items?: Job[] };
let current: Job | null = null;
const dataDirectory = process.env.FRAMME_TEST_DATA_DIR ? pathToFileURL(process.env.FRAMME_TEST_DATA_DIR + "/") : new URL(".data/", import.meta.url);
const jobPath = new URL("job.json", dataDirectory);
try { current = JSON.parse(await readFile(jobPath, "utf8")); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Não foi possível carregar o pedido salvo.");
}
async function saveJob() {
  await mkdir(dataDirectory, { recursive: true });
  const temp = new URL("job.tmp", dataDirectory);
  await writeFile(temp, JSON.stringify(current));
  await rename(temp, jobPath);
}
const uploadedUrls = new Set<string>();
const uploadedDurations = new Map<string, number>();
type Quote = { id: string; mode: Mode; input: Record<string, unknown>; credits: number; unitCredits: number; count: number; expires: number; used: boolean };
const quotes = new Map<string, Quote>();
let submitting = false;
let uploading = false;
function credentials(): string | undefined {
  // Secrets stay in the server; never log env, headers, or SDK errors.
  const env: Record<string, string> = {};
  loadEnv({ path: fileURLToPath(new URL(".env.local", import.meta.url)), quiet: true, processEnv: env });
  const value = env.HF_CREDENTIALS ?? process.env.HF_CREDENTIALS;
  return value && value !== "your-key-id:your-key-secret" && /^[^\s:]+:[^\s:]+$/.test(value) ? value : undefined;
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}
async function bytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("limit");
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}
async function presets(key: string) {
  const response = await fetch(`${api}/models/${models.restyle}/presets`, {
    headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(30000), redirect: "error",
  });
  if (!response.ok) throw new Error("presets");
  const data = await response.json() as { items?: { id: string; name: string; preview_url: string }[] };
  if (!Array.isArray(data.items)) throw new Error("catalog");
  return data.items.filter(item => typeof item.id === "string" && typeof item.name === "string")
    .map(item => ({ id: item.id, name: item.name, preview_url: mediaUrl(item.preview_url) ? item.preview_url : "" }));
}
async function generate(job: Job, input: Record<string, unknown>, key: string) {
  try {
    const client = createHiggsfieldClient({ credentials: key, maxRetries: 0, headers: { "Idempotency-Key": job.id } });
    // Explicit polling exposes real lifecycle state and handles cancellation.
    let result = await client.subscribe(models[job.mode], { input, withPolling: false });
    job.requestId = result.request_id;
    job.statusUrl = result.status_url;
    await saveJob();
    result = await pollJob(job, result, key);
    const status: string = result.status;
    if (status !== "completed") {
      job.status = "failed";
      job.message = ["nsfw", "moderated"].includes(status) ? "Pedido bloqueado pela moderação." : ["canceled", "cancelled"].includes(status) ? "Pedido cancelado." : "A geração não foi concluída.";
      return;
    }
    const url = result.video?.url;
    if (!mediaUrl(url)) throw new Error("video");
    job.url = url;
    job.status = "completed";
    job.message = "Seu vídeo está pronto.";
    job.completedAt = Date.now();
  } catch {
    job.status = "unverified";
    job.message = "Não foi possível confirmar a geração. Confira o pedido no console Higgsfield antes de tentar novamente: ele pode ter sido cobrado.";
  } finally {
    await saveJob().catch(() => {});
  }
}
async function generateBatch(batch: Job, input: Record<string, unknown>, key: string) {
  for (let index = 0; index < batch.items!.length; index++) {
    batch.activeIndex = index;
    const item = batch.items![index];
    item.status = "running";
    item.startedAt = Date.now();
    batch.message = `Gerando vídeo ${index + 1} de ${batch.count}.`;
    await generate(item, input, key);
    // Stop new submissions when the last request's outcome is uncertain.
    if (item.status === "unverified") {
      for (const remaining of batch.items!.slice(index + 1)) {
        remaining.status = "not_submitted";
        remaining.message = "Não enviado: confira o pedido anterior antes de tentar novamente.";
      }
      break;
    }
  }
  const completed = batch.items!.filter(item => item.status === "completed");
  batch.url = completed[0]?.url;
  batch.status = completed.length === batch.count ? "completed" : completed.length ? "partial" : "failed";
  batch.message = completed.length === batch.count ? `${completed.length} ${completed.length === 1 ? "vídeo pronto" : "vídeos prontos"}.` : `${completed.length} de ${batch.count} vídeos concluídos. Confira o estado de cada pedido.`;
  batch.completedAt = Date.now();
  await saveJob().catch(() => {});
}
async function pollJob(job: Job, first: Awaited<ReturnType<ReturnType<typeof createHiggsfieldClient>["subscribe"]>>, key: string) {
  let result = first;
  const deadline = Date.now() + 30 * 60 * 1000;
  while (["queued", "in_progress"].includes(result.status)) {
    job.phase = result.status;
    job.message = result.status === "queued" ? "Seu vídeo está na fila de processamento." : "Seu vídeo está sendo gerado.";
    if (Date.now() > deadline || !job.statusUrl || new URL(job.statusUrl).origin !== api) throw new Error("poll");
    await new Promise(resolve => setTimeout(resolve, 3000));
    const response = await fetch(job.statusUrl, { headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(30000), redirect: "error" });
    if (response.status >= 500 || response.status === 429) continue;
    if (!response.ok) throw new Error("poll");
    result = await response.json();
  }
  return result;
}
// Never resubmit a saved running job after restart.
if (current?.status === "running") {
  current.status = "unverified";
  current.message = "Acompanhamento interrompido. Consulte o pedido na Higgsfield antes de repetir a geração.";
}

createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}`) return json(res, 403, { error: "Host inválido." });
    if (req.method === "GET" && ["/panel.css", "/panel.js", "/profile.js", "/profile.css"].includes(req.url ?? "")) {
      res.writeHead(200, { "Content-Type": req.url?.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      return res.end(await readFile(new URL(`.${req.url}`, import.meta.url)));
    }
    if (req.method === "GET" && ["/", "/profile"].includes(req.url ?? "")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; media-src https: blob:; img-src 'self' https: blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'", "Referrer-Policy": "no-referrer" });
      return res.end(await readFile(new URL(req.url === "/profile" ? "profile.html" : "panel.html", import.meta.url)));
    }
    if (req.method === "POST" && req.headers.origin !== origin) return json(res, 403, { error: "Origem inválida." });
    if (req.method === "POST" && req.url === "/api/login") {
      try { const data = JSON.parse((await bytes(req, 4096)).toString()); login(data.password, res); return json(res, 200, { ok: true }); }
      catch { return json(res, 401, { error: "Senha incorreta ou tentativas excedidas. Aguarde um minuto se necessário." }); }
    }
    if (!authorized(req)) return json(res, 401, { error: "Entre na sua conta para continuar." });
    if (req.method === "GET" && req.url === "/api/profile") return json(res, 200, publicAccount());
    if (req.method === "GET" && req.url === "/api/plans") {
      const plans = JSON.parse(await readFile(new URL("plans.json", import.meta.url), "utf8"));
      return json(res, 200, { plans });
    }
    if (req.method === "POST" && req.url === "/api/profile") {
      try { const data = JSON.parse((await bytes(req, 2900000)).toString()); return json(res, 200, await updateAccount(data, res)); }
      catch (error) { return json(res, 400, { error: error instanceof AccountError ? error.message : "Não foi possível salvar. Verifique os dados do perfil." }); }
    }
    if (req.method === "GET" && new URL(req.url ?? "/", origin).pathname === "/api/download") {
      const index = Number(new URL(req.url!, origin).searchParams.get("index") ?? 0);
      const selected = current?.items ? current.items[index] : index === 0 ? current : null;
      if (!Number.isInteger(index) || selected?.status !== "completed" || !selected.url) return json(res, 404, { error: "Nenhum vídeo concluído." });
      const response = await fetch(selected.url, { signal: AbortSignal.timeout(300000), redirect: "error" });
      if (!response.ok || !response.body) return json(res, 502, { error: "Vídeo indisponível para download." });
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Disposition": `attachment; filename="framme-video-${index + 1}.mp4"`, "Cache-Control": "no-store" });
      const stream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
      stream.on("error", () => res.destroy()); res.on("close", () => stream.destroy());
      stream.pipe(res); return;
    }
    if (req.method === "GET" && req.url === "/api/status") return json(res, 200, { configured: Boolean(credentials()), job: current });
    if (req.method === "GET" && req.url === "/api/presets") {
      const key = credentials();
      if (!key) return json(res, 503, { error: "Configure a chave local para carregar os estilos." });
      try { return json(res, 200, { items: await presets(key) }); }
      catch { return json(res, 502, { error: "Não foi possível carregar os estilos. Verifique a chave e o acesso ao Restyle." }); }
    }
    if (req.method === "POST" && req.headers.origin !== origin) return json(res, 403, { error: "Origem inválida." });
    if (req.method === "POST" && req.url === "/api/upload") {
      const type = req.headers["content-type"] ?? "";
      if (!["video/mp4", "image/jpeg", "image/png", "image/webp", "image/gif"].includes(type))
        return json(res, 415, { error: "Use MP4, JPG, PNG, WebP ou GIF." });
      const key = credentials();
      if (!key) return json(res, 503, { error: "Configure a chave local antes de enviar arquivos." });
      if (uploading) return json(res, 409, { error: "Aguarde o envio em andamento." });
      uploading = true;
      try {
        const limit = (type === "video/mp4" ? 200 : 64) * 1024 * 1024;
        if (Number(req.headers["content-length"] ?? 0) > limit) return json(res, 413, { error: "Arquivo excede o limite do painel." });
        let file;
        try { file = await bytes(req, limit); } catch { return json(res, 413, { error: "Arquivo excede o limite do painel." }); }
        if (!file.length) return json(res, 400, { error: "Arquivo vazio." });
        let duration: number | undefined;
        if (type === 'video/mp4') {
          try { duration = mp4Duration(file); } catch { return json(res, 400, { error: 'Não foi possível ler a duração do MP4. Exporte novamente o vídeo, com pelo menos 4 segundos.' }); }
        }
        const response = await fetch(`${api}/files/generate-upload-url`, {
          method: "POST", headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content_type: type }), signal: AbortSignal.timeout(30000), redirect: "error",
        });
        if (!response.ok) throw new Error("upload-url");
        const target = await response.json() as { upload_url: string; public_url: string; upload_headers: Record<string, string> };
        if (!mediaUrl(target.public_url) || new URL(target.upload_url).protocol !== "https:") throw new Error("upload-target");
        // Storage receives only the returned upload headers, never API credentials.
        const stored = await fetch(target.upload_url, { method: "PUT", headers: target.upload_headers,
          body: new Uint8Array(file), signal: AbortSignal.timeout(300000), redirect: "error" });
        if (!stored.ok) throw new Error("upload");
        uploadedUrls.add(target.public_url);
        if (duration !== undefined) uploadedDurations.set(target.public_url, duration);
        return json(res, 200, { url: target.public_url });
      } catch { return json(res, 502, { error: "Falha ao enviar o arquivo ao Higgsfield. Verifique sua chave, acesso e conexão." }); }
      finally { uploading = false; }
    }
    if (req.method === "POST" && req.url === "/api/estimate") {
      try {
        const data = JSON.parse((await bytes(req, 64000)).toString());
        const count = data.count ?? 1;
        if (!Number.isInteger(count) || count < 1 || count > 4) return json(res, 400, { error: "Selecione de 1 a 4 vídeos." });
        const validated = validateInput(data);
        const allUrls = [validated.input.video_url, ...(validated.input.image_urls as string[])];
        if (!allUrls.every(url => uploadedUrls.has(url as string))) return json(res, 400, { error: "Envie o vídeo e as imagens pelo painel antes de calcular." });
        const key = credentials();
        if (!key) return json(res, 503, { error: "Credencial não configurada." });
        const duration = uploadedDurations.get(validated.input.video_url as string);
        if (!duration) return json(res, 400, { error: 'Envie novamente o vídeo para ler sua duração.' });
        const cost = videoCost(duration, validated.input.resolution, count);
        const now = Date.now();
        for (const [id, quote] of quotes) if (quote.expires < now) quotes.delete(id);
        const unitCredits = cost.unitCredits;
        const quote: Quote = { id: randomUUID(), mode: validated.mode, input: validated.input, credits: unitCredits * count, unitCredits, count, expires: now + 5 * 60 * 1000, used: false };
        quotes.set(quote.id, quote);
        return json(res, 200, { id: quote.id, credits: quote.credits, unitCredits, count, seconds: cost.seconds, expires: quote.expires });
      } catch { return json(res, 400, { error: "Não foi possível calcular. Verifique os arquivos e as opções e tente novamente." }); }
    }
    if (req.method === "POST" && req.url === "/api/generate") {
      if (req.headers["content-type"] !== "application/json") return json(res, 415, { error: "Pedido deve ser JSON." });
      if (current?.status === "running" || submitting) return json(res, 409, { error: "Já existe uma geração em andamento." });
      submitting = true;
      try {
        let data;
        try { data = JSON.parse((await bytes(req, 64000)).toString("utf8")); }
        catch { return json(res, 400, { error: "Pedido inválido ou muito grande." }); }
        const quote = quotes.get(data.quoteId);
        if (!quote || quote.used || quote.expires < Date.now()) return json(res, 409, { error: "A cotação expirou ou já foi usada. Recalcule antes de gerar." });
        const validated = { mode: quote.mode, input: quote.input };
        const key = credentials();
        if (!key) return json(res, 503, { error: "Configure uma nova chave no .env.local do servidor." });
        if (validated.mode === "restyle") {
          try {
            const catalog = await presets(key);
            if (!catalog.some(preset => preset.id === validated.input.preset_id)) return json(res, 400, { error: "Estilo indisponível. Atualize o catálogo e escolha outro." });
          } catch { return json(res, 502, { error: "Não foi possível validar o estilo. Nenhuma geração foi enviada." }); }
        }
        quote.used = true;
        current = { id: randomUUID(), mode: validated.mode, status: "running", phase: "submitting", startedAt: Date.now(), credits: quote.credits, count: quote.count, activeIndex: 0, message: "Enviando seus pedidos de geração.", items: Array.from({ length: quote.count }, () => ({ id: randomUUID(), mode: validated.mode, status: "pending", phase: "submitting", credits: quote.unitCredits, message: "Aguardando envio." })) };
        await saveJob();
        void generateBatch(current, validated.input, key);
        return json(res, 202, current);
      } finally { submitting = false; }
    }
    json(res, 404, { error: "Não encontrado." });
  } catch { json(res, 500, { error: "Erro no servidor local." }); }
}).listen(port, "127.0.0.1", () => console.log(`Painel Genjutsu: ${origin}`));
