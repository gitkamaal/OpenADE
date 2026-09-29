import {useEffect, useRef, useState} from "react";
import {Session} from "./api";
import {displayShortcut, Preferences} from "./preferences";

const mac=()=>/Mac|iPhone|iPad/.test(navigator.platform);
function modifiersMatch(event:KeyboardEvent,binding:string){
 const parts=binding.toLowerCase().split("+");parts.pop();
 return event.metaKey===(parts.includes("meta")||(mac()&&parts.includes("mod"))) && event.ctrlKey===(parts.includes("ctrl")||(!mac()&&parts.includes("mod"))) && event.altKey===parts.includes("alt") && event.shiftKey===parts.includes("shift");
}
export function jumpShortcutMatches(event:KeyboardEvent,binding:string){
 return Boolean(binding)&&event.key.toLowerCase()===binding.toLowerCase().split("+").at(-1)&&modifiersMatch(event,binding);
}
export function keyboardOverlayOpen(){
 return [...document.querySelectorAll<HTMLElement>('[role="dialog"],[role="menu"],.select-popover,.model-menu,.image-lightbox,.command-palette,.project-palette')].some(element=>!element.closest('[hidden],[inert]')&&element.getClientRects().length>0);
}
export function visibleSidebarSessionIds(eligible:Session[]){
 const ids=new Set(eligible.map(session=>session.id));
 return [...new Set([...document.querySelectorAll<HTMLElement>(".sidebar-chat-row[data-session-id]")].filter(row=>!row.closest('[hidden],[inert]')).map(row=>row.dataset.sessionId!).filter(id=>ids.has(id)))];
}
export function useSessionJumpHints(sessions:Session[],preferences:Preferences){
 const [hints,setHints]=useState<Record<string,string>>({});
 const heldRef=useRef<KeyboardEvent|null>(null);
 useEffect(()=>{
  const update=()=>{
   const held=heldRef.current;
   const visible=held&&(held.metaKey||held.ctrlKey||held.altKey||held.shiftKey)&&!keyboardOverlayOpen()&&Object.entries(preferences.shortcuts).some(([key,binding])=>/^jump[1-9]$/.test(key)&&modifiersMatch(held!,binding));
   const eligible=sessions.filter(session=>!preferences.sidebar_project_filter||session.repo_root===preferences.sidebar_project_filter);
   const next:Record<string,string>={};
   if(visible)visibleSidebarSessionIds(eligible).slice(0,9).forEach((id,i)=>{const binding=preferences.shortcuts[`jump${i+1}`];if(binding)next[id]=displayShortcut(binding);});
   setHints(current=>JSON.stringify(current)===JSON.stringify(next)?current:next);
  };
  const key=(event:KeyboardEvent)=>{heldRef.current=event;update();};const clear=()=>{heldRef.current=null;update();};
  window.addEventListener("keydown",key);window.addEventListener("keyup",key);window.addEventListener("blur",clear);document.addEventListener("visibilitychange",clear);
  const root=document.querySelector('.ade');const observer=new MutationObserver(update);
  if(root)observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','inert','data-session-id']});
  update();
  return()=>{observer.disconnect();window.removeEventListener("keydown",key);window.removeEventListener("keyup",key);window.removeEventListener("blur",clear);document.removeEventListener("visibilitychange",clear);};
 },[sessions,preferences]);
 return hints;
}
