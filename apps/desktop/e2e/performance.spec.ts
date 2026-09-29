import { test } from "./helpers";
import { expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { create,daemon,open,otherRepo,panel,ready,repo,status,tmp,token } from "./helpers";
const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)];
test("repeatable production-client performance with multiple projects and long inactive transcripts",async({browser,request},testInfo)=>{
 test.setTimeout(180000);const baseline=Boolean(process.env.OPENADE_E2E_SOURCE);const sessions=[];
 for(let i=0;i<24;i++){sessions.push(await create(request,`Performance session ${i}`,{repo_root:i%2?otherRepo:repo,prompt:i===0?"long-transcript":"Short performance fixture"}));}
 await expect.poll(()=>status(request,sessions[0].id)).toBe("completed");
 const cold:number[]=[],warm:number[]=[];
 for(let i=0;i<5;i++){const context=await browser.newContext();const page=await context.newPage();const start=performance.now();await page.goto("http://127.0.0.1:5199");await expect(page.locator(".ade")).toHaveAttribute("data-connected","true");cold.push(performance.now()-start);const reload=performance.now();await page.reload();await expect(page.locator(".ade")).toHaveAttribute("data-connected","true");warm.push(performance.now()-reload);await context.close();}
 const context=await browser.newContext();const page=await context.newPage();await page.goto("http://127.0.0.1:5199");await expect(page.locator(".ade")).toHaveAttribute("data-connected","true");
 await page.evaluate(()=>{const samples:number[]=[];Object.assign(window,{__inputSamples:samples});document.addEventListener("keydown",()=>{const start=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>samples.push(performance.now()-start)));});});
 const composer=page.locator("[data-main-composer]");await composer.pressSequentially("Measure input responsiveness in a real client",{delay:25});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const input=await page.evaluate(()=>(window as typeof window & {__inputSamples:number[]}).__inputSamples);
 const switches:number[]=[];
 // Use the actual session buttons; expansion remains a user-visible navigation action.
 for(let i=0;i<12;i++){
   await page.getByRole("button",{name:"Sessions",exact:true}).click();const started=performance.now();await page.getByRole("button",{name:new RegExp(`Performance session ${23-i}`)}).first().click();await expect(page.locator(".session-title h1")).toHaveText(`Performance session ${23-i}`);switches.push(performance.now()-started);}
 await page.getByRole("button",{name:"Sessions",exact:true}).click();await page.getByRole("button",{name:/Performance session 0\b/}).first().click();await expect(page.getByRole("heading",{name:"Native chat response",exact:true})).toBeVisible();
 const domNodes=await page.locator(".chat-timeline article").count();const cdp=await context.newCDPSession(page);await cdp.send("Performance.enable");const metrics=(await cdp.send("Performance.getMetrics")).metrics as {name:string;value:number}[];const rendererHeap=metrics.find(metric=>metric.name==="JSHeapUsedSize")?.value;await cdp.send("HeapProfiler.collectGarbage");const collectedMetrics=(await cdp.send("Performance.getMetrics")).metrics as {name:string;value:number}[];const rendererRetainedHeap=collectedMetrics.find(metric=>metric.name==="JSHeapUsedSize")?.value;
 await page.getByRole("button",{name:"Home",exact:true}).click();const health=await(await request.get(`${daemon}/api/health`)).json();const ps=execFileSync("ps",["-p",String(health.pid),"-o","rss=,%cpu="],{encoding:"utf8"}).trim().split(/\s+/).map(Number);const diagnosticsResponse=await request.get(`${daemon}/api/diagnostics`);const diagnostics=diagnosticsResponse.ok()?await diagnosticsResponse.json():null;
 const streaming:number[]=[];for(let i=0;i<5;i++){const session=await create(request,`Streaming performance ${i}`,{agent:"claude",prompt:"streaming fixture"});await page.getByRole("button",{name:"Sessions",exact:true}).click();const start=performance.now();await page.getByRole("button",{name:new RegExp(`Streaming performance ${i}`)}).first().click();await expect(page.getByText(/Native chat streams correctly/).first()).toBeVisible();streaming.push(performance.now()-start);}
 const report={variant:baseline?"baseline":"rebuilt",environment:{frontend:"production Vite build in Chromium; actual Go daemon; synthetic provider CLIs",nativeLatencyMeasured:false,agentMemoryIncluded:false},workload:{sessions:24,projects:2,historicalTurns:260},coldReady:{samples:cold,p50:percentile(cold,.5),p95:percentile(cold,.95)},warmReady:{samples:warm,p50:percentile(warm,.5),p95:percentile(warm,.95)},inputToTwoFrames:{samples:input,p50:percentile(input,.5),p95:percentile(input,.95)},sessionSwitch:{samples:switches,p50:percentile(switches,.5),p95:percentile(switches,.95)},streamFirstVisible:{samples:streaming,p50:percentile(streaming,.5),p95:percentile(streaming,.95)},engine:{rssKiB:ps[0],cpuPercent:ps[1],diagnostics},rendererHeapBytes:rendererHeap,rendererRetainedHeapBytes:rendererRetainedHeap,timelineArticleCount:domNodes};
 const output=process.env.OPENADE_PERF_OUTPUT??testInfo.outputPath("performance.json");fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));await testInfo.attach("performance",{path:output,contentType:"application/json"});
 if(!baseline){expect(domNodes).toBeLessThanOrEqual(80);expect(report.inputToTwoFrames.p95).toBeLessThan(150);expect(report.sessionSwitch.p95).toBeLessThan(600);expect(report.engine.diagnostics.stream_clients).toBe(0);}
 await context.close();
});

