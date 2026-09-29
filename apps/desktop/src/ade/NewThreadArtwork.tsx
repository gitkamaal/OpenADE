import {useEffect,useState} from "react";
import {fetchMedia,NewThreadArtworkState,newThreadArtworkMediaURL} from "./api";

const ascii="░▒▓█ ░▒▓█ ░▒▓█ ░▒▓█ ░▒▓█";
function useArtworkURL(imageID?:string) {
 const [url,setURL]=useState("");
 useEffect(()=>{
  if(!imageID){setURL("");return;}
  const controller=new AbortController();let active=true;let objectURL="";
  void fetchMedia(newThreadArtworkMediaURL(imageID),controller.signal).then(blob=>{objectURL=URL.createObjectURL(blob);if(active)setURL(objectURL);else URL.revokeObjectURL(objectURL);}).catch(()=>{if(active)setURL("");});
  return()=>{active=false;controller.abort();if(objectURL)URL.revokeObjectURL(objectURL);};
 },[imageID]);
 return url;
}
export function ArtworkPreview({artwork}:{artwork:NewThreadArtworkState}) {
 const url=useArtworkURL(artwork.image?.id);
 return <span className={`artwork-preview ${url?"":"artwork-preview-empty"}`}>{url?<img src={url} alt=""/>:"None"}</span>;
}
export function NewThreadArtwork({artwork}:{artwork:NewThreadArtworkState}) {
 const url=useArtworkURL(artwork.image?.id);
 if(!url)return null;
 return <div className="new-thread-artwork" data-effect={artwork.effect} aria-hidden="true"><img src={url} alt=""/><span className="new-thread-artwork-ascii">{ascii}<br/>{ascii}<br/>{ascii}<br/>{ascii}<br/>{ascii}</span></div>;
}
