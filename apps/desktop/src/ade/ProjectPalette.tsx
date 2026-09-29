import {useEffect, useId, useRef, useState} from "react";
import {ArrowLeft, Desktop, Folder, HardDrives, House, MagnifyingGlass, Plus} from "@phosphor-icons/react";
import {getProjectDirectories, getProjectLocations, ProjectDirectoryListing, registerProject} from "./api";
import {markCustomMenu} from "./menuKeys";

type Step = "device" | "locations" | "folders";
type Location = {name:string;path:string};

export function ProjectPalette({onClose,onAdded,onCommands}:{onClose:()=>void;onAdded:(path:string)=>void;onCommands:()=>void}){
 const [step,setStep]=useState<Step>("device"),[locations,setLocations]=useState<Location[]>([]),[location,setLocation]=useState<Location|null>(null);
 const [listing,setListing]=useState<ProjectDirectoryListing>({path:"",parent:"",entries:[]});
 const [query,setQuery]=useState(""),[active,setActive]=useState(0),[busy,setBusy]=useState(false),[choosing,setChoosing]=useState(false),[error,setError]=useState("");
 const [crumbMenu,setCrumbMenu]=useState<{left:number;top:number}|null>(null);
 const card=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),crumbTrigger=useRef<HTMLButtonElement>(null),crumbPopup=useRef<HTMLDivElement>(null),epoch=useRef(0),id=useId();

 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,release=markCustomMenu(card.current);
  input.current?.focus();
  return()=>{epoch.current++;release();if(previous?.isConnected)previous.focus();};
 },[]);
 useEffect(()=>{
  if(!crumbMenu)return;
  crumbPopup.current?.querySelector('button')?.focus();
  const dismiss=(event:PointerEvent)=>{const target=event.target as Node;if(!crumbPopup.current?.contains(target)&&!crumbTrigger.current?.contains(target))setCrumbMenu(null);};
  document.addEventListener("pointerdown",dismiss,true);
  return()=>document.removeEventListener("pointerdown",dismiss,true);
 },[crumbMenu]);

 const showLocations=async()=>{
  const request=++epoch.current;
  setCrumbMenu(null);
  setStep("locations");setLocation(null);setQuery("");setActive(0);setBusy(true);setError("");
  try{const result=await getProjectLocations();if(request===epoch.current)setLocations(result.locations);}
  catch(reason){if(request===epoch.current)setError(reason instanceof Error?reason.message:"Cannot list locations.");}
  finally{if(request===epoch.current){setBusy(false);input.current?.focus();}}
 };
 const load=async(path:string,selected?:Location)=>{
  const request=++epoch.current;setCrumbMenu(null);setBusy(true);setError("");
  try{
   const result=await getProjectDirectories(path);
   if(request===epoch.current){setListing(result);setStep("folders");if(selected)setLocation(selected);setQuery("");setActive(0);}
  }catch(reason){if(request===epoch.current)setError(reason instanceof Error?reason.message:"Cannot open this folder.");}
  finally{if(request===epoch.current){setBusy(false);input.current?.focus();}}
 };
 const back=()=>{
  if(busy)return;
  setCrumbMenu(null);
  if(step==="device"){onClose();onCommands();return;}
  input.current?.focus();
  if(step==="locations"){setStep("device");setQuery("");setActive(0);setError("");return;}
  if(!location||listing.path===location.path||listing.parent===listing.path){setStep("locations");setQuery("");setActive(0);setError("");return;}
  void load(listing.parent);
 };
 const add=async()=>{
  if(step!=="folders"||!listing.path||busy||error)return;
  const request=++epoch.current;setBusy(true);setError("");
  try{const result=await registerProject(listing.path);if(request===epoch.current){onAdded(result.path);onClose();}}
  catch(reason){if(request===epoch.current)setError(reason instanceof Error?reason.message:"Cannot add this project.");}
  finally{if(request===epoch.current)setBusy(false);}
 };
 const browse=async()=>{
  if(choosing)return;
  const attempt=++epoch.current;setBusy(false);setChoosing(true);setError("");
  const bridge=window as typeof window&{go?:{main?:{App?:{SelectRepository?:()=>Promise<string>}}}};
  try{const path=await bridge.go?.main?.App?.SelectRepository?.();if(attempt!==epoch.current)return;setChoosing(false);if(path)void load(path,{name:"Selected folder",path});}
  catch(reason){if(attempt===epoch.current)setError(reason instanceof Error?reason.message:"Folder selection failed.");}
  finally{if(attempt===epoch.current)setChoosing(false);}
 };

 const entries=step==="device"?[{name:"Local",path:""}]:step==="locations"?locations:listing.entries;
 const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
 const filtered=entries.filter(entry=>words.every(word=>entry.name.toLowerCase().includes(word)));
 const current=Math.min(active,Math.max(0,filtered.length-1));
 const select=(entry:Location)=>{if(step==="device")void showLocations();else if(step==="locations")void load(entry.path,entry);else void load(entry.path);};
 const openActive=()=>{if(busy)return;if(step==="folders"&&(/^(\/|~\/|[A-Za-z]:[\\/])/.test(query))){void load(query);return;}const entry=filtered[current];if(entry)select(entry);};
 useEffect(()=>{card.current?.querySelector(`[data-folder-index="${current}"]`)?.scrollIntoView({block:"nearest"});},[current,listing.path,query,step]);
 const root=location?.path.replace(/\/$/,"")??"";
 const crumbFolders=location&&step==="folders"&&listing.path.startsWith(root+"/")?listing.path.slice(root.length+1).split("/").filter(Boolean):[];
 const folderCrumbs=crumbFolders.map((name,index)=>({name,path:root+"/"+crumbFolders.slice(0,index+1).join("/")}));
 const hiddenCrumbs=folderCrumbs.length>3?folderCrumbs.slice(0,-2):[];
 const visibleCrumbs=hiddenCrumbs.length?folderCrumbs.slice(-2):folderCrumbs;
 const canBrowse=Boolean((window as typeof window&{go?:{main?:{App?:{SelectRepository?:()=>Promise<string>}}}}).go?.main?.App?.SelectRepository);

 return <div className="command-palette-overlay" onPointerDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
  <div ref={card} className="command-palette project-palette" role="dialog" aria-modal="true" aria-label="New project" onKeyDown={event=>{
   if(event.nativeEvent.isComposing)return;
   if(event.key==="Escape"){event.preventDefault();event.stopPropagation();onClose();}
   else if(event.key==="Tab"){
    if(!event.shiftKey&&step==="folders"&&query&&filtered[current]?.name.toLowerCase().startsWith(query.toLowerCase())&&filtered[current].name.toLowerCase()!==query.toLowerCase()){
     event.preventDefault();setQuery(filtered[current].name);return;
    }
    event.preventDefault();const controls=[...card.current!.querySelectorAll<HTMLElement>('input,button:not(:disabled)')].filter(el=>el.tabIndex>=0);
    const index=controls.indexOf(document.activeElement as HTMLElement);controls[(index+(event.shiftKey?-1:1)+controls.length)%controls.length]?.focus();
   }else if(event.key==="ArrowDown"||event.key==="ArrowUp"){
    event.preventDefault();setActive((current+(event.key==="ArrowDown"?1:-1)+filtered.length)%Math.max(1,filtered.length));
   }else if(event.key==="ArrowLeft"){event.preventDefault();back();}
   else if(event.key==="ArrowRight"){event.preventDefault();openActive();}
   else if(event.key==="Backspace"&&query===""){event.preventDefault();back();}
   else if(event.key==="Enter"){
    event.preventDefault();if(event.repeat||busy)return;
    if(event.metaKey||event.ctrlKey){void add();return;}
    openActive();
   }
  }}>
   <header><MagnifyingGlass/><input ref={input} role="combobox" aria-label={step==="device"?"Search devices":step==="locations"?"Search locations":"Search folders"} aria-controls={id} aria-expanded="true" aria-activedescendant={filtered[current]?`${id}-${current}`:undefined} placeholder={step==="device"?"Search devices…":step==="locations"?"Search locations…":"Search folders or enter a path…"} value={query} onChange={event=>{setQuery(event.target.value);setActive(0);}}/><kbd>esc</kbd></header>
   <div className="project-palette-breadcrumb"><button type="button" aria-label="Back" disabled={busy} onClick={back}><ArrowLeft/></button><button type="button" disabled={busy||step==="device"} onClick={()=>{setCrumbMenu(null);setStep("device");setQuery("");setActive(0);input.current?.focus();}}>New project</button>{step!=="device"&&<><span>›</span><button type="button" disabled={busy||step==="locations"} onClick={()=>{setCrumbMenu(null);setStep("locations");setQuery("");setActive(0);input.current?.focus();}}>Local</button></>}{step==="folders"&&location&&<><span>›</span><button type="button" disabled={busy||listing.path===location.path} onClick={()=>void load(location.path)}>{location.name}</button>{hiddenCrumbs.length>0&&<span className="project-crumb-pair"><span>›</span><button type="button" ref={crumbTrigger} aria-label="Show hidden folders" aria-expanded={Boolean(crumbMenu)} onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();setCrumbMenu(current=>current?null:{left:Math.max(8,Math.min(rect.left,window.innerWidth-288)),top:rect.bottom+6});}}>…</button></span>}{visibleCrumbs.map(({name,path})=><span className="project-crumb-pair" key={path}><span>›</span><button type="button" disabled={busy||path===listing.path} onClick={()=>void load(path)}>{name}</button></span>)}</>}</div>
   <div className="command-palette-results" role="listbox" aria-label={step==="device"?"Project devices":step==="locations"?"Project locations":"Project folders"} id={id}>{filtered.map((entry,index)=><button type="button" role="option" id={`${id}-${index}`} key={entry.path||entry.name} data-folder-index={index} tabIndex={-1} aria-selected={index===current} disabled={busy} className={index===current?"highlighted":""} onPointerMove={()=>setActive(index)} onClick={()=>select(entry)}>{step==="device"?<Desktop/>:step==="locations"?(entry.name==="Home"?<House/>:<HardDrives/>):<Folder/>}<span>{entry.name}</span>{step==="device"&&<i className="status-dot completed"/>}</button>)}{busy&&<p role="status">Loading…</p>}{!busy&&!filtered.length&&<p>{step==="device"?"No devices found":step==="locations"?"No locations found":"No folders match"}</p>}</div>
   {error&&<p className="inline-error" role="alert">{error}</p>}{step==="folders"&&listing.limited&&<p className="project-picker-note">Showing the first 1,000 folders. Enter a path to open another location.</p>}
   {step==="folders"&&listing.path&&<div className="project-palette-add"><span>{listing.git?"Git project":"Folder workspace"}</span><button type="button" disabled={busy||Boolean(error)} onClick={()=>void add()}><Plus/>Add project</button></div>}
   <footer><span>↑ ↓ Navigate</span><span>↵ {step==="folders"?"Open":"Select"}</span>{step!=="device"&&<span>← Back</span>}{step==="folders"&&<span>⌘↵ Add</span>}{step==="folders"&&canBrowse&&<button type="button" disabled={choosing} onClick={()=>void browse()}>Browse folders…</button>}<span>Esc Close</span></footer>
  </div>
  {crumbMenu&&<div ref={crumbPopup} className="project-palette-crumb-menu" role="menu" aria-label="Hidden project folders" style={{left:crumbMenu.left,top:crumbMenu.top}} onKeyDown={event=>{
   if(event.key==="Escape"||event.key==="Tab"){event.preventDefault();event.stopPropagation();setCrumbMenu(null);crumbTrigger.current?.focus();return;}
   if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();const items=[...crumbPopup.current!.querySelectorAll<HTMLButtonElement>('button')];const index=items.indexOf(document.activeElement as HTMLButtonElement);items[(index+(event.key==="ArrowDown"?1:-1)+items.length)%items.length]?.focus();}
  }}>{hiddenCrumbs.map(({name,path})=><button type="button" role="menuitem" key={path} onClick={()=>void load(path)}><Folder size={16}/>{name}</button>)}</div>}
 </div>;
}
