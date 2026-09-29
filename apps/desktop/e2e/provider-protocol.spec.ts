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
test('the pinned Claude model catalog reaches both initial and resumed CLI turns',async({request,page})=>{
 const meta=await(await request.get(`${daemon}/api/meta`)).json();
 const models=meta.agents.find((agent:any)=>agent.id==='claude').models;
 expect(models.map((model:any)=>model.id)).toEqual(['claude-fable-5-1','claude-fable-5','claude-opus-5-5','claude-opus-4-8','claude-opus-4-7','claude-sonnet-5','claude-haiku-4-5']);
 const probeFile=path.join(tmp,'provider-home/claude-model-probes.log');const probes=()=>fs.existsSync(probeFile)?fs.readFileSync(probeFile,'utf8').trim().split('\n').filter(Boolean).length:0;const before=probes();
 const discovered=(await(await request.get(`${daemon}/api/providers/claude/models?refresh=1`)).json()).models;
 expect(probes()).toBe(before+1);expect((await request.get(`${daemon}/api/providers/claude/models`)).ok()).toBe(true);expect(probes()).toBe(before+1);
 expect((await request.get(`${daemon}/api/providers/claude/models?refresh=1`)).ok()).toBe(true);expect(probes()).toBe(before+2);
 expect(discovered.map((model:any)=>model.id)).toEqual(['claude-opus-5-5','claude-fable-5-1','claude-fable-5','claude-opus-4-8','claude-opus-4-7','claude-sonnet-5','claude-haiku-4-5','gateway/claude-custom']);
 expect(discovered.at(-1).efforts).toEqual(['low','high']);
 const s=await create(request,'Claude model catalog',{agent:'claude',model:'claude-opus-5-5',effort:'high'});await expect.poll(()=>status(request,s.id)).toBe('completed');
 const argsFile=path.join(tmp,'provider-home/args',s.id+'.json');
 expect(JSON.parse(fs.readFileSync(argsFile,'utf8')).slice(0,4)).toEqual(['--model','claude-opus-5-5','--effort','high']);
 await ready(page);await open(page,'Claude model catalog');await page.getByLabel('Choose model').click();await expect(page.getByRole('option',{name:/^Fable 5.1/})).toBeVisible();await expect(page.getByRole('option',{name:/^Haiku 4.5/})).toBeVisible();await expect(page.getByRole('option',{name:/^Work Claude/})).toBeVisible();await page.keyboard.press('Escape');
 expect((await request.post(`${daemon}/api/sessions/${s.id}/model`,{data:{model:'claude-sonnet-5',effort:'xhigh'}})).ok()).toBe(true);
 expect((await request.post(`${daemon}/api/sessions/${s.id}/messages`,{data:{text:'Next Claude model turn'}})).status()).toBe(202);
 await expect.poll(()=>JSON.parse(fs.readFileSync(argsFile,'utf8')).slice(0,4)).toEqual(['--model','claude-sonnet-5','--effort','xhigh']);
});
test('Claude cached context usage excludes child traffic and persists in the chat indicator',async({request,page})=>{
 const s=await create(request,'Claude context telemetry',{agent:'claude',prompt:'claude-context'});
 await expect.poll(()=>status(request,s.id)).toBe('completed');
 expect((await state(request,s.id)).context).toEqual({tokens:42000,window:200000});
 await ready(page);await open(page,'Claude context telemetry');
 const ring=page.getByRole('button',{name:'Context usage 21%'});await expect(ring).toBeVisible();await ring.click();
 await expect(page.getByRole('dialog',{name:'Context usage details'})).toContainText('42,000 / 200,000 tokens');
 await expect(page.getByRole('dialog',{name:'Context usage details'})).toContainText('158,000 tokens remaining');
 await page.reload();await expect(page.getByRole('button',{name:'Context usage 21%'})).toBeVisible();
 expect((await request.post(`${daemon}/api/sessions/${s.id}/messages`,{data:{text:'Follow-up without usage metadata'}})).status()).toBe(202);
 await expect.poll(async()=>{const current=await(await request.get(`${daemon}/api/sessions/${s.id}`)).json();return current.generation===2?current.status:'previous';}).toBe('completed');
 expect((await state(request,s.id)).context).toEqual({tokens:42000,window:200000});
});

test('known context capacity remains visible while token use is unavailable',async({request,page})=>{
 const session=await create(request,'Context capacity without usage',{agent:'codex',prompt:'context-window-only'});
 await expect.poll(()=>status(request,session.id)).toBe('completed');
 expect((await state(request,session.id)).context).toEqual({tokens:null,window:200000});
 await ready(page);await open(page,'Context capacity without usage');
 const ring=page.getByRole('button',{name:'Context usage —'});await expect(ring).toBeVisible();await ring.click();
 const card=page.getByRole('dialog',{name:'Context usage details'});
 await expect(card).toContainText('200,000 token capacity');
 await expect(card).toContainText('Waiting for context usage');
 await page.reload();await expect(ring).toBeVisible();
});

test('Codex snake case usage and zero-token reset keep the context meter accurate',async({request,page})=>{
 const session=await create(request,'Snake case context',{agent:'codex',prompt:'context-snake-usage'});
 await expect.poll(()=>status(request,session.id)).toBe('completed');await expect.poll(async()=>(await state(request,session.id)).context).toEqual({tokens:64000,window:256000});
 await ready(page);await open(page,'Snake case context');await expect(page.getByRole('button',{name:'Context usage 25%'})).toBeVisible();
 expect((await request.post(`${daemon}/api/sessions/${session.id}/messages`,{data:{text:'context-snake-total'}})).status()).toBe(202);
 await expect.poll(()=>status(request,session.id)).toBe('completed');await expect.poll(async()=>(await state(request,session.id)).context).toEqual({tokens:90000,window:256000});await expect(page.getByRole('button',{name:'Context usage 35%'})).toBeVisible();
 expect((await request.post(`${daemon}/api/sessions/${session.id}/messages`,{data:{text:'context-snake-reset'}})).status()).toBe(202);
 await expect.poll(()=>status(request,session.id)).toBe('completed');await expect.poll(async()=>(await state(request,session.id)).context).toEqual({tokens:0,window:256000});
 const ring=page.getByRole('button',{name:'Context usage 0%'});await expect(ring).toBeVisible();await ring.click();await expect(page.getByRole('dialog',{name:'Context usage details'})).toContainText('0 / 256,000 tokens');await page.reload();await expect(ring).toBeVisible();
});

