import {useProviderState,ProviderInteraction,ContextUsage} from "./ProviderInteraction";
import {WebLinkContext} from "./WebLinkContext";
import {useAttachments,AttachmentPicker,AttachmentStrip,withAttachments} from "./Attachments";
import {useComposerLayout} from "./useComposerLayout";
import {menuKeys} from "./menuKeys";
import {ResizeBoundary} from "./ResizeBoundary";
import {
  ArrowLeft,
  ArrowUp,
  ChatCircleDots,
  DotsThree,
  GitBranch,
  Folder,
  FileCode,
  Globe,
  ClockCounterClockwise,
  SidebarSimple,
  Archive,
  GitDiff,
  GithubLogo,
  Plus,
  SpinnerGap,
  Square,
  TerminalWindow,
  Ticket as TicketIcon,
  X,
} from "@phosphor-icons/react";
import { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, ReactNode, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  createPullRequest,
  createSideChat,
  enqueueMessage,
  updateQueuedMessage,
  getTicket,
  listAgentCommands,
  listMessageQueue,
  projectName,
  QueuedMessage,
  removeQueuedMessage as removeQueuedMessageRequest,
  Session,
  steerQueuedMessage as steerQueuedMessageRequest,
  stopSession,
  streamURL,
  Ticket,
  AgentCommand,
 updateModel, updateSessionDetails,
} from "./api";
import { AgentCommandMenu, filterAgentCommands } from "./AgentCommandMenu";
import { copyText } from "./clipboard";
import { ChatTimeline } from "./ChatTimeline";
import { ReviewWorkspace } from "./ReviewWorkspace";
import { ReviewComment, withReviewComments } from "./ReviewComments";
import { SideChatPane } from "./SideChatPane";
import { SubagentPane } from "./SubagentPane";
const TerminalWorkspace=lazy(()=>import("./Terminal").then(module=>({default:module.TerminalWorkspace})));
const DirectTUIWorkspace=lazy(()=>import("./Terminal").then(module=>({default:module.DirectTUIWorkspace})));
import { Preferences, shortcutMatches, shouldSend } from "./preferences";
import { BrowserPanel, FilesPanel, forgetFilesPanel } from "./WorkspacePanels";
import { HistoryPanel } from "./HistoryPanel";
import { useEngine, refreshEngine } from "./engine-store";
import { ModelPicker } from "./ModelPicker";
import { MessageQueue } from "./MessageQueue";

const sessionDrafts=new Map<string,string>();
const reviewCommentDrafts=new Map<string,ReviewComment[]>();
export function forgetReviewComments(sessionId:string){reviewCommentDrafts.delete(sessionId);}
const pendingSessionSends=new Set<string>();
const notifyPendingSend=(id:string)=>window.dispatchEvent(new CustomEvent("openade-pending-send",{detail:id}));

export function recoverRejectedDraft(original:string,current:string){
  if(!current||current===original)return original;
  if(!original)return current;
  return `${original}\n\n${current}`;
}

type WorkTab = "review" | "terminal" | "pull-request" | "ticket" | "browser" | "history" | "editor" | `browser:${string}` | `side-chat:${string}` | `subagent:${string}` | `commit:${string}`;
type BrowserPageState={url?:string;label:string;favicon?:string};
type PanelMemory={browserPages:Record<string,BrowserPageState>;subagentTitles:Record<string,string>;tabs:WorkTab[];tab:WorkTab;rightOpen:boolean;filesOpen:boolean};
const panelMemory=new Map<string,PanelMemory>();
const forgottenPanelOwners=new Set<string>();
export function forgetWorkspacePanels(sessionId:string){forgottenPanelOwners.add(sessionId);forgetFilesPanel(sessionId);const remembered=panelMemory.get(sessionId);if(!remembered)return;const bridge=(window as typeof window&{go?:{main?:{App?:{BrowserActionTab?:(id:string,action:string)=>Promise<void>}}}}).go?.main?.App;for(const id of Object.keys(remembered.browserPages))void bridge?.BrowserActionTab?.(id,"close");panelMemory.delete(sessionId);}

