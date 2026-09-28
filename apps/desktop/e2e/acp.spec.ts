import {expect} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import net from "node:net";
import {test,create,daemon,tmp,status,ready,open,token} from "./helpers";

type Frame={method?:string;params?:Record<string,unknown>;result?:Record<string,unknown>;prompt?:string;sessionId?:string};
const log=(id:string):Frame[]=>fs.readFileSync(path.join(tmp,"provider-home/acp-events",id+".jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line));
const freePort=()=>new Promise<number>((resolve,reject)=>{const server=net.createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const address=server.address();if(!address||typeof address==="string"){server.close();reject(Error("No local port"));return;}server.close(()=>resolve(address.port));});});

test("all five pinned-source ACP entry points stream into independent native chats",async({request,page})=>{
  const rejected=await request.post(`${daemon}/api/sessions`,{data:{title:"Unsupported ACP model",prompt:"Do not send",agent:"grok",mode:"chat",repo_root:"",model:"unadvertised"}});
  expect(rejected.status()).toBe(400);
  const meta=(await(await request.get(`${daemon}/api/meta`)).json()).agents as {id:string;path:string;capabilities:{transport:string;native_chat:boolean;resume:boolean}}[];
  for(const agent of ["grok","devin","hermes","pi","antigravity"]){
    const provider=meta.find(item=>item.id===agent)!;
    expect(provider.capabilities).toMatchObject({transport:"acp-stdio",native_chat:true,resume:true});
    const baseline=(await(await request.get(`${daemon}/api/diagnostics`)).json()).provider_connections as number;
    const session=await create(request,`ACP ${agent}`,{agent});
    await expect.poll(()=>status(request,session.id)).toBe("completed");
    const transcript=fs.readFileSync(path.join(tmp,"data/transcripts",session.id+".log"),"utf8");
    expect(transcript.split("\n").filter(line=>line.includes('"openade.agent_delta"')).map(line=>JSON.parse(line).text).join("")).toBe("ACP native chat works.");
    expect(transcript).not.toContain("WRONG SESSION");
    const frames=log(session.id);
    expect(frames.find(frame=>frame.method==="initialize")?.params).toMatchObject({protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}});
    expect(frames.filter(frame=>frame.method==="session/new")).toHaveLength(1);
    expect(frames.filter(frame=>frame.method==="session/prompt")).toHaveLength(1);
    const response=await request.post(`${daemon}/api/sessions/${session.id}/messages`,{data:{text:`Follow up ${agent}`}});
    expect(response.status(),await response.text()).toBe(202);
    await expect.poll(async()=>{const s=(await(await request.get(`${daemon}/api/sessions/${session.id}`)).json());return s.status==="completed"?s.generation:0;}).toBe(2);
    expect(log(session.id).filter(frame=>frame.method==="initialize")).toHaveLength(1);
    expect(log(session.id).filter(frame=>frame.method==="session/prompt")).toHaveLength(2);
    expect((await(await request.get(`${daemon}/api/sessions/${session.id}`)).json()).provider_session_id).toBe(`acp-${session.id}`);
    if(agent==="grok"){
      await ready(page);await open(page,`ACP ${agent}`);
      await expect(page.locator(".activity-group summary").first()).toContainText("Thought");
      await expect(page.locator(".activity-group summary").first()).not.toContainText("0 tools");
    }
    expect((await request.delete(`${daemon}/api/sessions/${session.id}`)).status()).toBe(204);
    await expect.poll(async()=>((await(await request.get(`${daemon}/api/diagnostics`)).json()).provider_connections)).toBeLessThanOrEqual(baseline);
  }
});

