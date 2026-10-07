// Genjutsu list rates verified 2026-10-07 on the official model playgrounds.
export function videoCost(duration: number, resolution: unknown, count: number) {
  if (!Number.isFinite(duration) || duration < 4) throw Error('O vídeo precisa ter pelo menos 4 segundos.');
  if (!Number.isInteger(count) || count < 1 || count > 4) throw Error('Quantidade inválida.');
  const rate = resolution === '480p' ? 318 : resolution === '720p' ? 681 : 0;
  if (!rate) throw Error('Escolha 480p ou 720p.');
  const seconds = Math.ceil(Math.min(duration, 30));
  const unitCredits = Math.ceil(seconds * rate / 10);
  return { seconds, unitCredits, credits: unitCredits * count };
}
// Read the movie duration from MP4 metadata, never from a client-provided price.
export function mp4Duration(buffer: Buffer): number {
  function scan(start: number, end: number, inMovie = false): number {
    for (let offset = start; offset + 8 <= end;) {
      let size = buffer.readUInt32BE(offset), header = 8;
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      if (size === 1) { if (offset + 16 > end) break; size = Number(buffer.readBigUInt64BE(offset + 8)); header = 16; }
      if (size === 0) size = end - offset;
      if (!Number.isSafeInteger(size) || size < header || offset + size > end) break;
      const pos = offset + header, limit = offset + size;
      if (type === 'moov' && !inMovie) { const duration = scan(pos, limit, true); if (duration) return duration; }
      if (type === 'mvhd' && inMovie) {
        const version = buffer[pos], v1 = version === 1;
        if ((version !== 0 && version !== 1) || pos + (v1 ? 32 : 20) > limit) break;
        const scale = buffer.readUInt32BE(pos + (v1 ? 20 : 12));
        const ticks = v1 ? Number(buffer.readBigUInt64BE(pos + 24)) : buffer.readUInt32BE(pos + 16);
        if (scale && ticks && Number.isSafeInteger(ticks)) return ticks / scale;
      }
      offset += size;
    }
    return 0;
  }
  const duration = scan(0, buffer.length);
  if (!Number.isFinite(duration) || duration < 4) throw Error('Não foi possível ler a duração do MP4. Exporte um MP4 com duração mínima de 4 segundos.');
  return duration;
}
