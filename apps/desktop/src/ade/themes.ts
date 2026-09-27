import families from "./theme-catalog.json";

export type Appearance = "light" | "dark";
export const themes = families.flatMap(family => family.variants);
export type Theme = typeof themes[number];
const byId = new Map(themes.map(theme => [theme.id, theme]));
const legacyIds: Record<string, string> = {graphite:"zeron-dark", dusk:"gruvbox-dark", paper:"zeron-light"};
export function themeId(value:string, appearance:Appearance):string {
 const id=legacyIds[value]??value;
 return byId.get(id)?.appearance===appearance ? id : `zeron-${appearance}`;
}
export function resolveTheme(preferences:{color_scheme:string;light_theme:string;dark_theme:string},systemLight:boolean):Theme {
 const light=preferences.color_scheme==="light"||preferences.color_scheme==="system"&&systemLight;
 return byId.get(themeId(light?preferences.light_theme:preferences.dark_theme,light?"light":"dark"))!;
}
export function materialFor(theme:Theme,preference:string):string {
 return preference==="default"?theme.recommendedSurfaceTreatment:preference;
}

const lightAccents:Record<string,string>={"#8b7cf6":"#5b43e8","#fb923c":"#c2410c","#fbbf24":"#a16207","#4ade80":"#15803d","#22d3ee":"#0e7490","#60a5fa":"#2563eb","#f472b6":"#be185d"};
export function accentFor(color:string,appearance:string):string{return appearance==="light"?lightAccents[color]??color:color;}
