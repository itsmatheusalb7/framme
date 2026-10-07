export const models = {
  "motion-transfer": "higgsfield/genjutsu/motion-transfer/v1.0",
  "object-swap": "higgsfield/genjutsu/object-swap/v1.0",
  restyle: "higgsfield/genjutsu/restyle/v1.0",
} as const;
export type Mode = keyof typeof models;
export function mediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2083) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}
export function validateInput(value: unknown): { mode: Mode; input: Record<string, unknown> } {
  if (!value || typeof value !== "object") throw new Error("Pedido inválido.");
  const data = value as Record<string, unknown>;
  if (typeof data.mode !== "string" || !Object.hasOwn(models, data.mode)) throw new Error("Escolha um modo Genjutsu.");
  const mode = data.mode as Mode;
  if (!mediaUrl(data.video_url)) throw new Error("Informe um link HTTPS direto para o vídeo.");
  const refs = data.image_urls;
  const min = mode === "restyle" ? 0 : 1;
  const max = mode === "restyle" ? 5 : 8;
  if (!Array.isArray(refs) || refs.length < min || refs.length > max || !refs.every(mediaUrl))
    throw new Error(`Este modo aceita de ${min} a ${max} imagens, com links HTTPS diretos.`);
  const prompt = data.prompt ?? "";
  if (typeof prompt !== "string" || prompt.length > 10000) throw new Error("O prompt deve ter até 10.000 caracteres.");
  const resolution = data.resolution ?? "720p";
  if (!["480p", "720p", "1080p"].includes(resolution as string)) throw new Error("Resolução inválida.");
  const input: Record<string, unknown> = { video_url: data.video_url, image_urls: refs, prompt, resolution };
  if (mode === "restyle") {
    if (typeof data.preset_id !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.preset_id))
      throw new Error("Selecione um estilo disponível no catálogo.");
    input.preset_id = data.preset_id;
  }
  return { mode, input };
}
