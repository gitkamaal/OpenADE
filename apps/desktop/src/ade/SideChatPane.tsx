import {ArrowUp, GitBranch, Plus, Square} from "@phosphor-icons/react";
import {CSSProperties, FormEvent, useEffect, useRef, useState} from "react";
import {AttachmentPicker,AttachmentStrip,useAttachments,withAttachments} from "./Attachments";
import {ChatTimeline} from "./ChatTimeline";
import {enqueueMessage,listMessageQueue,QueuedMessage,removeQueuedMessage,Session,steerQueuedMessage,stopSession,streamURL,updateModel,updateQueuedMessage} from "./api";
import {useEngine,refreshEngine} from "./engine-store";
import {MessageQueue} from "./MessageQueue";
import {ModelPicker} from "./ModelPicker";
import {Preferences,shouldSend} from "./preferences";
import {ProviderInteraction,useProviderState} from "./ProviderInteraction";
import {useComposerLayout} from "./useComposerLayout";

const drafts=new Map<string,string>();

export function SideChatPane({session,sourceTitle,preferences,onRefresh,onForkSibling,onNewSibling}:{session:Session;sourceTitle:string;preferences:Preferences;onRefresh:()=>Promise<void>;onForkSibling:()=>void;onNewSibling:()=>void}){
  const engine=useEngine();
  const active=["starting","running","waiting"].includes(session.status);
  const provider=useProviderState(session.id,active,session.agent==="codex"||session.agent==="codex-cli");
  const [output,setOutput]=useState("");
  const cursor=useRef(0);
  const [streamVersion,setStreamVersion]=useState(0);
  const [input,setInput]=useState(()=>drafts.get(session.id)??"");
  const [error,setError]=useState("");
  const [sending,setSending]=useState(false);
  const [editing,setEditing]=useState<string|null>(null);
  const attachments=useAttachments(session.id);
  const composer=useComposerLayout(input,preferences.interface_size,attachments.images.length>0);
  const messages=useRef<HTMLDivElement>(null);
  const textarea=useRef<HTMLTextAreaElement>(null);
  const following=useRef(true);
  const mounted=useRef(true);
  const [queue,setQueue]=useState<QueuedMessage[]>([]);
  const activeRef=useRef(active);
  activeRef.current=active;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(input)drafts.set(session.id,input);else drafts.delete(session.id);},[session.id,input]);
  useEffect(()=>{setQueue(engine.queues[session.id]??[]);},[engine.queues,session.id]);
  useEffect(()=>{setOutput("");cursor.current=0;setInput(drafts.get(session.id)??"");},[session.id]);
  useEffect(()=>{
    let disposed=false,retry:number|undefined,render:number|undefined,pending="",replace=false,nextCursor=cursor.current;
    const flush=()=>{render=undefined;if(disposed)return;cursor.current=nextCursor;const text=pending;pending="";setOutput(current=>(replace?text:current+text).slice(-2_000_000));replace=false;};
    const socket=new WebSocket(streamURL(session.id,cursor.current));
    socket.onmessage=event=>{if(disposed)return;let message:{type:string;data?:string;reset?:boolean;cursor?:number};try{message=JSON.parse(String(event.data));}catch{return;}if(message.type!=="output")return;nextCursor=message.cursor??nextCursor;if(message.reset){pending=message.data??"";replace=true;}else pending+=message.data??"";if(render===undefined)render=window.setTimeout(flush,33);};
    socket.onclose=()=>{if(!disposed&&activeRef.current)retry=window.setTimeout(()=>setStreamVersion(value=>value+1),300);};
    return()=>{disposed=true;if(retry!==undefined)clearTimeout(retry);if(render!==undefined)clearTimeout(render);socket.close();};
  },[session.id,session.generation,streamVersion]);
  useEffect(()=>{if(following.current)messages.current?.scrollTo({top:messages.current.scrollHeight,behavior:"auto"});},[output]);
  const refreshQueue=async()=>{await refreshEngine();const latest=await listMessageQueue(session.id);if(mounted.current)setQueue(latest);};
  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    if(sending||attachments.uploading||(!input.trim()&&!attachments.images.length))return;
    const original=input,images=attachments.images,text=withAttachments(original,images);
    setSending(true);setError("");setInput("");let accepted=false;
    try{
      if(editing){await updateQueuedMessage(session.id,editing,text);setEditing(null);}else await enqueueMessage(session.id,text);
      accepted=true;
      const sent=new Set(images.map(image=>image.id));attachments.setImages(current=>current.filter(image=>!sent.has(image.id)));
      await onRefresh();await refreshQueue();
    }catch(reason){const message=reason instanceof Error?reason.message:String(reason);if(!accepted){setInput(current=>original&&current&&current!==original?`${original}\n\n${current}`:original||current);setError(message);}else setError(`Message saved. Unable to refresh: ${message}`);}
    finally{if(mounted.current)setSending(false);}
  };
  const request=provider.state.requests[0];
  return <section className="side-chat-pane" aria-label={`Side chat ${session.title}`}>
    <header className="side-chat-heading"><div><strong>{session.title}</strong><small>{session.fork_source_id?`Forked from ${sourceTitle}`:"New side chat"}</small></div><button title="New side chat" aria-label="New sibling side chat" onClick={onNewSibling}><Plus/></button><button title="Fork this chat" aria-label="Fork this side chat" onClick={onForkSibling}><GitBranch/></button></header>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <div className="side-chat-messages messages" ref={messages} onScroll={event=>{const node=event.currentTarget;following.current=node.scrollHeight-node.scrollTop-node.clientHeight<80;}}><ChatTimeline session={session} output={output} activityExpanded={preferences.activity_detail==="expanded"}/></div>
    <div className="side-chat-composer session-composer-dock">
      {queue.length>0&&<MessageQueue steering={provider.state.steering} messages={queue} sendingId={queue.find(item=>item.status==="dispatching")?.id??null} onSteer={id=>{void steerQueuedMessage(session.id,id).then(refreshQueue).catch(reason=>setError(String(reason)));}} onRemove={id=>{void removeQueuedMessage(session.id,id).then(refreshQueue).catch(reason=>setError(String(reason)));}} onEdit={id=>{const item=queue.find(value=>value.id===id);if(item){setEditing(id);setInput(item.text);textarea.current?.focus();}}}/>}
      {request&&<ProviderInteraction key={request.id} id={session.id} request={request} onResolved={()=>{provider.refresh();void onRefresh();}}/>}
      <form hidden={Boolean(request)} ref={composer.form} data-layout={composer.expanded?"expanded":"compact"} className={`session-composer ${composer.expanded?"expanded":"compact"} ${composer.morphing?"composer-morphing":""}`} style={{"--composer-text-height":`${composer.textHeight}px`,"--composer-cluster-width":`${composer.clusterWidth}px`} as CSSProperties} onSubmit={event=>void submit(event)} onPaste={attachments.paste} onDragOver={event=>{if(event.dataTransfer.types.includes("Files"))event.preventDefault();}} onDrop={attachments.drop}>
        <AttachmentStrip draft={attachments}/>
        <textarea ref={element=>{composer.textarea.current=element;textarea.current=element;}} aria-label="Side chat message" placeholder="Do anything…" value={input} onChange={event=>setInput(event.target.value)} onKeyDown={event=>{if(shouldSend(event,preferences.send_behavior)){event.preventDefault();event.currentTarget.form?.requestSubmit();}}}/>
        <div className="composer-footer"><AttachmentPicker draft={attachments}/><ModelPicker compactLabel provider={session.agent} models={engine.meta?.agents.find(item=>item.id===session.agent)?.models} model={session.model} effort={session.effort} serviceTier={session.service_tier} onChange={(model,effort)=>{void updateModel(session.id,model,effort,session.service_tier).then(onRefresh).catch(reason=>setError(String(reason)));}} onTierChange={tier=>{void updateModel(session.id,session.model,session.effort,tier).then(onRefresh).catch(reason=>setError(String(reason)));}}/><button type={active&&!input.trim()&&!attachments.images.length?"button":"submit"} className="send-button" disabled={sending||attachments.uploading||(!active&&!input.trim()&&!attachments.images.length)} aria-label={active&&!input.trim()&&!attachments.images.length?"Stop side chat":"Send side chat message"} onClick={active&&!input.trim()&&!attachments.images.length?()=>{void stopSession(session.id).then(onRefresh).catch(reason=>setError(String(reason)));}:undefined}>{active&&!input.trim()&&!attachments.images.length?<Square weight="fill"/>:<ArrowUp weight="bold"/>}</button></div>
      </form>
    </div>
  </section>;
}
