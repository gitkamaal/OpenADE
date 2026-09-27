import {markCustomMenu,menuKeys} from "./menuKeys";
import { createPortal } from "react-dom";
import { Select } from "./Select";
import {
  CaretDown,
  Check,
  DotsThree,
  Folder,
  GitBranch,
  House,
  ListMagnifyingGlass,
  Plus,
  Robot,
  SidebarSimple,
  Gear,
  SquaresFour,
  SpinnerGap,
} from "@phosphor-icons/react";
import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "./ProviderIcon";
import { ExternalConversation, projectName, relativeTime, Session } from "./api";
import { Preferences, ProjectOrganization, ProjectSort } from "./preferences";

export type Page = "home" | "sites" | "sessions" | "agents" | "review" | "settings";

type SidebarItem =
  | { kind: "session"; updatedAt: string; session: Session }
  | { kind: "external"; updatedAt: string; conversation: ExternalConversation };

export function Sidebar({
  page,
  sessions,
  projects,
  externalConversations,
  projectOrganization,
  projectSort,
  resumingConversationId,
  selectedId,
  connected,
  onPage,
  onOpen,
  onResumeExternal,
  onProjectOrganization,
  onProjectSort,
  onSearch,
  onNewProject,
  onNewSession,
  onToggle, preferences, onPreferences,
}: {
  preferences:Preferences; onPreferences:(next:Preferences)=>void;
  page: Page;
  sessions: Session[];
  projects: string[];
  externalConversations: ExternalConversation[];
  projectOrganization: ProjectOrganization;
  projectSort: ProjectSort;
  resumingConversationId: string | null;
  selectedId: string | null;
  connected: boolean;
  onPage: (page: Page) => void;
  onOpen: (id: string) => void;
  onResumeExternal: (conversation: ExternalConversation) => void;
  onProjectOrganization: (organization: ProjectOrganization) => void;
  onProjectSort: (sort: ProjectSort) => void;
  onNewProject: () => void;
  onSearch: () => void;
  onNewSession: () => void;
  onToggle: () => void;
}) {
  const [createSection,setCreateSection]=useState(false);
  const [contextPosition,setContextPosition]=useState({left:12,top:100});
  const [context,setContext]=useState<Session|null>(null);const [sectionName,setSectionName]=useState("");const [filter,setFilter]=useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(projects.slice(0, 3)));
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [showAllProjects, setShowAllProjects] = useState(false);
  const projectsCollapsed=false;
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const viewTrigger=useRef<HTMLButtonElement>(null);const contextTrigger=useRef<HTMLButtonElement|null>(null);const [viewBounds,setViewBounds]=useState({left:0,top:0});
  useLayoutEffect(()=>{if(!projectMenuOpen)return;const place=()=>{const r=viewTrigger.current!.getBoundingClientRect();setViewBounds({left:r.right+238<window.innerWidth?r.right+6:Math.max(8,r.left-238),top:Math.max(8,Math.min(r.top,window.innerHeight-280))});};place();window.addEventListener("resize",place);window.addEventListener("scroll",place,true);return()=>{window.removeEventListener("resize",place);window.removeEventListener("scroll",place,true);};},[projectMenuOpen,preferences.sidebar_width]);

  useEffect(()=>{if(projectMenuOpen)document.querySelector<HTMLElement>(".sidebar-view-menu button")?.focus();},[projectMenuOpen]);
  useEffect(()=>{if(context)document.querySelector<HTMLElement>(".sidebar-session-menu button")?.focus();},[context]);
  useEffect(()=>{if(projectMenuOpen||context)return markCustomMenu(projectMenuRef.current);},[projectMenuOpen,Boolean(context)]);
  useEffect(()=>{const dismiss=()=>{setProjectMenuOpen(false);setContext(null);setCreateSection(false);};window.addEventListener("openade-dismiss-menus",dismiss);return()=>window.removeEventListener("openade-dismiss-menus",dismiss);},[]);
  const allItems = useMemo<SidebarItem[]>(() => [
    ...sessions.filter(session=>!preferences.pinned_sessions.includes(session.id)&&!preferences.session_sections[session.id]&&`${session.title} ${session.repo_root}`.toLowerCase().includes(filter.toLowerCase())).map((session) => ({ kind: "session" as const, updatedAt: session.updated_at, session })),
    ...externalConversations.filter(conversation=>`${conversation.title} ${conversation.project_root}`.toLowerCase().includes(filter.toLowerCase())).map((conversation) => ({ kind: "external" as const, updatedAt: conversation.updated_at, conversation })),
  ], [externalConversations, sessions,preferences.pinned_sessions,preferences.session_sections,filter]);

  const orderIndex=(item:SidebarItem)=>{const index=preferences.session_order.indexOf(itemKey(item));return index<0?Number.MAX_SAFE_INTEGER:index;};
  const grouped = useMemo(() => {
    const roots = [...new Set([
      ...projects,
      ...sessions.map((session) => session.repo_root),
      ...externalConversations.map((conversation) => conversation.project_root),
    ])];
    const groups = roots.map((root) => ({
      root,
      items: sortSidebarItems(allItems.filter((item) => itemRoot(item) === root), projectSort).sort((a,b)=>projectSort==="manual"?orderIndex(a)-orderIndex(b):0),
    }));
    if (projectSort === "manual") return groups;
    return groups.sort((left, right) => {
      const leftFirst = left.items[0];
      const rightFirst = right.items[0];
      if (leftFirst && rightFirst) {
        const compared = compareSidebarItems(leftFirst, rightFirst, projectSort);
        if (compared) return compared;
      }
      if (leftFirst) return -1;
      if (rightFirst) return 1;
      return projectName(left.root).localeCompare(projectName(right.root));
    });
  }, [allItems, externalConversations, projectSort, projects, sessions,preferences.session_order]);

  const sortedItems = useMemo(() => sortSidebarItems(allItems, projectSort).sort((a,b)=>projectSort==="manual"?orderIndex(a)-orderIndex(b):0), [allItems, projectSort,preferences.session_order]);
  const filteredGroups=grouped.filter(group=>!preferences.sidebar_project_filter||group.root===preferences.sidebar_project_filter);
  const visibleGroups = showAllProjects ? filteredGroups : filteredGroups.slice(0, 10);
  const filteredItems=sortedItems.filter(item=>!preferences.sidebar_project_filter||itemRoot(item)===preferences.sidebar_project_filter);
  const visibleFlatItems = showAllProjects ? filteredItems : filteredItems.slice(0, 10);

  useEffect(() => {
    setExpanded((current) => current.size ? current : new Set(grouped.slice(0, 3).map((group) => group.root)));
  }, [grouped]);

  useEffect(() => {
    if (!projectMenuOpen&&!context) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!projectMenuRef.current?.contains(event.target as Node)&&!(event.target as Element).closest(".project-menu-wrap,.select-popover")) setProjectMenuOpen(false);
      if(!(event.target as Element).closest(".sidebar-session-menu"))setContext(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape"){setProjectMenuOpen(false);setContext(null);viewTrigger.current?.focus();}
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [projectMenuOpen,context]);

  const toggle = (root: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(root)) next.delete(root); else next.add(root);
    return next;
  });

  const chooseOrganization = (organization: ProjectOrganization) => {
    onProjectOrganization(organization);
    setShowAllProjects(false);
  };

  const chooseSort = (sort: ProjectSort) => {
    onProjectSort(sort);
  };

  const archive=(id:string)=>{onPreferences({...preferences,archived_sessions:[...preferences.archived_sessions,id]});setContext(null);};
  const sessionButton=(session:Session)=><button data-session-id={session.id} className={`sidebar-chat-row ${selectedId===session.id?"active":""} ${preferences.sidebar_show_provider?"":"hide-provider"}`} key={session.id} onClick={()=>onOpen(session.id)} onContextMenu={event=>{event.preventDefault();contextTrigger.current=event.currentTarget;setContextPosition({left:Math.max(8,Math.min(event.clientX,window.innerWidth-238)),top:Math.max(8,Math.min(event.clientY,window.innerHeight-190))});setContext(session);}} title={session.title}><span className={`status-dot ${session.status}`}/><ProviderIcon provider={session.agent}/><span>{preferences.sidebar_show_project_label&&<em className="project-metadata">{projectName(session.repo_root)} @ Local</em>}{session.title}{preferences.sidebar_show_branch&&<em className="branch-metadata">{session.branch}</em>}{preferences.sidebar_show_pr&&session.pr_url&&<em>Pull request</em>}</span><small>{relativeTime(session.updated_at)}</small></button>;
  const move=(from:string,to:string)=>{const order=[...new Set([...preferences.session_order,...allItems.map(itemKey)])];order.splice(order.indexOf(from),1);order.splice(order.indexOf(to),0,from);onPreferences({...preferences,session_order:order,project_sort:"manual"});};
  return (
    <aside className={`sidebar ${preferences.sidebar_compact?"compact-sidebar":""} ${preferences.sidebar_show_project_icon?"show-project-icons":""} ${preferences.sidebar_show_project_label?"":"hide-project-labels"}`} >
      <div className="workspace-switcher"><span>OpenADE</span><button className="icon-button workspace-action" aria-label="Search commands and chats" title="Search commands and chats" onClick={onSearch}><ListMagnifyingGlass/></button><button className="icon-button workspace-action" onClick={onNewSession} aria-label="New session" title="New session"><Plus /></button><button className="icon-button workspace-action" onClick={onToggle} aria-label="Collapse sidebar" title="Collapse sidebar"><SidebarSimple /></button></div>
      <nav className="primary-nav" aria-label="Primary">
        <NavButton icon={<House />} label="Home" active={page === "home"} onClick={() => onPage("home")} />
        <NavButton icon={<SquaresFour />} label="Sites" active={page === "sites"} onClick={() => onPage("sites")} />
        <NavButton icon={<ListMagnifyingGlass />} label="Sessions" active={page === "sessions"} onClick={() => onPage("sessions")} />
        <NavButton icon={<Robot />} label="Workflows" active={page === "agents"} onClick={() => onPage("agents")} />
        <NavButton icon={<GitBranch />} label="Review" active={page === "review"} onClick={() => onPage("review")} />
      </nav>

      <div className="sidebar-scroll">
        {preferences.pinned_sessions.some(id=>sessions.some(s=>s.id===id))&&<section className="project-group custom-sidebar-section"><div className="sidebar-section-title">Pinned</div><div className="project-sessions">{preferences.pinned_sessions.map(id=>sessions.find(s=>s.id===id)).filter((s):s is Session=>Boolean(s)).map(sessionButton)}</div></section>}
        {preferences.sidebar_sections.map(name=><section key={name} className="project-group custom-sidebar-section"><div className="sidebar-section-title">{name}<button aria-label={`Remove ${name} section`} onClick={()=>onPreferences({...preferences,sidebar_sections:preferences.sidebar_sections.filter(x=>x!==name),session_sections:Object.fromEntries(Object.entries(preferences.session_sections).filter(([,value])=>value!==name))})}>×</button></div><div className="project-sessions">{sessions.filter(s=>preferences.session_sections[s.id]===name&&!preferences.pinned_sessions.includes(s.id)).map(sessionButton)}</div></section>)}

        <div className="projects-heading" ref={projectMenuRef}>
          <Select className="projects-toggle" aria-label="Filter projects" icon={<Folder/>} searchable stickyValue="" popupWidth={224} searchPlaceholder="Search projects…" value={preferences.sidebar_project_filter} onChange={event=>{onPreferences({...preferences,sidebar_project_filter:event.target.value});setShowAllProjects(false);setExpanded(new Set(grouped.map(group=>group.root)));}} footer={<button type="button" className="new-project-action" onClick={()=>{window.dispatchEvent(new Event("openade-dismiss-menus"));onNewProject();}}><Plus/>New project…</button>}><option value="">All projects</option>{grouped.map(({root})=><option key={root} value={root}><span className="project-picker-choice"><span>{projectName(root)}</span><small>@ Local</small></span></option>)}</Select>
          <div className="projects-actions">
            <button ref={viewTrigger} onClick={() => setProjectMenuOpen((value) => !value)} aria-label="Project display settings" aria-haspopup="menu" aria-expanded={projectMenuOpen} title="Organize projects"><DotsThree /></button>
            <button onClick={onNewProject} aria-label="Add project" title="Add a workspace folder"><Plus /></button>
          </div>
          {projectMenuOpen&&createPortal(<div className="project-menu-wrap" style={{position:"fixed",...viewBounds}}><ProjectMenu organization={projectOrganization} sort={projectSort} onOrganization={chooseOrganization} onSort={chooseSort} onDismiss={()=>{setProjectMenuOpen(false);viewTrigger.current?.focus();}} preferences={preferences} onPreferences={onPreferences} filter={filter} onFilter={setFilter} onCreate={()=>setCreateSection(v=>!v)}/>{createSection&&<div className="sidebar-menu-extras"><form onSubmit={e=>{e.preventDefault();const name=sectionName.trim();if(name&&!preferences.sidebar_sections.includes(name)){onPreferences({...preferences,sidebar_sections:[...preferences.sidebar_sections,name]});setSectionName("");setProjectMenuOpen(false);}}}><input aria-label="New sidebar section" placeholder="New section…" maxLength={40} value={sectionName} onChange={e=>setSectionName(e.target.value)}/><button disabled={!sectionName.trim()}>Add</button></form></div>}</div>,projectMenuRef.current?.closest(".ade")??document.body)}
        </div>

        {!projectsCollapsed && projectOrganization === "project" && <div className="project-groups">
          {visibleGroups.map(({ root, items }) => {
            const open = expanded.has(root);
            const visible = showAll.has(root) ? items : items.slice(0, 3);
            return <section className="project-group" key={root}>
              <button className="project-row" onClick={() => toggle(root)} title={root} aria-expanded={open}><Folder /><span>{projectName(root)}</span><CaretDown className={open ? "open" : ""} /></button>
              {open && <div className="project-sessions">
                {visible.map(item=>item.kind==="session"?<div className="sidebar-draggable-row" key={itemKey(item)} draggable={projectSort==="manual"} onDragStart={event=>event.dataTransfer.setData("text/openade-session",itemKey(item))} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const from=event.dataTransfer.getData("text/openade-session");if(from&&from!==itemKey(item)&&allItems.some(x=>itemKey(x)===from))move(from,itemKey(item));}}>{sessionButton(item.session)}</div>:<ExternalConversationButton conversation={item.conversation} key={itemKey(item)} busy={resumingConversationId===`${item.conversation.provider}:${item.conversation.id}`} onOpen={onResumeExternal}/>)}
                {items.length > 3 && <button className="show-more" onClick={() => setShowAll((current) => { const next = new Set(current); if (next.has(root)) next.delete(root); else next.add(root); return next; })}>{showAll.has(root) ? "Show less" : `Show ${items.length - 3} more`}</button>}
              </div>}
            </section>;
          })}
          {filteredGroups.length > 10 && <button className="all-projects-toggle" onClick={() => setShowAllProjects((value) => !value)}>{showAllProjects ? "Show fewer projects" : `Show ${filteredGroups.length - 10} more projects`}</button>}
        </div>}

        {!projectsCollapsed && (projectOrganization === "list"||projectOrganization === "device") && <div className="project-flat-list project-sessions">{projectOrganization==="device"&&<div className="sidebar-section-title">Local</div>}
          {visibleFlatItems.map((item) => item.kind==="session"?sessionButton(item.session):<ExternalConversationButton conversation={item.conversation} key={itemKey(item)} busy={resumingConversationId===`${item.conversation.provider}:${item.conversation.id}`} onOpen={onResumeExternal}/>)}
          {filteredItems.length > 10 && <button className="all-projects-toggle" onClick={() => setShowAllProjects((value) => !value)}>{showAllProjects ? "Show fewer chats" : `Show ${filteredItems.length - 10} more chats`}</button>}
          {filteredItems.length === 0 && <div className="project-empty">Chats from indexed projects will appear here.</div>}
        </div>}

      </div>
      <div className="sidebar-footer"><div className="profile"><span className="avatar">L</span><span><strong>Local</strong><small className="connection-state">{connected ? "Daemon connected" : "Reconnecting…"}</small></span></div><button className={`icon-button ${page === "settings" ? "active" : ""}`} onClick={() => onPage("settings")} aria-label="Open settings" title="Settings"><Gear /></button></div>
      {context&&createPortal(<div style={{position:"fixed",left:contextPosition.left,top:contextPosition.top,bottom:"auto"}} className="sidebar-session-menu" onKeyDown={event=>menuKeys(event,()=>setContext(null),()=>contextTrigger.current?.focus())} role="menu" aria-label="Chat actions"><strong>{context.title}</strong><button role="menuitem" onClick={()=>{onPreferences({...preferences,pinned_sessions:preferences.pinned_sessions.includes(context.id)?preferences.pinned_sessions.filter(x=>x!==context.id):[...preferences.pinned_sessions,context.id]});setContext(null);}}>{preferences.pinned_sessions.includes(context.id)?"Unpin chat":"Pin chat"}</button><label>Section<Select aria-label="Move chat to section" value={preferences.session_sections[context.id]||""} onChange={event=>{onPreferences({...preferences,session_sections:{...preferences.session_sections,[context.id]:event.target.value}});setContext(null);}}><option value="">All projects</option>{preferences.sidebar_sections.map(name=><option key={name}>{name}</option>)}</Select></label><button role="menuitem" onClick={()=>archive(context.id)}>Archive chat</button></div>,projectMenuRef.current?.closest(".ade")??document.body)}
    </aside>
  );
}

