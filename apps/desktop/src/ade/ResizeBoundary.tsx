import {useEffect,useRef,useState} from "react";

// Pointer capture keeps the seam usable without a painted drag indicator.
// Persist only on completion; coalesce layout changes to one per animation frame.
export function ResizeBoundary({className,label,width,min,max,defaultWidth,fraction,reserve=0,collapseAt=0,direction=1,onResize,onCommit}:{className:string;label:string;width:number;min:number;max:number;defaultWidth:number;fraction?:number;reserve?:number;collapseAt?:number;direction?:number;onResize:(width:number)=>void;onCommit:(width:number)=>void}) {
 const element=useRef<HTMLDivElement>(null);
 const drag=useRef<{x:number;width:number;pending:number;frame:number|null;fallback:number|null;root:Element|null}|null>(null);
 const [limit,setLimit]=useState(max);
 const effectiveMin=Math.min(min,limit);
 const clamp=(value:number)=>Math.round(Math.max(effectiveMin,Math.min(limit,value)));
 useEffect(()=>{
  const parent=element.current?.parentElement;if(!parent||!fraction){setLimit(max);return;}
  const measure=()=>{const available=parent.getBoundingClientRect().width;setLimit(available<=collapseAt?0:Math.max(0,Math.min(max,Math.floor(available*fraction),reserve?Math.max(min,Math.floor(available-reserve)):max)));};
  measure();const observer=new ResizeObserver(measure);observer.observe(parent);return()=>observer.disconnect();
 },[fraction,min,max,reserve,collapseAt]);
 const finish=()=>{
  const current=drag.current;if(!current)return;
  drag.current=null;if(current.frame!==null)cancelAnimationFrame(current.frame);
  if(current.fallback!==null)window.clearTimeout(current.fallback);
  current.root?.classList.remove("is-resizing");if(current.pending!==current.width)onCommit(Math.max(min,current.pending));
 };
 useEffect(()=>()=>{const current=drag.current;if(current?.frame!==null&&current?.frame!==undefined)cancelAnimationFrame(current.frame);if(current?.fallback!==null&&current?.fallback!==undefined)window.clearTimeout(current.fallback);current?.root?.classList.remove("is-resizing");},[]);
 const flush=(current:NonNullable<typeof drag.current>)=>{if(current.frame!==null)cancelAnimationFrame(current.frame);if(current.fallback!==null)window.clearTimeout(current.fallback);current.frame=null;current.fallback=null;onResize(current.pending);};
 return <div ref={element} className={`${className} resize-boundary`} role="separator" aria-label={label} aria-orientation="vertical" aria-valuenow={Math.min(width,limit)} aria-valuemin={effectiveMin} aria-valuemax={limit} aria-disabled={limit<=min} tabIndex={limit<=min?-1:0}
  onDoubleClick={()=>{if(limit>min)onCommit(clamp(defaultWidth));}}
  onPointerDown={event=>{
   if(event.button!==0||limit<=min)return;event.preventDefault();
   const root=event.currentTarget.closest(".ade");root?.classList.add("is-resizing");
   drag.current={x:event.clientX,width:Math.min(width,limit),pending:Math.min(width,limit),frame:null,fallback:null,root};
   event.currentTarget.setPointerCapture(event.pointerId);
  }}
  onPointerMove={event=>{
   const current=drag.current;if(!current)return;
   current.pending=clamp(current.width+(event.clientX-current.x)*direction);
   if(current.frame===null&&current.fallback===null){current.frame=requestAnimationFrame(()=>flush(current));current.fallback=window.setTimeout(()=>flush(current),32);}
  }}
  onPointerUp={event=>{finish();if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
  onPointerCancel={finish} onLostPointerCapture={finish}
  onKeyDown={event=>{
   if(limit<=min)return;
   const step=event.shiftKey?32:8;
   const next=event.key==="Home"?min:event.key==="End"?limit:event.key==="ArrowRight"?Math.min(width,limit)+step*direction:event.key==="ArrowLeft"?Math.min(width,limit)-step*direction:null;
   if(next!==null){event.preventDefault();event.stopPropagation();onCommit(clamp(next));}
  }}/>
}
