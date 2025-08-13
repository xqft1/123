export const idlFactory = ({ IDL }) => {
  const PixelInfo = IDL.Record({
    'x' : IDL.Nat,
    'y' : IDL.Nat,
    'link' : IDL.Opt(IDL.Text),
    'color' : IDL.Nat32,
  });
  return IDL.Service({
    'claim_region' : IDL.Func(
        [
          IDL.Record({
            'x0' : IDL.Nat,
            'x1' : IDL.Nat,
            'y0' : IDL.Nat,
            'y1' : IDL.Nat,
          }),
        ],
        [],
        [],
      ),
    'get_canvas_chunk' : IDL.Func(
        [IDL.Nat, IDL.Nat, IDL.Nat, IDL.Nat],
        [IDL.Vec(IDL.Nat32)],
        ['query'],
      ),
    'get_pixels' : IDL.Func(
        [IDL.Nat, IDL.Nat, IDL.Nat, IDL.Nat],
        [IDL.Vec(PixelInfo)],
        ['query'],
      ),
    'link_at' : IDL.Func(
        [IDL.Record({ 'x' : IDL.Nat, 'y' : IDL.Nat })],
        [IDL.Opt(IDL.Text)],
        ['query'],
      ),
    'paint_region' : IDL.Func(
        [
          IDL.Record({
            'x0' : IDL.Nat,
            'x1' : IDL.Nat,
            'y0' : IDL.Nat,
            'y1' : IDL.Nat,
          }),
          IDL.Vec(IDL.Nat32),
        ],
        [],
        [],
      ),
    'set_region_link' : IDL.Func(
        [
          IDL.Record({
            'x0' : IDL.Nat,
            'x1' : IDL.Nat,
            'y0' : IDL.Nat,
            'y1' : IDL.Nat,
          }),
          IDL.Text,
        ],
        [],
        [],
      ),
  });
};
export const init = ({ IDL }) => { return []; };
