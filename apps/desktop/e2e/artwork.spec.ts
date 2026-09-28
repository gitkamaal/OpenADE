import {expect} from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import {spawn,ChildProcess} from "node:child_process";
import {daemon,ready,test,tmp,token} from "./helpers";

const png=fs.readFileSync(path.join(process.cwd(),"e2e/fixtures/preview-grid.png"));

test("new-thread artwork is managed, persisted, rendered, and removable",async({page,request})=>{
 await ready(page);
 const initial=await (await request.get(`${daemon}/api/new-thread-artwork`)).json();
 expect(initial.image).toBeFalsy();expect(initial.effect).toBe("none");
 await page.getByLabel("Open settings").click();await page.getByRole("tab",{name:"Appearance",exact:true}).click();
 const picker=page.getByLabel("Choose new thread background image");
 await picker.setInputFiles({name:"hero.png",mimeType:"image/png",buffer:png});
 await expect.poll(async()=>{const state=await(await request.get(`${daemon}/api/new-thread-artwork`)).json();return state.image?.name;}).toBe("hero.png");
 await expect(page.locator(".artwork-preview img")).toHaveAttribute("src",/^blob:/);
 const first=await (await request.get(`${daemon}/api/new-thread-artwork`)).json();
 const firstPreview=await page.locator(".artwork-preview img").getAttribute("src");
 for(const effect of ["dither","ascii","halftone","scanlines"]){
  await page.getByRole("combobox",{name:"Background effect",exact:true}).click();await page.locator(`.select-popover [role=option][data-value="${effect}"]`).click();
  await expect.poll(async()=>{const state=await(await request.get(`${daemon}/api/new-thread-artwork`)).json();return state.effect;}).toBe(effect);
 }
 await page.getByRole("button",{name:"Back",exact:true}).click();
 await expect(page.locator(".new-thread-artwork")).toHaveAttribute("data-effect","scanlines");await expect(page.locator(".new-thread-artwork img")).toHaveAttribute("src",/^blob:/);
 await page.reload();await expect(page.locator(".new-thread-artwork")).toHaveAttribute("data-effect","scanlines");
 await page.getByLabel("Open settings").click();await page.getByRole("tab",{name:"Appearance",exact:true}).click();
 await picker.setInputFiles({name:"replacement.jpg",mimeType:"image/jpeg",buffer:png});
 await expect.poll(async()=>{const state=await(await request.get(`${daemon}/api/new-thread-artwork`)).json();return state.image?.id;}).not.toBe(first.image.id);
 await expect(page.locator(".artwork-preview img")).not.toHaveAttribute("src",firstPreview!);
 await page.getByRole("button",{name:"Remove",exact:true}).click();
 await expect.poll(async()=>{const state=await(await request.get(`${daemon}/api/new-thread-artwork`)).json();return state.image;}).toBeFalsy();
 await expect(page.getByRole("combobox",{name:"Background effect",exact:true})).toHaveCount(0);
 expect((await request.get(`${daemon}/api/new-thread-artwork/media`)).status()).toBe(404);
});

test("new-thread artwork rejects invalid bytes and requires engine authentication",async({request})=>{
 const invalid=await request.post(`${daemon}/api/new-thread-artwork?name=unsafe.svg`,{data:"<svg onload=alert(1) />",headers:{"Content-Type":"image/svg+xml"}});expect(invalid.status()).toBe(400);
 const unauth=await request.get(`${daemon}/api/new-thread-artwork`,{headers:{Authorization:""}});expect(unauth.status()).toBe(401);
});

function startArtworkDaemon(port:number,data:string){return spawn(path.join(tmp,"openade-e2e"),["--daemon","--addr",`127.0.0.1:${port}`,"--data-dir",data],{env:{...process.env,OPENADE_AUTH_TOKEN:token,OPENADE_PROVIDER_HOME:path.join(tmp,"provider-home"),PATH:`${path.join(tmp,"bin")}:${process.env.PATH}`,SHELL:"/bin/sh"},stdio:"pipe"});}
async function stopArtworkDaemon(child:ChildProcess){if(child.exitCode!==null)return;child.kill("SIGTERM");await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error("artwork engine did not stop")),8000);child.once("exit",()=>{clearTimeout(timeout);resolve();});});}
test("new-thread artwork survives a daemon restart with only its managed copy",async()=>{
 const port=7474,base=`http://127.0.0.1:${port}`,data=path.join(tmp,"artwork-restart");fs.rmSync(data,{recursive:true,force:true});const headers={Authorization:`Bearer ${token}`,"Content-Type":"image/png"};let child=startArtworkDaemon(port,data);
 try{await expect.poll(async()=>{try{return(await fetch(base+"/api/health")).status}catch{return 0}}).toBe(200);const installed=await(await fetch(base+"/api/new-thread-artwork?name=restart.png",{method:"POST",headers,body:png})).json();await fetch(base+"/api/new-thread-artwork/effect",{method:"PATCH",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({effect:"halftone"})});await stopArtworkDaemon(child);child=startArtworkDaemon(port,data);await expect.poll(async()=>{try{return(await fetch(base+"/api/health")).status}catch{return 0}}).toBe(200);const state=await(await fetch(base+"/api/state",{headers:{Authorization:`Bearer ${token}`}})).json();expect(state.new_thread_artwork.image.id).toBe(installed.image.id);expect(state.new_thread_artwork.effect).toBe("halftone");const media=await fetch(base+"/api/new-thread-artwork/media",{headers:{Authorization:`Bearer ${token}`}});expect(media.status).toBe(200);expect(Buffer.from(await media.arrayBuffer())).toEqual(png);const managed=fs.readdirSync(path.join(data,"new-thread-backgrounds"));expect(managed).toHaveLength(1);expect(managed[0]).toMatch(/^new-thread-background-/);
 }finally{await stopArtworkDaemon(child);fs.rmSync(data,{recursive:true,force:true});}
});
