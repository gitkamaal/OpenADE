import {visibleSidebarSessionIds, jumpShortcutMatches, keyboardOverlayOpen} from "./useSessionJumpHints";
import {fontFamily} from "./useFontCatalog";
import {useAttachments,AttachmentPicker,AttachmentStrip,withAttachments} from "./Attachments";
import {useComposerLayout} from "./useComposerLayout";
import { Folder, Desktop } from "@phosphor-icons/react";
import { Select } from "./Select";
import {accentFor,materialFor,resolveTheme,onThemeRegistryChange,themeCssVariables,installThemeLibrary,themeId} from "./themes";
import {listThemeLibrary} from "./theme-library-api";
import {ResizeBoundary} from "./ResizeBoundary";
import {
  Pulse,
  ArrowUp,
  Check,
  Code,
  FileCode,
  GitBranch,
  GitDiff,
  GithubLogo,
  ListMagnifyingGlass,
  Plus,
  Robot,
  SidebarSimple,
  SpinnerGap,
  Ticket as TicketIcon,
  X,
} from "@phosphor-icons/react";
import { CSSProperties, FormEvent, Suspense, useEffect, useRef, useState } from "react";
import {
  createSession, getBranches, getProjectDirectories,
  ExternalConversation,
  listPullRequests,
  scanWorkspace,
  Meta,
  projectName,
  PullRequest,
  relativeTime,
  Session,
  setSessionArchived,
  switchSessionSurface,
  NewThreadArtworkState,
} from "./api";
import { SessionWorkspace, forgetReviewComments, recoverRejectedDraft } from "./SessionWorkspace";
import { loadPreferences, Preferences, savePreferences, themeClass, shortcutMatches, shouldSend } from "./preferences";
import { SettingsNavigation, SettingsPage, SettingsSection } from "./SettingsPage";
import { Page, Sidebar } from "./Sidebar";
import { useEngine, refreshEngine } from "./engine-store";
import { ModelPicker } from "./ModelPicker";
import {ProjectPalette} from "./ProjectPalette";
import {CommandPalette} from "./CommandPalette";
import { SitesPage } from "./SitesPage";
import { NewThreadArtwork } from "./NewThreadArtwork";

const agents = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "grok", label: "Grok" },
  { id: "devin", label: "Devin" },
  { id: "hermes", label: "Hermes" },
  { id: "pi", label: "Pi" },
  { id: "antigravity", label: "Antigravity" },
  { id: "copilot", label: "Copilot CLI" },
  { id: "opencode", label: "OpenCode" },
  { id: "shell", label: "Local shell" },
];

const templates = [
  { title: "Implement a Jira ticket", category: "Delivery", icon: TicketIcon, prompt: "Read the linked ticket, inspect the repository, make the smallest correct change, run the relevant tests, and prepare a draft pull request." },
  { title: "Review a pull request", category: "Code review", icon: GitDiff, prompt: "Review the current branch for correctness, regressions, security issues, and missing tests. Report findings before making any edits." },
  { title: "Fix failing CI", category: "Maintenance", icon: Pulse, prompt: "Inspect the latest failing checks, reproduce the failure locally, fix the root cause, and verify the narrowest relevant test suite." },
  { title: "Add focused tests", category: "Quality", icon: Check, prompt: "Identify the important untested behavior in this ticket and add focused regression tests without unrelated production changes." },
  { title: "Explain this codebase", category: "Documentation", icon: FileCode, prompt: "Map the main modules, runtime boundaries, data flow, and development commands. Call out unclear ownership or risky coupling." },
  { title: "Dependency sweep", category: "Maintenance", icon: Code, prompt: "Find outdated dependencies and propose the smallest safe upgrade set. Avoid broad version churn and run compatibility checks." },
];

