export async function copyText(text:string){
 const bridge=window as typeof window & {go?:{main?:{App?:{CopyText?:(text:string)=>Promise<void>}}}};
 if(bridge.go?.main?.App?.CopyText){await bridge.go.main.App.CopyText(text);return;}
 if(!navigator.clipboard)throw new Error("Clipboard unavailable");
 await navigator.clipboard.writeText(text);
}

export async function readText(){
 const bridge=window as typeof window & {go?:{main?:{App?:{ReadClipboard?:()=>Promise<string>}}}};
 if(bridge.go?.main?.App?.ReadClipboard)return bridge.go.main.App.ReadClipboard();
 if(!navigator.clipboard)throw new Error("Clipboard unavailable");
 return navigator.clipboard.readText();
}
