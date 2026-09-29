import manifestData from "./file-icons.json";

type Manifest = {
  iconDefinitions: Record<string,{iconPath:string}>;
  file?: string;
  folder?: string;
  fileExtensions: Record<string,string>;
  fileNames: Record<string,string>;
  folderNames: Record<string,string>;
};

const manifest=manifestData as Manifest;
const aliases:Record<string,string>={less:"brackets-sky",yml:"yaml"};

function iconAsset(definition:string|undefined,fallback:string):string{
  const path=manifest.iconDefinitions[aliases[definition??""]??definition??""]?.iconPath;
  if(!path||!/^\.\/icons\/(files|folders)\/[a-z0-9._-]+\.svg$/i.test(path))return fallback;
  return path.slice("./icons/".length);
}

export function fileIconPath(path:string,directory:boolean,appearance:"light"|"dark"):string{
  const name=path.replaceAll("\\","/").split("/").at(-1)?.toLowerCase()??"";
  let asset:string;
  if(directory){
    asset=iconAsset(manifest.folderNames[name]??manifest.folder,"folders/folder.svg");
  }else{
    let definition=manifest.fileNames[name];
    if(!definition){
      for(let dot=name.indexOf(".");dot>=0;dot=name.indexOf(".",dot+1)){
        definition=manifest.fileExtensions[name.slice(dot+1)];
        if(definition)break;
      }
    }
    asset=iconAsset(definition??manifest.file,"files/document.svg");
  }
  return `${import.meta.env.BASE_URL}file-icons/${appearance==="dark"?"dark/":""}${asset}`;
}

export function FileIdentityIcon({path,directory=false,appearance,className=""}:{path:string;directory?:boolean;appearance:"light"|"dark";className?:string}){
  return <img className={`file-identity-icon ${className}`} src={fileIconPath(path,directory,appearance)} alt="" aria-hidden="true" draggable={false}/>;
}
