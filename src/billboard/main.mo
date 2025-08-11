// src/billboard/main.mo
import Prim "mo:prim";
import Principal "mo:base/Principal";
import Array "mo:base/Array";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Nat8 "mo:base/Nat8";
import Text "mo:base/Text";

actor {

  // ---------- CONFIG ----------
  let WIDTH  : Nat = 1000;
  let HEIGHT : Nat = 1000;
  let NPIX   : Nat = WIDTH * HEIGHT;

  // ---------- STABLE STORAGE ----------
  // RGBA per pixel (0xRRGGBBAA as Nat32). Initialize to opaque white.
  stable var colors : [var Nat32] = Array.init<Nat32>(NPIX, 0xFFFFFFFF);

  // Ownership: for each pixel, 0 = unowned, otherwise an index into `ownersTable` (1-based)
  // We avoid storing a Principal per pixel to keep memory lower; instead we store a compact id.
  stable var ownerId : [var Nat32] = Array.init<Nat32>(NPIX, 0);

  // Owners table (index 0 reserved / unused).
  stable var ownersTable : [var Principal] = [var Principal.fromText("aaaaa-aa")]; // dummy placeholder at index 0

  // Links: each pixel stores a link id (0 = none). The table stores unique links; 0 is reserved ""
  stable var linkId   : [var Nat32] = Array.init<Nat32>(NPIX, 0);
  stable var linksTbl : [var Text]   = [var ""];

  // ---------- INTERNAL HELPERS ----------
  func idx(x : Nat, y : Nat) : Nat {
    x + y * WIDTH
  };

  func clamp(v : Nat, max : Nat) : Nat { if (v >= max) max - 1 else v };

  func ensureOwnerId(p : Principal) : Nat32 {
    // Linear scan (small in practice). Could be replaced by a hash map later.
    var i : Nat = 0;
    label L for (own in Iter.range(0, ownersTable.size() - 1)) {
      if (ownersTable[own] == p) { return Nat32.fromNat(own) };
      i += 1;
    };
    // Not found, append
    ownersTable := Array.tabulateVar<Principal>(ownersTable.size() + 1, func(i2 : Nat) : Principal {
      if (i2 < ownersTable.size()) ownersTable[i2] else p
    });
    return Nat32.fromNat(ownersTable.size() - 1);
  };

  func linkIdFor(url : Text) : Nat32 {
    // Return existing id if present; otherwise append.
    var i : Nat = 0;
    label L for (li in Iter.range(0, linksTbl.size() - 1)) {
      if (linksTbl[li] == url) { return Nat32.fromNat(li) };
      i += 1;
    };
    linksTbl := Array.tabulateVar<Text>(linksTbl.size() + 1, func(i2 : Nat) : Text {
      if (i2 < linksTbl.size()) linksTbl[i2] else url
    });
    return Nat32.fromNat(linksTbl.size() - 1);
  };

  func nat32ToBytesLE(n : Nat32) : [Nat8] {
    let b0 = Nat8.fromNat(Nat32.toNat(n & 0xFF));
    let b1 = Nat8.fromNat(Nat32.toNat((n >> 8) & 0xFF));
    let b2 = Nat8.fromNat(Nat32.toNat((n >> 16) & 0xFF));
    let b3 = Nat8.fromNat(Nat32.toNat((n >> 24) & 0xFF));
    [b0, b1, b2, b3]
  };

  // ---------- PUBLIC QUERIES ----------

  /// Return a chunk of the canvas as a Blob of RGBA bytes (little-endian u32 per pixel).
  public query func get_canvas_chunk(x0 : Nat, y0 : Nat, w : Nat, h : Nat) : async Blob {
    if (w == 0 or h == 0) { return Blob.fromArray([]) };
    let xStart = x0;
    let yStart = y0;
    let xEnd = Nat.min(x0 + w, WIDTH);
    let yEnd = Nat.min(y0 + h, HEIGHT);
    let outLen : Nat = (xEnd - xStart) * (yEnd - yStart) * 4;
    var out : [var Nat8] = Array.init<Nat8>(outLen, 0);
    var k : Nat = 0;
    var y : Nat = yStart;
    while (y < yEnd) {
      var x : Nat = xStart;
      while (x < xEnd) {
        let c = colors[idx(x, y)];
        let bytes = nat32ToBytesLE(c);
        out[k] := bytes[0];
        out[k+1] := bytes[1];
        out[k+2] := bytes[2];
        out[k+3] := bytes[3];
        k += 4;
        x += 1;
      };
      y += 1;
    };
    Blob.fromArray(Array.freeze(out))
  };

  /// Return the link (if any) at a specific coordinate.
  public query func get_link_at(x : Nat, y : Nat) : async ?Text {
    if (x >= WIDTH or y >= HEIGHT) { return null };
    let id = linkId[idx(x, y)];
    if (id == 0) { return null };
    ?linksTbl[Nat32.toNat(id)]
  };

  /// Optional: who owns a particular pixel (for debugging / UI badges)
  public query func get_owner_at(x : Nat, y : Nat) : async ?Principal {
    if (x >= WIDTH or y >= HEIGHT) { return null };
    let oid = ownerId[idx(x, y)];
    if (oid == 0) { return null };
    ?ownersTable[Nat32.toNat(oid)]
  };

  // ---------- PUBLIC UPDATE (ATOMIC COMMIT) ----------

  /// Commit a rectangle of pixels with a single (optional) link for the whole rect.
  /// Enforces single-ownership forever: once set, only the original owner can update their pixels.
  /// `packed` is row-major RGBA u32 values length = (x1-x0+1)*(y1-y0+1)
  public shared ({ caller }) func commit_pixels_and_link(x0 : Nat, y0 : Nat, x1 : Nat, y1 : Nat, packed : [Nat32], link : ?Text) : async { ok : Bool; err : ?Text } {
    if (x0 > x1 or y0 > y1) { return { ok = false; err = ? "invalid rect" } };
    if (x1 >= WIDTH or y1 >= HEIGHT) { return { ok = false; err = ? "rect out of bounds" } };
    let w = x1 - x0 + 1;
    let h = y1 - y0 + 1;
    if (packed.size() != w * h) {
      return { ok = false; err = ? "packed length does not match area" };
    };

    // First pass: verify ownership
    let oid = ensureOwnerId(caller);
    var i : Nat = 0;
    var y : Nat = y0;
    while (y <= y1) {
      var x : Nat = x0;
      while (x <= x1) {
        let p = idx(x, y);
        let curr = ownerId[p];
        if (curr != 0 and curr != oid) {
          return { ok = false; err = ? "some pixels already owned by another user" };
        };
        x += 1;
      };
      y += 1;
    };

    // Second pass: commit color + ownership + link
    let lid : Nat32 = switch (link) {
      case null 0;
      case (?t) { if (Text.size(t) == 0) 0 else linkIdFor(t) };
    };
    i := 0;
    y := y0;
    while (y <= y1) {
      var x2 : Nat = x0;
      while (x2 <= x1) {
        let p = idx(x2, y);
        colors[p] := packed[i];
        ownerId[p] := oid;
        if (lid != 0) { linkId[p] := lid };
        i += 1;
        x2 += 1;
      };
      y += 1;
    };

    { ok = true; err = null }
  };

  // Backward-compatibility aliases (the UI may try different names)
  public shared ({ caller }) func claim_and_paint(x0 : Nat, y0 : Nat, x1 : Nat, y1 : Nat, packed : [Nat32], link : ?Text) : async { ok : Bool; err : ?Text } {
    await commit_pixels_and_link(x0, y0, x1, y1, packed, link)
  };
  public shared ({ caller }) func commit_and_link(x0 : Nat, y0 : Nat, x1 : Nat, y1 : Nat, packed : [Nat32], link : ?Text) : async { ok : Bool; err : ?Text } {
    await commit_pixels_and_link(x0, y0, x1, y1, packed, link)
  };

} // actor
