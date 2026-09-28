import {expect} from "@playwright/test";
import {createServer} from "node:http";
import {test,ready,create,open,status} from "./helpers";

test("browser tabs keep independent pages and navigation when switching or closing the sidebar",async({page,request})=>{
 const server=createServer((req,res)=>{res.setHeader("Content-Type","text/html");res.end(`<h1>${req.url}</h1>`);});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();if(!address||typeof address==="string")throw Error("No preview port");
 const base=`http://127.0.0.1:${address.port}`;
 try{
  const session=await create(request,"Browser tab lifecycle");await expect.poll(()=>status(request,session.id)).toBe("completed");
  await ready(page);await open(page,"Browser tab lifecycle");
  await page.getByLabel("Toggle right sidebar").click();await page.locator(".panel-picker").getByRole("button",{name:"Browser",exact:true}).click();
  await page.locator(".browser-panel:visible").getByLabel("Website address").fill(`${base}/one`);await page.locator(".browser-panel:visible").getByRole("button",{name:"Go",exact:true}).click();
  await expect(page.locator(".browser-panel:visible").getByTitle("Workspace browser preview")).toHaveAttribute("src",`${base}/one`);
  await page.locator(".browser-panel:visible").getByLabel("New browser tab").click();
  await expect(page.locator('.panel-tabs [role="tab"]')).toHaveCount(2);
  await expect(page.locator(".browser-panel:visible").getByLabel("Website address")).toBeFocused();
  await page.locator(".browser-panel:visible").getByLabel("Website address").fill(`${base}/two`);await page.locator(".browser-panel:visible").getByRole("button",{name:"Go",exact:true}).click();
  await expect(page.locator(".browser-panel:visible").getByTitle("Workspace browser preview")).toHaveAttribute("src",`${base}/two`);
  await page.locator('.panel-tabs [role="tab"]').first().click();
  await expect(page.locator(".browser-panel:visible").getByLabel("Website address")).toHaveValue(`${base}/one`);
  await page.locator(".browser-panel:visible").getByLabel("Website address").fill(`${base}/one/next`);await page.locator(".browser-panel:visible").getByRole("button",{name:"Go",exact:true}).click();
  await page.locator('.panel-tabs [role="tab"]').last().click();
  await expect(page.locator(".browser-panel:visible").getByLabel("Website address")).toHaveValue(`${base}/two`);
  await page.locator('.panel-tabs [role="tab"]').first().click();
  await page.locator(".browser-panel:visible").getByLabel("Back in preview").click();
  await expect(page.locator(".browser-panel:visible").getByTitle("Workspace browser preview")).toHaveAttribute("src",`${base}/one`);
  await page.getByLabel("Close right sidebar").click();await page.getByLabel("Toggle right sidebar").click();
  await expect(page.locator(".browser-panel:visible").getByLabel("Website address")).toHaveValue(`${base}/one`);
  await page.getByLabel("Close Browser tab").last().click();
  await expect(page.locator('.panel-tabs [role="tab"]')).toHaveCount(1);
  await expect(page.locator(".browser-panel:visible").getByLabel("Website address")).toHaveValue(`${base}/one`);
 }finally{server.close();}
});

