import {expect} from '@playwright/test';
import {test,create,daemon,tmp,ready,open,status,token,choose} from './helpers';
import fs from 'node:fs';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process';
import net from 'node:net';
const program=path.join(tmp,'bin/codex');let original:Buffer;
const freePort=()=>new Promise<number>((resolve,reject)=>{const listener=net.createServer();listener.once('error',reject);listener.listen(0,'127.0.0.1',()=>{const address=listener.address();if(!address||typeof address==='string'){listener.close();reject(Error('No local test port'));return;}listener.close(()=>resolve(address.port));});});
const state=async(request:any,id:string)=>(await(await request.get(`${daemon}/api/sessions/${id}/provider-state`)).json());
const logs=(id:string)=>fs.readFileSync(path.join(tmp,'provider-home/rpc-log',id+'.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
test.beforeAll(async({request})=>{original=fs.readFileSync(program);fs.copyFileSync(path.join(tmp,'../codex-app-server-fixture.py'),program);fs.writeFileSync(program,'#!/usr/bin/env python3\n'+fs.readFileSync(program,'utf8'),{mode:0o755});fs.chmodSync(program,0o755);const meta=await(await request.get(daemon+'/api/meta')).json();expect(meta.agents.find((agent:any)=>agent.id==='codex').path).toBe(program);});
test.afterAll(()=>{fs.writeFileSync(program,original,{mode:0o755});fs.chmodSync(program,0o755);});
test('persistent stdio conversation, typed images, context and completion-before-ACK/EOF',async({request,page})=>{
 const s=await create(request,'Persistent Codex');await expect.poll(()=>status(request,s.id)).toBe('completed');expect((await state(request,s.id)).context).toEqual({tokens:32000,window:128000});
 const upload=await request.post(`${daemon}/api/attachments?name=fixture.png`,{headers:{'Content-Type':'image/png'},data:fs.readFileSync(path.join(tmp,'../fixtures/preview-grid.png'))});expect(upload.status()).toBe(201);const image=await upload.json();
 expect((await request.post(`${daemon}/api/sessions/${s.id}/messages`,{data:{text:`Image follow-up\n\nAttached images (local files — open them to view):\n- ${image.path}`}})).status()).toBe(202);await expect.poll(()=>status(request,s.id)).toBe('completed');const methods=logs(s.id).filter(row=>row.method);expect(methods.filter(row=>row.method==='initialize')).toHaveLength(1);expect(methods.filter(row=>row.method==='thread/start')).toHaveLength(1);expect(methods.filter(row=>row.method==='turn/start')).toHaveLength(2);expect(new Set(methods.map(row=>row.pid)).size).toBe(1);expect(logs(s.id).some(row=>JSON.stringify(row.inputTypes)==='["text","localImage"]')).toBe(true);
 await ready(page);await open(page,'Persistent Codex');await expect(page.getByRole('button',{name:'Context usage 25%'})).toBeVisible();await page.getByRole('button',{name:'Context usage 25%'}).click();await expect(page.getByRole('dialog',{name:'Context usage details'})).toContainText('32,000 of 128,000');expect(await page.getByRole('dialog',{name:'Context usage details'}).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})).toBe(true);await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Context usage details'})).toBeHidden();
 const tail=await create(request,'Final tail',{prompt:'eof-final'});await expect.poll(()=>status(request,tail.id)).toBe('completed');expect(fs.readFileSync(path.join(tmp,'data/transcripts',tail.id+'.log'),'utf8')).toContain('Final tail survives EOF');
});