test("ACP permission choices are visible, explicit and sent to the owning session",async({request,page})=>{
  const session=await create(request,"ask-permission from ACP",{agent:"devin"});
  await expect.poll(()=>status(request,session.id)).toBe("waiting");
  await ready(page);await open(page,"ask-permission from ACP");
  const dialog=page.getByRole("dialog",{name:"Agent permission"});
  await expect(dialog).toContainText("May I read the project?");
  const pending=(await(await request.get(`${daemon}/api/sessions/${session.id}/provider-state`)).json()).requests[0];
  await dialog.getByRole("button",{name:"Deny"}).click();
  await expect.poll(()=>status(request,session.id)).toBe("completed");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".activity-group summary").first()).toContainText("1 tool");
  expect((await(await request.get(`${daemon}/api/sessions/${session.id}/provider-state`)).json()).context).toEqual({tokens:80,window:128});
  expect((await request.post(`${daemon}/api/sessions/${session.id}/provider-requests/${pending.id}`,{data:{generation:pending.generation,answers:{choice:["Deny"]}}})).status()).toBe(409);
  expect(log(session.id).some(frame=>frame.result?.outcome&&JSON.stringify(frame.result.outcome).includes("deny-once"))).toBe(true);
  expect(fs.readFileSync(path.join(tmp,"data/transcripts",session.id+".log"),"utf8")).toContain("Permission result");
  expect((await request.delete(`${daemon}/api/sessions/${session.id}`)).status()).toBe(204);
});

test("ACP session/load restores the same provider conversation after daemon restart",async()=>{
  const port=await freePort(),base=`http://127.0.0.1:${port}`,data=path.join(tmp,"acp-restart"),headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
  const launch=()=>spawn(path.join(tmp,"openade-e2e"),["--daemon","--addr",`127.0.0.1:${port}`,"--data-dir",data],{env:{...process.env,PATH:path.join(tmp,"bin")+":"+process.env.PATH,OPENADE_PROVIDER_HOME:path.join(tmp,"provider-home"),OPENADE_AUTH_TOKEN:token},stdio:"ignore"});
  const wait=()=>expect.poll(async()=>{try{return(await fetch(base+"/api/health")).status;}catch{return 0;}}).toBe(200);
  const send=(url:string,method="GET",body?:unknown)=>fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const stop=async(child:ReturnType<typeof launch>)=>{if(child.exitCode!==null)return;const ended=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.kill("SIGTERM");await ended;};
  let child=launch();
  try{
    await wait();
    const response=await send("/api/sessions","POST",{title:"ACP restart",prompt:"Before restart",agent:"grok",mode:"chat",repo_root:""});
    expect(response.status).toBe(201);
    const session=await response.json();
    await expect.poll(async()=>(await(await send(`/api/sessions/${session.id}`)).json()).status).toBe("completed");
    await stop(child);child=launch();await wait();
    const resumed=await send(`/api/sessions/${session.id}/messages`,"POST",{text:"After restart"});
    expect(resumed.status,await resumed.text()).toBe(202);
    await expect.poll(async()=>{const current=await(await send(`/api/sessions/${session.id}`)).json();return current.status==="completed"?current.generation:0;}).toBe(2);
    const frames=log(session.id);
    expect(frames.filter(frame=>frame.method==="session/load")).toHaveLength(1);
    expect(frames.filter(frame=>frame.method==="session/new")).toHaveLength(1);
    expect(frames.filter(frame=>frame.method==="session/prompt")).toHaveLength(2);
    expect((await(await send(`/api/sessions/${session.id}`)).json()).provider_session_id).toBe(`acp-${session.id}`);
  }finally{await stop(child);}
});

test("Grok prompt-complete extension settles an otherwise unanswered prompt; cancel stops an active turn",async({request})=>{
  const session=await create(request,"grok-extension",{agent:"grok"});
  await expect.poll(()=>status(request,session.id)).toBe("completed");
  expect(log(session.id).filter(frame=>frame.method==="session/prompt")).toHaveLength(1);
  const response=await request.post(`${daemon}/api/sessions/${session.id}/messages`,{data:{text:"wait-cancel"}});
  expect(response.status(),await response.text()).toBe(202);
  await expect.poll(()=>status(request,session.id)).toBe("running");
  expect((await request.post(`${daemon}/api/sessions/${session.id}/stop`)).status()).toBe(204);
  await expect.poll(()=>status(request,session.id)).toBe("stopped");
  expect(log(session.id).some(frame=>frame.method==="session/cancel")).toBe(true);
  expect((await request.delete(`${daemon}/api/sessions/${session.id}`)).status()).toBe(204);
});
