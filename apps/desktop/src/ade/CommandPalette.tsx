import {useEffect,useId,useRef,useState} from "react";
import {MagnifyingGlass,Plus,Folder,Gear,Sun,Moon} from "@phosphor-icons/react";
import {Session,projectName,relativeTime} from "./api";
import {Preferences,displayShortcut,shortcutMatches} from "./preferences";
import {ProviderIcon} from "./ProviderIcon";
import {markCustomMenu} from "./menuKeys";

type Action="new"|"project"|"settings"|"theme";
type Entry={id:string;label:string;action?:Action;session?:Session;hint?:string};

// Mirrors Zeron's global action/history palette, independent of sidebar filters.
export function CommandPalette({sessions,preferences,isDark,onClose,onAction,onOpen}:{sessions:Session[];preferences:Preferences;isDark:boolean;onClose:()=>void;onAction:(action:Action)=>void;onOpen:(id:string)=>void}){
 const [query,setQuery]=useState("");const [active,setActive]=useState(0);
 const card=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null);const id=useId();
 const matches=(text:string)=>query.trim().toLowerCase().split(/\s+/).every(word=>text.toLowerCase().includes(word));
 const actions:Entry[]=[{id:"new",label:"New chat",action:"new",hint:displayShortcut(preferences.shortcuts.newSession)},{id:"project",label:"New project",action:"project",hint:displayShortcut(preferences.shortcuts.newProject)},{id:"settings",label:"Open settings",action:"settings",hint:displayShortcut(preferences.shortcuts.settings)},{id:"theme",label:`Switch to ${isDark?"light":"dark"} theme`,action:"theme"}];
 const ordered=[...sessions].sort((a,b)=>preferences.project_sort==="manual"?((preferences.session_order.indexOf(a.id)+1||999999)-(preferences.session_order.indexOf(b.id)+1||999999)):preferences.project_sort==="priority"?Number(["starting","running","waiting"].includes(b.status))-Number(["starting","running","waiting"].includes(a.status))||Date.parse(b.updated_at)-Date.parse(a.updated_at):Date.parse(preferences.project_sort==="created"?b.created_at:b.updated_at)-Date.parse(preferences.project_sort==="created"?a.created_at:a.updated_at));
 const entries:Entry[]=[...actions.filter(entry=>matches(entry.label)),...ordered.filter(session=>matches(`${session.title} ${projectName(session.repo_root)} Local ${session.branch} ${session.pr_url??""}`)).slice(0,30).map(session=>({id:session.id,label:session.title,session}))];
 const current=Math.min(active,Math.max(0,entries.length-1));
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const release=markCustomMenu(card.current);search.current?.focus();return()=>{release();if(previous?.isConnected)previous.focus();};},[]);
 useEffect(()=>{card.current?.querySelector(`[data-palette-index="${current}"]`)?.scrollIntoView({block:"nearest"});},[current,query]);
 const activate=(entry:Entry)=>{if(entry.action==="theme"){onAction(entry.action);return;}onClose();if(entry.action)onAction(entry.action);else if(entry.session)onOpen(entry.session.id);};
 return <div className="command-palette-overlay" onPointerDown={event=>{if(event.target===event.currentTarget)onClose();}}><div ref={card} className="command-palette" role="dialog" aria-modal="true" aria-label="Commands and chats" onKeyDown={event=>{
  if(event.nativeEvent.isComposing)return;
  if(event.key==="Escape"||shortcutMatches(event.nativeEvent,preferences.shortcuts.commandPalette)){event.preventDefault();event.stopPropagation();onClose();}
  else if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)){event.preventDefault();event.stopPropagation();setActive(event.key==="Home"?0:event.key==="End"?Math.max(0,entries.length-1):(current+(event.key==="ArrowDown"?1:-1)+entries.length)%Math.max(1,entries.length));}
  else if(event.key==="Enter"){event.preventDefault();event.stopPropagation();if(!event.repeat&&entries[current])activate(entries[current]);}
  else if(event.key==="Tab"){event.preventDefault();search.current?.focus();}
 }}><header><MagnifyingGlass/><input ref={search} aria-label="Search commands and chats" role="combobox" aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={entries[current]?`${id}-${current}`:undefined} placeholder="Search commands and chats…" value={query} onChange={event=>{setQuery(event.target.value);setActive(0);}}/><kbd>{displayShortcut(preferences.shortcuts.commandPalette)}</kbd></header><div role="listbox" id={id} aria-label="Commands and chats" className="command-palette-results">{entries.map((entry,index)=><button type="button" role="option" aria-selected={index===current} id={`${id}-${index}`} key={entry.id} data-palette-index={index} tabIndex={-1} className={`${index===current?"highlighted":""} ${entry.session&&!entries[index-1]?.session?"palette-history-first":""}`} onPointerMove={()=>setActive(index)} onClick={()=>activate(entry)}>{entry.session?null:entry.action==="new"?<Plus/>:entry.action==="project"?<Folder/>:entry.action==="settings"?<Gear/>:isDark?<Sun/>:<Moon/>}<span className={entry.session?"palette-chat":""}>{entry.session&&<small>{projectName(entry.session.repo_root)} @ Local</small>}<span>{entry.session&&preferences.sidebar_show_provider&&<ProviderIcon provider={entry.session.agent}/>} {entry.label}{entry.session&&preferences.archived_sessions.includes(entry.session.id)&&<em>Archived</em>}</span>{entry.session&&preferences.sidebar_show_branch&&<small>{entry.session.branch}</small>}</span>{entry.hint&&<kbd>{entry.hint}</kbd>}{entry.session&&<time>{relativeTime(entry.session.updated_at)}</time>}</button>)}{!entries.length&&<p>No results<small>Try a command, chat title, project, or device.</small></p>}</div><footer><span>↑ ↓ to navigate</span><span>↵ Select</span><span>Esc Close</span></footer></div></div>;
}
