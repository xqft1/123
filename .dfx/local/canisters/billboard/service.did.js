export const idlFactory = ({ IDL }) => {
  const Billboard = IDL.Service({
    'admin_set_ledger' : IDL.Func([IDL.Principal], [], []),
    'admin_set_price_per_pixel_e8s' : IDL.Func([IDL.Nat], [], []),
    'admin_set_recipient' : IDL.Func(
        [
          IDL.Record({
            'owner' : IDL.Principal,
            'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
          }),
        ],
        [],
        [],
      ),
    'claim_pixels' : IDL.Func(
        [IDL.Vec(IDL.Nat32), IDL.Opt(IDL.Text)],
        [IDL.Record({ 'cost_paid_e8s' : IDL.Nat, 'claimed' : IDL.Nat32 })],
        [],
      ),
    'get_canvas_chunk' : IDL.Func(
        [IDL.Nat32, IDL.Nat32, IDL.Nat32, IDL.Nat32],
        [IDL.Vec(IDL.Nat32)],
        ['query'],
      ),
    'ledger_canister' : IDL.Func([], [IDL.Principal], ['query']),
    'link_for_pixel' : IDL.Func([IDL.Nat32], [IDL.Opt(IDL.Text)], ['query']),
    'paint' : IDL.Func(
        [IDL.Vec(IDL.Record({ 'color' : IDL.Nat32, 'index' : IDL.Nat32 }))],
        [],
        [],
      ),
    'price_per_pixel_e8s' : IDL.Func([], [IDL.Nat], ['query']),
    'recipient_account' : IDL.Func(
        [],
        [
          IDL.Record({
            'owner' : IDL.Principal,
            'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
          }),
        ],
        ['query'],
      ),
    'set_link' : IDL.Func([IDL.Opt(IDL.Text)], [], []),
  });
  return Billboard;
};
export const init = ({ IDL }) => { return []; };
