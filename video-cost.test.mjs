import test from 'node:test';
import assert from 'node:assert/strict';
import { mp4Duration, videoCost } from './video-cost.ts';
test('rounds seconds up, caps 30 seconds, rounds credits per output',()=>{
  assert.deepEqual(videoCost(14.2,'720p',1),{seconds:15,unitCredits:1022,credits:1022});
  assert.equal(videoCost(14.2,'480p',4).credits,1908);
  assert.equal(videoCost(90,'720p',1).credits,2043);
  for(const duration of [NaN,Infinity,0,3.9])assert.throws(()=>videoCost(duration,'720p',1));
  assert.throws(()=>videoCost(5,'1080p',1));
});
test('reads MP4 movie duration; rejects missing and truncated metadata',()=>{
  const file=Buffer.alloc(36);file.writeUInt32BE(36,0);file.write('moov',4);file.writeUInt32BE(28,8);file.write('mvhd',12);file.writeUInt32BE(1000,28);file.writeUInt32BE(14200,32);
  assert.equal(mp4Duration(file),14.2);
  assert.throws(()=>mp4Duration(file.subarray(0,32)));
  assert.throws(()=>mp4Duration(Buffer.from('invalid')));
});