test("active streamed chat remains visible when its transcript passes the scrollback bound",async({page,request},testInfo)=>{
 test.setTimeout(240000);
 const size=Number(process.env.OPENADE_SCROLLBACK_STRESS??0),historical=size>=2?1700:size>=1?950:380;
 const session=await create(request,"Sliding transcript workload",{agent:"claude",prompt:size>=2?"sliding-transcript-overflow":size>=1?"sliding-transcript-stress":"sliding-transcript"});
 const gate=path.join(tmp,"provider-home","sliding-transcript-"+session.id);
 try{
  await ready(page);await open(page,"Sliding transcript workload");
  await expect.poll(()=>fs.existsSync(gate+".ready")).toBe(true);
  await expect(page.locator(".chat-assistant-turn").last()).toContainText(`Historical answer ${historical-1}`);
  await page.locator(".messages").hover();await page.mouse.wheel(0,-100000);
  await expect(page.getByRole("button",{name:"Jump to latest"})).toBeVisible();
  await page.getByRole("button",{name:"Jump to latest"}).click();
  await expect.poll(()=>page.locator(".messages").evaluate(node=>node.scrollHeight-node.scrollTop-node.clientHeight),{timeout:3000}).toBeLessThan(80);
  await page.evaluate(()=>{const frames:number[]=[];let previous=performance.now(),running=true;const tick=(now:number)=>{if(!running)return;frames.push(now-previous);previous=now;requestAnimationFrame(tick);};requestAnimationFrame(tick);(window as typeof window&{__stopFrameProbe?:()=>number[]}).__stopFrameProbe=()=>{running=false;return frames;};});
  fs.writeFileSync(gate+".go","");
  await expect(page.locator(".chat-assistant-turn").last()).toContainText("Latest visible answer.");
  await expect.poll(()=>status(request,session.id)).toBe("completed");
  const frames=await page.evaluate(()=>(window as typeof window&{__stopFrameProbe:()=>number[]}).__stopFrameProbe());
  const transcriptBytes=fs.statSync(path.join(tmp,"data","transcripts",session.id+".log")).size;
  expect(transcriptBytes).toBeGreaterThan(2_000_000);
  if(size>=2)expect(transcriptBytes).toBeGreaterThan(8*1024*1024);
  const replay=await page.evaluate(({id,token})=>new Promise<{first:string;offset:number;cursor:number}>((resolve,reject)=>{const socket=new WebSocket(`ws://127.0.0.1:7455/api/sessions/${id}/stream?token=${encodeURIComponent(token)}`);const timer=setTimeout(()=>{socket.close();reject(Error("replay timed out"));},10000);socket.onmessage=event=>{const frame=JSON.parse(String(event.data)) as {type:string;data:string;offset:number;cursor:number};if(frame.type!=="output")return;clearTimeout(timer);socket.close();resolve({first:frame.data.slice(0,32),offset:frame.offset,cursor:frame.cursor});};socket.onerror=()=>{clearTimeout(timer);reject(Error("replay failed"));};}),{id:session.id,token});
  expect(replay.first.startsWith("{")).toBe(true);
  expect(replay.cursor).toBe(transcriptBytes);
  expect(fs.readFileSync(path.join(tmp,"data","transcripts",session.id+".log"))[replay.offset-1]).toBe(10);
  const report={environment:"Production Vite in Chromium; actual Go daemon and synthetic Claude, not native frame timing",historicalTurns:historical+90,transcriptBytes,frames:frames.length,frameIntervalP50Ms:percentile(frames,.5),frameIntervalP95Ms:percentile(frames,.95),frameIntervalMaxMs:Math.max(...frames)};
  const output=process.env.OPENADE_SCROLLBACK_PERF_OUTPUT??testInfo.outputPath("scrollback-performance.json");fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));await testInfo.attach("scrollback-performance",{path:output,contentType:"application/json"});
  expect(await page.locator(".chat-timeline article").count()).toBeLessThanOrEqual(80);
  await page.reload();await expect(page.locator(".chat-assistant-turn").last()).toContainText("Latest visible answer.");
  await page.locator(".messages").hover();await page.mouse.wheel(0,-100000);
  await expect(page.getByRole("button",{name:"Jump to latest"})).toBeVisible();
  await page.getByRole("button",{name:"Jump to latest"}).click();
  await expect.poll(()=>page.locator(".messages").evaluate(node=>node.scrollHeight-node.scrollTop-node.clientHeight),{timeout:3000}).toBeLessThan(80);
  await page.locator(".messages").click({position:{x:5,y:5}});
  await expect(page.getByRole("button",{name:"Jump to latest"})).toHaveCount(0);
  await page.getByRole("button",{name:"Collapse sidebar"}).click();
  await expect.poll(()=>page.locator(".ade").evaluate(node=>Number.parseFloat(getComputedStyle(node).gridTemplateColumns))).toBeLessThan(1);
  await expect.poll(()=>page.locator(".messages").evaluate(node=>node.scrollHeight-node.scrollTop-node.clientHeight),{timeout:3000}).toBeLessThan(80);
  await page.getByRole("button",{name:"Toggle sidebar"}).click();
  await expect.poll(()=>page.locator(".ade").evaluate(node=>Number.parseFloat(getComputedStyle(node).gridTemplateColumns))).toBeGreaterThan(255);
  await expect.poll(()=>page.locator(".messages").evaluate(node=>node.scrollHeight-node.scrollTop-node.clientHeight),{timeout:3000}).toBeLessThan(80);
  await page.getByLabel("Toggle right sidebar").click();
  await page.getByLabel("Toggle files panel").click();
  await expect.poll(()=>page.locator(".messages").evaluate(node=>node.scrollHeight-node.scrollTop-node.clientHeight),{timeout:3000}).toBeLessThan(80);
  await page.getByRole("button",{name:"Show earlier messages"}).click();
  await expect(page.locator(".messages")).not.toHaveClass(/jump-layout/);
  await page.getByRole("button",{name:"Collapse sidebar"}).click();
  await expect.poll(()=>page.locator(".ade").evaluate(node=>Number.parseFloat(getComputedStyle(node).gridTemplateColumns))).toBeLessThan(1);
  await expect(page.getByRole("button",{name:"Jump to latest"})).toBeVisible();
  let historyReads=0;
  page.on("response",response=>{if(response.url().includes(`/api/sessions/${session.id}/transcript-page`)&&response.status()===200)historyReads++;});
  for(let index=0;index<80&&await page.getByText(/Historical answer 0 detail/).count()===0;index++){
   const earlier=page.getByRole("button",{name:"Show earlier messages"});
   await expect(earlier).toBeEnabled();await earlier.click();
   await expect(page.locator(".chat-timeline article")).not.toHaveCount(0);
   await expect.poll(()=>page.locator(".chat-timeline article").count()).toBeLessThanOrEqual(80);
   await expect(page.getByRole("button",{name:"Loading earlier messages…"})).toHaveCount(0);
  }
  await expect(page.getByText(/Historical answer 0 detail/)).toBeVisible();
  expect(historyReads).toBeGreaterThan(0);
  await page.getByRole("button",{name:"Show newer messages"}).click();
  await expect(page.locator(".chat-timeline article")).not.toHaveCount(0);
  if(size>=2){
   const readsBefore=historyReads;
   for(let index=0;index<80&&await page.getByRole("button",{name:"Show newer messages"}).count()>0;index++){
    const newer=page.getByRole("button",{name:"Show newer messages"});await expect(newer).toBeEnabled();await newer.click();
    await expect(page.getByRole("button",{name:"Loading messages…"})).toHaveCount(0);
    await expect.poll(()=>page.locator(".chat-timeline article").count()).toBeLessThanOrEqual(80);
   }
   expect(historyReads).toBeGreaterThan(readsBefore);
   await expect(page.locator(".chat-assistant-turn").last()).toContainText("Latest visible answer.");
  }
  await page.getByRole("button",{name:"Jump to latest"}).click();
  await expect(page.locator(".chat-assistant-turn").last()).toContainText("Latest visible answer.");
  await expect.poll(()=>page.locator(".messages").evaluate(node=>node.scrollHeight-node.scrollTop-node.clientHeight),{timeout:3000}).toBeLessThan(80);
  let before:number|undefined;const pages:Buffer[]=[];
  do{
   const response=await request.get(`${daemon}/api/sessions/${session.id}/transcript-page${before===undefined?"":`?before=${before}`}`);
   expect(response.status()).toBe(200);
   expect(response.headers()["cache-control"]).toBe("no-store");
   const chunk=await response.json() as {data:string;offset:number;cursor:number;has_more:boolean};
   const bytes=Buffer.from(chunk.data,"base64");expect(bytes.length).toBeLessThanOrEqual(1024*1024);
   expect(chunk.cursor-chunk.offset).toBe(bytes.length);
   pages.unshift(bytes);before=chunk.offset;
   if(!chunk.has_more)break;
  }while(before>0);
  expect(Buffer.concat(pages)).toEqual(fs.readFileSync(path.join(tmp,"data","transcripts",session.id+".log")));
  expect((await request.get(`${daemon}/api/sessions/${session.id}/transcript-page?before=-1`)).status()).toBe(400);
  expect((await request.get(`${daemon}/api/sessions/${session.id}/transcript-page`,{headers:{Authorization:"Bearer invalid"}})).status()).toBe(401);
  expect((await request.get(`${daemon}/api/sessions/not-a-session/transcript-page`)).status()).toBe(404);
 }finally{fs.writeFileSync(gate+".go","");await request.post(`${daemon}/api/sessions/${session.id}/stop`);}
});

