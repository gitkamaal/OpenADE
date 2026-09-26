import { test } from "./helpers";
import { expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { create,daemon,otherRepo,repo,status,tmp } from "./helpers";
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
 const domNodes=await page.locator(".chat-timeline article").count();const cdp=await context.newCDPSession(page);await cdp.send("Performance.enable");const metrics=(await cdp.send("Performance.getMetrics")).metrics as {name:string;value:number}[];const rendererHeap=metrics.find(metric=>metric.name==="JSHeapUsedSize")?.value;
 await page.getByRole("button",{name:"Home",exact:true}).click();const health=await(await request.get(`${daemon}/api/health`)).json();const ps=execFileSync("ps",["-p",String(health.pid),"-o","rss=,%cpu="],{encoding:"utf8"}).trim().split(/\s+/).map(Number);const diagnosticsResponse=await request.get(`${daemon}/api/diagnostics`);const diagnostics=diagnosticsResponse.ok()?await diagnosticsResponse.json():null;
 const streaming:number[]=[];for(let i=0;i<5;i++){const session=await create(request,`Streaming performance ${i}`,{agent:"claude",prompt:"streaming fixture"});await page.getByRole("button",{name:"Sessions",exact:true}).click();const start=performance.now();await page.getByRole("button",{name:new RegExp(`Streaming performance ${i}`)}).first().click();await expect(page.getByText(/Native chat streams correctly/).first()).toBeVisible();streaming.push(performance.now()-start);}
 const report={variant:baseline?"baseline":"rebuilt",environment:{frontend:"production Vite build in Chromium; actual Go daemon; synthetic provider CLIs",nativeLatencyMeasured:false,agentMemoryIncluded:false},workload:{sessions:24,projects:2,historicalTurns:260},coldReady:{samples:cold,p50:percentile(cold,.5),p95:percentile(cold,.95)},warmReady:{samples:warm,p50:percentile(warm,.5),p95:percentile(warm,.95)},inputToTwoFrames:{samples:input,p95:percentile(input,.95)},sessionSwitch:{samples:switches,p95:percentile(switches,.95)},streamFirstVisible:{samples:streaming,p95:percentile(streaming,.95)},engine:{rssKiB:ps[0],cpuPercent:ps[1],diagnostics},rendererHeapBytes:rendererHeap,timelineArticleCount:domNodes};
 const output=process.env.OPENADE_PERF_OUTPUT??testInfo.outputPath("performance.json");fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));await testInfo.attach("performance",{path:output,contentType:"application/json"});
 if(!baseline){expect(domNodes).toBeLessThanOrEqual(80);expect(report.inputToTwoFrames.p95).toBeLessThan(150);expect(report.sessionSwitch.p95).toBeLessThan(600);expect(report.engine.diagnostics.stream_clients).toBe(0);}
 await context.close();
});
