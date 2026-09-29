import {expect} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import net from "node:net";
import {test,create,daemon,tmp,status,ready,choose,token} from "./helpers";

type CursorCommand={op:string;prompt?:string;model?:string;resume?:string};
const log=(id:string):CursorCommand[]=>fs.readFileSync(path.join(tmp,"provider-home/cursor-events",id+".jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line));
const freePort=()=>new Promise<number>((resolve,reject)=>{const server=net.createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const address=server.address();if(!address||typeof address==="string"){server.close();reject(Error("No local port"));return;}server.close(()=>resolve(address.port));});});

test("Cursor SDK driver discovers models, resumes turns and changes model through its own wire",async({request,page})=>{
  const meta=(await(await request.get(`${daemon}/api/meta`)).json()).agents as {id:string;available:boolean;path:string;adapter_version?:string;capabilities:{transport:string;native_chat:boolean;resume:boolean;direct_tui:boolean}}[];
  const cursor=meta.find(item=>item.id==="cursor")!;
  expect(cursor).toMatchObject({available:true,path:path.join(tmp,"bin","cursor-shim"),capabilities:{transport:"cursor-sdk-jsonl",native_chat:true,resume:true,direct_tui:false}});
  expect(cursor.adapter_version).toBe("custom override (unverified)");
  const catalog=await request.get(`${daemon}/api/providers/cursor/models`);
  expect(catalog.status()).toBe(200);
  expect((await catalog.json()).models.map((item:{id:string})=>item.id)).toEqual(["auto-smart","cursor-pro"]);
  const unadvertised=await request.post(`${daemon}/api/sessions`,{data:{title:"Invalid Cursor model",prompt:"Do not run",agent:"cursor",mode:"chat",repo_root:"",model:"not-offered"}});
  expect(unadvertised.status()).toBe(400);
  const unsupportedTUI=await request.post(`${daemon}/api/sessions`,{data:{title:"Cursor TUI",prompt:"Do not run",agent:"cursor",mode:"tui",repo_root:""}});
  expect(unsupportedTUI.status()).toBe(400);
  const session=await create(request,"Cursor first turn",{agent:"cursor",repo_root:""});
  await expect.poll(()=>status(request,session.id)).toBe("completed");
  expect((await(await request.get(`${daemon}/api/sessions/${session.id}`)).json()).provider_session_id).toBe(`cursor-${session.id}`);
  const transcript=fs.readFileSync(path.join(tmp,"data/transcripts",session.id+".log"),"utf8");
  expect(transcript).toContain("Cursor SDK fixture: Cursor first turn");
  expect(transcript).toContain('"openade.tool"');
  expect(log(session.id).filter(frame=>frame.op==="run")).toHaveLength(1);
  expect((await request.post(`${daemon}/api/sessions/${session.id}/messages`,{data:{text:"Cursor follow up"}})).status()).toBe(202);
  await expect.poll(async()=>{const current=(await(await request.get(`${daemon}/api/sessions/${session.id}`)).json());return current.status==="completed"?current.generation:0;}).toBe(2);
  expect(log(session.id).filter(frame=>frame.op==="run")).toHaveLength(1);
  expect(log(session.id).filter(frame=>frame.op==="user")).toHaveLength(1);
  const changed=await request.post(`${daemon}/api/sessions/${session.id}/model`,{data:{model:"cursor-pro",effort:"",service_tier:""}});
  expect(changed.status(),await changed.text()).toBe(200);
  expect((await request.post(`${daemon}/api/sessions/${session.id}/messages`,{data:{text:"Selected Cursor model"}})).status()).toBe(202);
  await expect.poll(async()=>{const current=(await(await request.get(`${daemon}/api/sessions/${session.id}`)).json());return current.status==="completed"?current.generation:0;}).toBe(3);
  expect(log(session.id).filter(frame=>frame.op==="run").at(-1)).toMatchObject({model:"cursor-pro",resume:`cursor-${session.id}`});
  await ready(page);await choose(page,"Choose project","");await choose(page,"Provider","cursor");
  await page.getByLabel("Choose model").click();
  await expect(page.getByRole("option",{name:/Cursor Pro/})).toBeVisible();
  await page.getByRole("option",{name:/Cursor Pro/}).click();
  await expect(page.getByLabel("Choose model")).toContainText("Cursor Pro");
  const before=new Set(((await(await request.get(`${daemon}/api/sessions`)).json()).sessions as {id:string}[]).map(item=>item.id));
  await page.getByLabel("New session prompt").fill("Cursor UI turn");
  await page.getByRole("button",{name:"Start session"}).click();
  await expect(page.getByText("Cursor SDK fixture: Cursor UI turn")).toBeVisible();
  await expect(page.getByLabel("Session message")).toBeVisible();
  await expect(page.locator(".activity-group summary").first()).toContainText("Thought process · read 1 file");
  await expect(page.locator(".activity-group summary").first()).not.toContainText("openade.usage");
  const created=((await(await request.get(`${daemon}/api/sessions`)).json()).sessions as {id:string;agent:string}[]).find(item=>item.agent==="cursor"&&!before.has(item.id));
  expect(created).toBeTruthy();
  expect((await request.delete(`${daemon}/api/sessions/${created!.id}`)).status()).toBe(204);
  expect((await request.delete(`${daemon}/api/sessions/${session.id}`)).status()).toBe(204);
});