test("browser, terminal and panel cycles release renderer and daemon resources",async({page,request},testInfo)=>{
 test.setTimeout(120000);const baseline=Boolean(process.env.OPENADE_E2E_SOURCE);
 const session=await create(request,"Resource cycle fixture");await expect.poll(()=>status(request,session.id)).toBe("completed");
 const site=createServer((_req,res)=>{res.setHeader("Content-Type","text/html");res.end("<title>Local fixture</title><h1>Local browser fixture</h1>");});
 await new Promise<void>(resolve=>site.listen(0,"127.0.0.1",resolve));
 const address=site.address();if(!address||typeof address==="string")throw Error("No local fixture port");
 const url=`http://127.0.0.1:${address.port}/`;
 const cycles:number[]=[];
 try{
  await ready(page);await open(page,"Resource cycle fixture");await panel(page,"Browser");
  await page.locator(".browser-panel:visible").getByLabel("Website address").fill(url);
  await page.locator(".browser-panel:visible").getByRole("button",{name:"Go",exact:true}).click();
  await expect(page.locator(".browser-panel:visible").getByTitle("Workspace browser preview")).toHaveAttribute("src",url);
  for(let index=0;index<5;index++){
   const started=performance.now();
   await page.getByLabel("Close right sidebar").click();
   await page.setViewportSize({width:index%2?1280:1480,height:920});
   await page.getByLabel("Toggle right sidebar").click();
   await expect(page.locator(".browser-panel:visible").getByTitle("Workspace browser preview")).toHaveAttribute("src",url);
   cycles.push(performance.now()-started);
   const response=await request.post(`${daemon}/api/sessions/${session.id}/terminals`,{data:{title:`Cycle terminal ${index}`}});
   expect(response.status()).toBe(201);const terminal=await response.json();
   await panel(page,"Terminal");await expect(page.locator(".terminal-host:visible")).toBeVisible();
   expect((await request.post(`${daemon}/api/terminals/${terminal.id}/stop`)).status()).toBe(204);
   await expect.poll(async()=>(await(await request.get(`${daemon}/api/diagnostics`)).json()).live_terminals).toBe(0);
   await page.locator(".panel-tabs [role=tab]").first().click();
  }
  const cdp=await page.context().newCDPSession(page);await cdp.send("Performance.enable");await cdp.send("HeapProfiler.collectGarbage");
  const metrics=(await cdp.send("Performance.getMetrics")).metrics as {name:string;value:number}[];
  const retainedHeapBytes=metrics.find(metric=>metric.name==="JSHeapUsedSize")?.value;
  await page.close();
  if(!baseline)await expect.poll(async()=>(await(await request.get(`${daemon}/api/diagnostics`)).json()).activity_clients).toBe(0);
  const health=await(await request.get(`${daemon}/api/health`)).json();
  const ps=execFileSync("ps",["-p",String(health.pid),"-o","rss=,%cpu="],{encoding:"utf8"}).trim().split(/\s+/).map(Number);
  const handles=execFileSync("lsof",["-nP","-p",String(health.pid)],{encoding:"utf8"}).trim().split("\n").slice(1).map(line=>line.trim().split(/\s+/)).filter(parts=>/^\d+[a-z]*$/.test(parts[3]??""));
  const diagnostics=await(await request.get(`${daemon}/api/diagnostics`)).json();
  const report={variant:baseline?"baseline":"rebuilt",environment:"Chromium production client, actual Go daemon and synthetic providers; browser is an iframe fixture, not WKWebView",workload:{panelCycles:5,terminalStartsAndStops:5,browserTab:1,viewportWidths:[1280,1480]},panelCycleMs:{samples:cycles,p50:percentile(cycles,.5),p95:percentile(cycles,.95)},rendererRetainedHeapBytes:retainedHeapBytes,engine:{rssKiB:ps[0],cpuPercent:ps[1],fileDescriptors:handles.length,sockets:handles.filter(parts=>["IPv4","IPv6","unix"].includes(parts[4]??"")).length,diagnostics}};
  const output=process.env.OPENADE_RESOURCE_PERF_OUTPUT??testInfo.outputPath("resource-performance.json");fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));await testInfo.attach("resource-performance",{path:output,contentType:"application/json"});
  if(!baseline){expect(diagnostics.live_terminals).toBe(0);expect(diagnostics.stream_clients).toBe(0);expect(diagnostics.activity_clients).toBe(0);}
 }finally{await new Promise<void>(resolve=>site.close(()=>resolve()));}
});

