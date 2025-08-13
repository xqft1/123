// frontend/src/idl/ledger.idl.ts
// ICP Ledger (ICRC-1) IDL — minimal surface needed by the app.
// Methods covered:
//  - icrc1_symbol, icrc1_decimals, icrc1_fee, icrc1_metadata,
//    icrc1_supported_standards, icrc1_balance_of, icrc1_transfer
//  - legacy: account_balance_dfx
//
// IMPORTANT: icrc1_balance_of uses the canonical shape:
//   icrc1_balance_of: ({ account: { owner: principal; subaccount: opt vec nat8 } }) -> (nat) query

import type { IDL } from '@dfinity/candid'

export const idlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  // ----- Common types -----
  const Subaccount = IDL.Opt(IDL.Vec(IDL.Nat8))
  const Account = IDL.Record({
    owner: IDL.Principal,
    subaccount: Subaccount,
  })

  // Recursive MetadataValue for icrc1_metadata
  const Value: any = IDL.Rec()
  const MapEntry = IDL.Record({ key: IDL.Text, value: Value })
  Value.fill(
    IDL.Variant({
      Nat: IDL.Nat,
      Int: IDL.Int,
      Text: IDL.Text,
      Blob: IDL.Vec(IDL.Nat8),
      Array: IDL.Vec(Value),
      Map: IDL.Vec(MapEntry),
    })
  )

  const SupportedStandard = IDL.Record({
    name: IDL.Text,
    url: IDL.Text,
  })

  // ----- ICRC-1 transfer argument & error -----
  const TransferArg = IDL.Record({
    from_subaccount: Subaccount,
    to: Account,
    amount: IDL.Nat,
    fee: IDL.Opt(IDL.Nat),
    memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
    created_at_time: IDL.Opt(IDL.Nat64),
  })

  const TransferError = IDL.Variant({
    BadFee: IDL.Record({ expected_fee: IDL.Nat }),
    BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
    InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
    TooOld: IDL.Null,
    CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
    Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
    TemporarilyUnavailable: IDL.Null,
    GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
  })

  const TransferResult = IDL.Variant({ Ok: IDL.Nat, Err: TransferError })

  // ----- Legacy NNS balance type -----
  const Tokens = IDL.Record({ e8s: IDL.Nat64 })

  return IDL.Service({
    // ICRC-1 base
    icrc1_name: IDL.Func([], [IDL.Text], ['query']),
    icrc1_symbol: IDL.Func([], [IDL.Text], ['query']),
    icrc1_decimals: IDL.Func([], [IDL.Nat8], ['query']),
    icrc1_total_supply: IDL.Func([], [IDL.Nat], ['query']),
    icrc1_fee: IDL.Func([], [IDL.Nat], ['query']),
    icrc1_metadata: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Text, Value))], ['query']),
    icrc1_supported_standards: IDL.Func([], [IDL.Vec(SupportedStandard)], ['query']),

    // Canonical balance_of shape: { account: Account }
    icrc1_balance_of: IDL.Func([IDL.Record({ account: Account })], [IDL.Nat], ['query']),

    // ICRC-1 transfer (returns block index as Nat on Ok)
    icrc1_transfer: IDL.Func([TransferArg], [TransferResult], []),

    // Legacy NNS helper (fallback path in app):
    // Takes Account Identifier (blob) and returns { e8s : nat64 }
    account_balance_dfx: IDL.Func([IDL.Record({ account: IDL.Vec(IDL.Nat8) })], [Tokens], ['query']),
  })
}

export const init: IDL.Init = ({ IDL }) => {
  // ICP ledger canister has empty init for interface binding.
  return []
}

