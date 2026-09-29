import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {activateCodexAccount,AgentAccount,AgentAccountsSnapshot,AgentUsageWindow,forgetCodexAccount,getAgentAccounts} from "./api";

const empty:AgentAccountsSnapshot={accounts:[],warnings:[]};

function resetLabel(seconds?:number){
 if(!seconds)return "";
 const date=new Date(seconds*1000);
 if(!Number.isFinite(date.getTime()))return "";
 const delta=date.getTime()-Date.now();
 if(delta<22*60*60*1000)return `resets ${new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit"}).format(date)}`;
 if(delta<7*24*60*60*1000)return `resets ${new Intl.DateTimeFormat(undefined,{weekday:"short"}).format(date)}`;
 return `resets ${new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(date)}`;
}

function UsageMeter({window:usage}:{window:AgentUsageWindow}){
 if(!Number.isFinite(usage.used_fraction))return null;
 const fraction=Math.max(0,Math.min(1,usage.used_fraction));
 const percent=Math.round(fraction*100);
 const level=fraction>=.95?"critical":fraction>=.8?"warning":"normal";
 return <div className="account-usage-row"><span className="account-usage-label">{usage.label}</span><span className={`account-usage-track ${level}`} role="progressbar" aria-label={`${usage.label} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{width:`${percent}%`}}/></span><span className="account-usage-percent">{percent}%</span><small>{resetLabel(usage.resets_at)}</small></div>;
}

export function CodexAccounts(){
 const [snapshot,setSnapshot]=useState<AgentAccountsSnapshot>(empty);
 const [busy,setBusy]=useState(true),[acting,setActing]=useState<string|null>(null);
 const [error,setError]=useState(""),[version,setVersion]=useState(0);
 const [pendingForget,setPendingForget]=useState<AgentAccount|null>(null);
 const refreshButton=useRef<HTMLButtonElement>(null),confirmButton=useRef<HTMLButtonElement>(null),returnFocus=useRef<HTMLElement|null>(null);
 useEffect(()=>{let active=true;setBusy(true);setError("");void getAgentAccounts(true).then(value=>{if(active)setSnapshot(value);}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:String(reason));}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[version]);
 useEffect(()=>{if(!pendingForget)return;const frame=requestAnimationFrame(()=>confirmButton.current?.focus());return()=>cancelAnimationFrame(frame);},[pendingForget]);
 const closeDialog=()=>{setPendingForget(null);requestAnimationFrame(()=>{if(returnFocus.current?.isConnected)returnFocus.current.focus();else refreshButton.current?.focus();});};
 useEffect(()=>{if(!pendingForget)return;const onKey=(event:KeyboardEvent)=>{if(event.key!=="Escape"||acting)return;event.preventDefault();event.stopPropagation();closeDialog();};document.addEventListener("keydown",onKey,true);return()=>document.removeEventListener("keydown",onKey,true);},[pendingForget,acting]);
 const switchTo=(account:AgentAccount)=>{setActing(account.id);setError("");void activateCodexAccount(account.id).then(()=>setVersion(value=>value+1)).catch(reason=>setError(reason instanceof Error?reason.message:String(reason))).finally(()=>setActing(null));};
 const confirmForget=()=>{if(!pendingForget||acting)return;const id=pendingForget.id;setActing(id);setError("");void forgetCodexAccount(id).then(()=>{closeDialog();setVersion(value=>value+1);}).catch(reason=>setError(reason instanceof Error?reason.message:String(reason))).finally(()=>setActing(null));};
 const accounts=snapshot.accounts.filter(item=>item.provider==="codex");
 const warning=snapshot.warnings.find(item=>item.provider==="codex")?.message;
 return <section className="provider-accounts" aria-label="Codex accounts"><header><strong>Accounts</strong><button ref={refreshButton} type="button" disabled={busy||Boolean(acting)} onClick={()=>setVersion(value=>value+1)} aria-label="Refresh Codex account usage">{busy?"Checking…":"Refresh"}</button></header>{error?<p role="alert">{error}</p>:warning?<p role="status">{warning}</p>:null}{accounts.length?accounts.map(account=><div className="provider-account-row" aria-label={`Codex account ${account.email||account.plan_label||"connected"}`} key={account.id}><div className="provider-account-heading"><span className="provider-account-identity" title={account.email||undefined}>{account.email||account.plan_label||"Codex account"}</span>{account.active&&<span className="provider-account-active">Active</span>}{account.plan_label&&<span className="provider-account-plan">{account.plan_label}</span>}</div>{account.active&&account.usage_windows.length>0?<div className="account-usage-list">{account.usage_windows.map((window,index)=><UsageMeter key={`${window.label}:${index}`} window={window}/>)}</div>:account.usage_error?<p role="status">{account.usage_error}</p>:!account.active?<p>Switch to this account to check its current quota.</p>:account.auth_kind==="api-key"?<p>API key usage is managed by its provider.</p>:!busy?<p>Quota data is unavailable.</p>:null}{account.active&&account.usage_windows.length>0&&account.usage_error&&<p role="status">{account.usage_error}</p>}{account.switchable&&<div className="provider-account-actions">{!account.active&&<button type="button" disabled={Boolean(acting)} aria-label={`Switch to ${account.email||"Codex account"}`} onClick={()=>switchTo(account)}>{acting===account.id?"Switching…":"Switch"}</button>}<button type="button" disabled={Boolean(acting)} aria-label={`Forget ${account.email||"Codex account"}`} onClick={event=>{returnFocus.current=event.currentTarget;setPendingForget(account);}}>Forget</button></div>}</div>):!busy&&!warning&&!error?<p>No Codex account is connected.</p>:null}{accounts.length>0&&<p className="provider-account-storage-note">Saved logins stay on this Mac in OpenADE’s private app data.</p>}{pendingForget&&createPortal(<div className="sidebar-dialog-backdrop" role="presentation"><form className="sidebar-dialog danger-dialog" role="dialog" aria-modal="true" aria-label="Forget Codex account" onSubmit={event=>{event.preventDefault();confirmForget();}} onKeyDown={event=>{if(event.key==="Escape"&&!acting){event.preventDefault();event.stopPropagation();closeDialog();}if(event.key==="Tab"){const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)')];const index=controls.indexOf(document.activeElement as HTMLElement);if(controls.length){event.preventDefault();controls[(index+(event.shiftKey?-1:1)+controls.length)%controls.length]?.focus();}}}}><h2>Forget Codex account?</h2><p>{pendingForget.active?"This signs Codex out on this Mac and removes OpenADE’s saved copy. Running chats may continue with their current login until stopped.":"This removes OpenADE’s saved copy. The active Codex login stays connected."}</p>{error&&<p role="alert">{error}</p>}<div><button type="button" disabled={Boolean(acting)} onClick={closeDialog}>Cancel</button><button ref={confirmButton} type="submit" disabled={Boolean(acting)}>{acting?"Forgetting…":"Forget account"}</button></div></form></div>,document.querySelector(".ade")||document.body)}</section>;
}
