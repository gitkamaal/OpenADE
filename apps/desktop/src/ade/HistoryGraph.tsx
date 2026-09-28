import {GitCommit,GitHistoryRef} from "./api";

type Lane={id:number;color:number;target:string};
type Segment={from:number;to:number;color:number;shape:"through"|"incoming"|"outgoing"};
export type GraphRow={lane:number;color:number;segments:Segment[];head:boolean};
export type HistoryGraphLayout={rows:GraphRow[];lanes:number};

export function branchRefKey(reference:GitHistoryRef):string|undefined{
 return reference.kind==="tag"?undefined:`${reference.kind==="branch"?"local":"remote"}:${reference.label}`;
}

/** The same topological lane transitions as Zeron's pinned history view. */
export function layoutHistoryGraph(commits:GitCommit[],headSHA:string):HistoryGraphLayout{
 let active:Lane[]=[],nextId=0,nextColor=0,maxLanes=0;
 const rows=commits.map(commit=>{
  const before=[...active],incoming=before.flatMap((lane,index)=>lane.target===commit.sha?[index]:[]),primaryIndex=incoming[0];
  const nodeLane=primaryIndex??before.length,primary=primaryIndex===undefined?undefined:before[primaryIndex];
  const color=primary?.color??nextColor++;
  const resolved=new Set(incoming.map(index=>before[index].id));
  const next=before.filter(lane=>!resolved.has(lane.id));
  const parents=commit.parents.trim().split(/\s+/).filter(Boolean),outgoing:Lane[]=[];
  const first=parents[0];let primaryId:number|undefined;
  if(first){const lane={id:primary?.id??nextId++,color,target:first};next.splice(Math.min(nodeLane,next.length),0,lane);primaryId=lane.id;outgoing.push(lane);}
  let offset=1;
  for(const parent of parents.slice(1)){
   const existing=next.find(lane=>lane.target===parent);
   if(existing){outgoing.push(existing);continue;}
   const lane={id:nextId++,color:nextColor++,target:parent};
   const primaryPosition=primaryId===undefined?Math.min(nodeLane,next.length):next.findIndex(item=>item.id===primaryId);
   next.splice(Math.min(primaryPosition+offset,next.length),0,lane);offset++;outgoing.push(lane);
  }
  const segments:Segment[]=[];
  before.forEach((lane,index)=>{if(!resolved.has(lane.id))segments.push({from:index,to:next.findIndex(item=>item.id===lane.id),color:lane.color,shape:"through"});});
  incoming.forEach(index=>segments.push({from:index,to:nodeLane,color:before[index].color,shape:"incoming"}));
  outgoing.forEach(lane=>segments.push({from:nodeLane,to:next.findIndex(item=>item.id===lane.id),color:lane.color,shape:"outgoing"}));
  maxLanes=Math.max(maxLanes,before.length,next.length,nodeLane+1);active=next;
  return {lane:nodeLane,color,segments,head:commit.sha===headSHA};
 });
 return {rows,lanes:maxLanes};
}

/** Fold linear runs on a selected branch lane while keeping merge, ref and root rows. */
export function collapseHistoryBranches(commits:GitCommit[],selected:Set<string>,headSHA:string):{commits:GitCommit[];hidden:Map<string,number>}{
 if(!selected.size||!commits.length)return {commits,hidden:new Map()};
 const graph=layoutHistoryGraph(commits,headSHA),colors=new Map<string,number>();
 commits.forEach((commit,index)=>commit.refs.forEach(reference=>{const key=branchRefKey(reference);if(key&&selected.has(key))colors.set(key,graph.rows[index].color);}));
 if(!colors.size)return {commits,hidden:new Map()};
 const collapsedColors=new Set(colors.values()),childCounts=new Map<string,number>();
 commits.forEach(commit=>commit.parents.trim().split(/\s+/).filter(Boolean).forEach(parent=>childCounts.set(parent,(childCounts.get(parent)??0)+1)));
 const visible=new Set<string>(),hidden=new Map<string,number>();
 commits.forEach((commit,index)=>{
  const color=graph.rows[index].color,tip=commit.refs.some(reference=>{const key=branchRefKey(reference);return key?selected.has(key):false;});
  const parents=commit.parents.trim().split(/\s+/).filter(Boolean),junction=parents.length!==1||(childCounts.get(commit.sha)??0)>1;
  if(collapsedColors.has(color)&&!tip&&!commit.refs.length&&!junction){for(const [key,value] of colors)if(value===color)hidden.set(key,(hidden.get(key)??0)+1);}
  else visible.add(commit.sha);
 });
 const bySHA=new Map(commits.map(commit=>[commit.sha,commit]));
 const memo=new Map<string,string[]>();
 const nearest=(sha:string):string[]=>{
  if(visible.has(sha)||!bySHA.has(sha))return [sha];
  const cached=memo.get(sha);if(cached)return cached;
  const found:string[]=[],seen=new Set<string>(),stack=[sha];
  while(stack.length){const current=stack.pop()!;if(seen.has(current))continue;seen.add(current);if(visible.has(current)||!bySHA.has(current)){found.push(current);continue;}const parents=bySHA.get(current)!.parents.trim().split(/\s+/).filter(Boolean);for(let index=parents.length-1;index>=0;index--)stack.push(parents[index]);}
  memo.set(sha,found);return found;
 };
 return {commits:commits.filter(commit=>visible.has(commit.sha)).map(commit=>{const unique=new Set<string>();const parents=commit.parents.trim().split(/\s+/).filter(Boolean).flatMap(nearest).filter(sha=>!unique.has(sha)&&unique.add(sha));return {...commit,parents:parents.join(" ")};}),hidden};
}

const colors=["var(--accent)","var(--green)","var(--orange)","var(--red)","var(--muted)"];
const color=(id:number)=>colors[id%colors.length];
const x=(lane:number)=>8+lane*13;

export function HistoryGraph({row,lanes}:{row:GraphRow;lanes:number}){
 const width=Math.max(22,Math.min(7,lanes)*13+9);
 const path=(segment:Segment)=>{
  const from=x(segment.from),to=x(segment.to);
  if(segment.shape==="through")return `M${from} 0 C${from} 16 ${to} 20 ${to} 36`;
  if(segment.shape==="incoming")return `M${from} 0 C${from} 9 ${to} 10 ${to} 18`;
  return `M${from} 18 C${from} 26 ${to} 26 ${to} 36`;
 };
 return <svg className="history-graph" width={width} height="36" viewBox={`0 0 ${width} 36`} aria-hidden="true">{row.segments.filter(segment=>segment.from<7&&segment.to<7).map((segment,index)=><path key={index} d={path(segment)} stroke={color(segment.color)} strokeWidth="1.45" fill="none" opacity=".77"/>)}<circle cx={x(Math.min(row.lane,6))} cy="18" r={row.head?4:3} fill={row.head?"var(--panel-fill)":color(row.color)} stroke={color(row.color)} strokeWidth={row.head?1.8:1}/></svg>;
}
