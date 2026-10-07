import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInput, models } from './genjutsu.ts';
const base = { mode: 'motion-transfer', video_url: 'https://example.com/video.mp4', image_urls: ['https://example.com/person.jpg'] };
test('motion transfer sends only its supported model inputs', () => {
  const result = validateInput({ ...base, duration: 5, aspect_ratio: '16:9', generate_audio: true });
  assert.equal(models[result.mode], 'higgsfield/genjutsu/motion-transfer/v1.0');
  assert.deepEqual(Object.keys(result.input).sort(), ['image_urls','prompt','resolution','video_url']);
  assert.equal(result.input.prompt, '');
});
test('motion and swap require 1–8 references', () => {
  for (const mode of ['motion-transfer','object-swap']) {
    assert.throws(() => validateInput({ ...base, mode, image_urls: [] }));
    assert.throws(() => validateInput({ ...base, mode, image_urls: Array(9).fill(base.image_urls[0]) }));
    assert.doesNotThrow(() => validateInput({ ...base, mode, image_urls: Array(8).fill(base.image_urls[0]) }));
  }
});
test('restyle requires a preset and accepts zero to five references', () => {
  const data = { ...base, mode: 'restyle', image_urls: [], preset_id: 'c2143317-f28d-4c3c-a0b8-39bd547e08a7' };
  assert.equal(validateInput(data).input.preset_id, data.preset_id);
  assert.throws(() => validateInput({ ...data, preset_id: 'anime' }));
  assert.throws(() => validateInput({ ...data, image_urls: Array(6).fill(base.image_urls[0]) }));
});
test('invalid media, models, resolutions and long prompts fail before billing', () => {
  for (const video_url of ['file:///C:/video.mp4','http://localhost/video.mp4','https://user:password@example.com/video.mp4'])
    assert.throws(() => validateInput({ ...base, video_url }));
  assert.throws(() => validateInput({ ...base, mode: 'toString' }));
  assert.throws(() => validateInput({ ...base, resolution: '4k' }));
  assert.throws(() => validateInput({ ...base, prompt: 'x'.repeat(10001) }));
});
