import {expect} from "@playwright/test";
import {test,daemon,ready,tmp,token} from "./helpers";
import {execFileSync,spawn} from "node:child_process";
import {createServer} from "node:net";
import fs from "node:fs";
import path from "node:path";

const freePort=()=>new Promise<number>((resolve,reject)=>{const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const address=server.address();if(!address||typeof address==="string"){server.close();reject(Error("No local port"));return;}server.close(()=>resolve(address.port));});});
const fixtureAuth=(email:string,user:string)=>JSON.stringify({tokens:{id_token:`header.${Buffer.from(JSON.stringify({email,"https://api.openai.com/auth":{chatgpt_user_id:user,chatgpt_account_id:"fixture-team",chatgpt_plan_type:"plus"}})).toString("base64url")}.signature`,access_token:"SYNTHETIC_SECRET_NEVER_EXPOSE"}});

test("Providers renders the active Codex account and real protocol quota windows without exposing credentials",async({page,request})=>{
 const response=await request.get(`${daemon}/api/agent-accounts?refresh=1`);
 expect(response.status()).toBe(200);
 const raw=await response.text();
 expect(raw).not.toContain("PRIVATE_FIXTURE_TOKEN");
 expect(raw).not.toContain("private-fixture-account");
 const snapshot=JSON.parse(raw) as {accounts:{provider:string;email:string;plan_label:string;active:boolean;switchable:boolean;usage_windows:{label:string;used_fraction:number}[]}[]};
 expect(snapshot.accounts).toHaveLength(1);
 expect(snapshot.accounts[0]).toMatchObject({provider:"codex",email:"fixture@example.test",plan_label:"ChatGPT Pro",active:true,switchable:false});
 expect(snapshot.accounts[0].usage_windows.map(window=>window.used_fraction)).toEqual([.4,.85]);
 await ready(page);await page.getByLabel("Open settings").click();await page.getByRole("tab",{name:"Providers",exact:true}).click();
 const accounts=page.getByRole("region",{name:"Codex accounts"});
 await expect(accounts.getByText("fixture@example.test")).toBeVisible();
 await expect(accounts.getByText("ChatGPT Pro")).toBeVisible();
 await expect(accounts.getByRole("progressbar",{name:"Session used"})).toHaveAttribute("aria-valuenow","40");
 await expect(accounts.getByRole("progressbar",{name:"Week used"})).toHaveAttribute("aria-valuenow","85");
 await accounts.getByRole("button",{name:"Refresh Codex account usage"}).click();
 await expect(accounts.getByText("fixture@example.test")).toBeVisible();
 await expect(accounts).not.toContainText("PRIVATE_FIXTURE_TOKEN");
});

test("saved Codex accounts switch and forget through the real daemon with custom confirmation",async({page,request})=>{
 test.setTimeout(120000);
 const port=await freePort(),base=`http://127.0.0.1:${port}`,data=path.join(tmp,"account-switch-data"),home=path.join(tmp,"account-switch-codex-home");
 fs.mkdirSync(home,{recursive:true,mode:0o700});fs.mkdirSync(data,{recursive:true,mode:0o700});
 const auth=path.join(home,"auth.json");fs.writeFileSync(auth,fixtureAuth("first@example.test","first-user"),{mode:0o600});
 const child=spawn(path.join(tmp,"openade-e2e"),["--daemon","--addr",`127.0.0.1:${port}`,"--data-dir",data],{env:{...process.env,PATH:path.join(tmp,"bin")+":"+process.env.PATH,OPENADE_PROVIDER_HOME:path.join(tmp,"provider-home"),CODEX_HOME:home,OPENADE_AUTH_TOKEN:token,OPENADE_ACCOUNT_FIXTURE_REQUIRE_AUTH:"1"},stdio:"ignore"});
 try{
  await expect.poll(async()=>{try{return(await fetch(base+"/api/health")).status;}catch{return 0;}}).toBe(200);
  const firstResponse=await request.get(base+"/api/agent-accounts?refresh=1");expect(firstResponse.status()).toBe(200);
  const first=(await firstResponse.json()).accounts[0] as {id:string;email:string};expect(first.email).toBe("first@example.test");
  fs.writeFileSync(auth,fixtureAuth("second@example.test","second-user"),{mode:0o600});
  const externalRefresh=await request.get(base+"/api/agent-accounts?refresh=1");expect(externalRefresh.status()).toBe(200);
  const refreshed=(await externalRefresh.json()).accounts as {email:string;active:boolean}[];
  expect(refreshed).toHaveLength(2);expect(refreshed.find(account=>account.active)?.email).toBe("second@example.test");
  expect((await request.post(base+`/api/agent-accounts/codex/${first.id}/activate`)).status()).toBe(204);
  await page.addInitScript(connection=>{Object.assign(window,{go:{main:{App:{EngineConnection:async()=>connection}}}});},{url:base,token});
  await ready(page);await page.getByLabel("Open settings").click();await page.getByRole("tab",{name:"Providers",exact:true}).click();
  const accounts=page.getByRole("region",{name:"Codex accounts"});
  const firstRow=accounts.locator(".provider-account-row").filter({hasText:"first@example.test"});
  const secondRow=accounts.locator(".provider-account-row").filter({hasText:"second@example.test"});
  await expect(firstRow.getByText("Active",{exact:true})).toBeVisible();
  await secondRow.getByRole("button",{name:"Switch to second@example.test"}).click();
  await expect(secondRow.getByText("Active",{exact:true})).toBeVisible();
  await firstRow.getByRole("button",{name:"Forget first@example.test"}).click();
  const dialog=page.getByRole("dialog",{name:"Forget Codex account"});await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(firstRow.getByRole("button",{name:"Forget first@example.test"})).toBeFocused();
  await firstRow.getByRole("button",{name:"Forget first@example.test"}).click();await dialog.getByRole("button",{name:"Forget account"}).click();
  await expect(firstRow).toHaveCount(0);
  await secondRow.getByRole("button",{name:"Forget second@example.test"}).click();await expect(dialog).toContainText("signs Codex out");
  await dialog.getByRole("button",{name:"Forget account"}).click();
  await expect(accounts).toContainText("No Codex account is connected.");
  expect(fs.existsSync(auth)).toBe(false);
  expect(fs.readdirSync(path.join(data,"agent-accounts","codex")).filter(name=>name.endsWith(".json"))).toHaveLength(0);
  execFileSync("mkfifo",[auth]);
  const blockedAuth=await request.get(base+"/api/agent-accounts?refresh=1",{timeout:5000});
  expect(blockedAuth.status()).toBe(200);
  expect((await blockedAuth.json()).warnings).toEqual(expect.arrayContaining([expect.objectContaining({provider:"codex",message:expect.stringContaining("could not be read")})]));
  fs.unlinkSync(auth);
 }finally{if(child.exitCode===null){const ended=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.kill("SIGTERM");await ended;}}
});
