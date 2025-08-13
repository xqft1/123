import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface PixelInfo {
  'x' : bigint,
  'y' : bigint,
  'link' : [] | [string],
  'color' : number,
}
export interface _SERVICE {
  'claim_region' : ActorMethod<
    [{ 'x0' : bigint, 'x1' : bigint, 'y0' : bigint, 'y1' : bigint }],
    undefined
  >,
  'get_canvas_chunk' : ActorMethod<
    [bigint, bigint, bigint, bigint],
    Uint32Array | number[]
  >,
  'get_pixels' : ActorMethod<
    [bigint, bigint, bigint, bigint],
    Array<PixelInfo>
  >,
  'link_at' : ActorMethod<[{ 'x' : bigint, 'y' : bigint }], [] | [string]>,
  'paint_region' : ActorMethod<
    [
      { 'x0' : bigint, 'x1' : bigint, 'y0' : bigint, 'y1' : bigint },
      Uint32Array | number[],
    ],
    undefined
  >,
  'set_region_link' : ActorMethod<
    [{ 'x0' : bigint, 'x1' : bigint, 'y0' : bigint, 'y1' : bigint }, string],
    undefined
  >,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
