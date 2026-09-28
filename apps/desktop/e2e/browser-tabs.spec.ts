import {expect} from "@playwright/test";
import {createServer} from "node:http";
import {test,ready,create,open,status} from "./helpers";

test("browser tabs keep independent pages and navigation when switching or closing the sidebar",async({page,request})=>{
 const server=createServer((req,res)=>{res.setHeader("Content-Type","text/html");res.end(`<h1>${req.url}</h1>`);});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();if(!address||typeof address==="string")throw Error("No preview port");
 const base=`http://127.0.0.1:${address.port}`;
 try{
  const session=await create(request,"Browser tab lifecycle");const other=await create(request,"Browser tab other",{agent:"shell",repo_root:"",prompt:"printf other"});await expect.poll(()=>status(request,session.id)).toBe("completed");await expect.poll(()=>status(request,other.id)).toBe("completed");
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
  await open(page,"Browser tab other");await open(page,"Browser tab lifecycle");
  await expect(page.locator(".browser-panel:visible").getByLabel("Website address")).toHaveValue(`${base}/one`);
  await page.getByLabel("Close right sidebar").click();await page.getByLabel("Toggle right sidebar").click();
  await expect(page.locator(".browser-panel:visible").getByLabel("Website address")).toHaveValue(`${base}/one`);
  await page.getByLabel("Close Browser tab").last().click();
  await expect(page.locator('.panel-tabs [role="tab"]')).toHaveCount(1);
  await expect(page.locator('.panel-tabs [role="tab"][aria-selected="true"]')).toBeFocused();
  await expect(page.locator(".browser-panel:visible").getByLabel("Website address")).toHaveValue(`${base}/one`);
 }finally{server.close();}
});

test("native browser tabs retain their owning chat and close only when dismissed",async({page,request})=>{
 await page.addInitScript(()=>{
  const state=window as typeof window&{browserCalls:string[];go?:unknown};state.browserCalls=[];
  state.go={main:{App:{BrowserOpenTab:async(id:string)=>{state.browserCalls.push(`open:${id}`);},BrowserNavigateTab:async()=>{},BrowserBoundsTab:async()=>{},BrowserActionTab:async(id:string,action:string)=>{state.browserCalls.push(`${action}:${id}`);}}}};
 });
 const first=await create(request,"Browser owner first",{agent:"shell",repo_root:"",prompt:"printf first"});
 const second=await create(request,"Browser owner second",{agent:"shell",repo_root:"",prompt:"printf second"});
 await expect.poll(()=>status(request,first.id)).toBe("completed");await expect.poll(()=>status(request,second.id)).toBe("completed");
 await ready(page);await open(page,"Browser owner first");await page.getByLabel("Add panel").click();await page.getByRole("menuitem",{name:"Browser",exact:true}).click();
 const address=page.locator(".browser-panel:visible").getByLabel("Website address");
 await address.fill("http://127.0.0.1:54321/one");await page.locator(".browser-panel:visible").getByRole("button",{name:"Go",exact:true}).click();
 await page.locator(".browser-panel:visible").getByLabel("New browser tab").click();await address.fill("http://127.0.0.1:54321/two");await page.locator(".browser-panel:visible").getByRole("button",{name:"Go",exact:true}).click();
 const chips=page.locator(".panel-tabs>div");const original=await chips.evaluateAll(elements=>elements.map(element=>(element as HTMLElement).dataset.panelTab));
 await chips.nth(1).getByRole("tab").click();await expect(address).toHaveValue("http://127.0.0.1:54321/one");
 await open(page,"Browser owner second");await expect(page.locator('.panel-tabs [role="tab"]')).toHaveCount(1);
 expect(await page.evaluate(()=>(window as typeof window&{browserCalls:string[]}).browserCalls.filter(call=>call.startsWith("close:")))).toEqual([]);
 await open(page,"Browser owner first");await expect.poll(()=>chips.evaluateAll(elements=>elements.map(element=>(element as HTMLElement).dataset.panelTab))).toEqual(original);
 await expect(chips.nth(1).getByRole("tab")).toHaveAttribute("aria-selected","true");await expect(address).toHaveValue("http://127.0.0.1:54321/one");
 expect(await page.evaluate(()=>(window as typeof window&{browserCalls:string[]}).browserCalls.filter(call=>call.startsWith("open:")))).toEqual([`open:${original[1]}`,`open:${original[2]}`,`open:${original[1]}`,`open:${original[2]}`]);
 await chips.nth(1).getByLabel("Close Browser tab").click();await expect(chips).toHaveCount(2);
 await expect.poll(()=>page.evaluate(()=>(window as typeof window&{browserCalls:string[]}).browserCalls.filter(call=>call.startsWith("close:")))).toEqual([`close:${original[1]}`]);
 await open(page,"Browser owner second");await open(page,"Browser owner first");await expect(chips).toHaveCount(2);
 await expect(chips.nth(1)).toHaveAttribute("data-panel-tab",original[2]!);
 await page.locator(`[data-session-id="${first.id}"]`).click({button:"right"});await page.getByRole("menuitem",{name:"Delete…",exact:true}).click();
 await page.getByRole("dialog",{name:"Delete chat",exact:true}).getByRole("button",{name:"Delete",exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as typeof window&{browserCalls:string[]}).browserCalls.filter(call=>call.startsWith("close:")))).toEqual([`close:${original[1]}`,`close:${original[2]}`]);
});

