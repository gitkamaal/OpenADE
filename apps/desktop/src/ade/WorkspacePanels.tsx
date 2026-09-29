import { ArrowClockwise, ArrowSquareOut, ChatCircleDots, CaretRight, CaretDown, X, ArrowLeft, ArrowRight, GitBranch, Globe, FloppyDisk, Plus, Eye, EyeSlash, MagnifyingGlass } from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fileMediaURL, fileWatchURL, getFile, getFiles, getPreviewServers, saveFile, Session } from "./api";
import {WorkspaceImage} from "./Attachments";
import {MarkdownMessage} from "./MarkdownMessage";
import { Preferences } from "./preferences";
import {FileIdentityIcon} from "./FileIdentityIcon";
import { ReviewComment } from "./ReviewComments";
import { Dispatch, KeyboardEvent as ReactKeyboardEvent, SetStateAction, UIEvent as ReactUIEvent } from "react";
const CodeEditor=lazy(()=>import("./CodeEditor"));
type FilePanelMemory={tabs:string[];selected:string;preview:boolean;query:string;collapsed:string[]};
const filePanelMemory=new Map<string,FilePanelMemory>(),forgottenFileOwners=new Set<string>();
export function forgetFilesPanel(sessionId:string){forgottenFileOwners.add(sessionId);filePanelMemory.delete(sessionId);}
type NativeBrowserBridge={BrowserOpenTab?:(id:string,url:string,x:number,y:number,width:number,height:number)=>Promise<void>;BrowserNavigateTab?:(id:string,url:string)=>Promise<void>;BrowserBoundsTab?:(id:string,x:number,y:number,width:number,height:number)=>Promise<void>;BrowserActionTab?:(id:string,action:string)=>Promise<void>};
export function BrowserPanel({session,tabId,initialUrl,active,onTitle,onURL,onFavicon,onNewTab}:{session:Session;tabId:string;initialUrl?:string;active:boolean;onTitle:(label:string)=>void;onURL:(url:string)=>void;onFavicon:(data:string)=>void;onNewTab:(url?:string)=>void}){
 const native=window as typeof window & {go?:{main?:{App?:NativeBrowserBridge}};runtime?:{EventsOn?:(name:string,callback:(...args:any[])=>void)=>(()=>void)}};
 const bridge=native.go?.main?.App;const nativeBrowser=Boolean(bridge?.BrowserOpenTab&&/Mac/.test(navigator.platform));const viewport=useRef<HTMLDivElement>(null),addressInput=useRef<HTMLInputElement>(null);const opened=useRef(false);
 const titleCallback=useRef(onTitle),urlCallback=useRef(onURL),faviconCallback=useRef(onFavicon),newTabCallback=useRef(onNewTab),pageURL=useRef(initialUrl||""),pendingFavicon=useRef<{page:string;data:string}|null>(null);titleCallback.current=onTitle;urlCallback.current=onURL;faviconCallback.current=onFavicon;newTabCallback.current=onNewTab;
 const [nativeBack,setNativeBack]=useState(false),[nativeForward,setNativeForward]=useState(false);
 const [address,setAddress]=useState(initialUrl||""),[url,setUrl]=useState(initialUrl||"");
 const [request,setRequest]=useState<{url:string;version:number}|null>(initialUrl?{url:initialUrl,version:1}:null);
 const [history,setHistory]=useState<string[]>(initialUrl?[initialUrl]:[]),[cursor,setCursor]=useState(initialUrl?0:-1);
 const [error,setError]=useState(""),[key,setKey]=useState(0),[servers,setServers]=useState<string[]>([]);
 useEffect(()=>{if(!active||url)return;const frame=requestAnimationFrame(()=>addressInput.current?.focus());return()=>cancelAnimationFrame(frame);},[active,url]);
 const discover=()=>void getPreviewServers(session.id).then(result=>setServers(result.servers)).catch(reason=>setError(String(reason)));
 useEffect(()=>{discover();},[session.id]);
 const open=(value=address)=>{try{const parsed=new URL(value.includes("://")?value:`http://${value}`);if(!["http:","https:"].includes(parsed.protocol)||parsed.username||parsed.password)throw Error("Invalid web address");pageURL.current=parsed.href;urlCallback.current(parsed.href);pendingFavicon.current=null;faviconCallback.current("");setAddress(parsed.href);setUrl(parsed.href);setError("");titleCallback.current(parsed.hostname||"Browser");if(nativeBrowser)setRequest(current=>({url:parsed.href,version:(current?.version||0)+1}));else{const next=[...history.slice(0,cursor+1),parsed.href];setHistory(next);setCursor(next.length-1);}}catch{setError("Enter a valid website or localhost address without credentials.");}};
 const syncNative=useCallback(()=>{const host=viewport.current;if(!host||!opened.current||!nativeBrowser)return;const workspace=host.closest(".session-workspace"),root=host.closest(".ade"),bounds=host.getBoundingClientRect();const visible=active&&bounds.width>0&&bounds.height>0&&Boolean(workspace?.classList.contains("with-panel"))&&!workspace?.classList.contains("has-overlay")&&!root?.classList.contains("has-image-overlay")&&!root?.classList.contains("has-custom-menu")&&!root?.classList.contains("has-model-menu");void bridge?.BrowserBoundsTab?.(tabId,bounds.x,bounds.y,bounds.width,bounds.height);void bridge?.BrowserActionTab?.(tabId,visible?"show":"hide");},[active,bridge,nativeBrowser,tabId]);
 useEffect(()=>{if(!nativeBrowser||!request||!viewport.current)return;let stale=false;const bounds=viewport.current.getBoundingClientRect(),first=!opened.current;opened.current=true;const call=first?bridge?.BrowserOpenTab?.(tabId,request.url,bounds.x,bounds.y,bounds.width,bounds.height):bridge?.BrowserNavigateTab?.(tabId,request.url);void call?.then(()=>{if(!stale)syncNative();}).catch(reason=>{if(!stale){opened.current=false;setError(String(reason));}});return()=>{stale=true;};},[request,nativeBrowser,tabId]);
 useEffect(()=>{if(!nativeBrowser||!url||!viewport.current)return;const host=viewport.current,root=host.closest(".ade"),workspace=host.closest(".session-workspace");const observer=new ResizeObserver(syncNative);observer.observe(host);const mutations=new MutationObserver(syncNative);for(const node of [root,workspace])if(node)mutations.observe(node,{attributes:true,attributeFilter:["class","style"]});window.addEventListener("resize",syncNative);syncNative();return()=>{observer.disconnect();mutations.disconnect();window.removeEventListener("resize",syncNative);void bridge?.BrowserActionTab?.(tabId,"hide");};},[active,url,nativeBrowser,syncNative,tabId]);
 useEffect(()=>()=>{if(opened.current)void bridge?.BrowserActionTab?.(tabId,"hide");},[bridge,tabId]);
 useEffect(()=>{const offState=native.runtime?.EventsOn?.("browser:state",(id:string,value:string,title:string,back:boolean,forward:boolean)=>{if(id!==tabId)return;if(value!==pageURL.current){pageURL.current=value;faviconCallback.current(pendingFavicon.current?.page===value?pendingFavicon.current.data:"");pendingFavicon.current=null;}urlCallback.current(value);setUrl(value);setAddress(value);setNativeBack(back);setNativeForward(forward);titleCallback.current(title.trim()||(()=>{try{return new URL(value).hostname;}catch{return "Browser";}})());});const offFavicon=native.runtime?.EventsOn?.("browser:favicon",(id:string,page:string,data:string)=>{if(id!==tabId||!/^data:image\/png;base64,[A-Za-z0-9+/=]{1,1398104}$/.test(data))return;if(page===pageURL.current)faviconCallback.current(data);else pendingFavicon.current={page,data};});const offNew=native.runtime?.EventsOn?.("browser:new-tab",(id:string,value:string)=>{if(id===tabId)newTabCallback.current(value);});return()=>{offState?.();offFavicon?.();offNew?.();};},[tabId]);
 const browserAction=(action:"back"|"forward"|"reload")=>{pendingFavicon.current=null;faviconCallback.current("");void bridge?.BrowserActionTab?.(tabId,action);};
 const navigate=(next:number)=>{const value=history[next];pageURL.current=value;urlCallback.current(value);setCursor(next);setUrl(value);setAddress(value);try{titleCallback.current(new URL(value).hostname);}catch{titleCallback.current("Browser");}};
 useEffect(()=>{const key=(event:Event)=>{const {id,combo}=(event as CustomEvent<{id:string;combo:string}>).detail;if(!active||id!==tabId)return;if(combo==="mod+l"){addressInput.current?.focus();addressInput.current?.select();}else if(combo==="mod+shift+r"&&url){if(nativeBrowser)browserAction("reload");else setKey(value=>value+1);}else if(combo==="mod+["&&(nativeBrowser?nativeBack:cursor>0)){if(nativeBrowser)browserAction("back");else navigate(cursor-1);}else if(combo==="mod+]"&&(nativeBrowser?nativeForward:cursor<history.length-1)){if(nativeBrowser)browserAction("forward");else navigate(cursor+1);}};window.addEventListener("openade-browser-key",key);return()=>window.removeEventListener("openade-browser-key",key);},[active,tabId,nativeBrowser,nativeBack,nativeForward,url,cursor,history,bridge]);
 return <section className="browser-panel" data-browser-tab-id={tabId} style={{display:active?"flex":"none"}} aria-hidden={!active}><form onSubmit={event=>{event.preventDefault();open();}}><button type="button" className="icon-button" aria-label="Back in preview" disabled={nativeBrowser?!nativeBack:cursor<=0} onClick={()=>nativeBrowser?browserAction("back"):navigate(cursor-1)}><ArrowLeft/></button><button type="button" className="icon-button" aria-label="Forward in preview" disabled={nativeBrowser?!nativeForward:cursor>=history.length-1} onClick={()=>nativeBrowser?browserAction("forward"):navigate(cursor+1)}><ArrowRight/></button><button type="button" className="icon-button" aria-label="Reload preview" disabled={!url} onClick={()=>nativeBrowser?browserAction("reload"):setKey(v=>v+1)}><ArrowClockwise/></button><label><Globe/><input ref={addressInput} aria-label="Website address" placeholder="Website or localhost:3000" value={address} onChange={e=>setAddress(e.target.value)}/></label><button type="submit">Go</button><button type="button" className="icon-button" aria-label="New browser tab" onClick={()=>onNewTab()}><Plus/></button>{url&&<a href={url} target="_blank" rel="noreferrer" aria-label="Open in default browser"><ArrowSquareOut/></a>}</form><div className="preview-servers"><button onClick={discover} aria-label="Find local preview servers"><ArrowClockwise/>Local servers</button>{servers.map(server=><button key={server} onClick={()=>open(server)}>{new URL(server).port}</button>)}</div>{error&&<p role="alert">{error}</p>}{url?<><div className="browser-viewport" ref={viewport}>{!nativeBrowser&&<iframe title="Workspace browser preview" key={`${url}:${key}`} src={url} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer"/>}</div><div className="browser-note">{nativeBrowser?"Native browser preview. ":"If this site blocks embedded previews, "} <a href={url} target="_blank" rel="noreferrer">open it in your browser</a>.</div></>:<div className="panel-empty"><Globe/><strong>Open a preview</strong><p>Enter a website or select a local development server.</p></div>}</section>;
}
export function FilesPanel({session,active,appearance,preferences,onPreferences,onDirtyChange,editorTarget,onOpenEditor,comments=[],onComments,sideChats=[],onOpenSideChat,onNewSideChat,onForkSideChat,sideChatCreating=false}:{session:Session;active:boolean;appearance:"light"|"dark";preferences:Preferences;onPreferences:(next:Preferences)=>void;onDirtyChange:(dirty:boolean)=>void;editorTarget:HTMLElement|null;onOpenEditor:()=>void;comments?:ReviewComment[];onComments?:Dispatch<SetStateAction<ReviewComment[]>>;sideChats?:Session[];onOpenSideChat?:(id:string)=>void;onNewSideChat?:()=>void;onForkSideChat?:()=>void;sideChatCreating?:boolean}) {
 const rememberedFiles=useRef(filePanelMemory.get(session.id)).current;
 const [preview,setPreview]=useState(()=>rememberedFiles?.preview??false);const [imageRevision,setImageRevision]=useState(0);
 const [tabs,setTabs]=useState<string[]>(()=>rememberedFiles?.tabs??[]);const [collapsed,setCollapsed]=useState<Set<string>>(()=>new Set(rememberedFiles?.collapsed??[]));
 const [files,setFiles]=useState<string[]>([]);const [query,setQuery]=useState(()=>rememberedFiles?.query??"");const [searchActive,setSearchActive]=useState(0);const [searchCollapsed,setSearchCollapsed]=useState<Set<string>>(()=>new Set());const searchListRef=useRef<HTMLDivElement>(null);const [treeScrollTop,setTreeScrollTop]=useState(0);const [treeViewport,setTreeViewport]=useState(600);const [treeActivePath,setTreeActivePath]=useState(()=>rememberedFiles?.selected??"");const scrollFrame=useRef<number|null>(null),scrollFallback=useRef<number|null>(null),latestScrollTop=useRef(0);const [selected,setSelected]=useState(()=>rememberedFiles?.selected??"");const [content,setContent]=useState("");const [original,setOriginal]=useState("");const [error,setError]=useState("");const [loading,setLoading]=useState(()=>Boolean(rememberedFiles?.selected));const [saving,setSaving]=useState(false);const [version,setVersion]=useState(0);const [pending,setPending]=useState<string|null>(null);const dirty=content!==original;const imageFile=/\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svg|avif|heic|heif)$/i.test(selected);const markdownFile=/\.(md|markdown|mdx)$/i.test(selected);const requestRef=useRef(0);
 const initializedTree=useRef(false);
 const searchTaskTimer=useRef<number|undefined>(undefined);
 const scheduleSearchTask=(task:()=>void)=>{if(searchTaskTimer.current!==undefined)window.clearTimeout(searchTaskTimer.current);searchTaskTimer.current=window.setTimeout(()=>{searchTaskTimer.current=undefined;task();},0);};
 const focusTree=()=>scheduleSearchTask(()=>searchListRef.current?.focus({preventScroll:true}));
 useLayoutEffect(()=>{if(!forgottenFileOwners.has(session.id))filePanelMemory.set(session.id,{tabs,selected,preview,query,collapsed:[...collapsed]});},[session.id,tabs,selected,preview,query,collapsed]);
 useLayoutEffect(()=>{const list=searchListRef.current;if(!list)return;const measure=()=>setTreeViewport(list.clientHeight);measure();const observer=new ResizeObserver(measure);observer.observe(list);return()=>observer.disconnect();},[]);
 useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false);},[dirty,onDirtyChange]);
 useEffect(()=>()=>{if(scrollFrame.current!==null)cancelAnimationFrame(scrollFrame.current);if(scrollFallback.current!==null)window.clearTimeout(scrollFallback.current);},[]);
 useEffect(()=>()=>{if(searchTaskTimer.current!==undefined)window.clearTimeout(searchTaskTimer.current);},[]);
 useEffect(()=>{if(!active)return;let stale=false;void getFiles(session.id,preferences.show_ignored).then(result=>{if(!stale){setFiles(current=>current.length===result.length&&current.every((path,index)=>path===result[index])?current:result);if(!initializedTree.current){initializedTree.current=true;if(!rememberedFiles)setCollapsed(new Set(result.filter(path=>path.includes("/")).map(path=>path.split("/")[0])));}}}).catch(reason=>{if(!stale)setError(String(reason));});return()=>{stale=true;};},[session.id,active,version,preferences.show_ignored]);
 useEffect(()=>{if(!active)return;let stopped=false;let socket:WebSocket|undefined,timer:number|undefined,delay=250;
  const connect=()=>{if(stopped)return;try{socket=new WebSocket(fileWatchURL(session.id));}catch{timer=window.setTimeout(connect,delay);delay=Math.min(5000,delay*2);return;}
   socket.onmessage=event=>{try{const frame=JSON.parse(String(event.data)) as {type?:string};if(frame.type==="ready"||frame.type==="changed"){delay=250;setVersion(value=>value+1);}}catch{/* Ignore malformed notifications; the next repair resynchronizes. */}};
   socket.onclose=()=>{if(!stopped){timer=window.setTimeout(connect,delay);delay=Math.min(5000,delay*2);}};
  };connect();return()=>{stopped=true;if(timer!==undefined)window.clearTimeout(timer);socket?.close();};
 },[session.id,active]);
 const load=useCallback(async(path:string,keepPreview=false)=>{const request=++requestRef.current;setSelected(path);setTabs(current=>current.includes(path)?current:[...current,path]);setLoading(true);setContent("");setOriginal("");setError("");if(!keepPreview)setPreview(false);if(/\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svg|avif|heic|heif)$/i.test(path)){setImageRevision(value=>value+1);setLoading(false);return;}try{const result=await getFile(session.id,path);if(request===requestRef.current){setContent(result.content);setOriginal(result.content);}}catch(reason){if(request===requestRef.current)setError(String(reason));}finally{if(request===requestRef.current)setLoading(false);}},[session.id]);
 useEffect(()=>{if(rememberedFiles?.selected)void load(rememberedFiles.selected,true);},[load]);
 useEffect(()=>()=>{requestRef.current++;},[]);
 const save=useCallback(async()=>{if(!selected||imageFile||saving)return false;setSaving(true);setError("");try{const result=await saveFile(session.id,selected,content,original);setOriginal(result.content);return true;}catch(reason){setError(String(reason));return false;}finally{setSaving(false);}},[session.id,selected,content,original,saving,imageFile]);
 useEffect(()=>{if(!dirty||!preferences.autosave||saving||error)return;const timer=window.setTimeout(()=>void save(),preferences.autosave_delay_ms);return()=>window.clearTimeout(timer);},[dirty,preferences.autosave,preferences.autosave_delay_ms,save,saving,error]);
 useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.defaultPrevented||editorTarget?.closest("[hidden],[inert]"))return;if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="s"&&selected&&!imageFile){event.preventDefault();void save();}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);},[save,selected,imageFile]);
 const searchQuery=query.trim().toLowerCase();
 const visible=useMemo(()=>files.filter(path=>preferences.show_hidden||!path.split("/").some(part=>part.startsWith("."))),[files,preferences.show_hidden]);
 const matches=useMemo(()=>searchQuery?visible.map(path=>({path,score:fileSearchScore(path,searchQuery)})).filter((item):item is {path:string;score:number}=>item.score!==null).sort((a,b)=>b.score-a.score||compareFilePaths(a.path,b.path)):[],[visible,searchQuery]);
 const tree=useMemo(()=>fileTree(visible),[visible]);
 const rows=useMemo(()=>searchQuery?fileSearchTree(matches.slice(0,200),searchCollapsed):tree.filter(item=>!item.path.split("/").slice(0,-1).some((_,i,parts)=>collapsed.has(parts.slice(0,i+1).join("/")))),[tree,matches,searchQuery,collapsed,searchCollapsed]);
 const activeSearchIndex=Math.min(searchActive,Math.max(0,rows.length-1));
 useEffect(()=>{if(!searchQuery&&rows.length&&!rows.some(item=>item.path===treeActivePath))setTreeActivePath(rows.find(item=>item.path===selected)?.path??rows[0].path);},[rows,searchQuery,selected,treeActivePath]);
 const virtualize=!searchQuery&&rows.length>300,rowHeight=27;
 const firstRow=virtualize?Math.max(0,Math.floor(treeScrollTop/rowHeight)-6):0;
 const lastRow=virtualize?Math.min(rows.length,firstRow+Math.ceil(treeViewport/rowHeight)+12):rows.length;
 const shownRows=rows.slice(firstRow,lastRow);
 const allFilesVisible=preferences.show_hidden&&preferences.show_ignored;
 const updateQuery=(value:string)=>{setQuery(value);setSearchActive(0);setSearchCollapsed(new Set());};
 const openRow=(item:{path:string;directory:boolean})=>{
  setTreeActivePath(item.path);
  if(item.directory){if(searchQuery){setSearchCollapsed(current=>{const next=new Set(current);if(next.has(item.path))next.delete(item.path);else next.add(item.path);return next;});}else setCollapsed(current=>{const next=new Set(current);if(next.has(item.path))next.delete(item.path);else next.add(item.path);return next;});return;}
  onOpenEditor();if(item.path!==selected){dirty?setPending(item.path):void load(item.path);}if(searchQuery){const parts=item.path.split("/");setCollapsed(current=>{const next=new Set(current);for(let i=1;i<parts.length;i++)next.delete(parts.slice(0,i).join("/"));return next;});updateQuery("");}
 };
 const flushTreeScroll=()=>{if(scrollFrame.current!==null)cancelAnimationFrame(scrollFrame.current);if(scrollFallback.current!==null)window.clearTimeout(scrollFallback.current);scrollFrame.current=null;scrollFallback.current=null;setTreeScrollTop(latestScrollTop.current);};
 const scheduleTreeScroll=(top:number)=>{latestScrollTop.current=top;if(scrollFrame.current!==null||scrollFallback.current!==null)return;scrollFrame.current=requestAnimationFrame(flushTreeScroll);scrollFallback.current=window.setTimeout(flushTreeScroll,32);};
 const onListScroll=(event:ReactUIEvent<HTMLDivElement>)=>scheduleTreeScroll(event.currentTarget.scrollTop);
 const revealTreeRow=(index:number)=>{const list=searchListRef.current;if(!list)return;const top=index*rowHeight,bottom=top+rowHeight;if(top<list.scrollTop)list.scrollTop=top;else if(bottom>list.scrollTop+list.clientHeight)list.scrollTop=bottom-list.clientHeight;scheduleTreeScroll(list.scrollTop);};
 const onTreeKey=(event:ReactKeyboardEvent<HTMLDivElement>)=>{
  if(searchQuery||event.metaKey||event.ctrlKey||event.altKey||!rows.length)return;
  const index=Math.max(0,rows.findIndex(item=>item.path===treeActivePath)),item=rows[index];
  let next=index,handled=true;
  switch(event.key){
   case "ArrowUp":next=Math.max(0,index-1);break;
   case "ArrowDown":next=Math.min(rows.length-1,index+1);break;
   case "ArrowLeft":if(item.directory&&!collapsed.has(item.path))setCollapsed(current=>new Set(current).add(item.path));else{const parent=item.path.split("/").slice(0,-1).join("/");const parentIndex=rows.findIndex(row=>row.path===parent);if(parentIndex>=0)next=parentIndex;}break;
   case "ArrowRight":if(item.directory){if(collapsed.has(item.path))setCollapsed(current=>{const updated=new Set(current);updated.delete(item.path);return updated;});else if(rows[index+1]?.depth===item.depth+1)next=index+1;}break;
   case "Enter":case " ":openRow(item);break;
   default:handled=false;
  }
  if(!handled)return;event.preventDefault();event.stopPropagation();if(next!==index){setTreeActivePath(rows[next].path);revealTreeRow(next);}
 };
 const onSearchKey=(event:ReactKeyboardEvent<HTMLInputElement>)=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();updateQuery("");focusTree();return;}if(!searchQuery||!rows.length)return;if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();const next=Math.max(0,Math.min(rows.length-1,activeSearchIndex+(event.key==="ArrowDown"?1:-1)));setSearchActive(next);scheduleSearchTask(()=>searchListRef.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')[next]?.scrollIntoView({block:"nearest"}));}else if(event.key==="Enter"){event.preventDefault();openRow(rows[activeSearchIndex]);}};
 return <section className="files-panel"><div className="files-index"><header>
  <div className="files-search-field"><MagnifyingGlass aria-hidden="true"/><input role="searchbox" aria-label="Search files" aria-controls="project-file-results" aria-activedescendant={searchQuery&&rows.length?`file-search-result-${activeSearchIndex}`:undefined} placeholder="Search files" value={query} onChange={event=>updateQuery(event.target.value)} onKeyDown={onSearchKey}/></div>
  <button className="icon-button files-refresh" aria-label="Refresh files" title="Refresh files" onClick={()=>setVersion(value=>value+1)}><ArrowClockwise/></button>
  <button className="icon-button files-visibility" aria-label={allFilesVisible?"Hide hidden and ignored files":"Show all files (even hidden)"} title={allFilesVisible?"Hide hidden and ignored files":"Show all files (even hidden)"} aria-pressed={allFilesVisible} onClick={()=>onPreferences({...preferences,show_hidden:!allFilesVisible,show_ignored:!allFilesVisible})}>{allFilesVisible?<Eye/>:<EyeSlash/>}</button>
 </header><div className="file-list" id="project-file-results" ref={searchListRef} role="tree" tabIndex={0} aria-label={searchQuery?"Fuzzy workspace file results":"Project files"} onScroll={onListScroll} onKeyDown={onTreeKey}>
  {searchQuery&&matches.length>200&&<p className="file-search-count">Showing the first 200 matches</p>}
  {virtualize&&firstRow>0&&<div aria-hidden="true" style={{height:firstRow*rowHeight}}/>}
  {shownRows.map((item,offset)=>{const index=firstRow+offset,expanded=searchQuery?!searchCollapsed.has(item.path):!collapsed.has(item.path);return <button id={searchQuery?`file-search-result-${index}`:undefined} role="treeitem" aria-level={item.depth+1} aria-label={item.path} aria-selected={searchQuery?index===activeSearchIndex:treeActivePath===item.path} aria-expanded={item.directory?expanded:undefined} className={(searchQuery?index===activeSearchIndex:treeActivePath===item.path)?"active":""} style={{paddingLeft:8+item.depth*12}} title={item.path} key={item.path} onClick={()=>{if(searchQuery)setSearchActive(index);openRow(item);}}>{item.directory?<><CaretRight className={expanded?"folder-open":""}/><FileIdentityIcon path={item.path} directory appearance={appearance}/></>:<FileIdentityIcon path={item.path} appearance={appearance}/>}<span>{item.path.split('/').at(-1)}</span></button>;})}
  {virtualize&&lastRow<rows.length&&<div aria-hidden="true" style={{height:(rows.length-lastRow)*rowHeight}}/>}
  {rows.length===0&&<p>{searchQuery?"No files found.":"No matching files"}</p>}
 </div></div>{onOpenSideChat&&onNewSideChat&&onForkSideChat&&<SideChatsFooter chats={sideChats} busy={sideChatCreating} onOpen={onOpenSideChat} onNew={onNewSideChat} onFork={onForkSideChat}/>} {selected&&editorTarget&&createPortal(<div className="file-editor"><div className="editor-tabs" role="tablist" aria-label="Open files">{tabs.map(path=><div key={path}><button role="tab" aria-selected={path===selected} title={path} onClick={()=>{if(path!==selected)dirty?setPending(path):void load(path);}}><FileIdentityIcon path={path} appearance={appearance}/>{path.split('/').at(-1)}{path===selected&&dirty&&<span>•</span>}</button><button aria-label={`Close ${path}`} onClick={()=>{if(path===selected&&dirty){setError("Save or discard changes before closing this file.");return;}const next=tabs.filter(x=>x!==path);setTabs(next);if(path===selected){if(next.length)void load(next.at(-1)!);else setSelected("");}}}><X/></button></div>)}</div><header><FileIdentityIcon path={selected} appearance={appearance}/><strong title={selected}>{selected}</strong>{dirty&&<span aria-label="Unsaved changes">•</span>}{markdownFile&&<button aria-label={preview?"Edit Markdown":"Preview Markdown"} aria-pressed={preview} onClick={()=>setPreview(value=>!value)}>{preview?"Edit":"Preview"}</button>}<button aria-label="Reload file" className="icon-button" disabled={loading||saving} onClick={()=>dirty?setPending(selected):void load(selected)}><ArrowClockwise/></button><button aria-label="Save file" className="icon-button" disabled={!dirty||saving||loading} onClick={()=>void save()}><FloppyDisk/></button></header>{pending&&<div className="unsaved-prompt" role="alert"><span>Save your changes before opening another file?</span><button onClick={()=>void save().then(saved=>{if(saved){void load(pending);setPending(null);}})}>Save</button><button onClick={()=>{void load(pending);setPending(null);}}>Discard</button><button onClick={()=>setPending(null)}>Cancel</button></div>}{error&&<p className="inline-error" role="alert">{error}</p>}{loading?<p>Loading file…</p>:imageFile?<div className="file-image-preview" key={`${selected}:${imageRevision}`}><WorkspaceImage url={fileMediaURL(session.id,selected)} name={selected.split("/").at(-1)!}/></div>:<><div className="editor-code-surface" hidden={preview}><Suspense fallback={<p>Opening editor…</p>}><CodeEditor path={selected} value={content} onChange={setContent} wrap={preferences.word_wrap} disabled={saving||Boolean(error)&&!original} comments={comments.filter(comment=>comment.source==="file"&&comment.path===selected)} onComments={onComments}/></Suspense></div>{preview&&<div className="file-markdown-preview"><MarkdownMessage session={session} filePath={selected} reviewComments={comments} onReviewComments={onComments}>{content}</MarkdownMessage></div>}</>}</div>,editorTarget)}</section>;
}

