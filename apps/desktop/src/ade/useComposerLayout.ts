import {useLayoutEffect,useRef,useState} from "react";

// Zeron's established-thread geometry: 49px pill, 200px minimum text slot,
// 32px collapse hysteresis and a 150ms wait after an interactive resize.
export function useComposerLayout(value:string,fontSize:number,alwaysExpanded=false,minHeight=alwaysExpanded?76:60,active=true){
 const form=useRef<HTMLFormElement>(null),textarea=useRef<HTMLTextAreaElement>(null);
 const [expanded,setExpanded]=useState(alwaysExpanded||value.includes("\n")),[textHeight,setTextHeight]=useState(60),[formWidth,setFormWidth]=useState(0),[clusterWidth,setClusterWidth]=useState(150),[morphing,setMorphing]=useState(false);
 const current=useRef({value,expanded,force:alwaysExpanded});current.current.force=alwaysExpanded;current.current.value=value;
 const measure=useRef<()=>void>(()=>{});
 useLayoutEffect(()=>{
  const host=form.current,editor=textarea.current;if(!host||!editor)return;
  const canvas=document.createElement("canvas"),context=canvas.getContext("2d");
  let width=0,controls=0,resizeUntil=0,frame=0,settle=0,morph=0,alive=true;
  const calculate=()=>{
   frame=0;if(!alive||host.clientWidth<=0)return;
   const nextWidth=host.clientWidth;
   const model=host.querySelector<HTMLElement>(".model-picker");
   const nextControls=(model?.getBoundingClientRect().width??110)+32+8+8+8;
   const hadLayout=width>0;
   if(hadLayout&&(Math.abs(nextWidth-width)>.5||Math.abs(nextControls-controls)>.5)){
    resizeUntil=performance.now()+150;clearTimeout(settle);settle=window.setTimeout(calculate,150);
   }
   width=nextWidth;controls=nextControls;setFormWidth(nextWidth);setClusterWidth(previous=>Math.abs(previous-controls)>.5?controls:previous);
   const text=current.current.value,capacity=width-44-controls;
   const style=getComputedStyle(editor);
   if(context)context.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
   const hasNewline=text.includes("\n");
   const textWidth=hasNewline?0:(context?.measureText(text).width??text.length*8);
   const wasExpanded=current.current.expanded;
   const nextExpanded=current.current.force||hasNewline||capacity<200||(wasExpanded?(performance.now()<resizeUntil||textWidth>=capacity-32):textWidth>capacity);
   if(nextExpanded!==wasExpanded){
    current.current.expanded=nextExpanded;setExpanded(nextExpanded);
    if(hadLayout){setMorphing(true);clearTimeout(morph);morph=window.setTimeout(()=>{if(alive)setMorphing(false);},180);}
   }
  };
  measure.current=calculate;
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(calculate);};
  const observer=new ResizeObserver(schedule);observer.observe(host);
  const model=host.querySelector<HTMLElement>(".model-picker");if(model)observer.observe(model);
  calculate();void document.fonts.ready.then(()=>{if(alive)schedule();});
  return()=>{alive=false;observer.disconnect();cancelAnimationFrame(frame);clearTimeout(settle);clearTimeout(morph);measure.current=()=>{};};
 },[active]);
 useLayoutEffect(()=>{measure.current();},[value,fontSize,alwaysExpanded]);
 useLayoutEffect(()=>{
  const editor=textarea.current;if(!editor)return;
  editor.style.height="0px";
  const next=expanded?Math.min(260,Math.max(minHeight,editor.scrollHeight)):47;
  editor.style.height=`${next}px`;setTextHeight(previous=>previous===next?previous:next);
 },[value,expanded,fontSize,clusterWidth,formWidth,alwaysExpanded,minHeight,active]);
 return{form,textarea,expanded,morphing,textHeight,clusterWidth};
}