export function SessionWorkspace({ activeView=true, session, projectLabel, preferences, onBack, onRefresh, onPreferences, onArchive }: { activeView?:boolean; session: Session; projectLabel?:string; preferences: Preferences; onPreferences:(next:Preferences,persist?:boolean)=>void; onArchive:()=>void; onBack: () => void; onRefresh: () => Promise<void> }) {
  const tuiMode = session.mode === "tui";
 const provider=useProviderState(session.id,["starting","running","waiting"].includes(session.status),activeView&&!tuiMode&&["codex","codex-cli","claude","claude-code","grok","devin","hermes","pi","antigravity"].includes(session.agent));const providerRequest=provider.state.requests[0];
  const defaultTab: WorkTab = session.agent === "shell" || (preferences.session_surface === "terminal" && !tuiMode) ? "terminal" : "review";
  const rememberedPanels=useRef(panelMemory.get(session.id)).current;
  const [browserPages,setBrowserPages]=useState<Record<string,BrowserPageState>>(()=>rememberedPanels?.browserPages??{});
  const [tab, setTab] = useState<WorkTab>(()=>rememberedPanels?.tab??defaultTab);
  const [rightOpen, setRightOpen] = useState(()=>rememberedPanels?.rightOpen??(!tuiMode&&(session.agent === "shell" || (preferences.session_surface === "terminal" && !tuiMode))));
  const [tabs,setTabs]=useState<WorkTab[]>(()=>rememberedPanels?.tabs??(session.agent === "shell" ? ["terminal"] : []));
  const [subagentTitles,setSubagentTitles]=useState<Record<string,string>>(()=>rememberedPanels?.subagentTitles??{});
  const [filesOpen,setFilesOpen]=useState(()=>rememberedPanels?.filesOpen??false);
  useLayoutEffect(()=>{if(!forgottenPanelOwners.has(session.id))panelMemory.set(session.id,{browserPages,subagentTitles,tabs,tab,rightOpen,filesOpen});},[session.id,browserPages,subagentTitles,tabs,tab,rightOpen,filesOpen]);
  const panelStrip=useRef<HTMLDivElement>(null),panelGhost=useRef<HTMLDivElement>(null),panelPointer=useRef<{surface:WorkTab;id:number;startX:number;startY:number;dragging:boolean;restoreFocus:boolean;over?:number}|null>(null),suppressTabClick=useRef<WorkTab|null>(null);
  const [panelDrag,setPanelDrag]=useState<{surface:WorkTab;from:number;over:number;x:number;y:number}|null>(null);
  const movePanelTab=(surface:WorkTab,to:number)=>{setTabs(current=>{const from=current.indexOf(surface);if(from<0||to<0||to>=current.length||from===to)return current;const next=[...current];next.splice(from,1);next.splice(to,0,surface);return next;});};
  const panelDropIndex=(clientX:number)=>{const strip=panelStrip.current;if(!strip)return 0;const rect=strip.getBoundingClientRect();if(clientX<rect.left+24)strip.scrollLeft=Math.max(0,strip.scrollLeft-18);else if(clientX>rect.right-24)strip.scrollLeft+=18;const x=clientX-rect.left+strip.scrollLeft;return Math.max(0,Math.min(tabs.length-1,Math.floor(x/116)));};
  const panelSlide=(index:number)=>{if(!panelDrag)return 0;const {from,over}=panelDrag;return from<over&&index>from&&index<=over?-116:over<from&&index>=over&&index<from?116:0;};
  const startPanelPointer=(surface:WorkTab,event:ReactPointerEvent<HTMLButtonElement>)=>{if(event.button!==0||event.pointerType==="touch")return;suppressTabClick.current=null;panelPointer.current={surface,id:event.pointerId,startX:event.clientX,startY:event.clientY,dragging:false,restoreFocus:event.currentTarget===document.activeElement};event.currentTarget.setPointerCapture(event.pointerId);};
  const movePanelPointer=(event:ReactPointerEvent<HTMLButtonElement>)=>{const gesture=panelPointer.current;if(!gesture||gesture.id!==event.pointerId)return;if(!gesture.dragging&&Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY)<5)return;if(!gesture.dragging){gesture.dragging=true;suppressTabClick.current=gesture.surface;}event.preventDefault();const from=tabs.indexOf(gesture.surface),over=panelDropIndex(event.clientX);if(from<0)return;if(gesture.over!==over){gesture.over=over;setPanelDrag(current=>({surface:gesture.surface,from,over,x:current?.surface===gesture.surface?current.x:event.clientX,y:current?.surface===gesture.surface?current.y:event.clientY}));}if(panelGhost.current){panelGhost.current.style.left=`${event.clientX-56}px`;panelGhost.current.style.top=`${event.clientY-12}px`;}};
  const finishPanelPointer=(event:ReactPointerEvent<HTMLButtonElement>,commit:boolean)=>{const gesture=panelPointer.current;if(!gesture||gesture.id!==event.pointerId)return;panelPointer.current=null;if(gesture.dragging){const rect=panelStrip.current?.getBoundingClientRect();if(commit&&rect&&event.clientX>=rect.left-8&&event.clientX<=rect.right+8&&event.clientY>=rect.top-8&&event.clientY<=rect.bottom+8){movePanelTab(gesture.surface,panelDropIndex(event.clientX));if(gesture.restoreFocus)requestAnimationFrame(()=>[...document.querySelectorAll<HTMLElement>(".panel-tabs>div")].find(chip=>chip.dataset.panelTab===gesture.surface)?.querySelector<HTMLElement>('[role="tab"]')?.focus());}}setPanelDrag(null);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);};
  const openCommit=(sha:string)=>{const surface:WorkTab=`commit:${sha}`;setTabs(current=>current.includes(surface)?current:[...current,surface]);setTab(surface);setRightOpen(true);};
  const openSubagent=useCallback((id:string,title:string)=>{const surface:WorkTab=`subagent:${id}`;setSubagentTitles(current=>current[surface]===title?current:{...current,[surface]:title});setTabs(current=>current.includes(surface)?current:[...current,surface]);setTab(surface);setRightOpen(true);},[]);
  const addBrowserTab=useCallback((url?:string)=>{
    const surface:WorkTab=`browser:${crypto.randomUUID()}`;
    setBrowserPages(current=>({...current,[surface]:{url,label:"Browser"}}));
    setTabs(current=>[...current,surface]);
    setTab(surface);
    setRightOpen(true);
    return surface;
  },[]);
  const updateBrowserLabel=useCallback((surface:string,label:string)=>{
    setBrowserPages(current=>current[surface]&&current[surface].label!==label?{...current,[surface]:{...current[surface],label}}:current);
  },[]);
  const updateBrowserFavicon=useCallback((surface:string,data:string)=>{
    setBrowserPages(current=>current[surface]&&current[surface].favicon!==data?{...current,[surface]:{...current[surface],favicon:data||undefined}}:current);
  },[]);
  const updateBrowserURL=useCallback((surface:string,url:string)=>{
    setBrowserPages(current=>current[surface]&&current[surface].url!==url?{...current,[surface]:{...current[surface],url}}:current);
  },[]);
  const [editorTarget,setEditorTarget]=useState<HTMLDivElement|null>(null);
  const openEditor=useCallback(()=>{setTabs(current=>current.includes("editor")?current:[...current,"editor"]);setTab("editor");setRightOpen(true);},[]);
  const [tabMenu,setTabMenu]=useState(false);
  const [actionsOpen,setActionsOpen]=useState(false);const [detailsEditor,setDetailsEditor]=useState<"title"|"instructions"|null>(null);const [detailsValue,setDetailsValue]=useState("");
  const [panelMounted,setPanelMounted]=useState(rightOpen);
  const [filesMounted,setFilesMounted]=useState(filesOpen||tabs.includes("editor"));
  const dirtyRef=useRef(false);
  const onDirtyChange=useCallback((dirty:boolean)=>{dirtyRef.current=dirty;window.dispatchEvent(new CustomEvent("openade-editor-dirty",{detail:dirty}));},[]);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [input, setInput] = useState(()=>sessionDrafts.get(session.id)??"");
  const [comments,setCommentsState]=useState<ReviewComment[]>(()=>reviewCommentDrafts.get(session.id)??[]);
  const commentsRef=useRef(comments);
  const setComments=useCallback((action:ReviewComment[]|((current:ReviewComment[])=>ReviewComment[]))=>{
    const next=typeof action==="function"?action(commentsRef.current):action;
    commentsRef.current=next;
    if(next.length)reviewCommentDrafts.set(session.id,next);else reviewCommentDrafts.delete(session.id);
    setCommentsState(next);
  },[session.id]);
  useEffect(()=>{const restored=(event:Event)=>{const detail=(event as CustomEvent<{id:string;error:string}>).detail;if(detail.id===session.id){setInput(sessionDrafts.get(session.id)??"");setPanelError(detail.error);}};window.addEventListener("openade-rejected-draft",restored);return()=>window.removeEventListener("openade-rejected-draft",restored);},[session.id]);
  const attachments=useAttachments(session.id);
  const submitting=useRef(false);const [sending,setSending]=useState(()=>pendingSessionSends.has(session.id));
  useEffect(()=>{const changed=(event:Event)=>{if((event as CustomEvent<string>).detail===session.id)setSending(pendingSessionSends.has(session.id));};window.addEventListener("openade-pending-send",changed);return()=>window.removeEventListener("openade-pending-send",changed);},[session.id]);
  const composerLayout=useComposerLayout(input,preferences.interface_size,attachments.images.length>0||comments.length>0);
  useEffect(()=>{sessionDrafts.delete(session.id);if(input){sessionDrafts.set(session.id,input);if(sessionDrafts.size>32)sessionDrafts.delete(sessionDrafts.keys().next().value!);}},[session.id,input]);
  useEffect(()=>{if(!activeView){setTabMenu(false);setActionsOpen(false);setCommandOpen(false);}},[activeView]);
  const [editingMessageId,setEditingMessageId]=useState<string|null>(null);
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sideChatCreating,setSideChatCreating]=useState(false);
  const [streamVersion, setStreamVersion] = useState(0);
  const [commands, setCommands] = useState<AgentCommand[]>([]);
  const [commandOpen, setCommandOpen] = useState(false);
  const engine=useEngine();
  const sideChats=engine.sessions.filter(child=>child.parent_session_id===session.id&&!child.archived);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const outputRef = useRef<HTMLDivElement>(null);
  const reconnectStreamRef = useRef(false);
 const byteCursor=useRef(0);
 const followLatest=useRef(true);
 const [following,setFollowing]=useState(true);
  const mountedRef = useRef(false);
  const focusTimerRef = useRef<number | undefined>(undefined);
  const active = ["running", "starting", "waiting"].includes(session.status);
  const resumable = ["claude", "claude-code", "codex", "codex-cli", "cursor", "grok", "devin", "hermes", "pi", "antigravity"].includes(session.agent) && !active;
  const chatCapable = session.agent !== "shell" && !tuiMode;
  const canMessage = chatCapable && (active || resumable);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (focusTimerRef.current !== undefined) window.clearTimeout(focusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if(!rememberedPanels){
      setTab(defaultTab);
      setRightOpen(!tuiMode&&(session.agent === "shell" || preferences.session_surface === "terminal"));
    }
    setPanelError(null);
    setTicket(null);
  }, [defaultTab, preferences.session_surface, session.agent, session.id, tuiMode]);

  const refreshQueue = useCallback(async () => {
    if (!chatCapable) return;
    try {
      await refreshEngine();
      const next = await listMessageQueue(session.id);
      if (mountedRef.current) setQueuedMessages(next);
    } catch {
      // The session refresh loop will surface daemon connectivity errors globally.
    }
  }, [chatCapable, session.id]);

  useEffect(()=>{setQueuedMessages(engine.queues[session.id]??[]);},[engine.queues,session.id]);
  useEffect(() => {
    reconnectStreamRef.current = active || queuedMessages.length > 0;
  }, [active, queuedMessages.length]);

  useEffect(() => {
    if (tuiMode || !chatCapable) return;
    let disposed = false;
    let reconnectTimer: number | undefined;
    let pending="";let replay=false;let pendingCursor=byteCursor.current;let renderTimer:number|undefined;
    const flush=()=>{renderTimer=undefined;const chunk=pending;const replace=replay;pending="";replay=false;if(!disposed){byteCursor.current=pendingCursor;setOutput(current=>(replace?chunk:current+chunk).slice(-2_000_000));}};
    const socket = new WebSocket(streamURL(session.id,byteCursor.current));
    socket.onmessage = (event) => {
      if (disposed) return;
      const message = JSON.parse(String(event.data)) as { type: string; data?: string; replay?:boolean; reset?:boolean; cursor?:number };
      if (message.type === "output") {
 pendingCursor=message.cursor??pendingCursor;
        if(message.reset){pending=message.data??"";replay=true;}else pending+=message.data??"";
        if(renderTimer===undefined)renderTimer=window.setTimeout(flush,33);
      }
    };
    socket.onclose = () => {
      if (!disposed && reconnectStreamRef.current) {
        reconnectTimer = window.setTimeout(() => {
          if (!disposed) setStreamVersion((current) => current + 1);
        }, 250);
      }
    };
    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if(renderTimer!==undefined)window.clearTimeout(renderTimer);
      socket.onmessage = null;
      socket.onclose = null;
      socket.close();
    };
  }, [chatCapable, session.id, streamVersion, tuiMode,session.generation]);

  useEffect(() => {setOutput("");byteCursor.current=0;}, [session.id]);

  useEffect(() => {
    if (!chatCapable) return;
    let stale = false;
    void listAgentCommands(session.id)
      .then((next) => { if (!stale) setCommands(next); })
      .catch(() => { if (!stale) setCommands([]); });
    return () => { stale = true; };
  }, [chatCapable, session.id]);

  useEffect(() => {
    if(followLatest.current)outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: "auto" });
  }, [output]);

  useEffect(() => {
    let stale = false;
    if (tab === "ticket" && session.ticket_key && !ticket) {
      void getTicket(session.ticket_key)
        .then((next) => { if (!stale) setTicket(next); })
        .catch((reason) => { if (!stale) setPanelError(String(reason)); });
    }
    return () => { stale = true; };
  }, [session.ticket_key, tab, ticket]);

  const focusComposer = () => {
    if (focusTimerRef.current !== undefined) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = undefined;
      document.querySelector<HTMLTextAreaElement>(".session-composer textarea")?.focus();
    }, 0);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || pendingSessionSends.has(session.id) || (!input.trim()&&!attachments.images.length&&!commentsRef.current.length) || attachments.uploading || !canMessage) return;
    submitting.current=true;pendingSessionSends.add(session.id);notifyPendingSend(session.id);
    const originalInput=input;const originalImages=attachments.images;const originalComments=commentsRef.current;
    const value = withReviewComments(withAttachments(input,originalImages),originalComments);
    setInput("");
    setComments([]);
    setPanelError(null);
    let accepted=false;
    try {
      if(editingMessageId){await updateQueuedMessage(session.id,editingMessageId,value);setEditingMessageId(null);}
      else {const queued = await enqueueMessage(session.id, value);setQueuedMessages((current) => [...current.filter((item) => item.id !== queued.id), queued]);}
      accepted=true;
      const submittedIDs=new Set(originalImages.map(image=>image.id));
      attachments.setImages(current=>current.filter(image=>!submittedIDs.has(image.id)));
      await onRefresh();
      await refreshQueue();
    } catch (reason) {
      const message=reason instanceof Error ? reason.message : String(reason);
      if(!accepted){
        setComments(current=>[...originalComments.filter(comment=>!current.some(item=>item.id===comment.id)),...current]);
        const current=sessionDrafts.get(session.id)??"";
        const recovered=recoverRejectedDraft(originalInput,current);
        if(recovered)sessionDrafts.set(session.id,recovered);else sessionDrafts.delete(session.id);
        const combined=Boolean(originalInput&&current&&current!==originalInput);
        window.dispatchEvent(new CustomEvent("openade-rejected-draft",{detail:{id:session.id,error:combined?`The submitted message and newer draft were restored, separated by a blank line. ${message}`:message}}));
      }else if(mountedRef.current)setPanelError(`Message saved. Unable to refresh the conversation: ${message}`);
    } finally {submitting.current=false;pendingSessionSends.delete(session.id);notifyPendingSend(session.id);}
  };

  const steerQueuedMessage = async (id: string) => {
    setQueuedMessages((current) => {
      const selected = current.find((item) => item.id === id);
      return selected ? [selected, ...current.filter((item) => item.id !== id)] : current;
    });
    try {
      await steerQueuedMessageRequest(session.id, id);
      await refreshQueue();
    } catch (reason) {
      setPanelError(reason instanceof Error ? reason.message : String(reason));
      await refreshQueue();
    }
  };

  const removeQueuedMessage = async (id: string) => {
    setQueuedMessages((current) => current.filter((item) => item.id !== id));
    try {
      await removeQueuedMessageRequest(session.id, id);
    } catch (reason) {
      setPanelError(reason instanceof Error ? reason.message : String(reason));
      await refreshQueue();
    }
  };

  const editQueuedMessage = (id: string) => {
    const selected = queuedMessages.find((item) => item.id === id);
    if (!selected) return;
    setEditingMessageId(id);
    setInput(selected.text);
    focusComposer();
  };

  const insertCommand = (command: AgentCommand) => {
    setInput(`${command.invocation} `);
    setCommandOpen(false);
    focusComposer();
  };

  const createPR = async () => {
    setBusy(true);
    setPanelError(null);
    try {
      await createPullRequest({
        sessionId: session.id,
        title: session.title,
        base: session.base_branch,
        body: `## Summary\n\n${session.prompt}\n\n${session.ticket_key ? `Ticket: ${session.ticket_key}` : ""}\n\nCreated from OpenADE.`,
      });
      await onRefresh();
    } catch (reason) {
      setPanelError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const openSideChat=(id:string)=>{
    const surface:WorkTab=`side-chat:${id}`;
    setTabs(current=>current.includes(surface)?current:[...current,surface]);
    setTab(surface);setRightOpen(true);
  };
  const createChild=async(sourceId:string,mode:"fresh"|"fork")=>{
    if(sideChatCreating)return;
    setSideChatCreating(true);setPanelError(null);
    try{
      const source=engine.sessions.find(item=>item.id===sourceId)??session;
      const child=await createSideChat(sourceId,mode,source.parent_session_id||source.id);
      await onRefresh();await refreshEngine();
      openSideChat(child.id);
    }catch(reason){setPanelError(reason instanceof Error?reason.message:String(reason));}
    finally{setSideChatCreating(false);}
  };
  useEffect(()=>{if(!engine.connected)return;const existing=new Set(engine.sessions.map(item=>item.id));setTabs(current=>{const next=current.filter(surface=>!surface.startsWith("side-chat:")||existing.has(surface.slice(10)));return next.length===current.length?current:next;});setTab(current=>current.startsWith("side-chat:")&&!existing.has(current.slice(10))?"review":current);},[engine.connected,engine.sessions]);

  const toggleSurface = (surface: WorkTab) => {
    if(surface==="browser"){addBrowserTab();setTabMenu(false);return;}
    setTabs(current=>current.includes(surface)?current:[...current,surface]);
    setTabMenu(false);
    if (rightOpen && tab === surface && tabs.includes(surface)) {
      setRightOpen(false);
      return;
    }
    setTab(surface);
    setRightOpen(true);
  };

  useEffect(()=>{if(rightOpen||tabs.some(surface=>surface.startsWith("browser:"))){setPanelMounted(true);return;}const timer=window.setTimeout(()=>setPanelMounted(false),200);return()=>window.clearTimeout(timer);},[rightOpen,tabs]);
  useEffect(()=>{if(filesOpen||tabs.includes("editor")){setFilesMounted(true);return;}const timer=window.setTimeout(()=>setFilesMounted(false),200);return()=>window.clearTimeout(timer);},[filesOpen,tabs]);
  const toggleFiles=()=>{if(filesOpen&&dirtyRef.current){setPanelError("Save or discard file changes before closing the files panel.");return;}setFilesOpen(value=>!value);};
  useEffect(()=>{const key=(event:KeyboardEvent)=>{
    if(!activeView||event.defaultPrevented||event.isComposing||event.repeat)return;
    if(detailsEditor){if(event.key==="Escape"){event.preventDefault();setDetailsEditor(null);}return;}
    if(shortcutMatches(event,preferences.shortcuts.panel)){event.preventDefault();setRightOpen(value=>!value);}
    else if(shortcutMatches(event,preferences.shortcuts.files)){event.preventDefault();toggleFiles();}
    else if(shortcutMatches(event,preferences.shortcuts.terminal)){event.preventDefault();toggleSurface("terminal");}
    else if(shortcutMatches(event,preferences.shortcuts.focusComposer)){const composer=document.querySelector<HTMLTextAreaElement>(tab.startsWith("side-chat:")?".side-chat-pane .session-composer textarea":".conversation .session-composer textarea");if(composer?.getClientRects().length&&!composer.closest("[hidden],[inert]")){event.preventDefault();composer.focus();}}
    else if(shortcutMatches(event,preferences.shortcuts.browser)||shortcutMatches(event,preferences.shortcuts.diffs)||shortcutMatches(event,preferences.shortcuts.history)){event.preventDefault();if(shortcutMatches(event,preferences.shortcuts.browser)){addBrowserTab();}else{const target:WorkTab=shortcutMatches(event,preferences.shortcuts.diffs)?"review":"history";setTabs(current=>current.includes(target)?current:[...current,target]);setTab(target);setRightOpen(true);}}
    else if(shortcutMatches(event,preferences.shortcuts.closePanel)){event.preventDefault();if(rightOpen)closeTab(tab);}
    else if(shortcutMatches(event,preferences.shortcuts.nextPanel)||shortcutMatches(event,preferences.shortcuts.previousPanel)){event.preventDefault();if(tabs.length){const index=tabs.indexOf(tab);const delta=shortcutMatches(event,preferences.shortcuts.previousPanel)?-1:1;setTab(tabs[(index+delta+tabs.length)%tabs.length]);setRightOpen(true);}}
    else if(shortcutMatches(event,preferences.shortcuts.searchFiles)){event.preventDefault();setFilesOpen(true);window.setTimeout(()=>document.querySelector<HTMLInputElement>(".files-index input")?.focus(),200);}
    else if(event.key === "Escape") {
      if(detailsEditor){event.preventDefault();setDetailsEditor(null);}
      else if(commandOpen||tabMenu||actionsOpen){event.preventDefault();setCommandOpen(false);setTabMenu(false);setActionsOpen(false);}
      else if(preferences.stop_on_escape&&active&&!tuiMode){event.preventDefault();void stopSession(session.id).then(onRefresh);}
    }
  };window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[activeView,preferences,rightOpen,filesOpen,tab,commandOpen,tabMenu,actionsOpen,active,tuiMode,session.id,tabs,detailsEditor]);
  useEffect(()=>{const dismiss=()=>{setActionsOpen(false);setTabMenu(false);setCommandOpen(false);};window.addEventListener("openade-dismiss-menus",dismiss);return()=>window.removeEventListener("openade-dismiss-menus",dismiss);},[]);
  useEffect(()=>{if(actionsOpen)document.querySelector<HTMLElement>(".session-actions button")?.focus();if(tabMenu)document.querySelector<HTMLElement>(".panel-tab-menu button")?.focus();},[actionsOpen,tabMenu]);
  useEffect(()=>{if(!tabMenu&&!actionsOpen)return;const close=(event:PointerEvent)=>{if(!(event.target as Element).closest(".panel-tab-menu,.panel-add,.session-actions,.session-actions-trigger")){setTabMenu(false);setActionsOpen(false);}};document.addEventListener("pointerdown",close);return()=>document.removeEventListener("pointerdown",close);},[tabMenu,actionsOpen]);
  const focusAfterPanel=()=>{const target=composerLayout.textarea.current;if(target&&!target.disabled&&target.getClientRects().length&&!target.closest("[hidden],[inert]"))target.focus();else document.querySelector<HTMLElement>('.session-header [aria-label="Back"]')?.focus();};
  const closeTab=(surface:WorkTab)=>{if(surface==="editor"&&dirtyRef.current){setPanelError("Save or discard changes before closing the editor.");return;}const restoreFocus=tab===surface||(document.activeElement instanceof Element&&document.activeElement.getAttribute("aria-label")===`Close ${workTabLabel(surface)} tab`);const remaining=tabs.filter(value=>value!==surface);setTabs(remaining);if(surface.startsWith("browser:")){const bridge=(window as typeof window&{go?:{main?:{App?:{BrowserActionTab?:(id:string,action:string)=>Promise<void>}}}}).go?.main?.App;void bridge?.BrowserActionTab?.(surface,"close");setBrowserPages(current=>{const next={...current};delete next[surface];return next;});}if(surface.startsWith("subagent:"))setSubagentTitles(current=>{const next={...current};delete next[surface];return next;});if(tab===surface){if(remaining.length)setTab(remaining[remaining.length-1]);else setRightOpen(false);}if(restoreFocus)requestAnimationFrame(()=>{if(remaining.length)document.querySelector<HTMLElement>('.panel-tabs [role="tab"][aria-selected="true"]')?.focus();else focusAfterPanel();});};
  useEffect(()=>{const key=(event:Event)=>{const {id,combo}=(event as CustomEvent<{id:string;combo:string}>).detail;if(!activeView||!rightOpen||tab!==id)return;if(combo==="mod+t")addBrowserTab();else if(combo==="mod+w")closeTab(id as WorkTab);};window.addEventListener("openade-browser-key",key);return()=>window.removeEventListener("openade-browser-key",key);},[activeView,rightOpen,tab,tabs,addBrowserTab]);
  return (
    <WebLinkContext.Provider value={preferences.open_web_links_in_app?url=>{addBrowserTab(url);}:null}><div className={`session-workspace ${detailsEditor||tabMenu||actionsOpen?"has-overlay":""} ${rightOpen ? "with-panel" : ""} ${filesOpen?"with-files":""} ${tab.startsWith("side-chat:")?"with-side-chat":""} ${session.agent === "shell" && !tuiMode ? "shell-workspace" : ""}`} style={{"--panel-width":`${preferences.panel_width}px`} as CSSProperties}>
      <header className="session-header">
        <button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft /></button>
        <span className={`status-dot ${session.status}`} />
        <div className="session-title"><h1>{session.title}</h1><p>{projectLabel??projectName(session.repo_root)} <span>·</span> <code title={session.branch}>{session.branch||"Folder workspace"}</code></p></div>
        <span className="session-header-spacer"/>
        {active && <button className="header-stop" onClick={() => void stopSession(session.id).then(onRefresh)}><Square weight="fill" /> Stop</button>}
        {chatCapable&&<><button className="icon-button" aria-label="New side chat" title="New side chat" disabled={sideChatCreating} onClick={()=>void createChild(session.id,"fresh")}><Plus/></button><button className="icon-button" aria-label="Fork this chat" title="Fork this chat" disabled={sideChatCreating} onClick={()=>void createChild(session.id,"fork")}><GitBranch/></button></>}
        <div className="session-actions-anchor"><button className="icon-button session-actions-trigger" aria-label="Session actions" aria-expanded={actionsOpen} onClick={()=>setActionsOpen(value=>!value)}><DotsThree/></button>{actionsOpen&&<div className="session-actions" role="menu" onKeyDown={event=>menuKeys(event,()=>setActionsOpen(false),()=>document.querySelector<HTMLElement>(".session-actions-trigger")?.focus())}><button role="menuitem" onClick={()=>{setDetailsEditor("title");setDetailsValue(session.title);setActionsOpen(false);}}>Rename chat</button><button role="menuitem" onClick={()=>{setDetailsEditor("instructions");setDetailsValue(session.instructions||"");setActionsOpen(false);}}>Chat instructions</button><button role="menuitem" onClick={()=>{void copyText(session.worktree_path).catch(()=>setPanelError("Unable to copy workspace path."));setActionsOpen(false);}}>Copy workspace path</button><button role="menuitem" onClick={()=>{setActionsOpen(false);onArchive();}}><Archive/>{session.archived?"Unarchive session":"Archive session"}</button></div>}</div>
        <button className="icon-button" aria-label="Toggle files panel" aria-pressed={filesOpen} onClick={toggleFiles}><Folder/></button>
        <button className="icon-button" aria-label="Toggle right sidebar" aria-pressed={rightOpen} onClick={()=>setRightOpen(value=>!value)}><SidebarSimple/></button>
      </header>
      {detailsEditor&&<div className="chat-details-overlay"><form role="dialog" aria-modal="true" onKeyDown={event=>{if(event.key!=="Tab")return;const controls=[...event.currentTarget.querySelectorAll<HTMLElement>("input,textarea,button:not(:disabled)")];const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}} aria-label={detailsEditor==="title"?"Rename chat":"Chat instructions"} onSubmit={event=>{event.preventDefault();void updateSessionDetails(session.id,{[detailsEditor]:detailsValue}).then(onRefresh).then(()=>setDetailsEditor(null)).catch(reason=>setPanelError(String(reason)));}}>{panelError&&<p role="alert">{panelError}</p>}<h2>{detailsEditor==="title"?"Rename chat":"Chat instructions"}</h2>{detailsEditor==="title"?<input aria-label="Chat title" maxLength={240} value={detailsValue} onChange={e=>setDetailsValue(e.target.value)} autoFocus/>:<><textarea aria-label="Chat instructions" value={detailsValue} maxLength={16384} onChange={e=>setDetailsValue(e.target.value)} autoFocus/><p>Applied to your next message in this conversation.</p></>}<div><button type="button" onClick={()=>setDetailsEditor(null)}>Cancel</button><button disabled={detailsEditor==="title"&&!detailsValue.trim()}>Save</button></div></form></div>}
      <section className={`conversation ${tuiMode ? "tui-conversation" : ""}`}>
        {tuiMode ? <Suspense fallback={<div role="status">Opening terminal…</div>}><DirectTUIWorkspace session={session} onRefresh={onRefresh} preferences={preferences} /></Suspense> : <>
        <div className="messages" ref={outputRef} onScroll={event=>{const el=event.currentTarget;const following=el.scrollHeight-el.scrollTop-el.clientHeight<80;followLatest.current=following;setFollowing(following);}}>
          {chatCapable ? <ChatTimeline session={session} output={output} activityExpanded={preferences.activity_detail === "expanded"} onOpenSubagent={openSubagent} /> : <div className="shell-session-note"><TerminalWindow /><div><strong>Terminal run</strong><p>This run stays in the terminal so command output never gets mixed into chat.</p></div></div>}
        </div>
        {!following&&<button className="jump-latest" onClick={()=>{followLatest.current=true;setFollowing(true);outputRef.current?.scrollTo({top:outputRef.current.scrollHeight,behavior:"auto"});}}>Jump to latest</button>}
        {canMessage ? <div className={`session-composer-dock ${queuedMessages.length ? "with-queue" : ""}`}>
          <MessageQueue steering={provider.state.steering} messages={queuedMessages} sendingId={queuedMessages.find((item) => item.status === "dispatching")?.id ?? null} onSteer={(id) => void steerQueuedMessage(id)} onRemove={(id) => void removeQueuedMessage(id)} onEdit={(id) => void editQueuedMessage(id)} />

          {providerRequest&&<ProviderInteraction key={providerRequest.id} id={session.id} request={providerRequest} onResolved={()=>{provider.refresh();void onRefresh();}}/>}
 <div hidden={Boolean(providerRequest)}><form ref={composerLayout.form} data-layout={composerLayout.expanded?"expanded":"compact"} className={`session-composer ${composerLayout.expanded?"expanded":"compact"} ${composerLayout.morphing?"composer-morphing":""}`} style={{"--composer-text-height":`${composerLayout.textHeight}px`,"--composer-cluster-width":`${composerLayout.clusterWidth}px`} as CSSProperties} onSubmit={submit} onPaste={attachments.paste} onDragOver={event=>{if(event.dataTransfer.types.includes("Files"))event.preventDefault();}} onDrop={attachments.drop}>
          <AttachmentStrip draft={attachments}/>
          {comments.length>0&&<div className="review-comment-strip"><span>{comments.length} {comments.length===1?"review comment":"review comments"}</span><button type="button" onClick={()=>{const surface=comments[0].source==="diff"?"review":"editor";setTabs(current=>current.includes(surface)?current:[...current,surface]);setTab(surface);setRightOpen(true);}}>Review</button><button type="button" aria-label="Clear review comments" onClick={()=>setComments([])}>Clear</button></div>}
          {commandOpen && <AgentCommandMenu commands={commands} input={input} onSelect={insertCommand} />}
          <textarea ref={composerLayout.textarea}
            aria-label="Session message"
            value={input}
            onChange={(event) => { const value = event.target.value; setInput(value); if(value)sessionDrafts.set(session.id,value);else sessionDrafts.delete(session.id); if (/^\s*[/ $]/.test(value)) setCommandOpen(true); }}
            placeholder={canMessage ? "Do anything…" : "This run does not support follow-up messages"}
            rows={1}
            disabled={!canMessage}
            onKeyDown={(event) => {
              if (event.key === "Escape" && commandOpen) {
                event.preventDefault();
                setCommandOpen(false);
                return;
              }
              if (event.key === "Enter" && commandOpen && !event.shiftKey) {
                const first = filterAgentCommands(commands, input)[0];
                if (first) {
                  event.preventDefault();
                  insertCommand(first);
                  return;
                }
              }
              if (shouldSend(event,preferences.send_behavior)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="composer-footer">
            <div className="composer-utilities">
              <AttachmentPicker draft={attachments}/>
              <ModelPicker compactLabel serviceTier={session.service_tier} onTierChange={tier=>{void updateModel(session.id,session.model,session.effort,tier).then(onRefresh).catch(reason=>setPanelError(String(reason)));}} provider={session.agent} models={engine.meta?.agents.find(item=>item.id===session.agent)?.models} model={session.model} effort={session.effort} onChange={(model,effort)=>{void updateModel(session.id,model,effort,session.service_tier).then(onRefresh).catch(reason=>setPanelError(String(reason)));}}/>
            </div>
            <button type={active&&!input.trim()&&!attachments.images.length&&!comments.length?"button":"submit"} className="send-button" disabled={busy||sending||attachments.uploading||!canMessage||(!active&&!input.trim()&&!attachments.images.length&&!comments.length)} aria-label={active&&!input.trim()&&!attachments.images.length&&!comments.length?"Stop agent":"Send message"} onClick={active&&!input.trim()&&!attachments.images.length&&!comments.length?()=>{void stopSession(session.id).then(onRefresh).catch(reason=>setPanelError(String(reason)));}:undefined}>{active&&!input.trim()&&!attachments.images.length&&!comments.length?<span className="composer-stop-glyph" aria-hidden="true"/>:<ArrowUp weight="bold"/>}</button>
          </div>
          </form></div>
          <div className="session-context"><span title={session.worktree_path}><Folder/>{!session.repo_root?"No project":session.branch?"Local checkout":"Folder workspace"}</span>{session.branch&&<span title={session.branch}><GitBranch/>{session.branch}</span>}{session.instructions&&<button onClick={()=>{setDetailsEditor("instructions");setDetailsValue(session.instructions);}}>Instructions</button>}            <button type="button" className={`skills-shortcut ${commandOpen ? "active" : ""}`} onClick={() => setCommandOpen((value) => !value)} aria-label="Skills and commands" title="Skills and commands"><Plus /></button>{["codex","codex-cli","claude","claude-code","grok","devin","hermes","pi","antigravity"].includes(session.agent)&&<ContextUsage visible={activeView} context={provider.state.context}/>}<span className="runtime-chip" role="status"><span className={`status-dot ${session.status}`} />{active ? queuedMessages.length ? `${queuedMessages.length} queued · agent working` : `${agentLabel(session.agent)} is attached` : queuedMessages.some((item) => item.status === "dispatching") ? "Sending next message" : resumable ? "Conversation can continue" : `Run ${session.status}`}</span></div>
        </div> : <div className="session-closed-state"><span className={`status-dot ${session.status}`} />{chatCapable ? `This ${agentLabel(session.agent)} run is ${session.status}` : "Use the Terminal panel to inspect this run"}</div>}</>}
      </section>
      <div className="work-panel-clip" inert={!rightOpen}>
      {panelMounted&&<aside className="work-panel" aria-label={`${workTabLabel(tab)} panel`}>
        <header className="work-panel-header">{panelDrag&&<div ref={panelGhost} className="panel-tab-drag-ghost" style={{left:panelDrag.x-56,top:panelDrag.y-12}} aria-hidden="true">{browserPages[panelDrag.surface]?.label||workTabLabel(panelDrag.surface)}</div>}
          <div ref={panelStrip} className="panel-tabs" role="tablist" aria-label="Workspace panels">
            {tabs.map((surface,index)=><div className={`${surface===tab?"active ":""}${panelDrag?.surface===surface?"panel-tab-dragging":""}`} key={surface} data-panel-tab={surface} style={{transform:`translateX(${panelSlide(index)}px)`}} onAuxClick={event=>{if(event.button===1){event.preventDefault();event.stopPropagation();closeTab(surface);}}}>
              <button role="tab" aria-selected={surface===tab} aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight" onPointerDown={event=>startPanelPointer(surface,event)} onPointerMove={movePanelPointer} onPointerUp={event=>finishPanelPointer(event,true)} onPointerCancel={event=>finishPanelPointer(event,false)} onLostPointerCapture={event=>{if(panelPointer.current?.id===event.pointerId){panelPointer.current=null;setPanelDrag(null);suppressTabClick.current=null;}}} onKeyDown={event=>{if(event.key==="Enter"||event.key===" ")suppressTabClick.current=null;if(event.altKey&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&(event.key==="ArrowLeft"||event.key==="ArrowRight")){event.preventDefault();event.stopPropagation();movePanelTab(surface,index+(event.key==="ArrowRight"?1:-1));}}} onClick={event=>{if(suppressTabClick.current===surface){suppressTabClick.current=null;event.preventDefault();return;}suppressTabClick.current=null;setTab(surface);}}>
                <span className="panel-tab-leading">{surface.startsWith("browser:")&&browserPages[surface]?.favicon?<img className="panel-tab-favicon" src={browserPages[surface].favicon} alt="" aria-hidden="true"/>:workTabIcon(surface)}</span>
                <span className="panel-tab-label">{surface.startsWith("side-chat:")?engine.sessions.find(item=>item.id===surface.slice(10))?.title||"Side chat":surface.startsWith("subagent:")?subagentTitles[surface]||"Agent":surface.startsWith("browser:")?browserPages[surface]?.label||"Browser":workTabLabel(surface)}</span>
              </button>
              <button className="panel-tab-close" aria-label={`Close ${workTabLabel(surface)} tab`} onClick={()=>closeTab(surface)}><X/></button>
            </div>)}
          </div><div className="panel-add-anchor"><button className="icon-button panel-add" aria-label="Add panel" aria-expanded={tabMenu} onClick={()=>setTabMenu(value=>!value)}><Plus/></button>{tabMenu&&<div className="panel-tab-menu" role="menu" onKeyDown={event=>menuKeys(event,()=>setTabMenu(false),()=>document.querySelector<HTMLElement>(".panel-add")?.focus())}>{(["browser","terminal","review","history","pull-request",...(session.ticket_key?["ticket"]:[])] as WorkTab[]).map(surface=><button role="menuitem" key={surface} onClick={()=>{if(surface==="browser")addBrowserTab();else{setTabs(current=>current.includes(surface)?current:[...current,surface]);setTab(surface);setRightOpen(true);}setTabMenu(false);}}>{workTabIcon(surface)}{workTabLabel(surface)}</button>)}<button role="menuitem" disabled={sideChatCreating} onClick={()=>{setTabMenu(false);void createChild(session.id,"fork");}}><ChatCircleDots/>Side chat</button></div>}</div><button className="icon-button" onClick={()=>{setRightOpen(false);requestAnimationFrame(()=>focusAfterPanel());}} aria-label="Close right sidebar"><SidebarSimple/></button></header>
        <div className="panel-body">{panelError&&<div className="inline-error" role="alert"><span>{panelError}</span><button aria-label="Dismiss panel error" onClick={()=>setPanelError(null)}><X/></button></div>}<div className="file-editor-outlet" ref={setEditorTarget} hidden={tab!=="editor"}/>{tabs.length===0?<div className="panel-picker">{(["browser","terminal","review","history","pull-request"] as WorkTab[]).map(surface=><button key={surface} onClick={()=>toggleSurface(surface)}>{workTabIcon(surface)}{workTabLabel(surface)}</button>)}<button onClick={()=>void createChild(session.id,"fork")}><ChatCircleDots/>Side chat</button></div>:tab.startsWith("browser:")?null:tab.startsWith("side-chat:")?(()=>{const child=engine.sessions.find(item=>item.id===tab.slice(10));return child?<SideChatPane key={child.id} session={child} sourceTitle={engine.sessions.find(item=>item.id===child.fork_source_id)?.title??session.title} preferences={preferences} onRefresh={onRefresh} onForkSibling={()=>void createChild(child.id,"fork")} onNewSibling={()=>void createChild(child.id,"fresh")}/>:<p className="panel-empty">Side chat unavailable.</p>;})():tab.startsWith("subagent:")?<SubagentPane key={tab} session={session} docId={tab.slice(9)} expanded={preferences.activity_detail==="expanded"} onTitle={title=>setSubagentTitles(current=>current[tab]===title?current:{...current,[tab]:title})} onOpenSubagent={openSubagent}/>:tab==="editor"?null:tab==="terminal"?<Suspense fallback={<div role="status">Opening terminal…</div>}><TerminalWorkspace session={session} preferences={preferences}/></Suspense>:tab==="review"?<ReviewWorkspace sessionId={session.id} git={Boolean(session.branch)} preferences={preferences} onPreferences={onPreferences} comments={comments} onComments={setComments}/>:tab.startsWith("commit:")?<ReviewWorkspace key={tab} sessionId={session.id} git commitSha={tab.slice(7)} preferences={preferences} onPreferences={onPreferences}/>:tab==="history"?<HistoryPanel session={session} preferences={preferences} onPreferences={onPreferences} onOpenCommit={commit=>openCommit(commit.sha)}/>:tab==="ticket"?<TicketPanel ticket={ticket} session={session}/>:<PRPanel session={session} busy={busy} onCreate={createPR} onTicket={()=>setTab("ticket")}/>}{Object.keys(browserPages).filter(surface=>tabs.includes(surface as WorkTab)).map(surface=><BrowserPanel key={surface} tabId={surface} session={session} initialUrl={browserPages[surface]?.url} active={activeView&&rightOpen&&tab===surface} onTitle={label=>updateBrowserLabel(surface,label)} onURL={url=>updateBrowserURL(surface,url)} onFavicon={data=>updateBrowserFavicon(surface,data)} onNewTab={addBrowserTab}/>)}</div>
      </aside>}
      </div>
      {rightOpen&&!(session.agent==="shell"&&!tuiMode)&&<ResizeBoundary className="panel-resizer" label="Resize right sidebar" width={preferences.panel_width} min={360} max={900} fraction={filesOpen?.45:.55} defaultWidth={520} direction={-1} onResize={width=>onPreferences({...preferences,panel_width:width},false)} onCommit={width=>onPreferences({...preferences,panel_width:width})}/>}
      <div className="files-panel-clip" inert={!filesOpen}>{filesMounted&&<FilesPanel session={session} preferences={preferences} onDirtyChange={onDirtyChange} editorTarget={editorTarget} onOpenEditor={openEditor} comments={comments} onComments={setComments} sideChats={sideChats} onOpenSideChat={openSideChat} onNewSideChat={()=>void createChild(session.id,"fresh")} onForkSideChat={()=>void createChild(session.id,"fork")} sideChatCreating={sideChatCreating}/>}</div>
      <aside className="inspector-rail" aria-label="Session tools"><InspectorButton active={rightOpen&&tab==="review"} onClick={()=>toggleSurface("review")} icon={<GitDiff/>} label="Changes"/><InspectorButton active={rightOpen&&tab==="terminal"} onClick={()=>toggleSurface("terminal")} icon={<TerminalWindow/>} label="Terminal"/><InspectorButton active={rightOpen&&tab==="pull-request"} onClick={()=>toggleSurface("pull-request")} icon={<GithubLogo/>} label="PR"/></aside>
    </div></WebLinkContext.Provider>
  );
}

function InspectorButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick} aria-label={label} aria-pressed={active} title={label}>{icon}<span>{label}</span></button>;
}

function workTabLabel(tab: WorkTab): string {
  if(tab.startsWith("side-chat:"))return "Side chat";
  if(tab.startsWith("subagent:"))return "Agent";
  if(tab.startsWith("commit:"))return `Commit ${tab.slice(7,14)}`;
  if(tab.startsWith("browser:"))return "Browser";
  return ({ review: "Diffs", terminal: "Terminal", "pull-request": "Pull request", ticket: "Ticket",browser:"Browser",history:"History",editor:"Editor" } as Record<string, string>)[tab];
}

function workTabIcon(tab: WorkTab): ReactNode {
  if(tab.startsWith("side-chat:"))return <ChatCircleDots/>;
  if(tab.startsWith("subagent:"))return <ChatCircleDots/>;
  if (tab === "editor") return <FileCode/>;
  if (tab === "browser" || tab.startsWith("browser:")) return <Globe/>;
  if (tab === "history") return <ClockCounterClockwise/>;
  if (tab === "terminal") return <TerminalWindow />;
  if (tab === "pull-request") return <GithubLogo />;
  if (tab === "ticket") return <TicketIcon />;
  return <GitDiff />;
}

function PRPanel({ session, busy, onCreate, onTicket }: { session: Session; busy: boolean; onCreate: () => void; onTicket: () => void }) {
  if(!session.branch)return <div className="panel-empty"><GithubLogo/><strong>Git project required</strong><p>Pull requests are available for Git project branches.</p></div>;
  return <div className="pr-panel"><div className="panel-kicker"><GithubLogo /> GitHub delivery</div><h2>{session.pr_url ? "Draft pull request created" : "Prepare this branch for review"}</h2><p>OpenADE keeps the ticket key, branch, commit policy, and draft PR connected to this session.</p><dl><div><dt>Head</dt><dd><code>{session.branch}</code></dd></div><div><dt>Base</dt><dd><code>{session.base_branch}</code></dd></div>{session.ticket_key && <div><dt>Ticket</dt><dd><button className="link-button" onClick={onTicket}>{session.ticket_key}</button></dd></div>}</dl>{session.pr_url ? <button className="primary-wide" onClick={() => window.open(session.pr_url, "_blank")}><GithubLogo /> Open pull request</button> : <button className="primary-wide" disabled={busy} onClick={onCreate}>{busy ? <SpinnerGap className="spin" /> : <GitBranch />} Push branch and create draft PR</button>}<small>This action uses your locally authenticated GitHub CLI.</small></div>;
}

function TicketPanel({ ticket, session }: { ticket: Ticket | null; session: Session }) {
  return <div className="ticket-panel"><div className="panel-kicker"><TicketIcon /> Linked work item</div><h2>{ticket?.summary || session.ticket_key}</h2><p>{ticket ? `${ticket.status || "Status unavailable"} · ${ticket.assignee || "Unassigned"}` : "Ticket details are linked to this session. Configure the Jira CLI to load live metadata."}</p>{session.ticket_url && <button className="primary-wide" onClick={() => window.open(session.ticket_url, "_blank")}><TicketIcon /> Open in Jira</button>}<dl><div><dt>Required branch prefix</dt><dd><code>{session.ticket_key?.toLowerCase()}/</code></dd></div><div><dt>Current branch</dt><dd><code>{session.branch}</code></dd></div></dl></div>;
}

function agentLabel(agent: string): string {
  return ({ claude: "Claude Code", codex: "Codex CLI", cursor: "Cursor", grok: "Grok", devin: "Devin", hermes: "Hermes", pi: "Pi", antigravity: "Antigravity", copilot: "Copilot", opencode: "OpenCode" } as Record<string, string>)[agent] ?? agent;
}