function SideChatsFooter({chats,busy,onOpen,onNew,onFork}:{chats:Session[];busy:boolean;onOpen:(id:string)=>void;onNew:()=>void;onFork:()=>void}){
 const [open,setOpen]=useState(true);
 return <section className="files-side-chats" aria-label="Side chats"><header><button className="files-side-toggle" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?<CaretDown/>:<CaretRight/>}<strong>Chats</strong><span>{chats.length}</span></button><button aria-label="New side chat" title="New side chat" disabled={busy} onClick={onNew}><Plus/></button><button aria-label="Fork this chat" title="Fork this chat" disabled={busy} onClick={onFork}><GitBranch/></button></header>{open&&<div className="files-side-chat-list">{chats.length?chats.map(chat=><button key={chat.id} onClick={()=>onOpen(chat.id)} aria-label={`Open side chat ${chat.title}`}><span className={`status-dot ${chat.status}`}/><span>{chat.title}</span></button>):<div className="files-side-empty"><ChatCircleDots/><p>Side chats will appear here when they are created</p><div><button disabled={busy} onClick={onFork}><GitBranch/>Fork</button><button disabled={busy} onClick={onNew}><Plus/>New side chat</button></div></div>}</div>}</section>;
}

function fileTree(files:string[]){const entries=new Map<string,{path:string;directory:boolean;depth:number}>();for(const file of files){const parts=file.split("/");parts.forEach((_,i)=>{const path=parts.slice(0,i+1).join("/");entries.set(path,{path,directory:i<parts.length-1,depth:i});});}return [...entries.values()].sort((a,b)=>{const left=a.path.split("/"),right=b.path.split("/");for(let i=0;i<Math.min(left.length,right.length);i++){if(left[i]!==right[i]){const leftDir=i<left.length-1||a.directory,rightDir=i<right.length-1||b.directory;if(leftDir!==rightDir)return leftDir?-1:1;return left[i].localeCompare(right[i]);}}return left.length-right.length;});}

