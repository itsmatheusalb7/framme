import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.FRAMME_TEST_DATA_DIR = await mkdtemp(join(tmpdir(), 'framme-account-test-'));
const { authorized, publicAccount, updateAccount, login } = await import('./account.ts');
test('profile persists without allowing client-controlled plans or balances', async () => {
  await updateAccount({name:'Conta de teste',avatar:'',credits:999999,plan:'Scale'}, {setHeader(){}});
  assert.equal(publicAccount().name,'Conta de teste');
  assert.equal(publicAccount().credits,null);
  assert.equal(publicAccount().plan,null);
});
test('password is hashed, checked, and rotated with previous sessions revoked', async () => {
  let cookie;
  const response={setHeader(name,value){cookie=value.split(';')[0];}};
  await updateAccount({name:'Conta de teste',avatar:'',newPassword:'synthetic-password-123'},response);
  const firstCookie=cookie;
  assert.equal(authorized({headers:{}}),false);
  assert.equal(authorized({headers:{cookie}}),true);
  const stored=await readFile(join(process.env.FRAMME_TEST_DATA_DIR,'account.json'),'utf8');
  assert.equal(stored.includes('synthetic-password-123'),false);
  assert.equal('hash' in publicAccount(),false);
  assert.throws(()=>login('incorrect-password',response));
  await assert.rejects(updateAccount({name:'Conta de teste',avatar:'',currentPassword:'wrong',newPassword:'replacement-password-123'},response));
  await updateAccount({name:'Conta de teste',avatar:'',currentPassword:'synthetic-password-123',newPassword:'replacement-password-123'},response);
  assert.equal(authorized({headers:{cookie:firstCookie}}),false);
  assert.equal(authorized({headers:{cookie}}),true);
});