test("workspace tabs swap their leading icon for Close and support middle-click plus keyboard closing",async({page,request})=>{
 const session=await create(request,"Panel tab close parity");await expect.poll(()=>status(request,session.id)).toBe("completed");
 await ready(page);await open(page,"Panel tab close parity");await page.getByLabel("Toggle right sidebar").click();
 await page.locator(".panel-picker").getByRole("button",{name:"Browser",exact:true}).click();
 await page.locator(".browser-panel:visible").getByLabel("New browser tab").click();
 await page.locator(".browser-panel:visible").getByLabel("New browser tab").click();
 const chips=page.locator('.panel-tabs>div');await expect(chips).toHaveCount(3);
 const first=chips.first(),close=first.getByLabel('Close Browser tab');
 expect(Math.round((await first.boundingBox())!.width)).toBe(112);
 await first.hover();await expect(close).toHaveCSS('opacity','1');await expect(first.locator('.panel-tab-leading')).toHaveCSS('opacity','0');
 await page.mouse.move(700,500);await expect(close).toHaveCSS('opacity','0');await expect(first.locator('.panel-tab-leading')).toHaveCSS('opacity','1');
 await first.click({button:'middle'});await expect(chips).toHaveCount(2);
 const keyboardClose=chips.first().getByLabel('Close Browser tab');await keyboardClose.focus();await expect(keyboardClose).toHaveCSS('opacity','1');await keyboardClose.press('Enter');await expect(chips).toHaveCount(1);await expect(chips.getByRole('tab',{selected:true})).toBeFocused();
});