test("large editor keeps review gutters viewport bounded",async({page,request},testInfo)=>{
 const session=await create(request,"Large editor review performance");await expect.poll(()=>status(request,session.id)).toBe("completed");
 const lines=Array.from({length:6000},(_,index)=>`export const value${index} = ${index};`);fs.writeFileSync(path.join(session.worktree_path,"large.ts"),lines.join("\n"));
 await ready(page);await open(page,"Large editor review performance");await page.getByLabel("Toggle files panel").click();await page.getByRole("treeitem",{name:"large.ts",exact:true}).click();await expect(page.getByLabel("Edit large.ts")).toBeVisible();
 const before=await page.locator(".cm-comment-gutter .cm-add-comment").count();
 const scrollTwoFramesMs=await page.locator(".code-editor-host .cm-scroller").evaluate(async node=>{const start=performance.now();node.scrollTop=node.scrollHeight;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return performance.now()-start;});
 await expect(page.getByRole("button",{name:"Add or view comment on line 6000"})).toBeVisible();
 const after=await page.locator(".cm-comment-gutter .cm-add-comment").count();
 const report={environment:"Production Vite in Chromium; Go daemon and synthetic provider, not native frame timing",fileLines:6000,visibleGutterButtonsBefore:before,visibleGutterButtonsAfter:after,scrollTwoFramesMs};
 const output=process.env.OPENADE_EDITOR_PERF_OUTPUT??testInfo.outputPath("editor-performance.json");fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));await testInfo.attach("editor-performance",{path:output,contentType:"application/json"});
 expect(before).toBeLessThan(160);expect(after).toBeLessThan(160);expect(scrollTwoFramesMs).toBeLessThan(1000);
});
