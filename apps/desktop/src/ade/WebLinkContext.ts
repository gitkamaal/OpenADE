import {createContext} from 'react';
export const WebLinkContext=createContext<((url:string)=>void)|null>(null);