const fileSearchEncoder=new TextEncoder();
const byteLength=(value:string)=>fileSearchEncoder.encode(value).length;
const compareText=(left:string,right:string)=>left<right?-1:left>right?1:0;
const compareFilePaths=(left:string,right:string)=>compareText(left.toLowerCase(),right.toLowerCase())||compareText(left,right);

function fileSearchScore(path:string,query:string):number|null{
 const name=path.split("/").at(-1)!.toLowerCase(),full=path.toLowerCase();
 if(name===query)return 10000;
 if(name.startsWith(query))return 8000-byteLength(name);
 const nameIndex=name.indexOf(query);
 if(nameIndex>=0)return 6000-byteLength(name.slice(0,nameIndex))-byteLength(name);
 const pathIndex=full.indexOf(query);
 if(pathIndex>=0)return 4000-byteLength(full.slice(0,pathIndex))-byteLength(full);
 const wanted=[...query];let matched=0,gaps=0;
 for(const character of full){if(character===wanted[matched]){matched++;if(matched===wanted.length)return 2000-gaps-byteLength(full);}else gaps++;}
 return null;
}

function fileSearchTree(matches:{path:string;score:number}[],collapsed:Set<string>){
 type Node={path:string;name:string;directory:boolean;score:number|null;bestScore:number;children:string[]};
 const nodes=new Map<string,Node>(),roots:string[]=[];
 for(const match of matches){
  const parts=match.path.split("/").filter(Boolean);let parent="";
  for(let index=0;index<parts.length;index++){
   const path=parts.slice(0,index+1).join("/"),directory=index<parts.length-1;
   let node=nodes.get(path);
   if(!node){node={path,name:parts[index],directory,score:null,bestScore:match.score,children:[]};nodes.set(path,node);}
   if(directory)node.directory=true;
   if(!directory)node.score=Math.max(node.score??-Infinity,match.score);
   const siblings=parent?nodes.get(parent)!.children:roots;
   if(!siblings.includes(path))siblings.push(path);
   parent=path;
  }
 }
 const best=(path:string):number=>{const node=nodes.get(path)!;node.bestScore=Math.max(node.score??-Infinity,...node.children.map(best));return node.bestScore;};
 roots.forEach(best);
 const order=(left:string,right:string)=>{const a=nodes.get(left)!,b=nodes.get(right)!;return b.bestScore-a.bestScore||Number(b.directory)-Number(a.directory)||compareFilePaths(a.name,b.name)||compareText(a.path,b.path);};
 const rows:{path:string;directory:boolean;depth:number}[]=[];
 const append=(path:string,depth:number)=>{const node=nodes.get(path)!;rows.push({path,directory:node.directory,depth});if(node.directory&&!collapsed.has(path))node.children.sort(order).forEach(child=>append(child,depth+1));};
 roots.sort(order).forEach(root=>append(root,0));
 return rows;
}
