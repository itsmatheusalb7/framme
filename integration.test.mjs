// All provider calls are mocked. No billable requests and no user account changes.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';
import { createRequire } from 'node:module';
process.env.PORT='3211';
process.env.FRAMME_TEST_DATA_DIR=await mkdtemp(join(tmpdir(),'framme-server-test-'));
const localFetch=globalThis.fetch;
let localCookie='';
let submissions=0, sentInput, simulateFailure=false;
const submissionKeys=[];
axios.defaults.adapter=async config=>{
  submissions++;sentInput=JSON.parse(config.data);
  submissionKeys.push(config.headers['Idempotency-Key']);
  return {status:200,statusText:'OK',headers:{},config,data:simulateFailure?{status:'failed',request_id:'test-failed'}:{status:'completed',request_id:'test-request',video:{url:`https://media.example.test/result-${submissions}.mp4`}}};
};
createRequire(import.meta.url)('axios').defaults.adapter=axios.defaults.adapter;
globalThis.fetch=async (url,options={})=>{
  const value=String(url);
  if(value.startsWith('http://127.0.0.1:3211'))return localFetch(url,{...options,headers:{...options.headers,...(localCookie?{Cookie:localCookie}:{})}});
  if(value==='https://api.higgsfield.ai/files/generate-upload-url')return Response.json({public_url:'https://media.example.test/upload.mp4',upload_url:'https://storage.example.test/upload',upload_headers:{'Content-Type':'video/mp4'}});
  if(value==='https://storage.example.test/upload'){assert.equal(Boolean(options.headers?.Authorization),false);return new Response('');}
  if(value.startsWith('https://api.higgsfield.ai/estimate/'))return Response.json({usd:'1.275'});
  throw new Error('Unexpected upstream request blocked by test');
};
await import('./server.ts');
const mp4=Buffer.alloc(36);mp4.writeUInt32BE(36,0);mp4.write('moov',4);mp4.writeUInt32BE(28,8);mp4.write('mvhd',12);mp4.writeUInt32BE(1000,28);mp4.writeUInt32BE(14200,32);
const base='http://127.0.0.1:3211', headers={Origin:base,'Content-Type':'application/json'};
const post=(path,body)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
async function finished(){for(let i=0;i<100;i++){const d=await (await fetch(base+'/api/status')).json();if(d.job.status!=='running')return d;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out');}
try{
  assert.equal((await fetch(base+'/api/history')).status,401);
  const setup=await post('/api/setup',{name:'Test account',password:'local-test-password-123'});
  assert.equal(setup.status,200);localCookie=setup.headers.get('set-cookie').split(';')[0];
  assert.equal((await post('/api/setup',{name:'Other',password:'local-test-password-456'})).status,409);
  const upload=await fetch(base+'/api/upload',{method:'POST',headers:{Origin:base,'Content-Type':'video/mp4'},body:mp4});
  assert.equal(upload.status,200);const {url}=await upload.json();
  const input={mode:'motion-transfer',video_url:url,image_urls:[url],prompt:'test',resolution:'480p',count:4};
  for(const count of [0,5,1.5,'4'])assert.equal((await post('/api/estimate',{...input,count})).status,400);
  const estimate=await post('/api/estimate',input);
  assert.equal(estimate.status,200);const quote=await estimate.json();assert.equal(quote.credits,1908);assert.equal(quote.unitCredits,477);
  const response=await post('/api/generate',{quoteId:quote.id,prompt:'tampered',resolution:'1080p'});assert.equal(response.status,202);
  const duplicate=await post('/api/generate',{quoteId:quote.id});assert.equal(duplicate.status,409);
  const status=await finished();
  assert.equal(submissions,4);assert.equal(new Set(submissionKeys).size,4);assert.equal(sentInput.resolution,'480p');assert.equal(sentInput.prompt,'test');assert.equal('count' in sentInput,false);
  assert.equal(status.job.credits,1908);assert.equal(status.job.items.length,4);assert.equal(status.job.status,'completed');
  assert.equal((await post('/api/generate',{quoteId:quote.id})).status,409);
  simulateFailure=true;
  const failedQuote=await (await post('/api/estimate',{...input,count:2})).json();
  assert.equal((await post('/api/generate',{quoteId:failedQuote.id})).status,202);
  const failed=await finished();assert.equal(failed.job.status,'failed');assert.equal(failed.job.items.every(i=>i.status==='failed'),true);
  const history=await (await fetch(base+'/api/history')).json();
  assert.equal(history.items.length,4);assert.equal(new Set(history.items.map(item=>item.id)).size,4);
  assert.equal(history.items.every(item=>item.status==='completed'),true);
  assert.equal((await fetch(base+'/api/download?history=missing')).status,404);
  assert.equal((await fetch(base+'/.data/account.json')).status,404);
  assert.equal((await fetch(base+'/.env.local')).status,404);
  console.log('PASS: 1–4 limits, total quote, four unique submissions, immutable input, duplicate prevention, failed results. Provider mocked.');
  process.exit(0);
}catch(error){console.error(error instanceof assert.AssertionError ? error.message : 'Integration test failed.');process.exit(1);}
