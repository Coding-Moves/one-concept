const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const sha='a'.repeat(40), other='b'.repeat(40);
const baseline={...process.env,GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,VERIFIED_BACKEND_SHA:sha,REMOTE_MAIN_SHA:sha};
for(const [name,override,success] of [
 ['matching main deployment',{},true],
 ['preview branch',{GITHUB_REF:'refs/heads/develop'},false],
 ['tag dispatch',{GITHUB_REF:'refs/tags/v1.9.0'},false],
 ['missing attestation',{VERIFIED_BACKEND_SHA:''},false],
 ['short SHA',{VERIFIED_BACKEND_SHA:'aaaaaaa'},false],
 ['older backend',{VERIFIED_BACKEND_SHA:other},false],
 ['main advanced after dispatch',{REMOTE_MAIN_SHA:other},false],
 ['remote lookup failed',{REMOTE_MAIN_SHA:''},false],
 ['shell characters',{VERIFIED_BACKEND_SHA:'$(exit 0)'},false],
]) test(name,()=>{
 const result=spawnSync('bash',[path.join(__dirname,'check-release-revision.sh')],{env:{...baseline,...override},encoding:'utf8'});
 assert.equal(result.status,success?0:1,result.stderr+result.stdout);
});
