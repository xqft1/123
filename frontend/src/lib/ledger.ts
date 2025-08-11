import { Actor } from '@dfinity/agent'
import { idlFactory as ledgerIDL } from '../idl/ledger.idl'
export function ledgerActor(agent:any, canisterId:string) {
  return Actor.createActor(ledgerIDL as any, { agent, canisterId })
}