function ProjectMenu({onDismiss,organization,sort,onOrganization,onSort,preferences,onPreferences,filter,onFilter,onCreate}:{onDismiss:()=>void;organization:ProjectOrganization;sort:ProjectSort;onOrganization:(value:ProjectOrganization)=>void;onSort:(value:ProjectSort)=>void;preferences:Preferences;onPreferences:(next:Preferences)=>void;filter:string;onFilter:(value:string)=>void;onCreate:()=>void}) {
 const menu=useRef<HTMLDivElement>(null),showTrigger=useRef<HTMLButtonElement>(null);const [submenu,setSubmenu]=useState<"organize"|"sort"|"show"|null>(null);const [keyboard,setKeyboard]=useState(false);
 const active=useRef<typeof submenu>(null),origin=useRef<{x:number;y:number}|null>(null),last=useRef<{x:number;y:number}|null>(null),pending=useRef<{key:typeof submenu;timer:ReturnType<typeof setTimeout>}|null>(null);
 active.current=submenu;
 const cancel=()=>{if(pending.current)clearTimeout(pending.current.timer);pending.current=null;};
 const openChild=(key:typeof submenu,focus:boolean)=>{cancel();setKeyboard(focus);setSubmenu(key);};
 const childBounds=()=>menu.current?.closest(".ade")?.querySelector<HTMLElement>(".sidebar-choice-submenu,.sidebar-show-menu")?.getBoundingClientRect();
 const corridor=(x:number,y:number)=>{const bounds=childBounds(),start=origin.current;if(!bounds||!start)return false;const left=bounds.right<=menu.current!.getBoundingClientRect().left,edge=left?bounds.right:bounds.left,direction=left?-1:1,distance=(edge-start.x)*direction,advance=(x-start.x)*direction;if(distance<=0||advance<=0||advance>distance+8)return false;const fraction=Math.min(1,advance/distance);return y>=start.y+(bounds.top-8-start.y)*fraction&&y<=start.y+(bounds.bottom+8-start.y)*fraction;};
 const hover=(key:typeof submenu,event:{clientX:number;clientY:number})=>{if(active.current===key){cancel();origin.current={x:event.clientX,y:event.clientY};last.current=origin.current;return;}const bounds=childBounds(),left=Boolean(bounds&&bounds.right<=menu.current!.getBoundingClientRect().left),forward=last.current?(event.clientX-last.current.x)*(left?-1:1):0;
  if(active.current&&corridor(event.clientX,event.clientY)&&forward>-2){if(pending.current?.key!==key||forward>=2){cancel();const source=active.current;pending.current={key,timer:setTimeout(()=>{if(active.current===source&&pending.current?.key===key)openChild(key,false);},300)};}last.current={x:event.clientX,y:event.clientY};}
  else{openChild(key,false);origin.current={x:event.clientX,y:event.clientY};last.current=origin.current;}
 };
 useEffect(()=>()=>cancel(),[]);
 useEffect(()=>{if(submenu==="show"&&keyboard)document.querySelector<HTMLElement>(".sidebar-show-menu button")?.focus();},[submenu,keyboard]);
 useEffect(()=>{if(!submenu)return;const move=(event:PointerEvent)=>{const target=event.target as Element;if(target.closest(".sidebar-choice-submenu,.sidebar-show-menu")){cancel();return;}const parent=menu.current?.getBoundingClientRect();if(parent&&event.clientX>=parent.left&&event.clientX<=parent.right&&event.clientY>=parent.top&&event.clientY<=parent.bottom)return;if(!corridor(event.clientX,event.clientY))openChild(null,false);};document.addEventListener("pointermove",move);return()=>document.removeEventListener("pointermove",move);},[submenu]);
 const flags=[['sidebar_show_branch','Branch'],['sidebar_show_pr','Pull request'],['sidebar_show_provider','Provider'],['sidebar_show_project_icon','Project icon'],['sidebar_show_project_label','Project label']] as const;
 const rect=showTrigger.current?.getBoundingClientRect();const showLeft=rect&&rect.right+216>window.innerWidth;
 const row=(key:"organize"|"sort",label:string,choices:ReactNode,value:string,change:(value:string)=>void)=><div className="sidebar-menu-row" onPointerEnter={event=>hover(key,event)} onPointerMove={event=>hover(key,event)} onPointerLeave={()=>{if(pending.current?.key===key)cancel();}} onClick={event=>{if(!(event.target as Element).closest(".select-popover"))openChild(key,true);}}><span>{label}</span><Select placement="right" popupClassName="sidebar-choice-submenu" expanded={submenu===key} focusOnOpen={keyboard} onExpandedChange={value=>openChild(value?key:null,true)} aria-label={key==="organize"?"Organize sidebar":"Sort chats"} value={value} onChange={event=>change(event.target.value)}>{choices}</Select></div>;
 return <div ref={menu} className="project-menu sidebar-view-menu" onKeyDown={event=>menuKeys(event,onDismiss)} role="menu" aria-label="Project display settings">
  {row("organize","Organize",<><option value="device">By device</option><option value="project">By project</option><option value="list">None</option></>,organization,value=>onOrganization(value as ProjectOrganization))}
  {row("sort","Sort",<><option value="updated">Last updated</option><option value="created">Created</option><option value="priority">Priority</option><option value="manual">Manual order</option></>,sort,value=>onSort(value as ProjectSort))}
  <button ref={showTrigger} role="menuitem" aria-haspopup="menu" aria-expanded={submenu==="show"} onPointerEnter={event=>hover("show",event)} onPointerMove={event=>hover("show",event)} onClick={()=>openChild("show",true)}>Show<CaretDown/></button>
  <button role="menuitemcheckbox" aria-checked={preferences.sidebar_compact} onPointerEnter={event=>hover(null,event)} onClick={()=>{openChild(null,false);onPreferences({...preferences,sidebar_compact:!preferences.sidebar_compact});}}><span>Compact</span><span className={`sidebar-compact-switch ${preferences.sidebar_compact?"on":""}`}><i/></span></button>
  <button role="menuitem" onPointerEnter={event=>hover(null,event)} onClick={()=>{openChild(null,false);onCreate();}}><Plus/>Create Section</button>
  {submenu==="show"&&rect&&createPortal(<div className="sidebar-show-menu select-popover" style={{position:"fixed",left:showLeft?Math.max(8,rect.left-216):rect.right+6,top:Math.max(8,Math.min(rect.top,window.innerHeight-222)),width:210}} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key==="ArrowLeft"){event.preventDefault();event.stopPropagation();openChild(null,true);showTrigger.current?.focus();}else menuKeys(event,()=>openChild(null,true),()=>showTrigger.current?.focus());}} role="menu" aria-label="Show sidebar details">{flags.map(([key,label])=><button key={key} role="menuitemcheckbox" aria-checked={preferences[key]} onClick={()=>onPreferences({...preferences,[key]:!preferences[key]})}><span>{label}</span>{preferences[key]&&<Check/>}</button>)}<input aria-label="Filter sidebar sessions" placeholder="Filter chats…" value={filter} onChange={event=>onFilter(event.target.value)}/></div>,showTrigger.current?.closest('.ade')??document.body)}
 </div>;

}