test("workspace tab drag and keyboard reorder preserve the selected browser and live page",async({page,request})=>{
 const hits=new Map<string,number>();const server=createServer((req,res)=>{const path=req.url||"/";hits.set(path,(hits.get(path)||0)+1);res.setHeader("Content-Type","text/html");res.end(`<h1>${path}</h1>`);});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();if(!address||typeof address==="string")throw Error("No preview port");const base=`http://127.0.0.1:${address.port}`;
 try{
  const session=await create(request,"Panel tab reorder parity",{agent:"shell",repo_root:"",prompt:"printf reorder-qa"});await expect.poll(()=>status(request,session.id)).toBe("completed");
  await ready(page);await open(page,"Panel tab reorder parity");await page.getByLabel("Add panel").click();await page.getByRole("menuitem",{name:"Browser",exact:true}).click();
  const url=page.locator(".browser-panel:visible").getByLabel("Website address"),go=page.locator(".browser-panel:visible").getByRole("button",{name:"Go",exact:true});
  await url.fill(`${base}/one`);await go.click();await page.locator(".browser-panel:visible").getByLabel("New browser tab").click();await url.fill(`${base}/two`);await go.click();await page.locator(".browser-panel:visible").getByLabel("New browser tab").click();
  const chips=page.locator(".panel-tabs>div");await expect(chips).toHaveCount(4);const before=await chips.evaluateAll(elements=>elements.map(element=>(element as HTMLElement).dataset.panelTab));
  await expect.poll(()=>hits.get("/one")).toBe(1);await expect.poll(()=>hits.get("/two")).toBe(1);
  await chips.nth(1).getByRole("tab").click();await expect(url).toHaveValue(`${base}/one`);const firstHits=hits.get("/one"),secondHits=hits.get("/two");
  await chips.nth(1).dragTo(chips.nth(3));await expect.poll(()=>chips.evaluateAll(elements=>elements.map(element=>(element as HTMLElement).dataset.panelTab))).toEqual([before[0],before[2],before[3],before[1]]);
  await expect(chips.last().getByRole("tab")).toHaveAttribute("aria-selected","true");await expect(url).toHaveValue(`${base}/one`);expect(hits.get("/one")).toBe(firstHits);expect(hits.get("/two")).toBe(secondHits);
  await chips.last().getByRole("tab").focus();await chips.last().getByRole("tab").press("Alt+ArrowLeft");await expect.poll(()=>chips.evaluateAll(elements=>elements.map(element=>(element as HTMLElement).dataset.panelTab))).toEqual([before[0],before[2],before[1],before[3]]);await expect(chips.nth(2).getByRole("tab")).toBeFocused();await expect(url).toHaveValue(`${base}/one`);
  await page.evaluate(()=>{const state=window as typeof window&{panelDragStyles:string[]};state.panelDragStyles=[];new MutationObserver(records=>{for(const record of records)if(record.target instanceof HTMLElement)state.panelDragStyles.push(record.target.getAttribute("style")||"");}).observe(document.querySelector(".panel-tabs")!,{subtree:true,attributes:true,attributeFilter:["style"]});});
  await chips.nth(2).dragTo(chips.first(),{steps:10});
  await expect.poll(()=>chips.evaluateAll(elements=>elements.map(element=>(element as HTMLElement).dataset.panelTab))).toEqual([before[1],before[0],before[2],before[3]]);await expect(url).toHaveValue(`${base}/one`);
  expect(await page.evaluate(()=>(window as typeof window&{panelDragStyles:string[]}).panelDragStyles.some(style=>style.includes("116px")))).toBe(true);
  await chips.first().dragTo(page.locator(".browser-panel:visible .preview-servers"));
  await expect.poll(()=>chips.evaluateAll(elements=>elements.map(element=>(element as HTMLElement).dataset.panelTab))).toEqual([before[1],before[0],before[2],before[3]]);
  await expect(chips.first().getByRole("tab")).toHaveAttribute("aria-selected","true");
  await chips.nth(2).getByRole("tab").click();await expect(chips.nth(2).getByRole("tab")).toHaveAttribute("aria-selected","true");
  await chips.first().dragTo(chips.last());await expect.poll(()=>chips.evaluateAll(elements=>elements.map(element=>(element as HTMLElement).dataset.panelTab))).toEqual([before[0],before[2],before[3],before[1]]);await expect(chips.nth(1).getByRole("tab")).toHaveAttribute("aria-selected","true");
  await chips.last().getByRole("tab").click();await expect(chips.last().getByRole("tab")).toHaveAttribute("aria-selected","true");
  for(let i=0;i<8;i++)await page.locator(".browser-panel:visible").getByLabel("New browser tab").click();
  const strip=page.locator(".panel-tabs");await expect.poll(()=>strip.evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);
  await strip.evaluate(element=>{element.scrollLeft=element.scrollWidth;});const overflowBefore=await chips.evaluateAll(elements=>elements.map(element=>(element as HTMLElement).dataset.panelTab));
  await chips.last().dragTo(chips.nth(overflowBefore.length-2),{steps:8});
  await expect.poll(()=>chips.evaluateAll(elements=>elements.map(element=>(element as HTMLElement).dataset.panelTab))).toEqual([...overflowBefore.slice(0,-2),overflowBefore.at(-1),overflowBefore.at(-2)]);
  expect(hits.get("/one")).toBe(firstHits);
 }finally{server.close();}
});

