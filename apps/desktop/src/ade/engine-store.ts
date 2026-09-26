import { useSyncExternalStore } from "react";
import { engineEventsURL, getEngineState, getMeta, Meta, QueuedMessage, Session } from "./api";
interface EngineState {sequence:number;sessions:Session[];projects:string[];queues:Record<string,QueuedMessage[]>;meta:Meta|null;connected:boolean;error:string|null}
let state:EngineState={sequence:0,sessions:[],projects:[],queues:{},meta:null,connected:false,error:null};
const listeners=new Set<()=>void>();let source:EventSource|null=null;let retry:number|undefined;let refreshPromise:Promise<void>|null=null;let requested=false;let revision=0;
function publish(next:EngineState){state=next;for(const listener of listeners)listener();}
export function refreshEngine():Promise<void>{
 requested=true;if(refreshPromise)return refreshPromise;
 const epoch=revision;
 refreshPromise=(async()=>{while(requested&&epoch===revision){requested=false;try{
 const [snapshot,meta]=await Promise.all([getEngineState(),state.meta?Promise.resolve(state.meta):getMeta()]);
 if(epoch!==revision)return;publish({...snapshot,meta,connected:true,error:null});
 if(!source&&listeners.size){source=new EventSource(engineEventsURL(snapshot.sequence));source.addEventListener("reset",()=>{source?.close();source=null;void refreshEngine();});source.addEventListener("activity",event=>{const events=JSON.parse((event as MessageEvent).data) as {sequence:number}[];if(events.some(item=>item.sequence>state.sequence))void refreshEngine();});source.onerror=()=>{if(!listeners.size)return;publish({...state,connected:false});if(retry===undefined)retry=window.setTimeout(()=>{retry=undefined;void refreshEngine();},1500);};source.onopen=()=>{if(!state.connected)void refreshEngine();};}
 }catch(reason){if(epoch!==revision)return;publish({...state,connected:false,error:reason instanceof Error?reason.message:String(reason)});if(listeners.size&&retry===undefined)retry=window.setTimeout(()=>{retry=undefined;void refreshEngine();},1500);}}})().finally(()=>{refreshPromise=null;if(requested&&listeners.size)void refreshEngine();});
 return refreshPromise;
}
function subscribe(listener:()=>void){listeners.add(listener);if(listeners.size===1)void refreshEngine();return()=>{listeners.delete(listener);if(!listeners.size){revision++;requested=false;source?.close();source=null;if(retry!==undefined)window.clearTimeout(retry);retry=undefined;}};}
export function useEngine(){return useSyncExternalStore(subscribe,()=>state);}