test("Cursor SDK cancellation settles the turn and releases its process",async({request})=>{
  const baseline=(await(await request.get(`${daemon}/api/diagnostics`)).json()).provider_connections as number;
  const session=await create(request,"wait-cursor",{agent:"cursor",repo_root:""});
  await expect.poll(()=>status(request,session.id)).toBe("running");
  expect((await request.post(`${daemon}/api/sessions/${session.id}/stop`)).status()).toBe(204);
  await expect.poll(()=>status(request,session.id)).toBe("stopped");
  expect(log(session.id).some(frame=>frame.op==="interrupt")).toBe(true);
  expect((await request.delete(`${daemon}/api/sessions/${session.id}`)).status()).toBe(204);
  await expect.poll(async()=>((await(await request.get(`${daemon}/api/diagnostics`)).json()).provider_connections)).toBeLessThanOrEqual(baseline);
});

test("Cursor SDK authentication failure is visible and does not leave a running turn",async({request})=>{
  const session=await create(request,"fail-cursor-auth",{agent:"cursor",repo_root:""});
  await expect.poll(()=>status(request,session.id)).toBe("failed");
  const transcript=fs.readFileSync(path.join(tmp,"data/transcripts",session.id+".log"),"utf8");
  expect(transcript).toContain("Cursor SDK is not connected; set CURSOR_API_KEY.");
  expect((await request.delete(`${daemon}/api/sessions/${session.id}`)).status()).toBe(204);
});

test("Cursor SDK restores its own conversation identity after daemon restart",async()=>{
  const port=await freePort(),base=`http://127.0.0.1:${port}`,data=path.join(tmp,"cursor-restart"),headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
  const launch=()=>spawn(path.join(tmp,"openade-e2e"),["--daemon","--addr",`127.0.0.1:${port}`,"--data-dir",data],{env:{...process.env,PATH:path.join(tmp,"bin")+":"+process.env.PATH,OPENADE_PROVIDER_HOME:path.join(tmp,"provider-home"),OPENADE_CURSOR_SHIM_EXECUTABLE:path.join(tmp,"bin","cursor-shim"),OPENADE_AUTH_TOKEN:token},stdio:"ignore"});
  const wait=()=>expect.poll(async()=>{try{return(await fetch(base+"/api/health")).status;}catch{return 0;}}).toBe(200);
  const send=(url:string,method="GET",body?:unknown)=>fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const stop=async(child:ReturnType<typeof launch>)=>{if(child.exitCode!==null)return;const ended=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.kill("SIGTERM");await ended;};
  let child=launch();
  try{
    await wait();
    const response=await send("/api/sessions","POST",{title:"Cursor restart",prompt:"Before restart",agent:"cursor",mode:"chat",repo_root:""});
    expect(response.status).toBe(201);
    const session=await response.json();
    await expect.poll(async()=>(await(await send(`/api/sessions/${session.id}`)).json()).status).toBe("completed");
    await stop(child);child=launch();await wait();
    const resumed=await send(`/api/sessions/${session.id}/messages`,"POST",{text:"After restart"});
    expect(resumed.status,await resumed.text()).toBe(202);
    await expect.poll(async()=>{const current=await(await send(`/api/sessions/${session.id}`)).json();return current.status==="completed"?current.generation:0;}).toBe(2);
    const frames=log(session.id);
    expect(frames.filter(frame=>frame.op==="run")).toHaveLength(2);
    expect(frames.filter(frame=>frame.op==="run").at(-1)).toMatchObject({resume:`cursor-${session.id}`,prompt:"After restart"});
    expect((await(await send(`/api/sessions/${session.id}`)).json()).provider_session_id).toBe(`cursor-${session.id}`);
  }finally{await stop(child);}
});