test("native browser bridge opens each tab once and navigates existing WebViews without closing them",async({page,request})=>{
 await page.addInitScript(()=>{
  const state=window as typeof window&{go:{main:{App:Record<string,unknown>}};runtime:{EventsOn:(name:string,callback:(...args:unknown[])=>void)=>()=>void};browserCalls:{op:string;id:string;url?:string}[];browserEvents:Record<string,((...args:unknown[])=>void)[]>};
  state.browserCalls=[];
  state.browserEvents={};
  state.go={main:{App:{SetAppearance:async()=>"opaque"}}};
  state.runtime={EventsOn:(name,callback)=>{const listeners=state.browserEvents[name]??=[];listeners.push(callback);state.browserEvents[name]=listeners;return()=>{state.browserEvents[name]=listeners.filter(item=>item!==callback);};}};
  Object.assign(state.go.main.App,{
   BrowserOpenTab:async(id:string,url:string)=>{state.browserCalls.push({op:"open",id,url});},
   BrowserNavigateTab:async(id:string,url:string)=>{state.browserCalls.push({op:"navigate",id,url});},
   BrowserBoundsTab:async()=>{},
   BrowserActionTab:async(id:string,action:string)=>{state.browserCalls.push({op:action,id});},
  });
 });
 const session=await create(request,"Native browser tab bridge");await expect.poll(()=>status(request,session.id)).toBe("completed");
 await ready(page);await open(page,"Native browser tab bridge");
 await page.getByLabel("Toggle right sidebar").click();await page.locator(".panel-picker").getByRole("button",{name:"Browser",exact:true}).click();
 await page.locator(".browser-panel:visible").getByLabel("Website address").fill("http://localhost:7311/first");await page.locator(".browser-panel:visible").getByRole("button",{name:"Go",exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>((window as typeof window&{browserCalls:{op:string}[]}).browserCalls).filter(item=>item.op==="open").length)).toBe(1);
 const icon="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=";
 await page.evaluate(data=>{const state=window as typeof window&{browserCalls:{op:string;id:string}[];browserEvents:Record<string,((...args:unknown[])=>void)[]>};const id=state.browserCalls.find(item=>item.op==="open")!.id;state.browserEvents["browser:favicon"].forEach(listener=>listener(id,"http://localhost:7311/first",data));},icon);
 await expect(page.locator('.panel-tabs [role="tab"] img.panel-tab-favicon')).toHaveAttribute("src",icon);
 await page.locator(".browser-panel:visible").getByLabel("Website address").fill("http://localhost:7311/next");await page.locator(".browser-panel:visible").getByRole("button",{name:"Go",exact:true}).click();
 await expect(page.locator('.panel-tabs [role="tab"] img.panel-tab-favicon')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>((window as typeof window&{browserCalls:{op:string}[]}).browserCalls).filter(item=>item.op==="navigate").length)).toBe(1);
 await page.evaluate(data=>{const state=window as typeof window&{browserCalls:{op:string;id:string}[];browserEvents:Record<string,((...args:unknown[])=>void)[]>};const id=state.browserCalls.find(item=>item.op==="open")!.id;state.browserEvents["browser:favicon"].forEach(listener=>listener(id,"http://localhost:7311/redirected",data));},icon);
 await expect(page.locator('.panel-tabs [role="tab"] img.panel-tab-favicon')).toHaveCount(0);
 await page.evaluate(data=>{const state=window as typeof window&{browserCalls:{op:string;id:string}[];browserEvents:Record<string,((...args:unknown[])=>void)[]>};const id=state.browserCalls.find(item=>item.op==="open")!.id;state.browserEvents["browser:state"].forEach(listener=>listener(id,"http://localhost:7311/redirected","First WebKit Page",true,false));state.browserEvents["browser:favicon"].forEach(listener=>listener(id,"http://localhost:7311/first",data));state.browserEvents["browser:new-tab"].forEach(listener=>listener(id,"http://localhost:7312/second"));},icon);
 await expect(page.locator('.panel-tabs [role="tab"] img.panel-tab-favicon').first()).toHaveAttribute("src",icon);
 await expect(page.getByRole("tab",{name:"First WebKit Page"})).toBeVisible();
 await expect(page.locator(".browser-panel:visible").getByLabel("Website address")).toHaveValue("http://localhost:7312/second");
 await expect.poll(()=>page.evaluate(()=>((window as typeof window&{browserCalls:{op:string}[]}).browserCalls).filter(item=>item.op==="open").length)).toBe(2);
 await page.locator('.panel-tabs [role="tab"]').first().click();
 await expect.poll(()=>page.evaluate(()=>((window as typeof window&{browserCalls:{op:string}[]}).browserCalls).filter(item=>item.op==="close").length)).toBe(0);
 await page.getByLabel("Close Browser tab").last().click();
 await expect.poll(()=>page.evaluate(()=>((window as typeof window&{browserCalls:{op:string}[]}).browserCalls).filter(item=>item.op==="close").length)).toBe(1);
});