function AppShell() {
  const [themeRegistryVersion,setThemeRegistryVersion]=useState(0);
  useEffect(()=>onThemeRegistryChange(()=>setThemeRegistryVersion(value=>value+1)),[]);
  const [paletteOpen,setPaletteOpen]=useState(false);const [projectPaletteOpen,setProjectPaletteOpen]=useState(false);
  const [page, setPage] = useState<Page>("home");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [projectNames, setProjectNames] = useState<Record<string,string>>({});
  const [removedProjects, setRemovedProjects] = useState<string[]>([]);
  const [scannedProjects, setScannedProjects] = useState<string[]>([]);
  const [externalConversations, setExternalConversations] = useState<ExternalConversation[]>([]);
  const engine=useEngine();
  useEffect(()=>{if(!engine.connected)return;let stale=false;void listThemeLibrary().then(entries=>{if(!stale)installThemeLibrary(entries);}).catch(()=>{/* Keep the saved choice and last-good palette until reconnect. */});return()=>{stale=true;};},[engine.connected]);
  const previousEngineError=useRef<string|null>(null);
  const meta=engine.meta;
  const [selectedId, setSelectedId] = useState<string | null>(()=>localStorage.getItem("openade.selected-session"));
  const [retainedSelected, setRetainedSelected] = useState<Session | null>(null);
  const [pendingSelectionID, setPendingSelectionID] = useState<string | null>(null);
  const [editorDirtyRevision, setEditorDirtyRevision] = useState(0);
  useEffect(()=>{if(selectedId)localStorage.setItem("openade.selected-session",selectedId);else localStorage.removeItem("openade.selected-session");},[selectedId]);
  const [sidebarOpen, setSidebarOpen] = useState(() => loadPreferences().sidebar_open);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(()=>loadPreferences().settings_section);
  const previousPage = useRef<{page:Page;id:string|null}>({page:"home",id:null});
  const editorDirty = useRef(false);
  const contentFocus=useRef<HTMLElement|null>(null);
  const lastStatuses = useRef<Map<string,string> | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const [nativeMaterial, setNativeMaterial] = useState("pending");
  const [systemLight, setSystemLight] = useState(() => matchMedia("(prefers-color-scheme: light)").matches);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [resumingConversationId, setResumingConversationId] = useState<string | null>(null);
  const [switchingSessionId, setSwitchingSessionId] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const focusTimerRef = useRef<number | undefined>(undefined);
  const legacyArchiveMigration = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const dirty=(event:Event)=>{editorDirty.current=(event as CustomEvent<boolean>).detail;setEditorDirtyRevision(value=>value+1);};
    window.addEventListener("openade-editor-dirty",dirty);
    const focus=(event:FocusEvent)=>{const target=event.target;if(target instanceof HTMLElement&&target.closest(".session-workspace"))contentFocus.current=target;};
    document.addEventListener("focusin",focus);
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(editorDirty.current){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",beforeUnload);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("openade-editor-dirty",dirty);
      document.removeEventListener("focusin",focus);
      window.removeEventListener("beforeunload",beforeUnload);
      if (focusTimerRef.current !== undefined) window.clearTimeout(focusTimerRef.current);
    };
  }, []);

  const refresh=refreshEngine;
  useEffect(()=>{setSessions(engine.sessions);setProjects(engine.projects);setProjectNames(engine.project_names);setRemovedProjects(engine.removed_projects);setConnected(engine.connected);if(engine.error)setError(engine.error);else if(previousEngineError.current){const previous=previousEngineError.current;setError(current=>current===previous?null:current);}previousEngineError.current=engine.error;},[engine]);
  useEffect(() => {
    if (!pendingSelectionID || !engine.connected) return;
    const session = engine.sessions.find(item => item.id === pendingSelectionID);
    if (!session) return;
    setRetainedSelected(session);
    setSelectedId(session.id);
    setPage("sessions");
    setPendingSelectionID(null);
  }, [engine.connected, engine.sessions, pendingSelectionID]);
  useEffect(()=>{if(engine.connected&&!performance.getEntriesByName("openade-ready").length)performance.mark("openade-ready");},[engine.connected]);
  useEffect(() => {
    let stale = false;
    if (!preferences.project_root.trim()) {
      setScannedProjects([]);
      setExternalConversations([]);
      return () => { stale = true; };
    }
    void scanWorkspace(preferences.project_root)
      .then((result) => {
        if (stale) return;
        setScannedProjects(result.projects);
        setExternalConversations(result.conversations);
      })
      .catch((reason) => {
        if (!stale) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { stale = true; };
  }, [preferences.project_root]);

  const authoritativeSessions = engine.connected ? engine.sessions : sessions;
  const liveSelected = authoritativeSessions.find((session) => session.id === selectedId) ?? null;
  const selected = liveSelected ?? (retainedSelected?.id === selectedId ? retainedSelected : null);
  useEffect(() => {
    if (!selectedId) {
      if (retainedSelected) setRetainedSelected(null);
      return;
    }
    if (liveSelected) {
      if (retainedSelected !== liveSelected) setRetainedSelected(liveSelected);
      if (page !== "settings" && page !== "sessions") setPage("sessions");
      return;
    }
    // Do not discard a mounted editor merely because another client removed its
    // session. The session-scoped save API is gone, but the user can still copy
    // the retained buffer before discarding it.
    if (!connected) return;
    if (retainedSelected?.id === selectedId && editorDirty.current) {
      setError(
        "This conversation was removed in another window. Its unsaved editor buffer is still open; copy it before you discard or close it.",
      );
      return;
    }
    setRetainedSelected(null);
    setSelectedId(null);
    if (page === "settings") previousPage.current = { page: "home", id: null };
    else setPage("home");
  }, [connected, editorDirtyRevision, liveSelected, page, retainedSelected, selectedId]);
  const visibleSessions = sessions.filter(item=>!item.archived&&!item.parent_session_id);
  const removedProjectSet = new Set(removedProjects);
  const visibleProjects = [...new Set([...scannedProjects, ...projects])].filter(project=>Boolean(project)&&!removedProjectSet.has(project));
  const visibleExternalConversations = externalConversations.filter(conversation=>!removedProjectSet.has(conversation.project_root));
  const openSession = async (id: string) => {
    if (switchingSessionId) return;
    if(editorDirty.current&&id!==selectedId){setError("Save or discard file changes before opening another session.");return;}
    const current = sessions.find((session) => session.id === id);
    if (!current) {
      setSelectedId(id);
      setPage("sessions");
      return;
    }
    const preferredMode = current.agent==="shell"?current.mode:preferredSessionMode(preferences, current.agent);
    if (current.mode === preferredMode) {
      setSelectedId(id);
      setPage("sessions");
      return;
    }
    setSwitchingSessionId(id);
    setError(null);
    try {
      const switched = await switchSessionSurface(id, preferredMode);
      setSessions((items) => items.map((item) => item.id === id ? switched : item));
      setSelectedId(id);
      setPage("sessions");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSwitchingSessionId(null);
    }
  };
  const updatePreferences = (next: Preferences, persist=true) => {
    const adjusted={...next,sidebar_open:sidebarOpen};
    setPreferences(adjusted);
    if(persist) savePreferences(adjusted);
  };
  const setArchived = async (id:string, archived:boolean) => {
    try {
      await setSessionArchived(id, archived);
      await refreshEngine();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };
  useEffect(() => {
    if (!engine.connected || legacyArchiveMigration.current || !preferences.archived_sessions.length) return;
    legacyArchiveMigration.current = true;
    const ids = [...new Set(preferences.archived_sessions)];
    const present = ids.filter(id => engine.sessions.some(session => session.id === id));
    void Promise.all(present.map(id => setSessionArchived(id, true)))
      .then(() => refreshEngine())
      .then(() => updatePreferences({ ...preferences, archived_sessions: [] }))
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [engine.connected, engine.sessions, preferences.archived_sessions]);
  useEffect(()=>{const dark_theme=themeId(preferences.dark_theme,"dark",true),light_theme=themeId(preferences.light_theme,"light",true);if(dark_theme!==preferences.dark_theme||light_theme!==preferences.light_theme)updatePreferences({...preferences,dark_theme,light_theme});},[themeRegistryVersion,preferences.dark_theme,preferences.light_theme]);
  useEffect(() => {
    const bridge = window as typeof window & {
      go?: {main?: {App?: {SetAppearance?: (scheme:string,material:string)=>Promise<string>}}};
      runtime?: {EventsOn?: (name:string,callback:(status:string)=>void)=>()=>void};
    };
    const media = matchMedia("(prefers-color-scheme: light)");
    let active = true;
    const apply = () => {
      setSystemLight(media.matches);
      const material = materialFor(resolveTheme(preferences,media.matches),preferences.glass);
      const setter = bridge.go?.main?.App?.SetAppearance;
      if (setter) void setter(preferences.color_scheme, material).then(status => {if(active) setNativeMaterial(status);}).catch(() => {if(active) setNativeMaterial("unsupported");});
      else setNativeMaterial("browser");
    };
    const cancel = bridge.runtime?.EventsOn?.("appearance:changed", status => {if(active) setNativeMaterial(status);});
    apply(); media.addEventListener("change", apply);
    return () => {active = false; cancel?.(); media.removeEventListener("change", apply);};
  }, [preferences.color_scheme, preferences.dark_theme, preferences.light_theme, preferences.glass]);
  const openPage = (next: Page) => {
    if(editorDirty.current&&next!=="settings"){setError("Save or discard file changes before leaving this session.");return;}
    if(next === "settings" && page !== "settings") previousPage.current={page,id:selectedId};
    if(next==="settings")window.dispatchEvent(new Event("openade-dismiss-menus"));
    setPage(next);
    if(next!=="settings")setSelectedId(null);
  };
  const openComposer = () => {
    if(editorDirty.current){setError("Save or discard file changes before starting another session.");return;}
    setPage("home");
    setSelectedId(null);
    if (focusTimerRef.current !== undefined) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = undefined;
      document.querySelector<HTMLTextAreaElement>("[data-main-composer]")?.focus();
    }, 0);
  };
  const closeSettings = () => {
    setPage(previousPage.current.page);setSelectedId(previousPage.current.id);
    if(focusTimerRef.current!==undefined)window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current=window.setTimeout(()=>{focusTimerRef.current=undefined;const target=contentFocus.current; if(target?.isConnected)target.focus();else document.querySelector<HTMLElement>("[data-main-composer]")?.focus();},0);
  };
  const toggleSidebar = () => { window.dispatchEvent(new Event("openade-dismiss-menus"));setSidebarOpen(value=>!value); };
  useEffect(() => {if(preferences.sidebar_open!==sidebarOpen)updatePreferences({...preferences,sidebar_open:sidebarOpen});}, [sidebarOpen]);
  useEffect(() => {
    const navigationSessions=()=>{
      const eligible=sessions.filter(session=>!session.archived&&!session.parent_session_id&&(!preferences.sidebar_project_filter||session.repo_root===preferences.sidebar_project_filter));
      const ids=visibleSidebarSessionIds(eligible);
      return ids.length?ids.map(id=>eligible.find(session=>session.id===id)!):eligible;
    };
    const onKey = (event:KeyboardEvent) => {
      if(event.defaultPrevented || event.isComposing || event.repeat || (event.target instanceof Element && event.target.closest("[role=dialog]"))) return;
      if(shortcutMatches(event,preferences.shortcuts.sidebar)){event.preventDefault();toggleSidebar();}
      else if(shortcutMatches(event,preferences.shortcuts.settings)){event.preventDefault();page === "settings"?closeSettings():openPage("settings");}
      else if(shortcutMatches(event,preferences.shortcuts.commandPalette)){event.preventDefault();window.dispatchEvent(new Event("openade-dismiss-menus"));setPaletteOpen(value=>!value);}
      else if(shortcutMatches(event,preferences.shortcuts.newProject)){event.preventDefault();window.dispatchEvent(new Event("openade-dismiss-menus"));setProjectPaletteOpen(true);}
      else if(shortcutMatches(event,preferences.shortcuts.newSession)){event.preventDefault();openComposer();}
      else if(page!=="settings"&&shortcutMatches(event,preferences.shortcuts.model)){event.preventDefault();window.dispatchEvent(new Event("openade-model-picker"));}
      else if(shortcutMatches(event,preferences.shortcuts.focusComposer)&&!selectedId){event.preventDefault();document.querySelector<HTMLTextAreaElement>("[data-main-composer]")?.focus();}
      else if(!keyboardOverlayOpen()&&(shortcutMatches(event,preferences.shortcuts.next)||shortcutMatches(event,preferences.shortcuts.previous))) {
        event.preventDefault();const ordered=navigationSessions(),index=ordered.findIndex(session=>session.id===selectedId),delta=shortcutMatches(event,preferences.shortcuts.previous)?-1:1;
        const target=ordered[(index+delta+ordered.length)%ordered.length];if(target)void openSession(target.id);
      } else if(page!=="settings"&&!keyboardOverlayOpen()){const slot=Array.from({length:9},(_,i)=>i).find(i=>jumpShortcutMatches(event,preferences.shortcuts[`jump${i+1}`]));if(slot!==undefined){const target=navigationSessions()[slot];if(target){event.preventDefault();void openSession(target.id);}}}
    };
    window.addEventListener("keydown",onKey);return ()=>window.removeEventListener("keydown",onKey);
  },[preferences,page,selectedId,sessions,sidebarOpen]);
  useEffect(() => {
    if(!connected) return;
    const before=lastStatuses.current; lastStatuses.current=new Map(sessions.map(s=>[s.id,s.status])); if(!before)return;
    for(const session of sessions) {
      if(!before.has(session.id)||before.get(session.id)===session.status)continue;
      const completed=session.status==="completed";const input=session.status==="waiting";const failed=["failed","interrupted"].includes(session.status);
      if(!(completed||input||failed))continue;
      if(preferences.background_only&&document.hasFocus())continue;
      if(preferences.notifications&&"Notification" in window&&Notification.permission==="granted")new Notification(completed?"Task completed":input?"Input required":"Session interrupted",{body:session.title});
      if(preferences.sounds&&(completed?preferences.sound_completed:input?preferences.sound_input:preferences.sound_errors)) {
        const audio=new AudioContext(); const oscillator=audio.createOscillator();const gain=audio.createGain();oscillator.frequency.value=failed?220:completed?660:440;gain.gain.setValueAtTime(.04,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.18);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start();oscillator.stop(audio.currentTime+.2);oscillator.onended=()=>void audio.close();
      }
    }
  },[sessions,connected,preferences]);
  const resumeExternalConversation = async (conversation: ExternalConversation) => {
    if (resumingConversationId) return;
    setResumingConversationId(`${conversation.provider}:${conversation.id}`);
    setError(null);
    try {
      const session = await createSession({
        title: conversation.title,
        prompt: "",
        agent: conversation.provider,
        mode: preferredSessionMode(preferences, conversation.provider),
        resume_id: conversation.id,
        repo_root: conversation.project_root,
        base_branch: "HEAD",
      });
      setPendingSelectionID(session.id);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setResumingConversationId(null);
    }
  };

  const activeTheme=resolveTheme(preferences,systemLight);
  const activeMaterial=materialFor(activeTheme,preferences.glass);
  return (
    <div data-theme-id={activeTheme.id} data-theme-appearance={activeTheme.appearance} data-connected={connected} data-native-material={nativeMaterial}
      className={`ade ${preferences.code_fences_fit_content?"fit-code-fences":""} ${themeClass(preferences,systemLight)} material-${preferences.glass === "liquid" ? "frosted material-liquid" : preferences.glass} ${activeMaterial === "frosted" ? "default-frosted" : "default-opaque"} ${("go" in window) ? "native-window" : "browser-window"} ${sidebarOpen ? "" : "sidebar-collapsed"}`}
      style={{...themeCssVariables(activeTheme),"--theme-accent":activeTheme.accent.primary,"--glass-coverage":`${100-preferences.transparency}%`,"--glass-wash":`${(100-preferences.transparency)*.22}%`,"--glass-card":`${(100-preferences.transparency)*.55}%`,"--glass-composer":`${(100-preferences.transparency)*.8}%`,"--popup-dark-coverage":`${(100-preferences.transparency)*.3}%`,"--popup-light-coverage":`${(100-preferences.transparency)*.9}%`,"--sidebar-width":`${preferences.sidebar_width}px`,"--conversation-width":`${preferences.conversation_width}px`,"--code-font":fontFamily(preferences.code_font),"--terminal-font":fontFamily(preferences.terminal_font),"--code-size":`${preferences.code_size}px`,"--terminal-size":`${preferences.terminal_size}px`,"--interface-scale":preferences.interface_size/16,...(preferences.accent!=="default"?{"--accent":accentFor(preferences.accent,activeTheme.appearance)}:{}),fontFamily:fontFamily(preferences.interface_font,"sans-serif")} as CSSProperties}
    >
      {<div className="sidebar-clip" inert={!sidebarOpen}>{page === "settings" && <SettingsNavigation section={settingsSection} onSection={section=>{setSettingsSection(section);updatePreferences({...preferences,settings_section:section});}} onBack={closeSettings}/>}<Sidebar
        preferences={preferences} onPreferences={updatePreferences}
        page={page}
        sessions={visibleSessions} allSessions={sessions}
        projects={visibleProjects}
        projectNames={projectNames}
        externalConversations={visibleExternalConversations}
        projectOrganization={preferences.project_organization}
        projectSort={preferences.project_sort}
        resumingConversationId={resumingConversationId}
        selectedId={selectedId}
        connected={connected}
        onPage={openPage}
        onOpen={openSession}
        onResumeExternal={resumeExternalConversation}
        onProjectOrganization={(projectOrganization) => updatePreferences({ ...preferences, project_organization: projectOrganization })}
        onProjectSort={(projectSort) => updatePreferences({ ...preferences, project_sort: projectSort })}
        onNewProject={()=>{window.dispatchEvent(new Event("openade-dismiss-menus"));setProjectPaletteOpen(true);}}
        onSearch={()=>{window.dispatchEvent(new Event("openade-dismiss-menus"));setPaletteOpen(true);}}
        onNewSession={openComposer}
        onToggle={toggleSidebar}
        onArchive={setArchived}
        onBeforeDelete={ids=>selectedId&&ids.includes(selectedId)&&editorDirty.current?"Save or discard your editor changes before deleting this chat.":null}
        onDeleted={id=>{forgetReviewComments(id);if(selectedId===id&&connected)void refresh();}}
      /></div>}
      {sidebarOpen && page !== "settings" && <ResizeBoundary className="sidebar-resizer" label="Resize sidebar" width={preferences.sidebar_width} min={224} max={400} defaultWidth={256} onResize={width=>updatePreferences({...preferences,sidebar_width:width},false)} onCommit={width=>updatePreferences({...preferences,sidebar_width:width})}/> }

      {paletteOpen&&<CommandPalette sessions={sessions} projectNames={projectNames} preferences={preferences} isDark={activeTheme.appearance==="dark"} onClose={()=>setPaletteOpen(false)} onOpen={id=>{void openSession(id);}} onAction={action=>{if(action==="new")openComposer();else if(action==="theme")updatePreferences({...preferences,color_scheme:activeTheme.appearance==="dark"?"light":"dark"});else if(action==="project")setProjectPaletteOpen(true);else openPage("settings");}}/>}
      {projectPaletteOpen&&<ProjectPalette onClose={()=>setProjectPaletteOpen(false)} onCommands={()=>setPaletteOpen(true)} onAdded={path=>{void refresh();try{const draft=JSON.parse(sessionStorage.getItem("openade.home-draft")||"{}");sessionStorage.setItem("openade.home-draft",JSON.stringify({...draft,repo:path}));}catch{sessionStorage.setItem("openade.home-draft",JSON.stringify({repo:path}));}window.dispatchEvent(new CustomEvent("openade-select-project",{detail:path}));openComposer();}}/>}
      <main className="main-shell">
        {!sidebarOpen && <button className="sidebar-toggle icon-button" onClick={() => setSidebarOpen(true)} aria-label="Toggle sidebar"><SidebarSimple size={18} /></button>}
        {!connected && <div className="connection-banner"><SpinnerGap className="spin" /> {error || "Connecting to the local daemon…"}<button onClick={()=>{const bridge=window as typeof window & {go?:{main?:{App?:{Reconnect?:()=>Promise<void>}}}};void (bridge.go?.main?.App?.Reconnect?.()||Promise.resolve()).then(refresh).catch(reason=>setError(String(reason)));}}>Reconnect</button></div>}
        {connected && error && <button aria-label="Dismiss error" className="error-toast" onClick={() => setError(null)}><span role="alert">{error}</span><X /></button>}
        {selected&&<div className="retained-workspace" hidden={page==="settings"} inert={page==="settings"}><Suspense fallback={<div className="opening-session" role="status">Opening session…</div>}><SessionWorkspace activeView={page!=="settings"} key={selected.id} session={selected} projectLabel={projectNames[selected.repo_root]} preferences={preferences} onPreferences={updatePreferences} onArchive={()=>{if(editorDirty.current){setError("Save or discard file changes before archiving.");return;}void setArchived(selected.id,!selected.archived).then(done=>{if(done&&!selected.archived)setSelectedId(null);});}} onBack={() => {if(editorDirty.current){setError("Save or discard file changes before leaving this session.");return;}setSelectedId(null);}} onRefresh={refresh} /></Suspense></div>}
        <div className="retained-home" hidden={Boolean(selected)||page!=="home"} inert={Boolean(selected)||page!=="home"}><Home activeView={!selected&&page==="home"} sessions={sessions.filter(item=>!item.parent_session_id)} projects={visibleProjects} projectNames={projectNames} removedProjects={removedProjects} meta={meta} preferences={preferences} artwork={engine.new_thread_artwork} onCreated={(session) => { setPendingSelectionID(session.id); void refresh(); }} onOpen={openSession} onError={setError} /></div>
        {selected&&page!=="settings" || page === "home" ? null : page === "sites" ? (
          <SitesPage />
        ) : page === "sessions" ? (
          <SessionsPage sessions={visibleSessions} projectNames={projectNames} onOpen={openSession} />
        ) : page === "agents" ? (
          <AgentsPage onUse={(prompt) => { sessionStorage.setItem("openade-template", prompt); setPage("home"); }} />
        ) : page === "review" ? (
          <ReviewPage projects={visibleProjects} projectNames={projectNames} sessions={sessions} />
        ) : (
          <SettingsPage activeAppearance={activeTheme.appearance} resolvedMaterial={activeMaterial} nativeMaterial={nativeMaterial} preferences={preferences} artwork={engine.new_thread_artwork} onArtworkChanged={(artwork)=>{updatePreferences({...preferences,new_thread_background_effect:artwork.effect});void refreshEngine();}} onChange={updatePreferences} section={settingsSection} meta={meta} sessions={sessions} onSetup={session=>{if(editorDirty.current){setError("Save or discard file changes before opening provider setup.");return;}setPendingSelectionID(session.id);void refresh();}} onRestore={id=>{void setArchived(id,false);}} />
        )}
      </main>
    </div>
  );
}

function Home({ activeView, projects, projectNames, removedProjects, meta, preferences, artwork, onCreated, onError }: { activeView:boolean; sessions: Session[]; projects: string[]; projectNames:Record<string,string>; removedProjects:string[]; meta: Meta | null; preferences: Preferences; artwork:NewThreadArtworkState; onCreated: (session: Session) => void; onOpen: (id: string) => void; onError: (error: string | null) => void }) {
  const draft=useRef<{prompt?:string;repo?:string;agent?:string;model?:string;effort?:string;serviceTier?:string;checkout?:"current"|"worktree";base?:string}>((()=>{try{const value=JSON.parse(sessionStorage.getItem("openade.home-draft")||"{}");return value&&typeof value==="object"?value:{};}catch{return {};}})());
  const [prompt, setPrompt] = useState(() => sessionStorage.getItem("openade-template") ?? draft.current.prompt ?? "");
  const attachments=useAttachments("home");
  const homeComposer=useComposerLayout(prompt,preferences.interface_size,true,76,activeView);
  const [repo, setRepo] = useState(draft.current.repo ?? projects[0] ?? "");
  const [projectless,setProjectless]=useState((draft.current.repo ?? projects[0] ?? "")==="");
  const [agent, setAgent] = useState(draft.current.agent ?? preferences.default_agent);
  const [model,setModel]=useState(draft.current.model??"");const [effort,setEffort]=useState(draft.current.effort??"");const [serviceTier,setServiceTier]=useState(draft.current.serviceTier??"");const [checkout,setCheckout]=useState<"worktree"|"current">(draft.current.checkout==="current"?"current":"worktree");const [branches,setBranches]=useState<string[]>([]);const [gitProject,setGitProject]=useState(true);const [currentBranch,setCurrentBranch]=useState("HEAD");
  const [ticket, setTicket] = useState("");
  const [ticketURL, setTicketURL] = useState("");
  const [base, setBase] = useState(draft.current.base??"HEAD");
  const [optionsOpen, setOptionsOpen] = useState(false);
  useEffect(()=>{if(!activeView){setOptionsOpen(false);window.dispatchEvent(new Event("openade-dismiss-menus"));return;}const template=sessionStorage.getItem("openade-template");if(template!==null){setPrompt(template);sessionStorage.removeItem("openade-template");}},[activeView]);
  const [busy, setBusy] = useState(false);const starting=useRef(false);

  const repositoryEdited=useRef(draft.current.repo!==undefined);
  const updateRepository=(value:string)=>{repositoryEdited.current=true;setProjectless(!value);setRepo(value);};
  useEffect(()=>{if(repo&&removedProjects.includes(repo)){repositoryEdited.current=true;setProjectless(true);setRepo("");}},[repo,removedProjects]);
  useEffect(()=>{const select=(event:Event)=>updateRepository((event as CustomEvent<string>).detail);window.addEventListener("openade-select-project",select);return()=>window.removeEventListener("openade-select-project",select);},[]);
  useEffect(() => { if (!repositoryEdited.current && !repo && projects[0]) { setRepo(projects[0]); setProjectless(false); } }, [projects, repo]);
  const previousDefault=useRef(preferences.default_agent);
  useEffect(() => { if(previousDefault.current!==preferences.default_agent){setAgent(preferences.default_agent);previousDefault.current=preferences.default_agent;} }, [preferences.default_agent]);
  useEffect(()=>{sessionStorage.setItem("openade.home-draft",JSON.stringify({prompt,repo,agent,model,effort,serviceTier,checkout,base}));},[prompt,repo,agent,model,effort,serviceTier,checkout,base]);
  const latestDraft=useRef({prompt,repo,agent,model,effort,serviceTier,checkout,base});latestDraft.current={prompt,repo,agent,model,effort,serviceTier,checkout,base};
  useEffect(() => {
    const preferredAvailable = meta?.agents.find((item) => item.id === preferences.default_agent)?.available;
    const installed = meta?.agents.find((item) => item.available)?.id;
    if ((preferredAvailable === false || preferences.disabled_providers.includes(preferences.default_agent)) && installed) setAgent(meta?.agents.find(item=>item.available&&!preferences.disabled_providers.includes(item.id))?.id ?? "shell");
  }, [meta, preferences.default_agent, preferences.disabled_providers]);

  useEffect(()=>{if(!activeView)return;if(!repo.trim()){setBranches([]);setGitProject(false);return;}let stale=false;const timer=window.setTimeout(()=>void getBranches(repo).then(value=>{if(!stale){setGitProject(true);setBranches(value.branches);setCurrentBranch(value.current||"HEAD");}}).catch(async reason=>{try{const folder=await getProjectDirectories(repo);if(!stale){setBranches([]);setGitProject(folder.git!==false);if(folder.git===false)setCheckout("current");else onError(reason instanceof Error?reason.message:String(reason));}}catch{if(!stale)onError(reason instanceof Error?reason.message:String(reason));}}),250);return()=>{stale=true;clearTimeout(timer);};},[repo,projectless,activeView]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeView||starting.current||(!prompt.trim()&&!attachments.images.length)||attachments.uploading||(!repo.trim()&&!projectless)) return;
    starting.current=true;const originalImages=attachments.images;const originalPrompt=prompt;
    setBusy(true);
    onError(null);
    try {
      const session = await createSession({ auto_title:true,title: (prompt.trim()||"Image conversation").split("\n")[0].slice(0, 68), prompt: withAttachments(prompt,attachments.images), agent,model,effort,service_tier:serviceTier,checkout, mode: preferredSessionMode(preferences, agent), repo_root: repo.trim(), base_branch: base.trim() || "HEAD", ticket_key: ticket.trim(), ticket_url: ticketURL.trim() });
      const submittedIDs=new Set(originalImages.map(image=>image.id));attachments.setImages(current=>current.filter(image=>!submittedIDs.has(image.id)));
      sessionStorage.removeItem("openade-template");
      const remainingDraft={...latestDraft.current,prompt:latestDraft.current.prompt===originalPrompt?"":latestDraft.current.prompt};
      latestDraft.current=remainingDraft;
      setPrompt(remainingDraft.prompt);
      sessionStorage.setItem("openade.home-draft",JSON.stringify(remainingDraft));
      onCreated(session);
    } catch (reason) {
      const current=latestDraft.current.prompt??"";
      const recovered=recoverRejectedDraft(originalPrompt,current);
      const combined=Boolean(originalPrompt&&current&&current!==originalPrompt);
      const remainingDraft={...latestDraft.current,prompt:recovered};
      latestDraft.current=remainingDraft;
      sessionStorage.setItem("openade.home-draft",JSON.stringify(remainingDraft));
      sessionStorage.removeItem("openade-template");
      setPrompt(recovered);
      const message=reason instanceof Error ? reason.message : String(reason);
      onError(combined?`The submitted prompt and newer draft were restored, separated by a blank line. ${message}`:message);
    } finally { starting.current=false;setBusy(false); }
  };

  const browse = async () => {
    try {
      const selected = await selectRepository();
      if (selected) updateRepository(selected);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  if(!activeView)return null;
  return <div className="home-page">
    <section className={`home-hero ${artwork.image?"with-artwork":""}`}>
      <NewThreadArtwork artwork={artwork}/>
      <div className="home-context"><Select aria-label="Choose device" icon={<Desktop size={14}/>} value="local"><option value="local">Local workspace</option></Select><Select aria-label="Choose project" searchable icon={<Folder size={14}/>} value={repo} placeholder="Choose project" onChange={event=>updateRepository(event.target.value)} footer={<><input aria-label="Repository" placeholder="Or enter a repository path…" value={repo} onChange={event=>updateRepository(event.target.value)}/><button type="button" onClick={()=>void browse()}>Browse folders…</button></>}><option value="">No project</option>{[...new Set([...projects,...(repo?[repo]:[])])].filter(Boolean).map(project=><option value={project} key={project}>{projectNames[project]??projectName(project)}</option>)}</Select></div>
      <form ref={homeComposer.form} className="composer source-new-composer" onSubmit={submit} onPaste={attachments.paste} onDragOver={event=>{if(event.dataTransfer.types.includes("Files"))event.preventDefault();}} onDrop={attachments.drop}>
        <AttachmentStrip draft={attachments}/>
        <textarea ref={homeComposer.textarea} aria-label="New session prompt" data-main-composer value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder="Do anything…" rows={3} onKeyDown={event=>{if(shouldSend(event,preferences.send_behavior)){event.preventDefault();event.currentTarget.form?.requestSubmit();}}}/>
        {optionsOpen && <div className="composer-options"><label><span>Jira key</span><input value={ticket} onChange={event=>setTicket(event.target.value.toUpperCase())} placeholder="ADE-123"/></label><label><span>Ticket URL</span><input value={ticketURL} onChange={event=>setTicketURL(event.target.value)} placeholder="https://…/browse/ADE-123"/></label><label><span>Base branch</span><input value={base} onChange={event=>setBase(event.target.value)} placeholder="HEAD"/></label></div>}
        <div className="composer-toolbar"><AttachmentPicker draft={attachments}/><ModelPicker disabled={!activeView} providers={agents.filter(item=>!preferences.disabled_providers.includes(item.id)).map(item=>({...item,available:item.id==="shell"||meta?.agents.find(candidate=>candidate.id===item.id)?.available!==false}))} onProviderChange={value=>{setAgent(value);setModel("");setEffort("");setServiceTier("");}} serviceTier={serviceTier} onTierChange={setServiceTier} provider={agent} models={meta?.agents.find(item=>item.id===agent)?.models} model={model} effort={effort} onChange={(model,effort)=>{setModel(model);setEffort(effort);}}/><button className="send-button" type="submit" aria-label="Start session" disabled={busy||attachments.uploading||(!prompt.trim()&&!attachments.images.length)||(!repo.trim()&&!projectless)}>{busy?<SpinnerGap className="spin"/>:<ArrowUp weight="bold"/>}</button></div>
      </form>
      <div className="home-status"><Select icon={<Folder size={13}/>} aria-label="Checkout mode" disabled={!gitProject} value={gitProject?checkout:"current"} onChange={e=>setCheckout(e.target.value as "current"|"worktree")}><option value="worktree">Isolated worktree</option><option value="current">{gitProject?"Current checkout":projectless?"No project":"Folder workspace"}</option></Select><Select searchable icon={<GitBranch size={13}/>} aria-label="Starting branch" value={checkout==="current"?currentBranch:base} disabled={!gitProject||checkout==="current"} onChange={e=>setBase(e.target.value)}><option value="HEAD">HEAD</option>{[...new Set([...branches,...(currentBranch!=="HEAD"?[currentBranch]:[]),...(base!=="HEAD"?[base]:[])])].map(branch=><option key={branch}>{branch}</option>)}</Select><button aria-label="Session options" aria-expanded={optionsOpen} type="button" className="session-options-action" onClick={()=>setOptionsOpen(value=>!value)}><Plus size={17}/></button></div>
    </section>
  </div>;
}

function preferredSessionMode(preferences: Preferences, agent: string): "chat" | "tui" {
 if(!["claude","claude-code","codex","codex-cli","grok","devin","hermes","pi","antigravity","shell"].includes(agent))return "tui";
  return preferences.session_surface === "terminal" && ["codex", "codex-cli", "claude", "claude-code"].includes(agent)
    ? "tui"
    : "chat";
}

function SessionsPage({ sessions, projectNames, onOpen }: { sessions: Session[]; projectNames:Record<string,string>; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const filtered = sessions.filter((session) => (status === "all" || session.status === status) && `${session.title} ${projectNames[session.repo_root]??""} ${session.repo_root} ${session.branch} ${session.ticket_key}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="list-page"><PageHeader eyebrow="Workspace" title="Sessions" subtitle={`${sessions.length} indexed across ${new Set(sessions.map((item) => item.repo_root)).size} repositories`} />
    <div className="list-toolbar"><label className="search-box"><ListMagnifyingGlass /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sessions" /></label><Select aria-label="Session status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="running">Running</option><option value="waiting">Waiting</option><option value="completed">Completed</option><option value="failed">Failed</option></Select></div>
    <div className="session-table"><div className="table-head"><span>Task</span><span>Project</span><span>Linked work</span><span>Status</span><span>Updated</span></div>{filtered.map((session) => <button className="table-row" key={session.id} onClick={() => onOpen(session.id)} title={`Branch: ${session.branch}`}><span className="task-cell"><span className={`status-dot ${session.status}`} /><strong>{session.title}</strong><small>{agentLabel(session.agent)}</small></span><span>{projectNames[session.repo_root]??projectName(session.repo_root)}</span><span className="linked-work-cell">{session.ticket_key ? <span className="ticket-chip"><TicketIcon />{session.ticket_key}</span> : <small>No linked ticket</small>}</span><span><StatusPill status={session.status} /></span><span>{relativeTime(session.updated_at)}</span></button>)}{filtered.length === 0 && <div className="table-empty">No sessions match these filters.</div>}</div>
  </div>;
}

function AgentsPage({ onUse }: { onUse: (prompt: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const categories = ["All", ...new Set(templates.map((item) => item.category))];
  const filtered = templates.filter((item) => (category === "All" || item.category === category) && `${item.title} ${item.prompt}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="agents-page"><div className="agents-hero"><div><span className="eyebrow">Reusable instructions</span><h1>Workflows</h1><p>Start from a focused brief, then choose the repository and linked work item.</p></div><div className="agent-constellation"><span><Robot /></span><i /><span><GithubLogo /></span><i /><span><TicketIcon /></span></div></div><label className="template-search"><ListMagnifyingGlass /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a workflow" /></label><div className="filter-chips">{categories.map((item) => <button className={category === item ? "active" : ""} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div><div className="template-grid">{filtered.map((template) => { const Icon = template.icon; return <button key={template.title} className="template-card" onClick={() => onUse(template.prompt)}><div className="template-icon"><Icon /></div><strong>{template.title}</strong><p>{template.prompt}</p><span>Start with this workflow <ArrowUp /></span></button>; })}</div></div>;
}

function agentLabel(agent: string): string {
  return ({ claude: "Claude Code", codex: "Codex CLI", grok: "Grok", devin: "Devin", hermes: "Hermes", pi: "Pi", antigravity: "Antigravity", copilot: "Copilot", opencode: "OpenCode", shell: "Local shell" } as Record<string, string>)[agent] ?? agent;
}

function ReviewPage({ projects, projectNames, sessions }: { projects: string[]; projectNames:Record<string,string>; sessions: Session[] }) {
  const [repo, setRepo] = useState(projects[0] ?? "");
  const [prs, setPRs] = useState<PullRequest[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!repo && projects[0]) setRepo(projects[0]); }, [projects, repo]);
  useEffect(() => {
    if (!repo) return;
    let stale = false;
    setLoading(true); setError(null);
    void listPullRequests(repo)
      .then((next) => { if (!stale) setPRs(next); })
      .catch((reason) => { if (!stale) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [repo]);
  const draft = prs.filter((pr) => pr.isDraft).length;
  const needsReview = prs.filter((pr) => pr.reviewDecision === "REVIEW_REQUIRED").length;
  const filtered = prs.filter((pr) => `${pr.title} ${pr.author.login} ${pr.headRefName}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="review-page"><div className="review-top"><PageHeader eyebrow="GitHub" title="Pull requests" subtitle="Review and deliver changes across local projects" /><label className="repo-picker"><GithubLogo /><Select aria-label="Review repository" value={repo} onChange={(event) => setRepo(event.target.value)}>{projects.map((project) => <option key={project} value={project}>{projectNames[project]??projectName(project)}</option>)}</Select></label></div><div className="review-metrics"><Metric label="Open" value={prs.length} tone="green" /><Metric label="Needs review" value={needsReview} tone="orange" /><Metric label="Draft" value={draft} tone="neutral" /></div><div className="list-toolbar"><label className="search-box"><ListMagnifyingGlass /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pull requests" /></label></div>{loading ? <div className="loading-state"><SpinnerGap className="spin" /> Loading pull requests…</div> : error ? <div className="inline-error">{error}</div> : <div className="pr-list">{filtered.map((pr) => { const linked = sessions.find((session) => session.branch === pr.headRefName); return <button key={pr.number} className="pr-row" onClick={() => window.open(pr.url, "_blank")}><span className="pr-number">#{pr.number}</span><span className="pr-main"><strong>{pr.title}</strong><small>{pr.headRefName} → {pr.baseRefName} · @{pr.author.login}</small></span>{linked?.ticket_key && <span className="ticket-chip"><TicketIcon />{linked.ticket_key}</span>}<StatusPill status={pr.isDraft ? "interrupted" : "running"} label={pr.isDraft ? "Draft" : "Open"} /></button>; })}{filtered.length === 0 && <div className="table-empty">No open pull requests found for this repository.</div>}</div>}</div>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) { return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>; }
function PageHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) { return <header className="page-header"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></header>; }
function StatusPill({ status, label }: { status: string; label?: string }) { return <span className={`status-pill ${status}`}><span className="status-dot" />{label ?? status.replace("-", " ")}</span>; }

async function selectRepository(): Promise<string> {
  const bridge = window as typeof window & {
    go?: { main?: { App?: { SelectRepository?: () => Promise<string> } } };
  };
  if (bridge.go?.main?.App?.SelectRepository) {
    return bridge.go.main.App.SelectRepository();
  }
  throw new Error("Folder selection is available in the Wails desktop build.");
}

export default AppShell;
