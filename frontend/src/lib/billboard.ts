import { Actor } from '@dfinity/agent'
import { idlFactory as billboardIDL } from '../idl/billboard.idl'
export function billboardActor(agent:any, canisterId:string) {
  return Actor.createActor(billboardIDL as any, { agent, canisterId })
}