function ExternalConversationButton({ conversation, busy, onOpen }: { conversation: ExternalConversation; busy: boolean; onOpen: (conversation: ExternalConversation) => void }) {
  return <button className="external-session" onClick={() => onOpen(conversation)} disabled={busy} title={`Resume this ${providerLabel(conversation.provider)} conversation`}><ProviderIcon provider={conversation.provider}/> <span>{conversation.title}</span><small>{relativeTime(conversation.updated_at)}</small>{busy && <SpinnerGap className="spin" />}</button>;
}

function sortSidebarItems(items: SidebarItem[], sort: ProjectSort): SidebarItem[] {
  if (sort === "manual") return [...items];
  return [...items].sort((left, right) => compareSidebarItems(left, right, sort));
}

function compareSidebarItems(left: SidebarItem, right: SidebarItem, sort: ProjectSort): number {
  if (sort === "priority") {
    const priority = itemPriority(left) - itemPriority(right);
    if (priority) return priority;
  }
  if(sort==="created")return timestamp(right.kind==="session"?right.session.created_at:right.updatedAt)-timestamp(left.kind==="session"?left.session.created_at:left.updatedAt);
  return timestamp(right.updatedAt) - timestamp(left.updatedAt);
}

function itemPriority(item: SidebarItem): number {
  if (item.kind === "external") return 2;
  return ["starting", "running", "waiting"].includes(item.session.status) ? 0 : 1;
}

function itemRoot(item: SidebarItem): string {
  return item.kind === "session" ? item.session.repo_root : item.conversation.project_root;
}

function itemKey(item: SidebarItem): string {
  return item.kind === "session" ? `session:${item.session.id}` : `external:${item.conversation.provider}:${item.conversation.id}`;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function providerLabel(provider: ExternalConversation["provider"]): string {
  return provider === "claude" ? "Claude" : "Codex";
}

function NavButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button aria-label={label} title={label} className={active ? "active" : ""} onClick={onClick}>{icon}<span>{label}</span></button>;
}
