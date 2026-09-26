export type ThemePreference = "graphite" | "dusk" | "paper" | "glass" | "system";
export type SessionSurface = "chat" | "terminal";
export type ActivityDetail = "compact" | "expanded";
export type ProjectOrganization = "project" | "list";
export type ProjectSort = "priority" | "updated" | "manual";
export const defaultShortcuts: Record<string,string> = { sidebar:"Mod+B", panel:"Mod+R", files:"Mod+E", terminal:"Mod+J", newSession:"Mod+N", model:"Mod+/", settings:"Mod+,", next:"Ctrl+Tab", previous:"Ctrl+Shift+Tab", focusComposer:"Mod+L", browser:"Mod+Shift+B", diffs:"Mod+Shift+D", history:"Mod+Shift+H", closePanel:"Mod+Shift+W", nextPanel:"Mod+Alt+ArrowRight", previousPanel:"Mod+Alt+ArrowLeft", searchFiles:"Mod+P" };
export interface Preferences {
 theme: ThemePreference; color_scheme: "system" | "light" | "dark"; dark_theme: "graphite" | "dusk"; default_agent: string; session_surface: SessionSurface; activity_detail: ActivityDetail;
 project_root: string; project_organization: ProjectOrganization; project_sort: ProjectSort;
 send_behavior: "enter" | "mod-enter"; stop_on_escape: boolean; accent: string; glass: "default" | "opaque" | "frosted";
 interface_font: "Geist" | "System UI"; interface_size: number; terminal_font:string; code_font:string; terminal_size: number; code_size: number; conversation_width:number;
 sidebar_width:number; panel_width:number; sidebar_open:boolean; sidebar_compact:boolean; sidebar_show_branch:boolean; sidebar_show_pr:boolean; sidebar_show_provider:boolean; sidebar_show_project_icon:boolean; sidebar_show_project_label:boolean;
 notifications:boolean; background_only:boolean; sounds:boolean; sound_completed:boolean; sound_input:boolean; sound_errors:boolean;
 word_wrap:boolean; show_hidden:boolean; show_ignored:boolean; autosave:boolean;
 sidebar_sections:string[]; session_sections:Record<string,string>; session_order:string[]; disabled_providers:string[]; archived_sessions:string[]; pinned_sessions:string[]; shortcuts:Record<string,string>;
}
export const defaultPreferences: Preferences = {
 theme:"graphite", color_scheme:"dark", dark_theme:"graphite", default_agent:"claude", session_surface:"chat", activity_detail:"compact", project_root:"", project_organization:"project", project_sort:"updated",
 send_behavior:"enter", stop_on_escape:false, accent:"default", glass:"frosted", interface_font:"Geist", interface_size:16, terminal_font:"Geist Mono", code_font:"Geist Mono", terminal_size:13, code_size:12.5, conversation_width:736,
 sidebar_width:256, panel_width:520, sidebar_open:true, sidebar_compact:true,sidebar_show_branch:false,sidebar_show_pr:false,sidebar_show_provider:true,sidebar_show_project_icon:false,sidebar_show_project_label:true,
 notifications:false, background_only:true, sounds:false, sound_completed:true, sound_input:true, sound_errors:true,
 word_wrap:false, show_hidden:false, show_ignored:false, autosave:false, sidebar_sections:[],session_sections:{},session_order:[], disabled_providers:[], archived_sessions:[], pinned_sessions:[], shortcuts:defaultShortcuts,
};
export function loadPreferences(): Preferences {
 try {
  const stored:unknown = JSON.parse(localStorage.getItem("openade.preferences") ?? "{}");
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {...defaultPreferences};
  const result = {...defaultPreferences}; const raw = stored as Record<string,unknown>;
  for (const key of Object.keys(defaultPreferences) as (keyof Preferences)[]) {
   const value = raw[key]; const fallback = defaultPreferences[key];
   if (Array.isArray(fallback)) { if (Array.isArray(value) && value.every(v=>typeof v === "string")) Object.assign(result,{[key]:value}); }
   else if (key === "session_sections") {if(value&&typeof value==="object"&&!Array.isArray(value))result.session_sections=Object.fromEntries(Object.entries(value).filter(([,v])=>typeof v==="string")) as Record<string,string>;}
   else if (key === "shortcuts") { if (value && typeof value === "object") result.shortcuts = {...defaultShortcuts,...Object.fromEntries(Object.entries(value).filter(([,v])=>typeof v === "string"))}; }
   else if (typeof value === typeof fallback && (typeof value !== "number" || Number.isFinite(value))) Object.assign(result,{[key]:value});
  }
  if (!["graphite","dusk","paper","glass","system"].includes(result.theme)) result.theme="graphite";
  // Preserve the appearance of older profiles while separating palette and material.
  if (!("color_scheme" in raw)) result.color_scheme = result.theme === "system" ? "system" : result.theme === "paper" ? "light" : "dark";
  if (!("dark_theme" in raw)) result.dark_theme = result.theme === "dusk" ? "dusk" : "graphite";
  if (!["system","light","dark"].includes(result.color_scheme)) result.color_scheme="dark";
  if (!["graphite","dusk"].includes(result.dark_theme)) result.dark_theme="graphite";
  if (!["default","opaque","frosted"].includes(result.glass)) result.glass="default";
  if (!["chat","terminal"].includes(result.session_surface)) result.session_surface="chat";
  if (!["project","list"].includes(result.project_organization)) result.project_organization="project";
  if (!["priority","updated","manual"].includes(result.project_sort)) result.project_sort="updated";
  result.sidebar_width=Math.min(400,Math.max(224,result.sidebar_width)); result.panel_width=Math.min(900,Math.max(360,result.panel_width));
  result.conversation_width=Math.min(1200,Math.max(560,result.conversation_width));
  result.interface_size=Math.min(20,Math.max(12,result.interface_size)); result.terminal_size=Math.min(32,Math.max(8,result.terminal_size)); result.code_size=Math.min(32,Math.max(8,result.code_size));
  return result;
 } catch { return {...defaultPreferences}; }
}
export function savePreferences(preferences:Preferences) { localStorage.setItem("openade.preferences",JSON.stringify(preferences)); }
export function themeClass(preferences:Preferences):string {
 const dark=preferences.dark_theme === "dusk" ? "theme-dusk" : "theme-dark";
 return preferences.color_scheme === "light" ? "theme-light" : preferences.color_scheme === "system" ? `${dark} theme-system` : dark;
}
export function shortcutMatches(event:KeyboardEvent, binding:string):boolean {
 const bits=binding.toLowerCase().split("+"); const key=bits.pop();
 return event.key.toLowerCase() === key && event.shiftKey === bits.includes("shift") && event.altKey === bits.includes("alt") &&
 (bits.includes("mod") ? (event.metaKey || event.ctrlKey) : event.metaKey === bits.includes("meta") && event.ctrlKey === bits.includes("ctrl"));
}
export function shouldSend(event:{key:string;shiftKey:boolean;metaKey:boolean;ctrlKey:boolean;nativeEvent:{isComposing:boolean}}, behavior:Preferences["send_behavior"]):boolean {
 return !event.nativeEvent.isComposing && event.key === "Enter" && !event.shiftKey && (behavior === "enter" || event.metaKey || event.ctrlKey);
}

export const shortcutLabels:Record<string,string>={sidebar:"Toggle left sidebar",panel:"Toggle right sidebar",files:"Toggle files panel",terminal:"Toggle terminal",newSession:"New chat",model:"Open model picker",settings:"Settings",next:"Next chat",previous:"Previous chat",focusComposer:"Focus composer",browser:"Open browser",diffs:"Open diffs",history:"Open history",closePanel:"Close current panel",nextPanel:"Next panel",previousPanel:"Previous panel",searchFiles:"Search files"};
export function displayShortcut(binding:string){return binding.split("+").map(key=>({Mod:/Mac|iPhone|iPad/.test(navigator.platform)?"⌘":"Ctrl",Ctrl:"⌃",Alt:"⌥",Shift:"⇧",ArrowLeft:"←",ArrowRight:"→",Tab:"⇥"} as Record<string,string>)[key]||key.toUpperCase()).join(" ");}