test('Codex generated image is imported once, path-free, durable and owned by its chat',async({request,page})=>{
 const session=await create(request,'Generated image in chat',{prompt:'generated-image snake duplicate large-inline'});
 await expect.poll(()=>status(request,session.id)).toBe('completed');
 const transcript=fs.readFileSync(path.join(tmp,'data/transcripts',session.id+'.log'),'utf8');
 const images=transcript.trim().split('\n').map(line=>JSON.parse(line)).filter(event=>event.type==='openade.generated_image');
 expect(images).toHaveLength(2);expect(images[0]).toMatchObject({name:'Generated image',mime:'image/png'});expect(images[0].id).toMatch(/^[0-9a-f]{64}$/);expect(images[1].id).toBe(images[0].id);
 for(const secret of ['INLINE_IMAGE_SENTINEL','PRIVATE_REVISED_PROMPT_SENTINEL','generated_images','saved_path','savedPath'])expect(transcript).not.toContain(secret);
 const media=`${daemon}/api/sessions/${session.id}/generated-images/${images[0].id}/media`;
 const response=await request.get(media);expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('image/png');expect((await response.body()).subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
 expect((await page.request.get(media,{headers:{Authorization:''}})).status()).toBe(401);
 const other=await create(request,'Different image owner');expect((await request.get(`${daemon}/api/sessions/${other.id}/generated-images/${images[0].id}/media`)).status()).toBe(404);
 await ready(page);await open(page,'Generated image in chat');const card=page.getByLabel('Generated images').getByRole('button',{name:'View Generated image'});await expect(card).toHaveCount(1);await expect.poll(()=>card.locator('img').evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBe(1200);
 await card.click();const dialog=page.getByRole('dialog',{name:'Generated image'});await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(card).toBeFocused();
 await page.reload();await expect(page.getByLabel('Generated images').getByRole('button',{name:'View Generated image'})).toHaveCount(1);
 expect((await request.delete(`${daemon}/api/sessions/${session.id}`)).status()).toBe(204);expect((await request.get(media)).status()).toBe(404);expect(fs.existsSync(path.join(tmp,'data/generated-images',session.id))).toBe(false);
});

test('generated images reject outside paths, symlinks, invalid bytes and oversized files without leaking the source',async({request,page})=>{
 for(const kind of ['external','symlink','invalid','oversized','missing','failure']){
  const session=await create(request,`Generated image rejection ${kind}`,{prompt:`generated-image-${kind}`});await expect.poll(()=>status(request,session.id)).toBe('completed');
  const transcript=fs.readFileSync(path.join(tmp,'data/transcripts',session.id+'.log'),'utf8');expect(transcript).toContain('Generated image unavailable');expect(transcript).not.toContain('outside-generated.png');expect(transcript).not.toContain('generated_images');expect(transcript).not.toContain('private provider detail');expect(transcript).not.toContain('openade.generated_image');
  const folder=path.join(tmp,'data/generated-images',session.id);if(fs.existsSync(folder))expect(fs.readdirSync(folder)).toEqual([]);
 }
 const replay=await create(request,'Generated image replay spoof',{prompt:'generated-image replay-spoof'});await expect.poll(()=>status(request,replay.id)).toBe('completed');const replayText=fs.readFileSync(path.join(tmp,'data/transcripts',replay.id+'.log'),'utf8');expect((replayText.match(/"type":"openade.generated_image"/g)||[])).toHaveLength(1);expect(replayText).toContain('Generated image unavailable');expect(replayText).not.toContain('outside-generated.png');
 await ready(page);await open(page,'Generated image rejection failure');await expect(page.getByLabel('Generated images')).toHaveCount(0);await expect(page.locator('.activity-group')).toContainText('Generated image unavailable');
});

test('large non-image provider notifications retain the original transport bound',async({request})=>{
 const session=await create(request,'Bounded non-image frame',{prompt:'huge-nonimage'});await expect.poll(()=>status(request,session.id)).toBe('failed');const transcript=fs.readFileSync(path.join(tmp,'data/transcripts',session.id+'.log'),'utf8');expect(transcript).not.toContain('UNRETAINED_NONIMAGE_SENTINEL');
});
test('side chat fork starts an independent app-server thread with copied context',async({request})=>{
 const source=await create(request,'RPC fork source');await expect.poll(()=>status(request,source.id)).toBe('completed');
 const response=await request.post(`${daemon}/api/sessions/${source.id}/fork`,{data:{mode:'fork'}});expect(response.status(),await response.text()).toBe(201);const child=await response.json();
 expect(child.parent_session_id).toBe(source.id);expect(child.provider_session_id).toBe('');
 const prefix=fs.readFileSync(path.join(tmp,'data/transcripts',child.id+'.log'),'utf8');expect(prefix).toContain('RPC fork source');expect(prefix).not.toContain('thread_id');
 expect((await request.post(`${daemon}/api/sessions/${child.id}/messages`,{data:{text:'Explore a new path'}})).status()).toBe(202);await expect.poll(()=>status(request,child.id)).toBe('completed');
 const childLog=logs(child.id);expect(childLog.filter(row=>row.method==='thread/start')).toHaveLength(1);expect(childLog.filter(row=>row.method==='thread/resume')).toHaveLength(0);expect(childLog.filter(row=>row.method==='turn/start')).toHaveLength(1);
 const transcript=fs.readFileSync(path.join(tmp,'data/transcripts',child.id+'.log'),'utf8');expect(transcript).toContain('New user message:\\nExplore a new path');
 expect((await(await request.get(`${daemon}/api/sessions/${source.id}`)).json()).provider_session_id).not.toBe((await(await request.get(`${daemon}/api/sessions/${child.id}`)).json()).provider_session_id);
 expect((await request.post(`${daemon}/api/sessions/${child.id}/messages`,{data:{text:'Second child turn'}})).status()).toBe(202);await expect.poll(()=>status(request,child.id)).toBe('completed');
 const later=fs.readFileSync(path.join(tmp,'data/transcripts',child.id+'.log'),'utf8').split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).filter(event=>event.type==='openade.agent_message').at(-1).text;
 expect(later).toBe('Second child turn');
 const retryResponse=await request.post(`${daemon}/api/sessions/${source.id}/fork`,{data:{mode:'fork'}});expect(retryResponse.status()).toBe(201);const retry=await retryResponse.json();
 expect((await request.post(`${daemon}/api/sessions/${retry.id}/messages`,{data:{text:'bad-ack first attempt'}})).status()).toBe(409);await expect.poll(()=>status(request,retry.id)).toBe('failed');
 expect((await request.post(`${daemon}/api/sessions/${retry.id}/messages`,{data:{text:'Retry context'}})).status()).toBe(202);await expect.poll(()=>status(request,retry.id)).toBe('completed');
 const recovered=fs.readFileSync(path.join(tmp,'data/transcripts',retry.id+'.log'),'utf8');expect(recovered).toContain('New user message:\\nRetry context');
});
test('paged custom questions, numeric selection, private answer and draft survive settings',async({request,page})=>{
 const s=await create(request,'Question parity',{prompt:'wait initial'});await ready(page);await open(page,'Question parity');await page.getByLabel('Session message',{exact:true}).fill('Keep my ordinary draft');await request.post(`${daemon}/api/sessions/${s.id}/stop`);await expect.poll(()=>status(request,s.id)).toBe('stopped');await request.post(`${daemon}/api/sessions/${s.id}/messages`,{data:{text:'question now'}});
 const dialog=page.getByRole('dialog',{name:'Your input is needed'});await expect(dialog).toBeVisible();await expect(dialog).toContainText('1/2');expect(logs(s.id).filter(row=>row.reply)).toHaveLength(0);await page.keyboard.press('2');await expect(dialog).toContainText('2/2');await expect(page.getByLabel('Private answer')).toHaveAttribute('type','password');await page.getByLabel('Private answer').fill('private-fixture-value');await dialog.getByRole('button',{name:'Submit',exact:true}).click();await expect(dialog).toBeHidden();await expect.poll(()=>status(request,s.id)).toBe('completed');await expect(page.getByLabel('Session message',{exact:true})).toHaveValue('Keep my ordinary draft');await expect(page.getByLabel('Session message',{exact:true})).toBeFocused();
 await page.getByLabel('Open settings').click();await page.getByRole('button',{name:'Back',exact:true}).click();await expect(page.getByLabel('Session message',{exact:true})).toHaveValue('Keep my ordinary draft');
 expect(logs(s.id).filter(row=>row.answerCount===2)).toHaveLength(1);expect(fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8')).not.toContain('private-fixture-value');expect(fs.readFileSync(path.join(tmp,'data/openade.sqlite3')).includes(Buffer.from('private-fixture-value'))).toBe(false);
});
test('approvals require a decision, stale/duplicate replies fail and resolved questions disappear',async({request,page})=>{
 const s=await create(request,'Approval parity',{prompt:'approval'});await expect.poll(()=>status(request,s.id)).toBe('waiting');const q=(await state(request,s.id)).requests[0];expect((await request.post(`${daemon}/api/sessions/${s.id}/provider-requests/${q.id}`,{data:{generation:q.generation,decision:'acceptForSession'}})).status()).toBe(409);expect(logs(s.id).filter(row=>row.reply)).toHaveLength(0);await ready(page);await open(page,'Approval parity');const dialog=page.getByRole('dialog',{name:'Allow this command?'});await expect(dialog).toContainText('printf approved');await dialog.getByRole('button',{name:'Deny',exact:true}).click();await expect.poll(()=>status(request,s.id)).toBe('completed');expect(logs(s.id).filter(row=>row.decision==='decline')).toHaveLength(1);expect((await request.post(`${daemon}/api/sessions/${s.id}/provider-requests/${q.id}`,{data:{generation:q.generation,decision:'accept'}})).status()).toBe(409);
 const obsolete=await create(request,'Obsolete question',{prompt:'obsolete'});await expect.poll(async()=>(await state(request,obsolete.id)).requests.length).toBe(1);const old=(await state(request,obsolete.id)).requests[0];await expect.poll(async()=>(await state(request,obsolete.id)).requests.length).toBe(0);expect((await request.post(`${daemon}/api/sessions/${obsolete.id}/provider-requests/${old.id}`,{data:{generation:old.generation,answers:{approach:['Simple'],private:['x']}}})).status()).toBe(409);await request.post(`${daemon}/api/sessions/${obsolete.id}/stop`);
});
test('child completion cannot settle parent, real steering binds one turn and interruption reuses client',async({request})=>{
 const s=await create(request,'Steering ownership',{prompt:'wait child'});await expect.poll(async()=>logs(s.id).some(row=>row.method==='turn/start')).toBe(true);await new Promise(resolve=>setTimeout(resolve,300));expect(await status(request,s.id)).toBe('running');const generation=(await(await request.get(`${daemon}/api/sessions/${s.id}`)).json()).generation;
 const queued=await(await request.post(`${daemon}/api/sessions/${s.id}/message-queue`,{data:{text:'send into active turn'}})).json();expect((await request.post(`${daemon}/api/sessions/${s.id}/message-queue/${queued.id}/steer`)).status()).toBe(204);await expect.poll(()=>status(request,s.id)).toBe('completed');expect((await(await request.get(`${daemon}/api/sessions/${s.id}/message-queue`)).json()).messages).toEqual([]);expect((await(await request.get(`${daemon}/api/sessions/${s.id}`)).json()).generation).toBe(generation);expect(logs(s.id).filter(row=>row.method==='turn/steer')[0].expectedTurnId).toBe('turn-1');
 await request.post(`${daemon}/api/sessions/${s.id}/messages`,{data:{text:'wait next'}});await request.post(`${daemon}/api/sessions/${s.id}/stop`);await expect.poll(()=>status(request,s.id)).toBe('stopped');expect((await state(request,s.id)).connected).toBe(true);expect(logs(s.id).filter(row=>row.method==='initialize')).toHaveLength(1);expect(logs(s.id).filter(row=>row.method==='turn/interrupt')).toHaveLength(1);
});
test('known steering rejection stays queued, unknown delivery is quarantined and never retried',async({request})=>{
 const s=await create(request,'Steering failure',{prompt:'wait parent'});const a=await(await request.post(`${daemon}/api/sessions/${s.id}/message-queue`,{data:{text:'reject-steer'}})).json();expect((await request.post(`${daemon}/api/sessions/${s.id}/message-queue/${a.id}/steer`)).status()).toBe(409);expect((await(await request.get(`${daemon}/api/sessions/${s.id}/message-queue`)).json()).messages[0].status).toBe('queued');await request.delete(`${daemon}/api/sessions/${s.id}/message-queue/${a.id}`);
 const b=await(await request.post(`${daemon}/api/sessions/${s.id}/message-queue`,{data:{text:'uncertain-steer'}})).json();expect((await request.post(`${daemon}/api/sessions/${s.id}/message-queue/${b.id}/steer`)).status()).toBe(409);await expect.poll(()=>status(request,s.id)).toBe('failed');expect((await(await request.get(`${daemon}/api/sessions/${s.id}/message-queue`)).json()).messages[0].status).toBe('uncertain');expect(logs(s.id).filter(row=>row.method==='turn/start')).toHaveLength(1);expect((await request.delete(`${daemon}/api/sessions/${s.id}/message-queue/${b.id}`)).status()).toBe(204);
 const crash=await create(request,'RPC death',{prompt:'explode'});await expect.poll(()=>status(request,crash.id)).toBe('failed');const unknown=await create(request,'Unknown method',{prompt:'unknown'});await expect.poll(()=>status(request,unknown.id)).toBe('completed');expect(logs(unknown.id).some(row=>row.unknownError===-32601)).toBe(true);
});

test('accepted steering timestamps a settled partial reply before the next user message',async({request,page})=>{
 const s=await create(request,'Steered partial timestamp',{prompt:'partial-before-steer wait'});
 const transcript=path.join(tmp,'data/transcripts',s.id+'.log');
 await expect.poll(()=>fs.readFileSync(transcript,'utf8').includes('Partial before steering')).toBe(true);
 const queued=await(await request.post(`${daemon}/api/sessions/${s.id}/message-queue`,{data:{text:'continue partial'}})).json();
 expect((await request.post(`${daemon}/api/sessions/${s.id}/message-queue/${queued.id}/steer`)).status()).toBe(204);
 await expect.poll(()=>status(request,s.id)).toBe('completed');
 await ready(page);await open(page,'Steered partial timestamp');
 const replies=page.locator('.chat-assistant-turn');await expect(replies).toHaveCount(2);
 await expect(replies.first()).toContainText('Partial before steering');
 await expect(replies.first().locator('time')).toHaveAttribute('datetime',/\d{4}-\d{2}-\d{2}T/);
 await expect(replies.nth(1).locator('time')).toHaveAttribute('datetime',/\d{4}-\d{2}-\d{2}T/);
});

test('legacy transcript rows use exact durable turn times only when messages align',async({request,page})=>{
 const s=await create(request,'Legacy transcript times',{prompt:'legacy first'});await expect.poll(()=>status(request,s.id)).toBe('completed');
 expect((await request.post(`${daemon}/api/sessions/${s.id}/messages`,{data:{text:'legacy second'}})).status()).toBe(202);
 await expect.poll(()=>status(request,s.id)).toBe('completed');
 const records=(await(await request.get(`${daemon}/api/sessions/${s.id}/turns`)).json()).turns.sort((a:{generation:number},b:{generation:number})=>a.generation-b.generation);
 expect(records).toHaveLength(2);
 const transcript=path.join(tmp,'data/transcripts',s.id+'.log');
 const old=fs.readFileSync(transcript,'utf8').split('\n').map(line=>{if(!line.startsWith('{'))return line;const event=JSON.parse(line);delete event.created_at;return JSON.stringify(event);}).join('\n');
 fs.writeFileSync(transcript,old);
 await ready(page);await open(page,'Legacy transcript times');
 const users=page.locator('.chat-user-turn'),replies=page.locator('.chat-assistant-turn');await expect(users).toHaveCount(2);await expect(replies).toHaveCount(2);
 await expect(users.nth(1).locator('time')).toHaveAttribute('datetime',new Date(records[1].started_at).toISOString());
 await expect(replies.first().locator('time')).toHaveAttribute('datetime',new Date(records[0].finished_at).toISOString());
 await expect(replies.first().locator('time')).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M$/);
 await expect(replies.nth(1).locator('time')).toHaveAttribute('datetime',new Date(records[1].finished_at).toISOString());
 fs.appendFileSync(transcript,'{"type":"openade.user_message","text":"unmatched old marker"}\n');
 await page.reload();await expect(page.locator('.chat-user-turn')).toHaveCount(3);await expect(page.locator('.chat-assistant-turn time')).toHaveCount(0);
});

test('connection count stays bounded, active-limit admission fails safely and releases turns',async({request})=>{
 const active:string[]=[];try{
 for(let i=0;i<8;i++){const s=await create(request,'Active connection '+i,{prompt:'wait limit'});expect(s.status).toBe('running');active.push(s.id);}
 const refused=await create(request,'Ninth active',{prompt:'wait limit'});expect(refused.status).toBe('failed');expect(fs.existsSync(path.join(tmp,'provider-home/rpc-log',refused.id+'.jsonl'))).toBe(false);expect((await(await request.get(daemon+'/api/diagnostics')).json()).provider_connections).toBe(8);
 }finally{for(const id of active)await request.post(`${daemon}/api/sessions/${id}/stop`);}
 await expect.poll(async()=>(await(await request.get(daemon+'/api/diagnostics')).json()).live_sessions).toBe(0);
 const later=await create(request,'Idle eviction');await expect.poll(()=>status(request,later.id)).toBe('completed');expect((await(await request.get(daemon+'/api/diagnostics')).json()).provider_connections).toBeLessThanOrEqual(8);
});

test('restart invalidates unanswered questions, preserves context and quarantines ambiguous steering',async()=>{
 const port=await freePort(),base=`http://127.0.0.1:${port}`,data=path.join(tmp,'rpc-recovery');const headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'};
 const launch=()=>spawn(path.join(tmp,'openade-e2e'),['--daemon','--addr',`127.0.0.1:${port}`,'--data-dir',data],{env:{...process.env,PATH:path.join(tmp,'bin')+':'+process.env.PATH,OPENADE_PROVIDER_HOME:path.join(tmp,'provider-home'),OPENADE_AUTH_TOKEN:token},stdio:'ignore'});
 const wait=()=>expect.poll(async()=>{try{return(await fetch(base+'/api/health')).status;}catch{return 0;}}).toBe(200);
 const send=(url:string,method='GET',body?:unknown)=>fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const stop=async(child:ReturnType<typeof launch>,signal:'SIGTERM'|'SIGKILL'='SIGTERM')=>{if(child.exitCode!==null)return;const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill(signal);await ended;};
 let child=launch();try{await wait();const meta=await(await send('/api/meta')).json();expect(meta.agents.find((agent:any)=>agent.id==='codex').path).toBe(program);
 const s=await(await send('/api/sessions','POST',{title:'Restart question',prompt:'question pending',agent:'codex',repo_root:path.join(tmp,'fixture-repo'),base_branch:'main'})).json();await expect.poll(async()=>(await(await send(`/api/sessions/${s.id}/provider-state`)).json()).requests.length).toBe(1);const q=(await(await send(`/api/sessions/${s.id}/provider-state`)).json()).requests[0];
 await stop(child,'SIGKILL');child=launch();await wait();expect((await(await send(`/api/sessions/${s.id}`)).json()).status).toBe('interrupted');const turns=(await(await send(`/api/sessions/${s.id}/turns`)).json()).turns;expect(turns[0].status).toBe('interrupted');expect((await send(`/api/sessions/${s.id}/provider-requests/${q.id}`,'POST',{generation:q.generation,answers:{approach:['Simple'],private:['x']}})).status).toBe(409);
 await send(`/api/sessions/${s.id}/messages`,'POST',{text:'regular after restart'});await expect.poll(async()=>(await(await send(`/api/sessions/${s.id}`)).json()).status).toBe('completed');expect((await(await send(`/api/sessions/${s.id}/provider-state`)).json()).context.tokens).toBe(32000);await stop(child);child=launch();await wait();expect((await(await send(`/api/sessions/${s.id}/provider-state`)).json()).context).toEqual({tokens:32000,window:128000});
 }finally{await stop(child);}
});


test('multiple pending requests retain their order and invalid protocol acknowledgements fail closed',async({request})=>{
 const s=await create(request,'Ordered questions',{prompt:'multi-question'});await expect.poll(async()=>(await state(request,s.id)).requests.length).toBe(2);const pending=(await state(request,s.id)).requests;expect(pending.map((q:any)=>q.questions[0].id)).toEqual(['approach','second']);for(let i=0;i<10;i++)expect((await state(request,s.id)).requests.map((q:any)=>q.id)).toEqual(pending.map((q:any)=>q.id));
 const first=pending[0];expect((await request.post(`${daemon}/api/sessions/${s.id}/provider-requests/${first.id}`,{data:{generation:first.generation,answers:{approach:['Simple'],private:['fixture private']}}})).status()).toBe(204);await expect.poll(async()=>(await state(request,s.id)).requests.length).toBe(1);expect((await state(request,s.id)).requests[0].id).toBe(pending[1].id);await request.post(`${daemon}/api/sessions/${s.id}/provider-requests/${pending[1].id}`,{data:{generation:pending[1].generation,answers:{second:['Continue']}}});await expect.poll(()=>status(request,s.id)).toBe('completed');
 const bad=await create(request,'Malformed acknowledgement',{prompt:'bad-ack wait'});await expect.poll(()=>status(request,bad.id)).toBe('failed');expect(logs(bad.id).filter(row=>row.method==='turn/start')).toHaveLength(1);const invalid=await create(request,'Malformed wire frame',{prompt:'bad-json'});await expect.poll(()=>status(request,invalid.id)).toBe('failed');
});


test('steering completion before acknowledgement/EOF preserves transcript order; invalid identities stay uncertain',async({request,page})=>{
 for(const text of ['early-steer','early-steer eof']){const s=await create(request,'Ordered steering '+text,{prompt:'wait steering'});const q=await(await request.post(`${daemon}/api/sessions/${s.id}/message-queue`,{data:{text}})).json();expect((await request.post(`${daemon}/api/sessions/${s.id}/message-queue/${q.id}/steer`)).status()).toBe(204);await expect.poll(()=>status(request,s.id)).toBe('completed');const transcript=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');expect(transcript.indexOf('openade.user_message')).toBeLessThan(transcript.indexOf('Steered early response'));expect((await(await request.get(`${daemon}/api/sessions/${s.id}/message-queue`)).json()).messages).toEqual([]);await ready(page);await open(page,'Ordered steering '+text);const user=page.locator('.chat-user-turn').filter({hasText:text});await expect(user).toBeVisible();await expect(user.locator('xpath=following-sibling::article[1]')).toContainText('Steered early response');}
 for(const text of ['wrong-steer-ack','empty-steer-ack']){const s=await create(request,'Invalid steering '+text,{prompt:'wait steering'});const q=await(await request.post(`${daemon}/api/sessions/${s.id}/message-queue`,{data:{text}})).json();expect((await request.post(`${daemon}/api/sessions/${s.id}/message-queue/${q.id}/steer`)).status()).toBe(409);await expect.poll(()=>status(request,s.id)).toBe('failed');expect((await(await request.get(`${daemon}/api/sessions/${s.id}/message-queue`)).json()).messages[0].status).toBe('uncertain');expect(logs(s.id).filter(row=>row.method==='turn/start')).toHaveLength(1);await request.delete(`${daemon}/api/sessions/${s.id}/message-queue/${q.id}`);}
});


test('atomic queue edit/steer claims send the winning text; early mismatched start ACK cannot complete',async({request})=>{
 const s=await create(request,'Atomic steering edits',{prompt:'wait atomic'});
 for(let i=0;i<12;i++){if(i)await request.post(`${daemon}/api/sessions/${s.id}/messages`,{data:{text:'wait atomic '+i}});const q=await(await request.post(`${daemon}/api/sessions/${s.id}/message-queue`,{data:{text:'Original '+i}})).json();const [edit,steer]=await Promise.all([request.put(`${daemon}/api/sessions/${s.id}/message-queue/${q.id}`,{data:{text:'Edited '+i}}),request.post(`${daemon}/api/sessions/${s.id}/message-queue/${q.id}/steer`)]);expect([204,409]).toContain(edit.status());expect(steer.status()).toBe(204);await expect.poll(()=>status(request,s.id)).toBe('completed');const output=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');const events=output.split('\n').filter(line=>line.trim().startsWith('{')).map(line=>JSON.parse(line));const expected=(edit.status()===204?'Edited ':'Original ')+i;expect(events.filter(event=>event.type==='openade.user_message').at(-1).text).toBe(expected);expect(events.filter(event=>event.type==='openade.agent_message').at(-1).text).toBe('Steered: '+expected);}
 const invalid=await create(request,'Early incorrect start',{prompt:'early-bad-start'});await expect.poll(()=>status(request,invalid.id)).toBe('failed');const turns=(await(await request.get(`${daemon}/api/sessions/${invalid.id}/turns`)).json()).turns;expect(turns[0].status).toBe('failed');expect(logs(invalid.id).filter(row=>row.method==='turn/start')).toHaveLength(1);
});


test('question and context surfaces follow Frosted/Opaque materials without fading text',async({request,page})=>{
 const s=await create(request,'Question materials',{prompt:'question materials'});try{await ready(page);await open(page,'Question materials');await expect(page.getByRole('dialog',{name:'Your input is needed'})).toBeVisible();await page.getByLabel('Open settings').click();await page.getByRole('tab',{name:'Appearance',exact:true}).click();await choose(page,'Glass','frosted');await page.getByRole('button',{name:'Back',exact:true}).click();const form=page.getByRole('dialog',{name:'Your input is needed'});await expect(form).toHaveCSS('opacity','1');expect(await form.evaluate(el=>getComputedStyle(el,'::before').backdropFilter)).toBe('blur(16px)');expect(await form.evaluate(el=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d')!;ctx.fillStyle=getComputedStyle(el,'::before').backgroundColor;ctx.fillRect(0,0,1,1);return ctx.getImageData(0,0,1,1).data[3];})).toBeLessThan(255);
 await page.getByLabel('Open settings').click();await page.getByRole('tab',{name:'Appearance',exact:true}).click();await choose(page,'Glass','opaque');await page.getByRole('button',{name:'Back',exact:true}).click();await expect(form).toHaveCSS('opacity','1');expect(await form.evaluate(el=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d')!;ctx.fillStyle=getComputedStyle(el,'::before').backgroundColor;ctx.fillRect(0,0,1,1);return ctx.getImageData(0,0,1,1).data[3];})).toBe(255);await page.getByRole('button',{name:'Context usage —'}).click();await expect(page.getByRole('dialog',{name:'Context usage details'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Context usage details'})).toBeHidden();}finally{await request.post(`${daemon}/api/sessions/${s.id}/stop`);}
});


test('daemon death before queued start ACK preserves uncertain delivery without dropping or resending it',async()=>{
 const port=await freePort(),base=`http://127.0.0.1:${port}`,data=path.join(tmp,'rpc-start-crash');const headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'};
 const launch=()=>spawn(path.join(tmp,'openade-e2e'),['--daemon','--addr',`127.0.0.1:${port}`,'--data-dir',data],{env:{...process.env,PATH:path.join(tmp,'bin')+':'+process.env.PATH,OPENADE_PROVIDER_HOME:path.join(tmp,'provider-home'),OPENADE_AUTH_TOKEN:token},stdio:'ignore'});
 const wait=()=>expect.poll(async()=>{try{return(await fetch(base+'/api/health')).status;}catch{return 0;}}).toBe(200);const send=(url:string,method='GET',body?:unknown)=>fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const stop=async(child:ReturnType<typeof launch>,signal:'SIGTERM'|'SIGKILL'='SIGTERM')=>{if(child.exitCode!==null)return;const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill(signal);await ended;};let child=launch();try{await wait();const meta=await(await send('/api/meta')).json();expect(meta.agents.find((agent:any)=>agent.id==='codex').path).toBe(program);const s=await(await send('/api/sessions','POST',{title:'Crash before provider ACK',prompt:'Initial completed turn',agent:'codex',repo_root:path.join(tmp,'fixture-repo'),base_branch:'main'})).json();await expect.poll(async()=>(await(await send(`/api/sessions/${s.id}`)).json()).status).toBe('completed');const q=await(await send(`/api/sessions/${s.id}/message-queue`,'POST',{text:'hold-start-ack wait'})).json();await expect.poll(async()=>(await(await send(`/api/sessions/${s.id}/message-queue`)).json()).messages[0]?.status).toBe('provider-starting');await expect.poll(()=>logs(s.id).some(row=>row.holdAck)).toBe(true);await stop(child,'SIGKILL');child=launch();await wait();const recovered=(await(await send(`/api/sessions/${s.id}/message-queue`)).json()).messages;expect(recovered).toHaveLength(1);expect(recovered[0].id).toBe(q.id);expect(recovered[0].status).toBe('uncertain');await new Promise(resolve=>setTimeout(resolve,300));expect(logs(s.id).filter(row=>row.method==='turn/start')).toHaveLength(2);expect((await(await send(`/api/sessions/${s.id}`)).json()).generation).toBe(2);}finally{await stop(child);}
});


test('conflicting early start identities cannot acknowledge or discard a queued turn',async({request})=>{
 const s=await create(request,'Conflict start recovery');await expect.poll(()=>status(request,s.id)).toBe('completed');const q=await(await request.post(`${daemon}/api/sessions/${s.id}/message-queue`,{data:{text:'conflicting-start'}})).json();await expect.poll(()=>status(request,s.id)).toBe('failed');const queue=(await(await request.get(`${daemon}/api/sessions/${s.id}/message-queue`)).json()).messages;expect(queue).toHaveLength(1);expect(queue[0].id).toBe(q.id);expect(queue[0].status).toBe('uncertain');expect(logs(s.id).filter(row=>row.method==='turn/start')).toHaveLength(2);await request.delete(`${daemon}/api/sessions/${s.id}/message-queue/${q.id}`);
});

test('closed-client and transcript-open failures before dispatch release queued messages for editing and retry',async()=>{
 const port=await freePort(),base=`http://127.0.0.1:${port}`,data=path.join(tmp,'rpc-presend'),bin=path.join(tmp,'presend-bin'),control=path.join(tmp,'presend-control.json');fs.mkdirSync(bin,{recursive:true});fs.symlinkSync(program,path.join(bin,'codex'));fs.writeFileSync(path.join(bin,'git'),`#!/usr/bin/env python3
import os,sys,json,time,signal,shutil
control=os.environ['OPENADE_E2E_PROVIDER_FAILURE_CONTROL']
if 'GIT_INDEX_FILE' in os.environ and 'read-tree' in sys.argv and os.path.exists(control):
 with open(control) as f:entry=json.load(f)
 os.unlink(control)
 if entry['cause']=='close':os.killpg(entry['pid'],signal.SIGTERM);time.sleep(.15)
 elif entry['cause']=='hold':
  open(entry['marker'],'w').close()
  end=time.time()+5
  while os.path.exists(entry['marker']) and time.time()<end:time.sleep(.05)
 else:shutil.move(entry['transcript'],entry['backup']);os.mkdir(entry['transcript'])
os.execv('/usr/bin/git',['git']+sys.argv[1:])
`,{mode:0o755});fs.chmodSync(path.join(bin,'git'),0o755);
 const headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'};const launch=()=>spawn(path.join(tmp,'openade-e2e'),['--daemon','--addr',`127.0.0.1:${port}`,'--data-dir',data],{env:{...process.env,PATH:bin+':'+process.env.PATH,OPENADE_PROVIDER_HOME:path.join(tmp,'provider-home'),OPENADE_AUTH_TOKEN:token,OPENADE_E2E_PROVIDER_FAILURE_CONTROL:control},stdio:'ignore'});let child=launch();const send=(url:string,method='GET',body?:unknown)=>fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 try{await expect.poll(async()=>{try{return(await fetch(base+'/api/health')).status;}catch{return 0;}}).toBe(200);const meta=await(await send('/api/meta')).json();expect(meta.agents.find((agent:any)=>agent.id==='codex').path).toBe(path.join(bin,'codex'));
 for(const cause of ['close','transcript','retry-crash']){const s=await(await send('/api/sessions','POST',{title:'Pre-send '+cause,prompt:'Initial completed turn',agent:'codex',repo_root:path.join(tmp,'fixture-repo'),base_branch:'main'})).json();await expect.poll(async()=>(await(await send(`/api/sessions/${s.id}`)).json()).status).toBe('completed');const transcript=path.join(data,'transcripts',s.id+'.log'),backup=transcript+'.before-fixture';const pid=logs(s.id).find(row=>row.method==='initialize').pid;fs.writeFileSync(control,JSON.stringify({cause,pid,transcript,backup}));const q=await(await send(`/api/sessions/${s.id}/message-queue`,'POST',{text:'Never dispatched yet'})).json();await expect.poll(async()=>(await(await send(`/api/sessions/${s.id}`)).json()).status).toBe('failed');const pending=(await(await send(`/api/sessions/${s.id}/message-queue`)).json()).messages;expect(pending[0].id).toBe(q.id);expect(pending[0].status).toBe('queued');expect(logs(s.id).filter(row=>row.method==='turn/start')).toHaveLength(1);if(cause!=='close'){fs.rmdirSync(transcript);fs.renameSync(backup,transcript);}expect((await send(`/api/sessions/${s.id}/message-queue/${q.id}`,'PUT',{text:'Edited recoverable message'})).status).toBe(204);
 if(cause==='retry-crash'){const marker=path.join(tmp,'presend-held-marker');fs.writeFileSync(control,JSON.stringify({cause:'hold',marker}));const pendingSend=send(`/api/sessions/${s.id}/message-queue/${q.id}/steer`,'POST').catch(()=>null);await expect.poll(()=>fs.existsSync(marker)).toBe(true);const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await ended;await pendingSend;fs.unlinkSync(marker);try{process.kill(-pid,'SIGTERM');}catch{}const restartMarker=marker+'-restart';fs.writeFileSync(control,JSON.stringify({cause:'hold',marker:restartMarker}));child=launch();await expect.poll(async()=>{try{return(await fetch(base+'/api/health')).status;}catch{return 0;}}).toBe(200);await expect.poll(()=>fs.existsSync(restartMarker)).toBe(true);const recovered=(await(await send(`/api/sessions/${s.id}/message-queue`)).json()).messages;expect(recovered).toHaveLength(1);expect(recovered[0]).toMatchObject({id:q.id,status:'dispatching',text:'Edited recoverable message'});expect(logs(s.id).filter(row=>row.method==='turn/start')).toHaveLength(1);fs.unlinkSync(restartMarker);}
 if(cause==='close'){expect((await send(`/api/sessions/${s.id}/messages`,'POST',{text:'wait separate active turn'})).status).toBe(202);await expect.poll(async()=>(await(await send(`/api/sessions/${s.id}`)).json()).status).toBe('running');}
 if(cause!=='retry-crash')expect((await send(`/api/sessions/${s.id}/message-queue/${q.id}/steer`,'POST')).status).toBe(204);await expect.poll(async()=>(await(await send(`/api/sessions/${s.id}`)).json()).status).toBe('completed');expect((await(await send(`/api/sessions/${s.id}/message-queue`)).json()).messages).toEqual([]);expect(fs.readFileSync(transcript,'utf8')).toContain('Edited recoverable message');const mirror=execFileSync('/usr/bin/sqlite3',[path.join(data,'openade.sqlite3'),`SELECT text FROM messages WHERE id='${q.id}'`],{encoding:'utf8'}).trim();expect(mirror).toBe('Edited recoverable message');}
 }finally{if(child.exitCode===null){const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGTERM');await ended;}}
});

test('concealed approval scopes and truncated commands cannot expose an acceptance button',async({request,page})=>{
 await ready(page);
 for(const variant of ['network','permissions','stdin','environment','empty','oversized','root','file-empty','file-generic']){
  const s=await create(request,'Unsupported approval '+variant,{prompt:'concealed-'+variant});await expect.poll(()=>status(request,s.id)).toBe('completed');
  expect((await state(request,s.id)).requests).toEqual([]);const replies=logs(s.id).filter(row=>row.reply===502);expect(replies).toHaveLength(1);expect(replies[0].decision).toBeNull();expect(replies[0].errorCode).toBe(variant==='oversized'?-32602:-32601);
  await open(page,'Unsupported approval '+variant);await expect(page.getByRole('button',{name:'Allow once',exact:true})).toHaveCount(0);
 }
});
