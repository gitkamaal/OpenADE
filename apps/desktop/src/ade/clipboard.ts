export async function copyText(text:string){
 const bridge=window as typeof window & {go?:{main?:{App?:{CopyText?:(text:string)=>Promise<void>}}}};
 if(bridge.go?.main?.App?.CopyText){await bridge.go.main.App.CopyText(text);return;}
 if(!navigator.clipboard)throw new Error("Clipboard unavailable");
 await navigator.clipboard.writeText(text);
}