test('delivered stream text becomes visible before the provider finishes',async({request,page})=>{
 const session=await create(request,'Live stream fidelity',{agent:'codex',prompt:'stream-visible-burst'});
 await ready(page);await open(page,'Live stream fidelity');
 await expect.poll(async()=>page.locator('.chat-assistant-turn .markdown-body').last().textContent(),{timeout:2500}).toContain('FIRST_CHUNK_END');
 await expect.poll(()=>status(request,session.id)).toBe('completed');
 await expect(page.locator('.chat-assistant-turn .markdown-body').last()).toContainText('Live stream finished');
});

test('text and work keep provider event order in the chat timeline',async({request,page})=>{
 const session=await create(request,'Interleaved stream',{agent:'codex',prompt:'interleaved-stream'});
 await expect.poll(()=>status(request,session.id)).toBe('completed');
 await ready(page);await open(page,'Interleaved stream');
 const parts=page.locator('.chat-assistant-turn').last().locator(':scope > .markdown-body, :scope > .chat-activity-segment');
 await expect(parts).toHaveCount(3);
 await expect(parts.nth(0)).toHaveText('First visible text.');
 await expect(parts.nth(1).locator('summary')).toHaveText('Ran 1 command');
 await expect(parts.nth(2)).toHaveText('Second visible text.');
 await page.reload();
 await expect(parts).toHaveCount(3);
});

test('completed Codex text cannot replace streamed text around a work step',async({request,page})=>{
 const session=await create(request,'Revised completion stream',{agent:'codex',prompt:'interleaved-revised-final'});
 await expect.poll(()=>status(request,session.id)).toBe('completed');await ready(page);await open(page,'Revised completion stream');
 const parts=page.locator('.chat-assistant-turn').last().locator(':scope > .markdown-body, :scope > .chat-activity-segment');
 await expect(parts).toHaveCount(3);await expect(parts.nth(0)).toHaveText('First visible text.');await expect(parts.nth(1).locator('summary')).toHaveText('Ran 1 command');await expect(parts.nth(2)).toHaveText('Second visible text.');await expect(page.locator('.chat-assistant-turn').last()).not.toContainText('Rewritten completion payload.');
 if(process.env.OPENADE_STREAM_CAPTURE_PATH)await page.screenshot({path:process.env.OPENADE_STREAM_CAPTURE_PATH});
 await page.reload();await expect(parts).toHaveCount(3);
});

test('interleaved Codex message IDs retain delta arrival order',async({request,page})=>{
 const session=await create(request,'Interleaved message IDs',{agent:'codex',prompt:'interleaved-message-ids'});
 await expect.poll(()=>status(request,session.id)).toBe('completed');await ready(page);await open(page,'Interleaved message IDs');
 await expect(page.locator('.chat-assistant-turn .markdown-body').last()).toHaveText('OneTwoThree');await page.reload();await expect(page.locator('.chat-assistant-turn .markdown-body').last()).toHaveText('OneTwoThree');
});

test('streamed text and work appear in provider order before the turn completes',async({request,page})=>{
 const session=await create(request,'Live interleaved stream',{agent:'codex',prompt:'interleaved-live'});
 const gate=path.join(tmp,'provider-home','interleaved-live-'+session.id);
 try{
  await ready(page);await open(page,'Live interleaved stream');
  const parts=page.locator('.chat-assistant-turn').last().locator(':scope > .markdown-body, :scope > .chat-activity-segment');
  await expect(parts).toHaveCount(1);await expect(parts.nth(0)).toHaveText('First visible text.');
  fs.writeFileSync(gate+'.tool','');await expect(parts).toHaveCount(2);await expect(parts.nth(1).locator('summary')).toHaveText('Ran 1 command');
  fs.writeFileSync(gate+'.text','');await expect(parts).toHaveCount(3);await expect(parts.nth(2)).toHaveText('Second visible text.');
  fs.writeFileSync(gate+'.done','');await expect.poll(()=>status(request,session.id)).toBe('completed');await expect(parts).toHaveCount(3);
 }finally{await request.post(`${daemon}/api/sessions/${session.id}/stop`);}
});

test('thinking separated by assistant text remains in two ordered work groups',async({request,page})=>{
 const session=await create(request,'Interleaved thinking',{agent:'codex',prompt:'interleaved-thinking'});
 await expect.poll(()=>status(request,session.id)).toBe('completed');
 await ready(page);await open(page,'Interleaved thinking');
 const parts=page.locator('.chat-assistant-turn').last().locator(':scope > .markdown-body, :scope > .chat-activity-segment');
 await expect(parts).toHaveCount(5);
 for(const [index,text] of [[1,'First thought.'],[3,'Second thought.']] as const){
  await parts.nth(index).locator('summary').click();
  await parts.nth(index).getByRole('button',{name:'Thought process'}).click();
  await expect(parts.nth(index)).toContainText(text);
 }
 await expect(parts.nth(0)).toHaveText('First text.');
 await expect(parts.nth(2)).toHaveText('Second text.');
 await expect(parts.nth(4)).toHaveText('Third text.');
});

