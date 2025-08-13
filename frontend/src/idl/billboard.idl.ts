// Minimal Candid IDL for the billboard canister
// Keep in sync with your on-chain interface
export const idlFactory = ({ IDL }) => {
  const Nat32 = IDL.Nat32
  const PixelPair = IDL.Record({ index: Nat32, color: IDL.Nat32 })
  const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) })
  return IDL.Service({
    get_canvas_chunk: IDL.Func([IDL.Nat32, IDL.Nat32, IDL.Nat32, IDL.Nat32], [IDL.Vec(IDL.Nat32)], ['query']),
    link_for_pixel: IDL.Func([IDL.Nat32], [IDL.Opt(IDL.Text)], ['query']),
    price_per_pixel_e8s: IDL.Func([], [IDL.Nat], ['query']),
    recipient_account: IDL.Func([], [Account], ['query']),
    ledger_canister: IDL.Func([], [IDL.Principal], ['query']),
    claim_pixels: IDL.Func([IDL.Vec(IDL.Nat32), IDL.Opt(IDL.Text)], [IDL.Record({ claimed: IDL.Nat32, cost_paid_e8s: IDL.Nat })], []),
    paint: IDL.Func([IDL.Vec(PixelPair)], [], []),
    set_link: IDL.Func([IDL.Opt(IDL.Text)], [], [])
  })
}
