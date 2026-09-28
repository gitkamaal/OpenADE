import {themeId,resolveTheme} from "./themes";
import type {NewThreadArtworkEffect} from "./api";
export type ThemePreference = "graphite" | "dusk" | "paper" | "glass" | "system";
export type SessionSurface = "chat" | "terminal";
export type ActivityDetail = "compact" | "expanded";
export type ProjectOrganization = "project" | "device" | "list";
export type ProjectSort = "priority" | "updated" | "created" | "manual";
export interface SidebarSection { id:string; name:string; collapsed:boolean; }
export const MAX_BACKGROUND_TRANSPARENCY = 90;
export const settingsSections = ["General","Appearance","Notifications","Shortcuts","Providers","Devices","Files","Archived sessions"] as const;
export type SettingsSection = typeof settingsSections[number];
export const defaultShortcuts: Record<string,string> = { ...Object.fromEntries(Array.from({length:9},(_,i)=>[`jump${i+1}`,`Mod+${i+1}`])), commandPalette:"Mod+K",newProject:"Mod+Shift+N", sidebar:"Mod+B", panel:"Mod+R", files:"Mod+E", terminal:"Mod+J", newSession:"Mod+N", model:"Mod+/", settings:"Mod+,", next:"Ctrl+Tab", previous:"Ctrl+Shift+Tab", focusComposer:"Mod+L", browser:"Mod+Shift+B", diffs:"Mod+Shift+D", history:"Mod+Shift+H", closePanel:"Mod+Shift+W", nextPanel:"Mod+Alt+ArrowRight", previousPanel:"Mod+Alt+ArrowLeft", searchFiles:"Mod+P" };
export interface Preferences {
 settings_section:SettingsSection; theme: ThemePreference; color_scheme: "system" | "light" | "dark"; dark_theme: string; light_theme: string; transparency:number; default_agent: string; session_surface: SessionSurface; activity_detail: ActivityDetail;
 sidebar_project_filter:string; project_root: string; project_organization: ProjectOrganization; project_sort: ProjectSort;
 send_behavior: "enter" | "mod-enter"; stop_on_escape: boolean; accent: string; glass: "default" | "opaque" | "frosted" | "liquid";
 interface_font: string; interface_size: number; terminal_font:string; code_font:string; terminal_size: number; code_size: number; conversation_width:number;
 sidebar_width:number; panel_width:number; sidebar_open:boolean; sidebar_compact:boolean; sidebar_show_branch:boolean; sidebar_show_pr:boolean; sidebar_show_provider:boolean; sidebar_show_project_icon:boolean; sidebar_show_project_label:boolean;
 notifications:boolean; background_only:boolean; sounds:boolean; sound_completed:boolean; sound_input:boolean; sound_errors:boolean;
 diff_split:boolean;diff_wrap:boolean;code_fences_fit_content:boolean;open_web_links_in_app:boolean;autosave_delay_ms:number;
 word_wrap:boolean; show_hidden:boolean; show_ignored:boolean; autosave:boolean; new_thread_background_effect:NewThreadArtworkEffect;
 sidebar_sections:SidebarSection[]; session_sections:Record<string,string>; session_order:string[]; disabled_providers:string[]; archived_sessions:string[]; pinned_sessions:string[]; shortcuts:Record<string,string>;
}
export const defaultPreferences: Preferences = {
 settings_section:"General", theme:"graphite", color_scheme:"dark", dark_theme:"zeron-dark", light_theme:"zeron-light", transparency:50, default_agent:"claude", session_surface:"chat", activity_detail:"compact", sidebar_project_filter:"", project_root:"", project_organization:"project", project_sort:"updated",
 send_behavior:"enter", stop_on_escape:false, accent:"default", glass:"frosted", interface_font:"Geist", interface_size:16, terminal_font:"Geist Mono", code_font:"Geist Mono", terminal_size:13, code_size:12.5, conversation_width:736,
 sidebar_width:256, panel_width:520, sidebar_open:true, sidebar_compact:true,sidebar_show_branch:false,sidebar_show_pr:false,sidebar_show_provider:true,sidebar_show_project_icon:false,sidebar_show_project_label:true,
 notifications:false, background_only:true, sounds:false, sound_completed:true, sound_input:true, sound_errors:true,
 diff_split:false,diff_wrap:false,code_fences_fit_content:false,open_web_links_in_app:true,autosave_delay_ms:900,
 word_wrap:false, show_hidden:false, show_ignored:false, autosave:false, new_thread_background_effect:"none", sidebar_sections:[],session_sections:{},session_order:[], disabled_providers:[], archived_sessions:[], pinned_sessions:[], shortcuts:defaultShortcuts,
};
export function loadPreferences(): Preferences {
 try {
  const stored:unknown = JSON.parse(localStorage.getItem("openade.preferences") ?? "{}");
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {...defaultPreferences};
  const result = {...defaultPreferences}; const raw = stored as Record<string,unknown>;
  for (const key of Object.keys(defaultPreferences) as (keyof Preferences)[]) {
   const value = raw[key]; const fallback = defaultPreferences[key];
   if(key==="sidebar_sections"&&Array.isArray(value)){const seen=new Set<string>();const legacy=value.every(item=>typeof item==="string");result.sidebar_sections=value.flatMap((item,index):SidebarSection[]=>{const source=typeof item==="string"?{id:`legacy-${index}-${item.replace(/[^a-z0-9]+/gi,"-").slice(0,48)}`,name:item,collapsed:false}:item;if(!source||typeof source!=="object"||Array.isArray(source)||typeof (source as SidebarSection).id!=="string"||typeof (source as SidebarSection).name!=="string")return [];let id=(source as SidebarSection).id.trim().slice(0,160);const name=(source as SidebarSection).name.trim().slice(0,120);if(!id||!name)return [];if(seen.has(id))id=`legacy-repaired-${index}-${id.slice(0,120)}`;seen.add(id);return [{id,name,collapsed:Boolean((source as SidebarSection).collapsed)}];});if(legacy){const ids=Object.fromEntries(result.sidebar_sections.map(section=>[section.name,section.id]));result.session_sections=Object.fromEntries(Object.entries(raw.session_sections??{}).filter((entry):entry is [string,string]=>typeof entry[1]==="string").map(([id,name])=>[id,ids[name]??name]));}}
   else if (Array.isArray(fallback)) { if (Array.isArray(value) && value.every(v=>typeof v === "string")) Object.assign(result,{[key]:value}); }
   else if (key === "session_sections") {if(value&&typeof value==="object"&&!Array.isArray(value))result.session_sections=Object.fromEntries(Object.entries(value).filter(([,v])=>typeof v==="string")) as Record<string,string>;}
   else if (key === "shortcuts") { if (value && typeof value === "object") result.shortcuts = {...defaultShortcuts,...Object.fromEntries(Object.entries(value).filter(([,v])=>typeof v === "string"))}; }
   else if (typeof value === typeof fallback && (typeof value !== "number" || Number.isFinite(value))) Object.assign(result,{[key]:value});
  }
  if (!settingsSections.includes(result.settings_section)) result.settings_section="General";
  if(Array.isArray(raw.sidebar_sections)){const firstByName=new Map<string,string>();const knownIds=new Set<string>();for(const section of result.sidebar_sections){knownIds.add(section.id);if(!firstByName.has(section.name))firstByName.set(section.name,section.id);}result.session_sections=Object.fromEntries(Object.entries(result.session_sections).flatMap(([id,membership])=>{const resolved=knownIds.has(membership)?membership:firstByName.get(membership);return resolved?[[id,resolved]]:[];}));if(raw.sidebar_sections.some(item=>typeof item!=="object"||item===null||Array.isArray(item)))localStorage.setItem("openade.preferences",JSON.stringify(result));}
  if (!["graphite","dusk","paper","glass","system"].includes(result.theme)) result.theme="graphite";
  // Preserve the appearance of older profiles while separating palette and material.
  if (!("color_scheme" in raw)) result.color_scheme = result.theme === "system" ? "system" : result.theme === "paper" ? "light" : "dark";
  if (!("dark_theme" in raw)) result.dark_theme = result.theme === "dusk" ? "gruvbox-dark" : "zeron-dark";
  if (!["system","light","dark"].includes(result.color_scheme)) result.color_scheme="dark";
  // Native library entries arrive after the engine connects. Keep their saved
  // selections while the built-in fallback is rendered during startup.
  result.dark_theme=themeId(result.dark_theme,"dark",true);
  result.light_theme=themeId(result.light_theme,"light",true);
  if (!("transparency" in raw)&&"glass" in raw) result.transparency=raw.glass==="transparent"?50:45;
  result.transparency=Math.min(MAX_BACKGROUND_TRANSPARENCY,Math.max(0,result.transparency));
  if (raw.glass==="transparent") result.glass="frosted";
  if (!["default","opaque","frosted","liquid"].includes(result.glass)) result.glass="default";
  if (!["chat","terminal"].includes(result.session_surface)) result.session_surface="chat";
  if (!["none","dither","ascii","halftone","scanlines"].includes(result.new_thread_background_effect)) result.new_thread_background_effect="none";
  if (!["project","device","list"].includes(result.project_organization)) result.project_organization="project";
  if (!["priority","updated","created","manual"].includes(result.project_sort)) result.project_sort="updated";
  result.autosave_delay_ms=Math.min(5000,Math.max(100,result.autosave_delay_ms));
  result.sidebar_width=Math.min(400,Math.max(224,result.sidebar_width)); result.panel_width=Math.min(900,Math.max(360,result.panel_width));
  result.conversation_width=Math.min(1200,Math.max(560,result.conversation_width));
  for(const key of ["interface_font","code_font","terminal_font"] as const){if(!result[key]||result[key].length>200||/[\x00-\x1f]/.test(result[key]))result[key]=defaultPreferences[key];}
  result.interface_size=Math.min(20,Math.max(12,result.interface_size)); result.terminal_size=Math.min(32,Math.max(8,result.terminal_size)); result.code_size=Math.min(32,Math.max(8,result.code_size));
  return result;
 } catch { return {...defaultPreferences}; }
}
export function savePreferences(preferences:Preferences) { localStorage.setItem("openade.preferences",JSON.stringify(preferences)); }
export function themeClass(preferences:Preferences,systemLight=false):string {
 return resolveTheme(preferences,systemLight).appearance==="light"?"theme-light":"theme-dark";
}
export function shortcutMatches(event:KeyboardEvent, binding:string):boolean {
 const bits=binding.toLowerCase().split("+"); const key=bits.pop();
 return event.key.toLowerCase() === key && event.shiftKey === bits.includes("shift") && event.altKey === bits.includes("alt") &&
 (bits.includes("mod") ? (event.metaKey || event.ctrlKey) : event.metaKey === bits.includes("meta") && event.ctrlKey === bits.includes("ctrl"));
}
export function shouldSend(event:{key:string;shiftKey:boolean;metaKey:boolean;ctrlKey:boolean;nativeEvent:{isComposing:boolean}}, behavior:Preferences["send_behavior"]):boolean {
 return !event.nativeEvent.isComposing && event.key === "Enter" && !event.shiftKey && (behavior === "enter" || event.metaKey || event.ctrlKey);
}

export const shortcutLabels:Record<string,string>={...Object.fromEntries(Array.from({length:9},(_,i)=>[`jump${i+1}`,`Jump to chat ${i+1}`])),commandPalette:"Search commands and chats",newProject:"New project",sidebar:"Toggle left sidebar",panel:"Toggle right sidebar",files:"Toggle files panel",terminal:"Toggle terminal",newSession:"New chat",model:"Open model picker",settings:"Settings",next:"Next chat",previous:"Previous chat",focusComposer:"Focus composer",browser:"Open browser",diffs:"Open diffs",history:"Open history",closePanel:"Close current panel",nextPanel:"Next panel",previousPanel:"Previous panel",searchFiles:"Search files"};
export function displayShortcut(binding:string){return binding.split("+").map(key=>({Mod:/Mac|iPhone|iPad/.test(navigator.platform)?"⌘":"Ctrl",Ctrl:"⌃",Alt:"⌥",Shift:"⇧",ArrowLeft:"←",ArrowRight:"→",Tab:"⇥"} as Record<string,string>)[key]||key.toUpperCase()).join(" ");}