test('Codex file changes keep stable rows and count distinct paths after reload',async({request,page})=>{
 const session=await create(request,'Typed file changes',{agent:'codex',prompt:'typed-file-changes'});
 await expect.poll(()=>status(request,session.id)).toBe('completed');
 const transcript=fs.readFileSync(path.join(tmp,'data/transcripts',session.id+'.log'),'utf8');
 const tools=transcript.trim().split('\n').map(line=>JSON.parse(line)).filter(event=>event.type==='openade.tool');
 expect(tools).toHaveLength(6);
 expect(tools[0]).toMatchObject({id:'change-one',title:'Edited file',paths:['src/shared.ts'],operation:'edit'});
 expect(tools[1]).toMatchObject({id:'change-one',paths:[]});
 expect(tools[5]).toMatchObject({id:'change-three',paths:['src/other.ts'],failed:true});
 await ready(page);await open(page,'Typed file changes');
 const group=page.locator('.chat-assistant-turn .activity-group').last();
 await expect(group.locator('summary')).toHaveText('Edited 2 files · 1 failed');
 await group.locator('summary').click();
 await expect(group.locator('.activity-row')).toHaveCount(3);
 await group.locator('.activity-row').nth(0).getByRole('button',{name:'Edited file'}).click();
 await expect(group.locator('.activity-row').nth(0)).toContainText('src/shared.ts');
 await page.reload();
 await expect(group.locator('summary')).toHaveText('Edited 2 files · 1 failed');
 await group.locator('summary').click();
 await expect(group.locator('.activity-row')).toHaveCount(3);
});

test('Codex app-server reasoning text reaches the native work accordion',async({request,page})=>{
 const session=await create(request,'reasoning-content',{agent:'codex'});
 await expect.poll(()=>status(request,session.id)).toBe('completed');
 await ready(page);await open(page,'reasoning-content');
 const group=page.locator('.activity-group').last();await expect(group.locator('summary')).toHaveText('Thought process');
 await group.locator('summary').click();await group.getByRole('button',{name:'Thought process'}).click();
 await expect(group).toContainText('First, inspect the files.');
});

