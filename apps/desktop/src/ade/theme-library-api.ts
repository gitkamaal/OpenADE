import { request } from "./api";

export type ThemeDocument=Record<string,unknown>;
export type ThemeLibraryVariant={id:string;name:string;appearance:"light"|"dark";document:ThemeDocument};
export type ThemeLibraryEntry={id:string;name:string;source:{kind:"snapshot"|"linkedFile"|"linkedPackage"|"editableFile";path?:string};selectedVariantIds:string[];variants:ThemeLibraryVariant[];failures?:{id:string;name:string;path:string;message:string}[];status:{state:"ready"|"warning";message?:string}};
export type ThemeImportPreview={path:string;name:string;sourceKind:"linkedFile"|"linkedPackage";variants:ThemeLibraryVariant[];failures:{id:string;name:string;path:string;message:string}[];digest:string};

export const listThemeLibrary=async()=>((await request<{entries?:ThemeLibraryEntry[]}>("/api/themes")).entries??[]);
export const linkThemeSource=(path:string,name="")=>request<ThemeLibraryEntry>("/api/themes/link",{method:"POST",body:JSON.stringify({path,name})});
export const previewThemeSource=(path:string)=>request<ThemeImportPreview>("/api/themes/preview",{method:"POST",body:JSON.stringify({path})});
export const importReviewedTheme=(preview:ThemeImportPreview,mode:"snapshot"|"link",selected:string[])=>request<ThemeLibraryEntry>("/api/themes/import",{method:"POST",body:JSON.stringify({path:preview.path,digest:preview.digest,mode,selected})});
export const reloadThemeSource=(id:string)=>request<{entries:ThemeLibraryEntry[]}>(`/api/themes/${encodeURIComponent(id)}/reload`,{method:"POST"});
export const unlinkThemeSource=(id:string)=>request<{entries:ThemeLibraryEntry[]}>(`/api/themes/${encodeURIComponent(id)}/unlink`,{method:"POST"});
export const duplicateThemeSource=(id:string,mode:"snapshot"|"editable")=>request<ThemeLibraryEntry>(`/api/themes/${encodeURIComponent(id)}/duplicate`,{method:"POST",body:JSON.stringify({mode})});
export const removeThemeSource=(id:string)=>request<void>(`/api/themes/${encodeURIComponent(id)}`,{method:"DELETE"});

type Bridge={go?:{main?:{App?:{SelectThemeSource?:()=>Promise<string>;SelectThemePackage?:()=>Promise<string>;RevealThemeSource?:(id:string)=>Promise<void>}}}};
const appBridge=()=>((window as unknown as Bridge).go?.main?.App);
export async function chooseNativeThemeSource(kind:"file"|"package"):Promise<string>{const method=kind==="file"?appBridge()?.SelectThemeSource:appBridge()?.SelectThemePackage;if(!method)throw Error("Linking a source requires the native OpenADE app. Browser imports remain snapshots.");return method();}
export const nativeThemePickerAvailable=()=>!!(appBridge()?.SelectThemeSource&&appBridge()?.SelectThemePackage);
export async function revealNativeThemeSource(id:string):Promise<void>{const reveal=appBridge()?.RevealThemeSource;if(!reveal)throw Error("Revealing theme sources requires the native macOS OpenADE app.");await reveal(id);}
export const nativeThemeRevealAvailable=()=>!!appBridge()?.RevealThemeSource;
