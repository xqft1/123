import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface Billboard {
  'admin_set_ledger' : ActorMethod<[Principal], undefined>,
  'admin_set_price_per_pixel_e8s' : ActorMethod<[bigint], undefined>,
  'admin_set_recipient' : ActorMethod<
    [{ 'owner' : Principal, 'subaccount' : [] | [Uint8Array | number[]] }],
    undefined
  >,
  'claim_pixels' : ActorMethod<
    [Uint32Array | number[], [] | [string]],
    { 'cost_paid_e8s' : bigint, 'claimed' : number }
  >,
  'get_canvas_chunk' : ActorMethod<
    [number, number, number, number],
    Uint32Array | number[]
  >,
  'ledger_canister' : ActorMethod<[], Principal>,
  'link_for_pixel' : ActorMethod<[number], [] | [string]>,
  'paint' : ActorMethod<
    [Array<{ 'color' : number, 'index' : number }>],
    undefined
  >,
  'price_per_pixel_e8s' : ActorMethod<[], bigint>,
  'recipient_account' : ActorMethod<
    [],
    { 'owner' : Principal, 'subaccount' : [] | [Uint8Array | number[]] }
  >,
  'set_link' : ActorMethod<[[] | [string]], undefined>,
}
export interface _SERVICE extends Billboard {}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