test('Claude stdio questions use the custom multi-page wizard and return answers to the same run',async({request,page})=>{
 const s=await create(request,'Claude stdio question',{agent:'claude',prompt:'claude-question'});
 await expect.poll(async()=>(await state(request,s.id)).requests.length).toBe(1);
 const pending=(await state(request,s.id)).requests[0];
 expect((await request.post(`${daemon}/api/sessions/${s.id}/provider-requests/${pending.id}`,{data:{generation:pending.generation+1,answers:{}}})).status()).toBe(409);
 await expect.poll(()=>status(request,s.id)).toBe('waiting');
 await ready(page);await open(page,'Claude stdio question');
 const wizard=page.getByRole('dialog',{name:'Your input is needed'});await expect(wizard).toBeVisible();
 await wizard.getByRole('button',{name:'Editor'}).click();await wizard.getByRole('button',{name:'Terminal'}).click();
 await expect(wizard.getByRole('button',{name:'Editor'})).toHaveAttribute('aria-pressed','true');
 await wizard.getByRole('button',{name:'Next'}).click();await expect(wizard).toContainText('Which priority?');
 await wizard.getByRole('button',{name:'Now'}).click();
 await expect.poll(()=>status(request,s.id)).toBe('completed');await expect(wizard).toBeHidden();
 expect((await request.post(`${daemon}/api/sessions/${s.id}/provider-requests/${pending.id}`,{data:{generation:pending.generation,answers:{}}})).status()).toBe(409);
 const wire=JSON.parse(fs.readFileSync(path.join(tmp,'provider-home/claude-control-answer.json'),'utf8'));
 expect(wire).toMatchObject({type:'control_response',response:{subtype:'success',request_id:'claude-ask-1',response:{behavior:'allow',updatedInput:{answers:{'Which areas?':['Editor','Terminal'],'Which priority?':'Now'}}}}});
 const transcript=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');
 expect(transcript).not.toContain('control_request');expect(transcript).not.toContain('Which areas?');expect(transcript).toContain('"status":"pending"');expect(transcript).toContain('"status":"answered"');
});
test('Claude non-question stdio tool permissions are answered without a wizard',async({request})=>{
 const s=await create(request,'Claude stdio tool',{agent:'claude',prompt:'claude-question permission'});
 await expect.poll(()=>status(request,s.id)).toBe('completed');
 expect((await state(request,s.id)).requests).toEqual([]);
 const wire=JSON.parse(fs.readFileSync(path.join(tmp,'provider-home/claude-control-answer.json'),'utf8'));
 expect(wire.response.response).toEqual({behavior:'allow',updatedInput:{command:'printf harmless'}});
});
test('stopping Claude during a question dismisses its request and transcript chip',async({request})=>{
 const s=await create(request,'Claude interrupted question',{agent:'claude',prompt:'claude-question'});
 await expect.poll(async()=>(await state(request,s.id)).requests.length).toBe(1);
 const question=(await state(request,s.id)).requests[0];
 expect((await request.post(`${daemon}/api/sessions/${s.id}/stop`)).ok()).toBe(true);
 await expect.poll(()=>status(request,s.id)).toBe('stopped');
 await expect.poll(async()=>(await state(request,s.id)).requests.length).toBe(0);
 const transcript=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');
 expect(transcript).toContain(`"id":"${question.id}"`);expect(transcript).toContain('"status":"dismissed"');
});
test('Claude Agent/Task child output stays in its own document and SendMessage reopens it',async({request,page})=>{
 const s=await create(request,'Claude linked agent',{agent:'claude',prompt:'claude-child'});
 await expect.poll(()=>status(request,s.id)).toBe('completed');
 expect(JSON.parse(fs.readFileSync(path.join(tmp,'provider-home/args',s.id+'.json'),'utf8'))).toContain('--forward-subagent-text');
 const parent=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');
 expect(parent).toContain('Parent finished independently.');expect(parent).not.toContain('Child found the answer.');
 const markers=parent.trim().split('\n').map(line=>JSON.parse(line)).filter(event=>event.type==='openade.subagent');expect(markers).toHaveLength(1);
 const child=await(await request.get(`${daemon}/api/sessions/${s.id}/subagents/${markers[0].doc_id}`)).json();
 expect(child.status).toBe('done');expect(child.output).toContain('Inspect the fixture child');expect(child.output).toContain('Child found the answer.');expect(child.output).toContain('Check the follow-up');expect(child.output).toContain('Follow-up confirmed.');
 await ready(page);await open(page,'Claude linked agent');const chip=page.getByRole('button',{name:/Open agent Inspect Claude child/});await expect(chip).toContainText('Done');await chip.click();await expect(page.getByLabel('Agent panel')).toContainText('Follow-up confirmed.');
});
test('Claude early child frames and foreground Agent results preserve the child document',async({request})=>{
 const s=await create(request,'Claude foreground child',{agent:'claude',prompt:'claude-child early foreground'});await expect.poll(()=>status(request,s.id)).toBe('completed');
 const parent=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');expect(parent).not.toContain('Early child output.');
 const marker=parent.trim().split('\n').map(line=>JSON.parse(line)).find(event=>event.type==='openade.subagent');expect(marker).toBeTruthy();
 const child=await(await request.get(`${daemon}/api/sessions/${s.id}/subagents/${marker.doc_id}`)).json();expect(child.status).toBe('done');expect(child.output).toContain('Early child output.');expect(child.output).toContain('Child found the answer.');
});
test('Claude child tool IDs reused by a later CLI process still create a new owned document',async({request})=>{
 const s=await create(request,'Claude repeated spawn',{agent:'claude',prompt:'claude-child'});await expect.poll(()=>status(request,s.id)).toBe('completed');
 expect((await request.post(`${daemon}/api/sessions/${s.id}/messages`,{data:{text:'claude-child'}})).status()).toBe(202);
 await expect.poll(async()=>{const current=await(await request.get(`${daemon}/api/sessions/${s.id}`)).json();return current.generation===2?current.status:'previous';}).toBe('completed');
 const parent=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');const markers=parent.trim().split('\n').map(line=>JSON.parse(line)).filter(event=>event.type==='openade.subagent');expect(markers).toHaveLength(2);expect(new Set(markers.map(event=>event.doc_id)).size).toBe(2);
 for(const marker of markers){const child=await(await request.get(`${daemon}/api/sessions/${s.id}/subagents/${marker.doc_id}`)).json();expect(child.status).toBe('done');}
});
test('nested Claude Agent output opens from the owning child tab without entering the parent chat',async({request,page})=>{
 const s=await create(request,'Claude nested agent',{agent:'claude',prompt:'claude-child nested'});await expect.poll(()=>status(request,s.id)).toBe('completed');
 const parent=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');expect(parent).not.toContain('Nested child found the detail.');
 const first=parent.trim().split('\n').map(line=>JSON.parse(line)).find(event=>event.type==='openade.subagent');expect(first).toBeTruthy();
 const child=await(await request.get(`${daemon}/api/sessions/${s.id}/subagents/${first.doc_id}`)).json();expect(child.status).toBe('done');expect(child.output).not.toContain('Nested child found the detail.');
 const nested=child.output.trim().split('\n').map((line:string)=>JSON.parse(line)).find((event:any)=>event.type==='openade.subagent');expect(nested).toMatchObject({title:'Inspect nested fixture'});
 const grandchild=await(await request.get(`${daemon}/api/sessions/${s.id}/subagents/${nested.doc_id}`)).json();expect(grandchild.status).toBe('done');expect(grandchild.output).toContain('Inspect one level deeper');expect(grandchild.output).toContain('Nested child found the detail.');
 await ready(page);await open(page,'Claude nested agent');await page.getByRole('button',{name:'Open agent Inspect Claude child'}).click();const panel=page.getByLabel('Agent panel');const nestedCard=panel.getByRole('button',{name:'Open agent Inspect nested fixture'});await expect(nestedCard).toContainText('Done');await nestedCard.click();await expect(panel.getByLabel('Agent transcript Inspect nested fixture')).toContainText('Nested child found the detail.');
});
test('Copilot CLI opens an interactive prompt with a stable session ID and resumes it',async({request})=>{
 const s=await create(request,'Copilot interactive',{agent:'copilot',mode:'tui'});
 await expect.poll(async()=>fs.existsSync(path.join(tmp,'data/transcripts',s.id+'.log'))?fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8').includes('copilot-shim started'):false).toBe(true);
 const initial=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');expect(initial).toContain(`args: --session-id ${s.id} -i Copilot interactive`);
 expect(initial).not.toContain('openade.provider_session');
 expect((await request.post(`${daemon}/api/sessions/${s.id}/stop`)).ok()).toBe(true);await expect.poll(()=>status(request,s.id)).toBe('stopped');
 expect((await request.post(`${daemon}/api/sessions/${s.id}/resume-tui`)).ok()).toBe(true);
 await expect.poll(()=>status(request,s.id)).toBe('running');
 await expect.poll(()=>fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8').split('copilot-shim started').length).toBe(3);
 const resumed=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');expect(resumed.slice(resumed.lastIndexOf('copilot-shim started'))).toContain(`args: --session-id ${s.id}`);expect(resumed.slice(resumed.lastIndexOf('copilot-shim started'))).not.toContain(' -i ');
 await request.post(`${daemon}/api/sessions/${s.id}/stop`);
});
test('persistent stdio conversation, typed images, context and completion-before-ACK/EOF',async({request,page})=>{
 const s=await create(request,'Persistent Codex');await expect.poll(()=>status(request,s.id)).toBe('completed');expect((await state(request,s.id)).context).toEqual({tokens:32000,window:128000});
 const upload=await request.post(`${daemon}/api/attachments?name=fixture.png`,{headers:{'Content-Type':'image/png'},data:fs.readFileSync(path.join(tmp,'../fixtures/preview-grid.png'))});expect(upload.status()).toBe(201);const image=await upload.json();
 expect((await request.post(`${daemon}/api/sessions/${s.id}/messages`,{data:{text:`Image follow-up\n\nAttached images (local files — open them to view):\n- ${image.path}`}})).status()).toBe(202);await expect.poll(()=>status(request,s.id)).toBe('completed');const methods=logs(s.id).filter(row=>row.method);expect(methods.filter(row=>row.method==='initialize')).toHaveLength(1);expect(methods.filter(row=>row.method==='thread/start')).toHaveLength(1);expect(methods.filter(row=>row.method==='turn/start')).toHaveLength(2);expect(new Set(methods.map(row=>row.pid)).size).toBe(1);expect(logs(s.id).some(row=>JSON.stringify(row.inputTypes)==='["text","localImage"]')).toBe(true);
 await ready(page);await open(page,'Persistent Codex');await expect(page.getByRole('button',{name:'Context usage 25%'})).toBeVisible();await page.getByRole('button',{name:'Context usage 25%'}).click();await expect(page.getByRole('dialog',{name:'Context usage details'})).toContainText('32,000 / 128,000 tokens');await expect(page.getByRole('dialog',{name:'Context usage details'})).toContainText('96,000 tokens remaining');expect(await page.getByRole('dialog',{name:'Context usage details'}).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})).toBe(true);await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Context usage details'})).toBeHidden();
 expect((await request.post(`${daemon}/api/sessions/${s.id}/messages`,{data:{text:'context-window-only'}})).status()).toBe(202);await expect.poll(()=>status(request,s.id)).toBe('completed');await expect.poll(async()=>(await state(request,s.id)).context).toEqual({tokens:32000,window:200000});
 const updatedRing=page.getByRole('button',{name:'Context usage 16%'});await expect(updatedRing).toBeVisible();await updatedRing.click();await expect(page.getByRole('dialog',{name:'Context usage details'})).toContainText('32,000 / 200,000 tokens');await page.reload();await expect(updatedRing).toBeVisible();
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
 const questionCard=page.getByRole('note',{name:'Question: Approach'});await expect(questionCard).toContainText('Approach');await expect(questionCard).not.toContainText('Awaiting your answer');
 await page.getByLabel('Open settings').click();await page.getByRole('button',{name:'Back',exact:true}).click();await expect(page.getByLabel('Session message',{exact:true})).toHaveValue('Keep my ordinary draft');
 await page.reload();await expect(page.getByRole('note',{name:'Question: Approach'})).toContainText('Approach');
 expect(logs(s.id).filter(row=>row.answerCount===2)).toHaveLength(1);const transcript=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');expect(transcript).toContain('"type":"openade.question"');expect(transcript).not.toContain('private-fixture-value');expect(fs.readFileSync(path.join(tmp,'data/openade.sqlite3')).includes(Buffer.from('private-fixture-value'))).toBe(false);
});
test('approvals require a decision, stale/duplicate replies fail and resolved questions disappear',async({request,page})=>{
 const s=await create(request,'Approval parity',{prompt:'approval'});await expect.poll(()=>status(request,s.id)).toBe('waiting');const q=(await state(request,s.id)).requests[0];expect((await request.post(`${daemon}/api/sessions/${s.id}/provider-requests/${q.id}`,{data:{generation:q.generation,decision:'acceptForSession'}})).status()).toBe(409);expect(logs(s.id).filter(row=>row.reply)).toHaveLength(0);await ready(page);await open(page,'Approval parity');const dialog=page.getByRole('dialog',{name:'Allow this command?'});await expect(dialog).toContainText('printf approved');await dialog.getByRole('button',{name:'Deny',exact:true}).click();await expect.poll(()=>status(request,s.id)).toBe('completed');expect(logs(s.id).filter(row=>row.decision==='decline')).toHaveLength(1);expect((await request.post(`${daemon}/api/sessions/${s.id}/provider-requests/${q.id}`,{data:{generation:q.generation,decision:'accept'}})).status()).toBe(409);
 const obsolete=await create(request,'Obsolete question',{prompt:'obsolete'});await expect.poll(async()=>(await state(request,obsolete.id)).requests.length).toBe(1);const old=(await state(request,obsolete.id)).requests[0];await expect.poll(async()=>(await state(request,obsolete.id)).requests.length).toBe(0);expect((await request.post(`${daemon}/api/sessions/${obsolete.id}/provider-requests/${old.id}`,{data:{generation:old.generation,answers:{approach:['Simple'],private:['x']}}})).status()).toBe(409);await request.post(`${daemon}/api/sessions/${obsolete.id}/stop`);
 const obsoleteTranscript=fs.readFileSync(path.join(tmp,'data/transcripts',obsolete.id+'.log'),'utf8');const markers=obsoleteTranscript.split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(event=>event.type==='openade.question');expect(markers.map(event=>event.status)).toEqual(['pending','dismissed']);
});
test('child completion cannot settle parent, real steering binds one turn and interruption reuses client',async({request})=>{
 const s=await create(request,'Steering ownership',{prompt:'wait child'});await expect.poll(async()=>logs(s.id).some(row=>row.method==='turn/start')).toBe(true);await new Promise(resolve=>setTimeout(resolve,300));expect(await status(request,s.id)).toBe('running');const generation=(await(await request.get(`${daemon}/api/sessions/${s.id}`)).json()).generation;
 const queued=await(await request.post(`${daemon}/api/sessions/${s.id}/message-queue`,{data:{text:'send into active turn'}})).json();expect((await request.post(`${daemon}/api/sessions/${s.id}/message-queue/${queued.id}/steer`)).status()).toBe(204);await expect.poll(()=>status(request,s.id)).toBe('completed');expect((await(await request.get(`${daemon}/api/sessions/${s.id}/message-queue`)).json()).messages).toEqual([]);expect((await(await request.get(`${daemon}/api/sessions/${s.id}`)).json()).generation).toBe(generation);expect(logs(s.id).filter(row=>row.method==='turn/steer')[0].expectedTurnId).toBe('turn-1');
 await request.post(`${daemon}/api/sessions/${s.id}/messages`,{data:{text:'wait next'}});await request.post(`${daemon}/api/sessions/${s.id}/stop`);await expect.poll(()=>status(request,s.id)).toBe('stopped');expect((await state(request,s.id)).connected).toBe(true);expect(logs(s.id).filter(row=>row.method==='initialize')).toHaveLength(1);expect(logs(s.id).filter(row=>row.method==='turn/interrupt')).toHaveLength(1);
});
test('Codex child documents retain early and late output without settling the parent or linking agent controls',async({request,page})=>{
 for(const variant of ['early','live','v2']){
  const s=await create(request,`Linked agent ${variant}`,{prompt:`subagent ${variant}`});
  await expect.poll(()=>status(request,s.id)).toBe('completed');
  const transcript=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');
  const spawns=transcript.split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(event=>event.type==='openade.subagent');
  expect(spawns).toHaveLength(1);expect(transcript).toContain('Parent completed independently');expect(transcript).not.toContain('Child is working');
  const docId=spawns[0].doc_id;expect(docId).toMatch(/^[0-9a-f-]{36}$/);
  await expect.poll(async()=>(await(await request.get(`${daemon}/api/sessions/${s.id}/subagents/${docId}`)).json()).status).toBe('done');
  const doc=await(await request.get(`${daemon}/api/sessions/${s.id}/subagents/${docId}`)).json();
  expect(doc.child_thread_id).toBe('child-turn-'+String(s.generation));expect(doc.output).toContain('Inspect the fixture child');expect(doc.output).toContain(variant==='early'?'Finished early.':'Finished after parent.');
  const other=await create(request,`Other owner ${variant}`);expect((await request.get(`${daemon}/api/sessions/${other.id}/subagents/${docId}`)).status()).toBe(404);
  await ready(page);await open(page,`Linked agent ${variant}`);
  const chip=page.getByRole('button',{name:/Open agent/});await expect(chip).toHaveCount(1);await expect(chip).toContainText('Done');await chip.click();
  const panel=page.getByLabel('Agent panel');await expect(panel.getByLabel(/Agent transcript/)).toContainText('Finished');await expect(panel).toContainText('Inspect the fixture child');
  await page.reload();await expect(page.getByRole('button',{name:/Open agent/})).toHaveCount(1);
  expect((await request.delete(`${daemon}/api/sessions/${s.id}`)).status()).toBe(204);expect((await request.get(`${daemon}/api/sessions/${s.id}/subagents/${docId}`)).status()).toBe(404);
 }
});
test('a failed spawn stays a non-link card and never claims a child document',async({request,page})=>{
 const s=await create(request,'Failed agent spawn',{prompt:'subagent failed-spawn'});await expect.poll(()=>status(request,s.id)).toBe('completed');
 await ready(page);await open(page,'Failed agent spawn');await expect(page.getByRole('button',{name:/Open agent/})).toHaveCount(0);await expect(page.getByRole('note',{name:/Agent Inspect the fixture child/})).toContainText('Failed');
});
test('a child remains live after its parent completes and updates the open agent panel',async({request,page})=>{
 const s=await create(request,'Live linked agent',{prompt:'subagent held'});await expect.poll(()=>status(request,s.id)).toBe('completed');
 const parent=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');const spawn=parent.split('\n').filter(Boolean).map(line=>JSON.parse(line)).find(event=>event.type==='openade.subagent');const endpoint=`${daemon}/api/sessions/${s.id}/subagents/${spawn.doc_id}`;
 const before=await(await request.get(endpoint)).json();expect(before.status).toBe('running');expect(before.output).toContain('Child is working.');expect(before.cursor).toBeGreaterThan(0);
 await ready(page);await open(page,'Live linked agent');const chip=page.getByRole('button',{name:/Open agent/});await expect(chip).toContainText('Working');await chip.click();
 const panel=page.getByLabel('Agent panel');await expect(panel).toContainText('Child is working.');await expect(panel).not.toContainText('Finished after parent.');
 fs.writeFileSync(path.join(tmp,'provider-home/rpc-log',s.id+'.release-child'),'go');
 await expect(chip).toContainText('Done');await expect(panel).toContainText('Finished after parent.');await expect(page.locator('.conversation .activity-group')).toContainText('Wait for agents');await panel.getByRole('button',{name:'Close Agent tab'}).click();await expect(page.getByLabel('Session message',{exact:true})).toBeFocused();
 const delta=await(await request.get(`${endpoint}?after=${before.cursor}`)).json();expect(delta.output).toContain('Finished after parent.');expect(delta.output).not.toContain('Inspect the fixture child');expect(delta.cursor).toBeGreaterThan(before.cursor);
 const childLog=path.join(tmp,'data/subagents',s.id,spawn.doc_id+'.log');fs.appendFileSync(childLog,'{"type":"openade.agent_message","id":"partial","text":"π');const partial=await(await request.get(`${endpoint}?after=${delta.cursor}`)).json();expect(partial.output).toBe('');expect(partial.cursor).toBe(delta.cursor);fs.appendFileSync(childLog,'"}\n');const whole=await(await request.get(`${endpoint}?after=${delta.cursor}`)).json();expect(whole.output).toContain('"text":"π"');expect(whole.cursor).toBeGreaterThan(delta.cursor);
});
test('child output is bounded independently of the parent transcript',async({request})=>{
 const s=await create(request,'Bounded child output',{prompt:'subagent bounded'});await expect.poll(()=>status(request,s.id)).toBe('completed');
 const parent=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');const spawn=parent.split('\n').filter(Boolean).map(line=>JSON.parse(line)).find(event=>event.type==='openade.subagent');expect(spawn?.doc_id).toBeTruthy();expect(parent).not.toContain('xxxxxxxxxxxxxxxxxxxxxxxx');
 await expect.poll(async()=>(await(await request.get(`${daemon}/api/sessions/${s.id}/subagents/${spawn.doc_id}`)).json()).status).toBe('done');
 const child=await(await request.get(`${daemon}/api/sessions/${s.id}/subagents/${spawn.doc_id}`)).json();expect(Buffer.byteLength(child.output)).toBeLessThanOrEqual(2*1024*1024);expect(child.output).toContain('Subagent transcript is truncated after 2 MiB.');
});
test('a daemon restart keeps the child document and clears its stale running state',async()=>{
 const port=await freePort(),base=`http://127.0.0.1:${port}`,data=path.join(tmp,'subagent-recovery');const headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'};
 const launch=()=>spawn(path.join(tmp,'openade-e2e'),['--daemon','--addr',`127.0.0.1:${port}`,'--data-dir',data],{env:{...process.env,PATH:path.join(tmp,'bin')+':'+process.env.PATH,OPENADE_PROVIDER_HOME:path.join(tmp,'provider-home'),OPENADE_AUTH_TOKEN:token},stdio:'ignore'});
 const wait=()=>expect.poll(async()=>{try{return(await fetch(base+'/api/health')).status;}catch{return 0;}}).toBe(200);
 const send=(url:string,method='GET',body?:unknown)=>fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const stop=async(child:ReturnType<typeof launch>)=>{if(child.exitCode!==null)return;const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGTERM');await ended;};
 let child=launch();try{await wait();const response=await send('/api/sessions','POST',{title:'Recover linked agent',prompt:'subagent held',agent:'codex',repo_root:path.join(tmp,'fixture-repo'),base_branch:'main'});expect(response.status).toBe(201);const s=await response.json();await expect.poll(async()=>(await(await send(`/api/sessions/${s.id}`)).json()).status).toBe('completed');
 const parent=fs.readFileSync(path.join(data,'transcripts',s.id+'.log'),'utf8');const spawn=parent.split('\n').filter(Boolean).map(line=>JSON.parse(line)).find(event=>event.type==='openade.subagent');expect(spawn).toBeTruthy();const endpoint=`/api/sessions/${s.id}/subagents/${spawn.doc_id}`;await expect.poll(async()=>(await(await send(endpoint)).json()).status).toBe('running');
 await stop(child);child=launch();await wait();const doc=await(await send(endpoint)).json();expect(doc.status).toBe('interrupted');expect(doc.output).toContain('Child is working.');expect(doc.child_thread_id).toBe('child-turn-1');
 }finally{await stop(child);}
});
test('reused provider item IDs in later turns still create independent child documents',async({request})=>{
 const s=await create(request,'Two linked turns',{prompt:'subagent early'});await expect.poll(()=>status(request,s.id)).toBe('completed');
 expect((await request.post(`${daemon}/api/sessions/${s.id}/messages`,{data:{text:'subagent early again'}})).status()).toBe(202);await expect.poll(()=>status(request,s.id)).toBe('completed');
 const events=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(event=>event.type==='openade.subagent');expect(events).toHaveLength(2);expect(events[0].doc_id).not.toBe(events[1].doc_id);
 for(const [index,event] of events.entries()){const doc=await(await request.get(`${daemon}/api/sessions/${s.id}/subagents/${event.doc_id}`)).json();expect(doc.child_thread_id).toBe(`child-turn-${index+1}`);expect(doc.status).toBe('done');}
});
test('sibling child streams stay bound to their own spawn cards',async({request,page})=>{
 const s=await create(request,'Sibling linked agents',{prompt:'subagent siblings'});await expect.poll(()=>status(request,s.id)).toBe('completed');
 const events=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(event=>event.type==='openade.subagent');expect(events).toHaveLength(2);expect(events.map(event=>event.title)).toEqual(['Inspect alpha','Inspect beta']);
 const docs=[];for(const event of events){const endpoint=`${daemon}/api/sessions/${s.id}/subagents/${event.doc_id}`;await expect.poll(async()=>(await(await request.get(endpoint)).json()).status).toBe('done');docs.push(await(await request.get(endpoint)).json());}
 expect(docs[0].output).toContain('alpha report');expect(docs[0].output).not.toContain('beta report');expect(docs[1].output).toContain('beta report');expect(docs[1].output).not.toContain('alpha report');
 await ready(page);await open(page,'Sibling linked agents');await expect(page.getByRole('button',{name:/Open agent/})).toHaveCount(2);await page.getByRole('button',{name:'Open agent Inspect beta'}).click();const panel=page.getByLabel('Agent panel');await expect(panel).toContainText('beta report');await expect(panel).not.toContainText('alpha report');
 await page.getByRole('button',{name:'Open agent Inspect alpha'}).click();await expect(panel.getByRole('tab')).toHaveCount(2);await expect(panel).toContainText('alpha report');await panel.getByRole('tab',{name:'Inspect beta'}).click();await expect(panel).toContainText('beta report');
 const other=await create(request,'Different chat for agent tabs');await expect.poll(()=>status(request,other.id)).toBe('completed');await open(page,'Different chat for agent tabs');await open(page,'Sibling linked agents');await expect(page.getByRole('tab',{name:'Inspect alpha'})).toBeVisible();await expect(page.getByRole('tab',{name:'Inspect beta'})).toHaveAttribute('aria-selected','true');
});
test('a completed child reopens as a separate answer when the parent sends a follow-up',async({request,page})=>{
 const s=await create(request,'Child follow-up turn',{prompt:'subagent early'});await expect.poll(()=>status(request,s.id)).toBe('completed');
 const parent=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');const spawn=parent.split('\n').filter(Boolean).map(line=>JSON.parse(line)).find(event=>event.type==='openade.subagent');const endpoint=`${daemon}/api/sessions/${s.id}/subagents/${spawn.doc_id}`;
 await ready(page);await open(page,'Child follow-up turn');await page.getByRole('button',{name:'Open agent Inspect the fixture child'}).click();const panel=page.getByLabel('Agent panel');await expect(panel.locator('.chat-assistant-turn')).toHaveCount(1);await expect(panel).toContainText('Finished early.');
 expect((await request.post(`${daemon}/api/sessions/${s.id}/messages`,{data:{text:'resume-child held'}})).status()).toBe(202);await expect.poll(()=>status(request,s.id)).toBe('completed');await expect.poll(async()=>(await(await request.get(endpoint)).json()).status).toBe('running');
 await expect(page.getByRole('button',{name:'Open agent Inspect the fixture child'})).toContainText('Working');await expect(panel.locator('.chat-assistant-turn')).toHaveCount(2);await expect(panel.locator('.chat-assistant-turn').nth(1)).toContainText('Second assignment is running.');await expect(page.getByRole('button',{name:/Open agent/})).toHaveCount(1);
 fs.writeFileSync(path.join(tmp,'provider-home/rpc-log',s.id+'.release-revisit'),'go');await expect.poll(async()=>(await(await request.get(endpoint)).json()).status).toBe('done');await expect(panel.locator('.chat-assistant-turn').nth(1)).toContainText('Second assignment finished.');await expect(page.locator('.conversation .activity-group').last()).toContainText('Send agent message');
 const output=(await(await request.get(endpoint)).json()).output;expect((output.match(/"type":"openade.child_turn_started"/g)||[])).toHaveLength(2);expect((output.match(/"type":"turn.completed"/g)||[])).toHaveLength(2);expect((output.match(/"type":"openade.user_message"/g)||[])).toHaveLength(1);expect(output).not.toContain('STALE_AFTER_DONE');
});
test('a nested spawn is a visible non-link agent card inside its owning child transcript',async({request,page})=>{
 const s=await create(request,'Nested agent fallback',{prompt:'subagent nested'});await expect.poll(()=>status(request,s.id)).toBe('completed');
 await ready(page);await open(page,'Nested agent fallback');await page.getByRole('button',{name:'Open agent Inspect the fixture child'}).click();const panel=page.getByLabel('Agent panel');const nested=panel.getByRole('note',{name:'Agent Inspect nested dependency'});await expect(nested).toContainText('Spawned');await expect(panel.getByRole('button',{name:'Open agent Inspect nested dependency'})).toHaveCount(0);await expect(panel).toContainText('Child is working.');
 const parent=fs.readFileSync(path.join(tmp,'data/transcripts',s.id+'.log'),'utf8');expect(parent).not.toContain('grandchild-turn');expect(parent.match(/"type":"openade.subagent"/g)).toHaveLength(1);
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
 await send(`/api/sessions/${s.id}/messages`,'POST',{text:'context-window-only'});await expect.poll(async()=>(await(await send(`/api/sessions/${s.id}`)).json()).status).toBe('completed');await expect.poll(async()=>(await(await send(`/api/sessions/${s.id}/provider-state`)).json()).context).toEqual({tokens:32000,window:200000});
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
 const s=await create(request,'Question materials',{prompt:'question materials'});try{await ready(page);await open(page,'Question materials');await expect(page.getByRole('dialog',{name:'Your input is needed'})).toBeVisible();await page.getByLabel('Open settings').click();await page.getByRole('tab',{name:'Appearance',exact:true}).click();await choose(page,'Glass','frosted');await page.getByRole('button',{name:'Back',exact:true}).click();const form=page.getByRole('dialog',{name:'Your input is needed'});await expect(form).toHaveCSS('opacity','1');const reduced=await page.evaluate(()=>matchMedia('(prefers-reduced-transparency: reduce)').matches);expect(await form.evaluate(el=>getComputedStyle(el,'::before').backdropFilter)).toBe(reduced?'none':'blur(16px)');const alpha=await form.evaluate(el=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d')!;ctx.fillStyle=getComputedStyle(el,'::before').backgroundColor;ctx.fillRect(0,0,1,1);return ctx.getImageData(0,0,1,1).data[3];});if(reduced)expect(alpha).toBe(255);else expect(alpha).toBeLessThan(255);
 await page.getByLabel('Open settings').click();await page.getByRole('tab',{name:'Appearance',exact:true}).click();await choose(page,'Glass','opaque');await page.getByRole('button',{name:'Back',exact:true}).click();await expect(form).toHaveCSS('opacity','1');expect(await form.evaluate(el=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d')!;ctx.fillStyle=getComputedStyle(el,'::before').backgroundColor;ctx.fillRect(0,0,1,1);return ctx.getImageData(0,0,1,1).data[3];})).toBe(255);await expect(page.getByRole('button',{name:'Context usage —'})).toHaveCount(0);}finally{await request.post(`${daemon}/api/sessions/${s.id}/stop`);}
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
