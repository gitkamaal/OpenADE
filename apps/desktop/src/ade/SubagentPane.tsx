import {useEffect,useRef,useState} from "react";
import {ChatTimeline} from "./ChatTimeline";
import {fetchSubagent,Session,SubagentDoc} from "./api";

export function SubagentPane({session,docId,expanded,onTitle,onOpenSubagent}:{session:Session;docId:string;expanded:boolean;onTitle:(title:string)=>void;onOpenSubagent?:(id:string,title:string)=>void}){
 const [doc,setDoc]=useState<SubagentDoc|null>(null),[error,setError]=useState("");
 const messages=useRef<HTMLDivElement>(null),following=useRef(true),cursor=useRef(0);
 const onTitleRef=useRef(onTitle);onTitleRef.current=onTitle;
 useEffect(()=>{cursor.current=0;setDoc(null);setError("");},[session.id,docId]);
 useEffect(()=>{
  let active=true,busy=false,timer:number|undefined;
  const parentSettled=!["starting","running","waiting"].includes(session.status);
  const schedule=()=>{if(active&&timer===undefined)timer=window.setTimeout(()=>{timer=undefined;read();},1000);};
  const read=()=>{
   if(!active||busy||document.hidden)return;
   busy=true;
   const after=cursor.current;
   void fetchSubagent(session.id,docId,after).then(value=>{
    if(!active)return;
    cursor.current=value.cursor;
    setDoc(previous=>{
     const output=after===0||value.reset?value.output:(previous?.output??"")+value.output;
     if(previous&&previous.cursor===value.cursor&&previous.status===value.status&&previous.title===value.title&&previous.child_thread_id===value.child_thread_id&&previous.output===output)return previous;
     return {...value,output};
    });
    onTitleRef.current(value.title);setError("");
    if(!parentSettled||value.status==="running")schedule();
   }).catch(reason=>{if(active){setError(reason instanceof Error?reason.message:"Subagent transcript unavailable");schedule();}}).finally(()=>{busy=false;});
  };
  const onVisibility=()=>{if(document.hidden){if(timer!==undefined)window.clearTimeout(timer);timer=undefined;}else read();};
  document.addEventListener("visibilitychange",onVisibility);
  read();
  return()=>{active=false;if(timer!==undefined)window.clearTimeout(timer);document.removeEventListener("visibilitychange",onVisibility);};
 },[session.id,docId,session.status,session.generation]);
 useEffect(()=>{if(following.current)messages.current?.scrollTo({top:messages.current.scrollHeight,behavior:"auto"});},[doc?.output]);
 const status=doc?.status==="done"?"completed":doc?.status==="failed"?"failed":doc?.status==="interrupted"?"interrupted":"running";
 return <section className="subagent-pane" aria-label={`Agent transcript ${doc?.title??"loading"}`}><header><strong>{doc?.title??"Agent"}</strong><span className={`subagent-pane-status ${doc?.status??"running"}`}>{doc?.status??"Loading"}</span></header>{error&&<p className="inline-error" role="alert">{error}</p>}<div className="subagent-pane-messages messages" ref={messages} onScroll={event=>{const node=event.currentTarget;following.current=node.scrollHeight-node.scrollTop-node.clientHeight<80;}}>{doc?<ChatTimeline session={{...session,status}} output={doc.output} activityExpanded={expanded} onOpenSubagent={onOpenSubagent} initialPromptOverride="" disableDurableTimestamps/>:<p className="panel-empty">Loading agent transcript…</p>}</div></section>;
}
