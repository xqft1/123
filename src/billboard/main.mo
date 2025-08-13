import HashMap "mo:base/HashMap";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Option "mo:base/Option";
import Text "mo:base/Text";
import Array "mo:base/Array";

actor Billboard {
  // Use a named constant for the empty/white pixel
  let EMPTY : Nat32 = 4294967295; // 0xFFFFFFFF

  // Custom hash function for Nat (since Nat.hash is unavailable in moc 0.28.0)
  private func natHash(n : Nat) : Nat32 {
    // Simple hash: convert Nat to Nat32 (truncate if needed)
    Nat32.fromNat(n)
  };

  // Stable array to store pixel data, matching previous name
  stable var pixelEntries : [(Nat, { color: Nat32; link: ?Text })] = [];

  // Non-stable HashMap for runtime access
  var pixels = HashMap.HashMap<Nat, { color: Nat32; link: ?Text }>(
    0,
    Nat.equal,
    natHash // Use custom hash function
  );

  // Initialize HashMap from pixelEntries
  private func initPixels() {
    pixels := HashMap.fromIter<Nat, { color: Nat32; link: ?Text }>(
      pixelEntries.vals(),
      0,
      Nat.equal,
      natHash // Use custom hash function
    );
  };

  // Run initialization
  initPixels();

  // Migration functions for stable storage
  system func preupgrade() {
    pixelEntries := Iter.toArray(pixels.entries());
  };

  system func postupgrade() {
    initPixels();
    pixelEntries := []; // Clear to save space
  };

  private func getIndex(x: Nat, y: Nat) : Nat {
    y * 1000 + x
  };

  public shared func claim_region(rect : { x0: Nat; y0: Nat; x1: Nat; y1: Nat }) : async () {
    for (y in Iter.range(rect.y0, rect.y1)) {
      for (x in Iter.range(rect.x0, rect.x1)) {
        let idx = getIndex(x, y);
        switch (pixels.get(idx)) {
          case (?pixel) {
            if (pixel.color != EMPTY or pixel.link != null) {
              assert false;
            };
          };
          case null {};
        };
      };
    };
  };

  public shared func paint_region(rect : { x0: Nat; y0: Nat; x1: Nat; y1: Nat }, payload : [Nat32]) : async () {
    var i = 0;
    for (y in Iter.range(rect.y0, rect.y1)) {
      for (x in Iter.range(rect.x0, rect.x1)) {
        let idx = getIndex(x, y);
        let current = Option.get(pixels.get(idx), { color = EMPTY; link = null });
        pixels.put(idx, { color = payload[i]; link = current.link });
        i += 1;
      };
    };
  };

  public shared func set_region_link(rect : { x0: Nat; y0: Nat; x1: Nat; y1: Nat }, link : Text) : async () {
    for (y in Iter.range(rect.y0, rect.y1)) {
      for (x in Iter.range(rect.x0, rect.x1)) {
        let idx = getIndex(x, y);
        let current = Option.get(pixels.get(idx), { color = EMPTY; link = null });
        pixels.put(idx, { color = current.color; link = ?link });
      };
    };
  };

  public query func link_at(pos : { x: Nat; y: Nat }) : async ?Text {
    let idx = getIndex(pos.x, pos.y);
    switch (pixels.get(idx)) {
      case (?pixel) { pixel.link };
      case null { null };
    };
  };

  public query func get_canvas_chunk(startX: Nat, startY: Nat, width: Nat, height: Nat) : async [Nat32] {
    var res : [var Nat32] = Array.init<Nat32>(width * height, EMPTY);
    var i = 0;
    for (y in Iter.range(startY, startY + height - 1)) {
      for (x in Iter.range(startX, startX + width - 1)) {
        let idx = getIndex(x, y);
        switch (pixels.get(idx)) {
          case (?pixel) { res[i] := pixel.color };
          case null { res[i] := EMPTY };
        };
        i += 1;
      };
    };
    Array.freeze(res)
  };

  // Type alias to avoid syntax issues with array of records
  type PixelInfo = { x: Nat; y: Nat; color: Nat32; link: ?Text };

  public query func get_pixels(startX: Nat, startY: Nat, width: Nat, height: Nat) : async [PixelInfo] {
    var res : [var PixelInfo] = Array.init<PixelInfo>(width * height, { x = 0; y = 0; color = EMPTY; link = null });
    var i = 0;
    for (dy in Iter.range(0, height - 1)) {
      for (dx in Iter.range(0, width - 1)) {
        let x = startX + dx;
        let y = startY + dy;
        let idx = getIndex(x, y);
        let pixel = Option.get(pixels.get(idx), { color = EMPTY; link = null });
        res[i] := { x = x; y = y; color = pixel.color; link = pixel.link };
        i += 1;
      };
    };
    Array.freeze(res)
  };
};