test("native browser key events honor app shortcuts before browser actions and ignore stale tabs",async({page,request})=>{
 await page.addInitScript(()=>{
  localStorage.setItem("openade.preferences",JSON.stringify({shortcuts:{commandPalette:"Mod+Alt+L"}}));
  const state=window as typeof window&{go:{main:{App:Record<string,unknown>}};runtime:{EventsOn:(name:string,callback:(...args:unknown[])=>void)=>()=>void};browserCalls:{op:string;id?:string;bindings?:string[]}[];browserEvents:Record<string,((...args:unknown[])=>void)[]>};
  state.browserCalls=[];state.browserEvents={};
  state.go={main:{App:{SetAppearance:async()=>"opaque",BrowserSetShortcuts:async(bindings:string[])=>{state.browserCalls.push({op:"shortcuts",bindings});},BrowserOpenTab:async(id:string)=>{state.browserCalls.push({op:"open",id});},BrowserNavigateTab:async()=>{},BrowserBoundsTab:async()=>{},BrowserActionTab:async(id:string,op:string)=>{state.browserCalls.push({op,id});}}}};
  state.runtime={EventsOn:(name,callback)=>{const listeners=state.browserEvents[name]??=[];listeners.push(callback);state.browserEvents[name]=listeners;return()=>{state.browserEvents[name]=listeners.filter(item=>item!==callback);};}};
 });
 const session=await create(request,"Native browser key context",{agent:"shell",repo_root:"",prompt:"printf browser-key-context"});await expect.poll(()=>status(request,session.id)).toBe("completed");
 await ready(page);await open(page,"Native browser key context");await page.getByLabel("Add panel").click();await page.getByRole("menuitem",{name:"Browser",exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>((window as typeof window&{browserCalls:{op:string;bindings?:string[]}[]}).browserCalls).some(call=>call.op==="shortcuts"&&call.bindings?.includes("Mod+Alt+L")))).toBe(true);
 await page.locator(".browser-panel:visible").getByLabel("Website address").fill("http://localhost:7311/first");await page.locator(".browser-panel:visible").getByRole("button",{name:"Go",exact:true}).click();
 const first=await page.evaluate(()=>((window as typeof window&{browserCalls:{op:string;id?:string}[]}).browserCalls).find(call=>call.op==="open")!.id!);
 const key=async(id:string,combo:string)=>page.evaluate(({id,combo})=>{const state=window as typeof window&{browserEvents:Record<string,((...args:unknown[])=>void)[]>};state.browserEvents["browser:key"].forEach(listener=>listener(id,combo));},{id,combo});
 await page.evaluate(id=>{const state=window as typeof window&{browserEvents:Record<string,((...args:unknown[])=>void)[]>};state.browserEvents["browser:state"].forEach(listener=>listener(id,"http://localhost:7311/first","First page",true,true));},first);
 await expect(page.locator(".browser-panel:visible").getByLabel("Back in preview")).toBeEnabled();
 await key(first,"mod+shift+r");await key(first,"mod+[");await key(first,"mod+]");
 await expect.poll(()=>page.evaluate(()=>((window as typeof window&{browserCalls:{op:string}[]}).browserCalls).filter(call=>["reload","back","forward"].includes(call.op)).map(call=>call.op))).toEqual(["reload","back","forward"]);
 await key(first,"mod+l");await expect(page.locator(".browser-panel:visible").getByLabel("Website address")).toBeFocused();
 await key(first,"mod+alt+l");await expect(page.getByRole("dialog",{name:"Commands and chats"})).toBeVisible();await page.keyboard.press("Escape");
 await key(first,"mod+t");await expect(page.locator('.panel-tabs [role="tab"]')).toHaveCount(3);
 await key(first,"mod+w");await expect(page.locator('.panel-tabs [role="tab"]')).toHaveCount(3);
 const second=page.locator('.panel-tabs [role="tab"]').last();await expect(second).toHaveAttribute("aria-selected","true");
 const secondId=await page.locator(".browser-panel:visible").getAttribute("data-browser-tab-id");await key(secondId!,"mod+w");await expect(page.locator('.panel-tabs [role="tab"]')).toHaveCount(2);await expect(page.locator('.panel-tabs [role="tab"][aria-selected="true"]')).toBeFocused();
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
