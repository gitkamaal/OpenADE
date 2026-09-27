import type {KeyboardEvent} from "react";

/** Navigation for custom action menus; nested choices consume their own keys. */
export function menuKeys(event:KeyboardEvent<HTMLElement>,dismiss:()=>void,restore?:()=>void){
 if(event.key==="Escape"){event.preventDefault();event.stopPropagation();dismiss();restore?.();return;}
 if(event.key==="Tab"){if(event.metaKey||event.ctrlKey||event.altKey){event.preventDefault();event.stopPropagation();}else dismiss();return;}
 if(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement)return;
 const controls=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(button=>button.getClientRects().length);
 const index=controls.indexOf(document.activeElement as HTMLButtonElement);
 if(!controls.length)return;
 const next=event.key==="Home"?0:event.key==="End"?controls.length-1:event.key==="ArrowDown"?(index+1)%controls.length:event.key==="ArrowUp"?(index-1+controls.length)%controls.length:null;
 if(next!==null){event.preventDefault();event.stopPropagation();controls[next].focus();}
 if(event.key==="ArrowRight"&&document.activeElement?.getAttribute('aria-haspopup')){event.preventDefault();event.stopPropagation();(document.activeElement as HTMLButtonElement).click();}
}

// Native WKWebView sits above HTML; keep it hidden until the last popup closes.
const menuCounts=new WeakMap<Element,number>();
export function markCustomMenu(element:Element|null){
 const root=element?.closest(".ade");if(!root)return()=>{};
 menuCounts.set(root,(menuCounts.get(root)??0)+1);root.classList.add("has-custom-menu");
 return()=>{const remaining=(menuCounts.get(root)??1)-1;if(remaining>0)menuCounts.set(root,remaining);else{menuCounts.delete(root);root.classList.remove("has-custom-menu");}};
}
