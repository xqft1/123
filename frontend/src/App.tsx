import React, { useEffect, useRef } from 'react'
import { AuthClient } from '@dfinity/auth-client'
import { Actor, HttpAgent } from '@dfinity/agent'
import { Principal } from '@dfinity/principal'
import { idlFactory as billboardIDL } from './idl/billboard.idl'
import { idlFactory as ledgerIDL } from './idl/ledger.idl'
import { IcrcLedgerCanister } from "@dfinity/ledger-icrc";
import { AccountIdentifier } from "@dfinity/ledger-icp";

// Minimal drop-in replacement for createAgent (avoids extra deps)
async function createAgent(opts: { identity: any; host: string }) {
  const agent = new HttpAgent({ identity: opts.identity, host: opts.host });
  // If using a local replica: await (agent as any).fetchRootKey?.();
  return agent;
}


/** ---------- Canvas config ---------- **/
const WIDTH = 1000
const HEIGHT = 1000
const TILE = 125
const CLAIM_SLICE = 4000
const PAINT_SLICE = 2000

/** ---------- Pricing ---------- **/
/** 0.01 ICP / pixel = 1_000_000 e8s */
const PRICE_E8S: bigint = 1_000_000n

/** Persist selection this session */
const SELECTION_KEY = 'ombb.selection'

/** Receiver (owner) — for transfers only */
const OWNER_RECEIVER = Principal.fromText('o72d6-axkp7-lv7lv-24bj5-vldpt-tqd2q-3f3n6-5wdn6-tizzq-ubugz-bae')

/** Boundary hosts to probe (order matters) */
const HOSTS = [
  'https://icp-api.io',
  'https://ic0.app',
  'https://boundary.ic0.app'
]

/** Ledger canister id (ICP ICRC-1) */
const LEDGER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai'

const ICP_LEDGER_CANISTER_ID = "ryjl3-tyaaa-aaaaa-aaaba-cai";
const ICP_AGENT_HOST = "https://icp-api.io";


type Rect = { x0: number; y0: number; x1: number; y1: number }

export default function App() {
  /** Actors / identity */
  const billboardRef = useRef<any>(null)

  // ---------- Robust on-chain commit with verification & sticky host ----------
  async function commitPixelsAndLinkReliable(a: any, rect: Rect, work: HTMLCanvasElement | null, linkVal: string) {
    // Helper: pack canvas -> u32 AARRGGBB
    const packWorkToU32 = (c: HTMLCanvasElement) => {
      const { width: w, height: h } = c
      const data = c.getContext('2d')!.getImageData(0,0,w,h).data
      const u32 = new Uint32Array(w*h)
      for (let i=0, j=0; i<data.length; i+=4, j++) {
        u32[j] = (255<<24) | (data[i] << 16) | (data[i+1] << 8) | (data[i+2])
      }
      return u32
    }
    const has = (name: string) => typeof (a as any)?.[name] === 'function'
    const idxsFromRect = (r: Rect) => {
      const res: number[] = []
      for (let y=r.y0; y<=r.y1; y++) for (let x=r.x0; x<=r.x1; x++) res.push(y*WIDTH + x)
      return res
    }

    // 0) Use the same boundary host for ~90s after payment (avoid stale read)
    try { stickyHostExpiryRef.current = Date.now() + 90_000 } catch {}

    // 1) Claim region (permanent)
    if (has('claim_region')) {
      await (a as any).claim_region(rect)
    } else if (has('claim')) {
      await (a as any).claim(rect)
    } else if (has('claim_pixels')) {
      await (a as any).claim_pixels(idxsFromRect(rect))
    }

    // 2) Paint pixels
    if (work) {
      const payload = Array.from(packWorkToU32(work))
      if (has('paint_region')) {
        await (a as any).paint_region(rect, payload)
      } else if (has('paint')) {
        await (a as any).paint(rect, payload)
      } else if (has('paint_pixels')) {
        await (a as any).paint_pixels(idxsFromRect(rect), payload)
      }
    }

    // 3) Persist link
    if (linkVal && /^https?:\/\//.test(linkVal)) {
      const idxs = idxsFromRect(rect)
      if (has('set_region_link')) {
        await (a as any).set_region_link(rect, linkVal)
      } else if (has('set_link')) {
        await (a as any).set_link(rect, linkVal)
      } else if (has('link_region')) {
        await (a as any).link_region(rect, linkVal)
      } else if (has('set_links')) {
        await (a as any).set_links(idxs, linkVal)
      }
    }

    // 4) Verify: poll same host until both color & link reflect
    const sameHostAgent = async () => {
      return a
    }
    const eqColor = async () => {
      try {
        await drawSingleShot(a)
        return true
      } catch { return false }
    }
    const checkLinkAt = async (): Promise<boolean> => {
      try {
        const cx = Math.floor((rect.x0 + rect.x1)/2)
        const cy = Math.floor((rect.y0 + rect.y1)/2)
        let url: string | null = null
        if (typeof (a as any).link_at === 'function') {
          url = await (a as any).link_at({ x: cx, y: cy })
        } else if (typeof (a as any).get_link === 'function') {
          url = await (a as any).get_link({ x: cx, y: cy })
        } else {
          return true
        }
        return !!url && (!linkVal || url === linkVal || url.startsWith(linkVal))
      } catch { return false }
    }

    const started = Date.now()
    const timeout = 20000
    while (Date.now() - started < timeout) {
      await sameHostAgent()
      const okColor = await eqColor()
      const okLink = await checkLinkAt()
      if (okColor && okLink) return
      await new Promise(r=>setTimeout(r, 1000))
    }
    console.warn('[commit verify] timed out; proceeding anyway')
  }
  const ledgerRef = useRef<any>(null)
  const principalRef = useRef<Principal | null>(null)
  /** Keep identity to rebuild agents if needed */
  const identityRef = useRef<any>(null)
  const agentHostRef = useRef<string | null>(null)
  const stickyHostRef = useRef<string | null>(null)
  const stickyHostExpiryRef = useRef<number>(0)

  /** Wallet + selection state */
  const balanceE8sRef = useRef<bigint>(0n)
  const selectionRef = useRef<Rect | null>(null)
  const pendingPreviewRef = useRef<{ rect: Rect; work: HTMLCanvasElement } | null>(null)
  const pendingPayRef = useRef(false)

  /** UI refs */
  const previewBarRef = useRef<HTMLDivElement | null>(null)
  const metaRef = useRef<HTMLSpanElement | null>(null)
  const linkInputRef = useRef<HTMLInputElement | null>(null)
  const payBtnRef = useRef<HTMLButtonElement | null>(null)
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null)

  /** Balance poller */
  const balanceTimer = useRef<number | null>(null)

  /** Billboard canister id (from Vite env) */
  const billboardId = import.meta.env.VITE_BILLBOARD_CANISTER_ID as string
  if (!billboardId) console.error('VITE_BILLBOARD_CANISTER_ID is missing')

  useEffect(() => {
    ;(async () => {
      ensureStaticUI()
      ensureCanvases()
      ensurePurchaseUI()

      // Anonymous draw (fast) with host probe
      try {
        const { agent } = await connectBestHost()
        const anonActor = Actor.createActor(billboardIDL as any, { agent, canisterId: billboardId })
        try { await drawSingleShot(anonActor) } catch { await drawTilesParallel(anonActor) }
      } catch (e) {
        console.warn('Anonymous draw failed:', e)
      }

      // Restore selection
      const restored = loadSelection()
      if (restored) { setSelection(restored); drawSelectionMarquee(restored) }

      wireSelectionHandlers()
      wireButtons()

      // Purchase bar hooks
      if (payBtnRef.current && !(payBtnRef.current as any).__wired) {
        (payBtnRef.current as any).__wired = true
        payBtnRef.current.addEventListener('click', () => {
          if (pendingPayRef.current) return
          applyPay()
        })
      }
      cancelBtnRef.current?.addEventListener('click', () => {
        clearPreview(); pendingPreviewRef.current = null; dispatchPreviewOff()
        updatePurchaseUI(selectionRef.current, false)
      })

      // Auth
      const auth = await AuthClient.create()
      if (await auth.isAuthenticated()) await finishLogin(auth)
      else updateSigninUI(false)
    })()

    // Global login/signout hooks
    const onLogin = () => { login() }
    const onSignout = async () => {
      const auth = await AuthClient.create()
      await auth.logout()
      billboardRef.current = null
      ledgerRef.current = null
      principalRef.current = null
      agentHostRef.current = null
      balanceE8sRef.current = 0n
      if (balanceTimer.current) { clearInterval(balanceTimer.current); balanceTimer.current = null }
      updateSigninUI(false)
      updateAddressUI()
      setBalanceText('—') // clear
      clearPreview()
      pendingPreviewRef.current = null
      dispatchPreviewOff()
      updatePurchaseUI(selectionRef.current, false)
      toast('Signed out', 'info')
    }
    window.addEventListener('ic:login', onLogin as EventListener)
    window.addEventListener('ic:signout', onSignout as EventListener)

    return () => {
      window.removeEventListener('ic:login', onLogin as EventListener)
      window.removeEventListener('ic:signout', onSignout as EventListener)
      if (balanceTimer.current) { clearInterval(balanceTimer.current); balanceTimer.current = null }
    }
  }, [])

  // Wire public click-through once on mount
  useEffect(() => { try { wirePublicClickThru() } catch {} }, [])

  /** ---------- UI skeleton guards (hard fix) ---------- */
  function ensureStaticUI() {
    // Balance line
    if (!document.getElementById('balance')) {
      const host = document.querySelector('#walletPanel') || document.body
      const div = document.createElement('div')
      div.id = 'balance'
      div.className = 'muted'
      div.textContent = 'Balance: — ICP'
      host.insertBefore(div, host.firstChild)
    }
    // Address line
    if (!document.getElementById('walletAddr')) {
      const el = document.createElement('span')
      el.id = 'walletAddr'
      el.textContent = '—'
      document.body.appendChild(el)
    }
  }

  /** ---------------- Auth ---------------- */
  async function login() {
    const auth = await AuthClient.create()
    await auth.login({
      identityProvider: 'https://identity.ic0.app/#authorize',
      onSuccess: async () => { await finishLogin(auth) }
    })
  }

  async function finishLogin(auth: AuthClient) {
    const identity = auth.getIdentity()
    const principal = identity.getPrincipal()
    principalRef.current = principal

    // keep identity for later agent rebuilds
    identityRef.current = identity

    updateSigninUI(true, principal.toText())
    updateAddressUI()

    // Show loading state immediately
    setBalanceText('loading…')

    // Create actors with the best responding host
    const { agent, host } = await connectBestHost(identity)
    agentHostRef.current = host
    billboardRef.current = Actor.createActor(billboardIDL as any, { agent, canisterId: billboardId })
    ledgerRef.current = Actor.createActor(ledgerIDL as any, { agent, canisterId: LEDGER_ID })

    await ensureLedgerReady(ledgerRef.current, host)

    // First refresh: HARD with rotation & timeout
    await refreshBalance({ hardRetry: true })

    // Poll balance every 15s
    if (balanceTimer.current) clearInterval(balanceTimer.current)
    balanceTimer.current = window.setInterval(() => { refreshBalance({}).catch(()=>{}) }, 15000)

    updatePurchaseUI(selectionRef.current, !!pendingPreviewRef.current)
    toast('Signed in', 'success')
  }

  
  /** Host probing with sticky host (avoids stale reads after writes) */
  
async function connectBestHost(
  identity?: any,
  skipHost?: string
): Promise<{ agent: HttpAgent; host: string }> {
  // Prefer sticky host for a short window
  if (stickyHostRef.current && Date.now() < stickyHostExpiryRef.current) {
    const host = stickyHostRef.current as string;
    const agent = await createAgent({ identity, host });
    try {
      const testLedger = Actor.createActor(ledgerIDL as any, { agent, canisterId: LEDGER_ID });
      await withTimeout(testLedger.icrc1_symbol(), 2500);
      agentHostRef.current = host;
      return { agent, host };
    } catch (e) {
      console.warn('[HOST sticky failed, falling back to probe]', host, e);
    }
  }

  const list = HOSTS.filter(h => h !== skipHost);
  let lastErr: any = null;
  for (const host of list) {
    try {
      const agent = await createAgent({ identity, host });
      const testLedger = Actor.createActor(ledgerIDL as any, { agent, canisterId: LEDGER_ID });
      await withTimeout(testLedger.icrc1_symbol(), 2500);
      agentHostRef.current = host;
      return { agent, host };
    } catch (e) {
      lastErr = e;
      console.warn('[HOST probe failed]', host, e);
    }
  }
  throw lastErr ?? new Error('All boundary hosts failed');
}


  async function ensureLedgerReady(ledger: any, host: string) {
    try {
      if (typeof ledger?.icrc1_symbol !== 'function' || typeof ledger?.icrc1_balance_of !== 'function') {
        throw new Error('Ledger IDL missing ICRC-1 methods')
      }
      const [sym, dec] = await Promise.all([
        withTimeout(ledger.icrc1_symbol(), 2500),
        withTimeout(ledger.icrc1_decimals(), 2500)
      ])
      console.log('[ICRC1] host:', host, 'symbol:', sym, 'decimals:', dec)
    } catch (e) {
      console.warn('Ledger check failed on host', host, e)
      const id = principalRef.current ? (await AuthClient.create()).getIdentity() : undefined
      const alt = await connectBestHost(id, host)
      agentHostRef.current = alt.host
      ledgerRef.current = Actor.createActor(ledgerIDL as any, { agent: alt.agent, canisterId: LEDGER_ID })
      billboardRef.current = Actor.createActor(billboardIDL as any, { agent: alt.agent, canisterId: import.meta.env.VITE_BILLBOARD_CANISTER_ID })
      const [sym, dec] = await Promise.all([
        withTimeout(ledgerRef.current.icrc1_symbol(), 2500),
        withTimeout(ledgerRef.current.icrc1_decimals(), 2500)
      ])
      console.log('[ICRC1:retied] host:', alt.host, 'symbol:', sym, 'decimals:', dec)
    }
  }

  function updateSigninUI(signedIn: boolean, principalText?: string) {
    const btn = document.getElementById('btn-login') as HTMLElement | null
    const who = document.getElementById('who') as HTMLElement | null
    if (!btn || !who) return
    if (signedIn) { btn.classList.add('signed-in'); btn.textContent = '🟢 Signed in'; who.textContent = principalText || who.textContent || '' }
    else { btn.classList.remove('signed-in'); btn.textContent = 'Sign in'; who.textContent = 'Not signed in' }
  }

  function updateAddressUI() {
    const your = principalRef.current?.toText() ?? '—'
    const yourEl = document.getElementById('walletAddr')
    if (yourEl) yourEl.textContent = your
  }

  /** --------------- Balance (ICRC-1) with hard retry + timeouts --------------- */
  async function refreshBalance(opts: { hardRetry?: boolean } = {}) {
    const owner = principalRef.current
    if (!owner) return

    const doOnce = async () => {
      await ensureLedgerReady(ledgerRef.current, agentHostRef.current || '(unknown)')
      try {
      const e8s = await withTimeout(
        ledgerRef.current.icrc1_balance_of({ account: { owner, subaccount: [] } }),
        3000
      ) as bigint
      balanceE8sRef.current = e8s
      setBalanceText((Number(e8s) / 1e8).toFixed(4))
      console.log(`[BALANCE] host=${agentHostRef.current} principal=${owner.toText()} e8s=${e8s.toString()}`)
    } catch (primaryErr) {
      try {
        const agent = await createAgent({ identity: identityRef.current, host: agentHostRef.current || HOSTS[0] })
        const { balance } = IcrcLedgerCanister.create({ agent, canisterId: Principal.fromText(LEDGER_ID) })
        const e8s = await balance({ owner, certified: true }) as bigint
        balanceE8sRef.current = e8s ?? 0n
        setBalanceText((Number(e8s ?? 0n) / 1e8).toFixed(4))
        console.log(`[BALANCE:fallback] host=${agentHostRef.current} principal=${owner.toText()} e8s=${(e8s ?? 0n).toString()}`)
      } catch (fallbackErr) {
        console.warn('[BALANCE] both primary and fallback failed', primaryErr, fallbackErr)
        throw fallbackErr
      }
    }
    }

    try {
      setBalanceText('loading…')
      if (!opts.hardRetry) { await doOnce(); }
      else {
        try { await doOnce(); }
        catch (e1) {
          console.warn('[BALANCE] current host failed:', agentHostRef.current, e1)
          let lastErr = e1
          const id = (await AuthClient.create()).getIdentity()
          const tried = new Set<string>(agentHostRef.current ? [agentHostRef.current] : [])
          for (const host of HOSTS) {
            if (tried.has(host)) continue
            try {
              const { agent } = await connectBestHost(id, agentHostRef.current || undefined)
              agentHostRef.current = host
              ledgerRef.current = Actor.createActor(ledgerIDL as any, { agent, canisterId: LEDGER_ID })
              await ensureLedgerReady(ledgerRef.current, host)
              const e8s = await withTimeout(
                ledgerRef.current.icrc1_balance_of({ account: { owner, subaccount: [] } }),
                3000
              ) as bigint
              balanceE8sRef.current = e8s
              setBalanceText((Number(e8s) / 1e8).toFixed(4))
              console.log(`[BALANCE:retied] host=${host} principal=${owner.toText()} e8s=${e8s.toString()}`)
              lastErr = null
              break
            } catch (e2) {
              console.warn('[BALANCE] retry host failed:', host, e2)
              lastErr = e2
              tried.add(host)
            }
          }
          if (lastErr) throw lastErr
        }
      }
    } catch (e: any) {
      console.error('[BALANCE] refresh failed:', e)
      setBalanceText('—') // keep the em dash only on final failure
      toast(`Balance refresh failed: ${String(e?.message || e)}`, 'error')
    }

    updatePurchaseUI(selectionRef.current, !!pendingPreviewRef.current)
  }

  function setBalanceText(text: string | null) {
    const el = document.getElementById('balance'); if (!el) return
    if (text === null) { el.textContent = 'Balance: — ICP'; return }
    if (text === 'loading…') { el.textContent = 'Balance: loading…'; return }
    el.textContent = `Balance: ${text} ICP`
  }

  /** --------------- Draw billboard --------------- */
  async function drawSingleShot(a: any) {
    const colors: number[] = await a.get_canvas_chunk(0, 0, WIDTH, HEIGHT)
    const { ctx } = ensureCanvases()
    const img = ctx.createImageData(WIDTH, HEIGHT)
    let k = 0
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      const base = i * 4
      const rgba = (colors[k++] >>> 0)
      img.data[base + 0] = (rgba >>> 24) & 255
      img.data[base + 1] = (rgba >>> 16) & 255
      img.data[base + 2] = (rgba >>> 8) & 255
      img.data[base + 3] = (rgba >>> 0) & 255
    }
    ctx.putImageData(img, 0, 0)
  }
  async function drawTilesParallel(a: any) {
    const { ctx } = ensureCanvases()
    const tiles: Array<{ x: number; y: number; w: number; h: number }> = []
    for (let y = 0; y < HEIGHT; y += TILE) for (let x = 0; x < WIDTH; x += TILE)
      tiles.push({ x, y, w: Math.min(TILE, WIDTH - x), h: Math.min(TILE, HEIGHT - y) })
    let i = 0
    const concurrency = 16
    const worker = async () => {
      while (i < tiles.length) {
        const t = tiles[i++]
        const colors: number[] = await a.get_canvas_chunk(t.x, t.y, t.w, t.h)
        const img = ctx.createImageData(t.w, t.h)
        let k = 0
        for (let yy = 0; yy < t.h; yy++) for (let xx = 0; xx < t.w; xx++) {
          const base = (yy * t.w + xx) * 4
          const rgba = (colors[k++] >>> 0)
          img.data[base + 0] = (rgba >>> 24) & 255
          img.data[base + 1] = (rgba >>> 16) & 255
          img.data[base + 2] = (rgba >>> 8) & 255
          img.data[base + 3] = (rgba >>> 0) & 255
        }
        ctx.putImageData(img, t.x, t.y)
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()))
  }

  /** ---------- Public click-through to owners' links ---------- */
  async function fetchLinkAt(a: any, x: number, y: number): Promise<string | null> {
  const idx = y * WIDTH + x;
  try {
    if (typeof a?.get_link_at === 'function') {
      const res = await a.get_link_at(x, y);
      const link = Array.isArray(res) ? res[0] : res?.[0];
      return typeof link === 'string' ? link : null;
    }
    if (typeof a?.get_link === 'function') {
      const res = await a.get_link(idx);
      const link = Array.isArray(res) ? res[0] : res?.[0];
      return typeof link === 'string' ? link : null;
    }
    if (typeof a?.get_pixel === 'function') {
      const res = await a.get_pixel(idx);
      const link = res?.link?.[0];
      return typeof link === 'string' ? link : null;
    }
  } catch (e) {
    console.warn('fetchLinkAt failed', e);
  }
  return null;
}

  function wirePublicClickThru() {
    const { base } = ensureCanvases()
    if ((base as any)._ombbClickWired) return
    ;(base as any)._ombbClickWired = true

    base.addEventListener('click', async (ev: MouseEvent) => {
      if (selectionRef.current || pendingPreviewRef.current) return

      let actor = billboardRef.current
      if (!actor) {
        try {
          const { agent } = await connectBestHost()
          actor = Actor.createActor(billboardIDL as any, { agent, canisterId: billboardId })
        } catch {
          return
        }
      }

      const r = base.getBoundingClientRect()
      const sx = base.width / r.width
      const sy = base.height / r.height
      const x = Math.floor((ev.clientX - r.left) * sx)
      const y = Math.floor((ev.clientY - r.top) * sy)
      if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return

      const link = await fetchLinkAt(actor, x, y)
      if (link) window.open(link, '_blank', 'noopener')
    })
  }



  /** --------------- Canvas setup --------------- */
  function ensureCanvases() {
    const mount = document.getElementById('root')!
    if (!document.getElementById('canvas-base')) {
      mount.style.position = 'relative'

      const base = document.createElement('canvas')
      base.id = 'canvas-base'
      base.width = WIDTH; base.height = HEIGHT
      base.style.border = '1px solid #25344c'
      base.style.display = 'block'
      base.style.cursor = 'crosshair'
      base.style.borderRadius = '12px'
      base.style.background = '#ffffff'
      base.style.position = 'relative'
      base.style.zIndex = '0'
      mount.appendChild(base)

      const marquee = document.createElement('canvas')
      marquee.id = 'canvas-marquee'
      marquee.width = WIDTH; marquee.height = HEIGHT
      marquee.style.position = 'absolute'; marquee.style.inset = '0'; marquee.style.pointerEvents = 'none'
      marquee.style.zIndex = '1'
      mount.appendChild(marquee)

      const preview = document.createElement('canvas')
      preview.id = 'canvas-preview'
      preview.width = WIDTH; preview.height = HEIGHT
      preview.style.position = 'absolute'; preview.style.inset = '0'; preview.style.pointerEvents = 'none'
      preview.style.zIndex = '2'
      mount.appendChild(preview)
    }
    const baseEl = document.getElementById('canvas-base') as HTMLCanvasElement
    const marqueeEl = document.getElementById('canvas-marquee') as HTMLCanvasElement
    const previewEl = document.getElementById('canvas-preview') as HTMLCanvasElement
    return {
      base: baseEl,
      ctx: baseEl.getContext('2d')!,
      marquee: marqueeEl,
      mctx: marqueeEl.getContext('2d')!,
      preview: previewEl,
      pctx: previewEl.getContext('2d')!,
    }
  }

  /** --------------- Purchase bar --------------- */
  function ensurePurchaseUI() {
    const bar = document.getElementById('previewBar') as HTMLDivElement | null
    const meta = document.getElementById('previewMeta') as HTMLSpanElement | null
    const apply = document.getElementById('btn-apply-pay') as HTMLButtonElement | null
    const cancel = document.getElementById('btn-preview-cancel') as HTMLButtonElement | null
    previewBarRef.current = bar; metaRef.current = meta; payBtnRef.current = apply; cancelBtnRef.current = cancel

    // URL field next to Pay
    let link = document.getElementById('linkInput') as HTMLInputElement | null
    if (!link && bar) {
      link = document.createElement('input')
      link.type = 'url'
      link.id = 'linkInput'
      link.placeholder = 'https://your-link (required)'
      link.required = true
      link.autocomplete = 'url'
      link.style.marginLeft = '10px'
      link.style.marginRight = '10px'
      link.style.minWidth = '240px'
      link.style.maxWidth = '46vw'
      link.style.padding = '8px 10px'
      link.style.border = '1px solid #233046'
      link.style.borderRadius = '10px'
      link.style.background = '#0e1420'
      link.style.color = '#e6e9ef'
      if (apply && apply.parentElement === bar) bar.insertBefore(link, apply)
      else bar.appendChild(link)
    }
    linkInputRef.current = link

    linkInputRef.current?.addEventListener('input', () => {
      updatePurchaseUI(selectionRef.current, !!pendingPreviewRef.current)
    })

    document.getElementById('balance')?.addEventListener('click', () => refreshBalance({ hardRetry: true }))
  }

  function showPurchaseBar() { previewBarRef.current?.classList.add('show') }
  function hidePurchaseBar() { previewBarRef.current?.classList.remove('show') }

  function updatePurchaseUI(rect: Rect | null, hasPreview: boolean) {
    if (!rect) { hidePurchaseBar(); return }
    showPurchaseBar()

    const pixels = (rect.x1 - rect.x0 + 1) * (rect.y1 - rect.y0 + 1)
    const costE8s = calcCostE8s(rect)
    const affordable = balanceE8sRef.current >= costE8s
    const need = Math.max(0, Number(costE8s - balanceE8sRef.current) / 1e8)

    const base = `${hasPreview ? 'Preview' : 'Selected'} ${pixels} px • Est. ${formatICP(costE8s)} ICP`
    const affordMsg = affordable ? '' : ` • Need ${need.toFixed(4)} ICP`
    metaRef.current && (metaRef.current.textContent = `${base}${affordMsg}`)

    const linkVal = (linkInputRef.current?.value || '').trim()
    const linkValid = isValidHttpUrl(linkVal)
    if (payBtnRef.current) {
      payBtnRef.current.disabled = !linkValid
      payBtnRef.current.title = linkValid ? '' : 'Enter a valid link (http/https)'
    }
    const msg = document.getElementById('affordMsg') as HTMLElement | null
    if (msg) msg.style.display = affordable ? 'none' : 'inline'
  }

  /** --------------- Selection helpers / handlers --------------- */

  function u32FromCanvas(canvas: HTMLCanvasElement): Uint32Array {
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  // The typed array view reuses the RGBA buffer as u32 little-endian
  return new Uint32Array(img.data.buffer);
}

async function commitPixelsAndLink(a: any, rect: {x0:number;y0:number;x1:number;y1:number}, work: HTMLCanvasElement, link: string | null) {
  const candidates = ["commit_pixels_and_link","claim_and_paint","commit_and_link"];
  const u32s = Array.from(u32FromCanvas(work) as unknown as number[]);
  let lastErr: any = null;
  for (const m of candidates) {
    if (typeof (a as any)[m] === 'function') {
      try {
        const res = await (a as any)[m](rect.x0, rect.y0, rect.x1, rect.y1, u32s, link ?? null);
        if (!res || res.ok === true || res.Ok === true) return true;
        if (res.err || res.Err) throw new Error(String(res.err ?? res.Err));
        return true;
      } catch (e) { lastErr = e }
    }
  }
  throw lastErr ?? new Error("No commit method found on canister");
}


  function setSelection(rect: Rect) {
    selectionRef.current = rect
    try { sessionStorage.setItem(SELECTION_KEY, JSON.stringify(rect)) } catch {}
    updatePurchaseUI(rect, !!pendingPreviewRef.current)
  }
  function loadSelection(): Rect | null {
    try {
      const raw = sessionStorage.getItem(SELECTION_KEY)
      if (!raw) return null
      const r = JSON.parse(raw)
      if (Number.isFinite(r.x0) && Number.isFinite(r.y0) && Number.isFinite(r.x1) && Number.isFinite(r.y1)) {
        return normRect(r as Rect)
      }
    } catch {}
    return null
  }
  function nudgeSelect() {
    const base = document.getElementById('canvas-base') as HTMLCanvasElement | null
    if (!base) return
    const old = base.style.borderColor
    base.style.borderColor = '#ff6b6b'
    base.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => { base.style.borderColor = old || '#25344c' }, 650)
  }

  function drawSelectionMarquee(rect: Rect) {
    const { marquee, mctx } = ensureCanvases()
    marquee.width = marquee.width
    mctx.setLineDash([6, 4])
    mctx.strokeStyle = '#00b3ff'
    mctx.lineWidth = 1
    mctx.strokeRect(rect.x0 + 0.5, rect.y0 + 0.5, rect.x1 - rect.x0 + 1, rect.y1 - rect.y0 + 1)
    mctx.fillStyle = 'rgba(0,179,255,0.15)'
    mctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0 + 1, rect.y1 - rect.y0 + 1)

    const w = rect.x1 - rect.x0 + 1, h = rect.y1 - rect.y0 + 1
    const text = `${w}×${h} (${w * h})`
    mctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    const pad = 4, tw = mctx.measureText(text).width
    const tx = Math.min(rect.x0 + 6, WIDTH - tw - pad * 2 - 4)
    const ty = Math.max(rect.y0 - 8, 12)
    mctx.fillStyle = 'rgba(0,0,0,0.6)'
    mctx.fillRect(tx - pad, ty - 12, tw + pad * 2, 16)
    mctx.fillStyle = '#e6e9ef'
    mctx.fillText(text, tx, ty)

    const sc = document.getElementById('selectedCount'); if (sc) sc.textContent = text
  }

  function wireSelectionHandlers() {
    const { base } = ensureCanvases()
    let dragging = false
    let startX = 0, startY = 0

    const getPoint = (evt: MouseEvent | TouchEvent) => {
      const r = base.getBoundingClientRect()
      const t = (evt as TouchEvent).touches?.[0] || (evt as TouchEvent).changedTouches?.[0]
      const clientX = t ? t.clientX : (evt as MouseEvent).clientX
      const clientY = t ? t.clientY : (evt as MouseEvent).clientY
      const x = clamp(Math.floor(clientX - r.left), 0, WIDTH - 1)
      const y = clamp(Math.floor(clientY - r.top), 0, HEIGHT - 1)
      return { x, y }
    }

    const onDown = (e: MouseEvent | TouchEvent) => {
      e.preventDefault()
      const { x, y } = getPoint(e)
      startX = x; startY = y
      dragging = true
      setSelection({ x0: startX, y0: startY, x1: startX, y1: startY })
      drawSelectionMarquee(selectionRef.current!)
    }
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging) return
      const { x, y } = getPoint(e)
      const rect = normRect({ x0: startX, y0: startY, x1: x, y1: y })
      setSelection(rect)
      drawSelectionMarquee(rect)
    }
    const onUp = (e: MouseEvent | TouchEvent) => {
      if (!dragging) return
      dragging = false
      const { x, y } = getPoint(e)
      const rect = normRect({ x0: startX, y0: startY, x1: x, y1: y })
      setSelection(rect)
      drawSelectionMarquee(rect)
      clearPreview(); pendingPreviewRef.current = null; dispatchPreviewOff()
      updatePurchaseUI(rect, false)
    }

    base.addEventListener('mousedown', onDown)
    base.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    base.addEventListener('touchstart', onDown, { passive: false })
    base.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
  }

  /** --------------- Buttons / modals / design --------------- */
  function wireButtons() {
    const loginBtn = document.getElementById('btn-login')
    loginBtn?.addEventListener('click', (e) => {
      const signed = !!principalRef.current
      if (!signed) { e.preventDefault(); login() }
    })

    document.getElementById('btn-claim-link')?.addEventListener('click', () => {
      const sel = selectionRef.current || loadSelection()
      if (!sel) { nudgeSelect(); return }
      linkInputRef.current?.focus()
      openDesignChooser()
    })

    document.getElementById('btn-upload-trigger')?.addEventListener('click', () => {
      const sel = selectionRef.current || loadSelection()
      if (!sel) { nudgeSelect(); return }
      openUploadModal()
    })

    document.getElementById('btn-paint')?.addEventListener('click', () => {
      const sel = selectionRef.current || loadSelection()
      if (!sel) { nudgeSelect(); return }
      openPainter()
    })
  }

  function killModalById(id: string) { const m = document.getElementById(id); if (m) m.remove() }

  function openUploadModal(presetFile?: File) {
    const sel = selectionRef.current || loadSelection()
    if (!sel) { nudgeSelect(); return }
    const w = sel.x1 - sel.x0 + 1, h = sel.y1 - sel.y0 + 1
    killModalById('uploadModal')

    const modal = document.createElement('div')
    modal.id = 'uploadModal'
    Object.assign(modal.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'center', zIndex: '9999' } as CSSStyleDeclaration)

    const box = document.createElement('div')
    Object.assign(box.style, { background: '#121826', padding: '16px', borderRadius: '12px', border: '1px solid #1f2a3b', color: '#e6e9ef', width: 'min(92vw, 900px)' } as CSSStyleDeclaration)

    const title = document.createElement('div')
    title.textContent = `Upload Image — fits ${w}×${h}px`
    Object.assign(title.style, { fontWeight: '600', marginBottom: '10px' } as CSSStyleDeclaration)

    const drop = document.createElement('div')
    Object.assign(drop.style, { border: '1px dashed #2b3b56', background: '#0e1420', color: '#b9c2d0', borderRadius: '12px', padding: '18px', textAlign: 'center', cursor: 'pointer' } as CSSStyleDeclaration)
    drop.innerHTML = `<div style="font-weight:600;margin-bottom:6px;">Drop image here or click to choose</div>
      <div style="font-size:12px;opacity:.8">PNG, JPG, GIF. It will stretch to fill ${w}×${h} pixels.</div>`

    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = 'image/*'
    fileInput.style.display = 'none'

    const viewWrap = document.createElement('div')
    Object.assign(viewWrap.style, { marginTop: '12px', display: 'grid', placeItems: 'center' } as CSSStyleDeclaration)

    const view = document.createElement('canvas')
    const scaleTarget = Math.min(800, Math.max(300, Math.max(w, h) * 20))
    const scale = Math.max(1, Math.floor(scaleTarget / Math.max(w, h)))
    view.width = w * scale; view.height = h * scale
    Object.assign(view.style, { imageRendering: 'pixelated', border: '1px solid #25344c', background: '#ffffff', maxWidth: '100%', maxHeight: '60vh' } as CSSStyleDeclaration)

    let work: HTMLCanvasElement | null = document.createElement('canvas')
    work.width = w; work.height = h

    const footer = document.createElement('div')
    Object.assign(footer.style, { marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' } as CSSStyleDeclaration)
    const bUse = document.createElement('button'); bUse.textContent = 'Use this image'; bUse.className = 'pill'; bUse.disabled = true
    const bCancel = document.createElement('button'); bCancel.textContent = 'Cancel'; bCancel.className = 'pill ghost'

    viewWrap.appendChild(view)
    box.appendChild(title)
    box.appendChild(drop)
    box.appendChild(fileInput)
    box.appendChild(viewWrap)
    footer.appendChild(bUse)
    footer.appendChild(bCancel)
    box.appendChild(footer)
    modal.appendChild(box)
    document.body.appendChild(modal)

    const vctx = view.getContext('2d')!
    const drawPreviewFromImage = (img: HTMLImageElement) => {
      const wctx = work!.getContext('2d')!
      wctx.imageSmoothingEnabled = true
      wctx.clearRect(0, 0, w, h)
      wctx.drawImage(img, 0, 0, w, h) // warp to selection
      vctx.imageSmoothingEnabled = false
      vctx.clearRect(0, 0, view.width, view.height)
      vctx.drawImage(work!, 0, 0, view.width, view.height)
      bUse.disabled = false
    }

    const handleFile = async (file: File) => {
      if (!file) return
      let url = ''
      try {
        url = URL.createObjectURL(file)
        const img = new Image()
        await new Promise<void>((ok, err) => { img.onload = () => ok(); img.onerror = () => err(new Error('image load failed')); img.src = url })
        drawPreviewFromImage(img)
      } catch { alert('Failed to load image.') }
      finally { if (url) URL.revokeObjectURL(url) }
    }

    drop.addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', (e) => {
      const f = (e.target as HTMLInputElement).files?.[0]
      if (f) handleFile(f)
      fileInput.value = ''
    })
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = '#3ea8ff' })
    drop.addEventListener('dragleave', () => { drop.style.borderColor = '#2b3b56' })
    drop.addEventListener('drop', (e) => {
      e.preventDefault()
      drop.style.borderColor = '#2b3b56'
      const f = e.dataTransfer?.files?.[0]
      if (f) handleFile(f)
    })

    if (presetFile) handleFile(presetFile)

    bUse.onclick = () => {
      if (!work) { alert('No image loaded yet.'); return }
      const copy = document.createElement('canvas')
      copy.width = work.width; copy.height = work.height
      copy.getContext('2d')!.drawImage(work, 0, 0)
      showPreview(sel, copy)
      modal.remove()
      afterPreviewPlaced()
    }
    bCancel.onclick = () => modal.remove()
  }

  function openDesignChooser() {
    const sel = selectionRef.current || loadSelection()
    if (!sel) { nudgeSelect(); return }
    const pixels = (sel.x1 - sel.x0 + 1) * (sel.y1 - sel.y0 + 1)
    const costE8s = calcCostE8s(sel)
    const affordable = balanceE8sRef.current >= costE8s
    const needICP = Math.max(0, Number(costE8s - balanceE8sRef.current) / 1e8)

    killModalById('chooserModal')
    const modal = document.createElement('div')
    modal.id = 'chooserModal'
    Object.assign(modal.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'center', zIndex: '9999' } as CSSStyleDeclaration)
    const box = document.createElement('div')
    Object.assign(box.style, { background: '#121826', padding: '12px', border: '1px solid #1f2a3b', borderRadius: '10px', color: '#e6e9ef', minWidth: 'min(92vw, 460px)' } as CSSStyleDeclaration)
    const info = document.createElement('div')
    info.style.margin = '2px 0 10px 0'
    info.innerHTML = `Selection: <strong>${pixels}</strong> px • Estimated cost <strong>${formatICP(costE8s)} ICP</strong>` +
      (affordable ? '' : ` • <span style="color:#ff6b6b">Need ${needICP.toFixed(4)} ICP</span>`)
    const row = document.createElement('div'); Object.assign(row.style, { display: 'flex', gap: '8px', flexWrap: 'wrap' } as CSSStyleDeclaration)
    const bUpload = document.createElement('button'); bUpload.className = 'pill'; bUpload.textContent = 'Upload Image'
    const bPaint = document.createElement('button'); bPaint.className = 'pill'; bPaint.textContent = 'Freeform Paint'
    const bClose = document.createElement('button'); bClose.className = 'pill'; bClose.textContent = 'Close'
    row.appendChild(bUpload); row.appendChild(bPaint); row.appendChild(bClose)
    box.appendChild(info); box.appendChild(row); modal.appendChild(box); document.body.appendChild(modal)
    bUpload.onclick = () => { modal.remove(); openUploadModal() }
    bPaint.onclick = () => { modal.remove(); openPainter() }
    bClose.onclick = () => modal.remove()
  }

  function openPainter() {
    const sel = selectionRef.current || loadSelection()
    if (!sel) { nudgeSelect(); return }

    const w = sel.x1 - sel.x0 + 1, h = sel.y1 - sel.y0 + 1
    killModalById('paintModal')

    const modal = document.createElement('div')
    modal.id = 'paintModal'
    Object.assign(modal.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'center', zIndex: '9999' } as CSSStyleDeclaration)

    const box = document.createElement('div')
    Object.assign(box.style, { background: '#121826', padding: '12px', borderRadius: '10px', border: '1px solid #1f2a3b', color: '#e6e9ef', minWidth: 'min(92vw, 900px)' } as CSSStyleDeclaration)

    const work = document.createElement('canvas'); work.width = w; work.height = h
    const wctx = work.getContext('2d')!

    const view = document.createElement('canvas')
    const target = Math.min(800, Math.max(300, Math.max(w, h) * 20))
    const scale = Math.max(1, Math.floor(target / Math.max(w, h)))
    view.width = w * scale; view.height = h * scale
    Object.assign(view.style, { imageRendering: 'pixelated', border: '1px solid #25344c', background: '#ffffff', maxWidth: '92vw', maxHeight: '70vh' } as CSSStyleDeclaration)

    const controls = document.createElement('div'); controls.style.marginTop = '8px'
    const color = document.createElement('input'); color.type = 'color'; color.value = '#ff0000'; color.style.marginRight = '8px'
    const brush = document.createElement('input'); brush.type = 'range'; brush.min = '1'; brush.max = String(Math.max(10, Math.floor(Math.max(w, h) / 20))); brush.value = '1'
    const bPreview = document.createElement('button'); bPreview.textContent = 'Preview on billboard'; bPreview.className = 'pill'; bPreview.style.margin = '0 8px'
    const bCancel = document.createElement('button'); bCancel.textContent = 'Cancel'; bCancel.className = 'pill'

    box.appendChild(view); controls.appendChild(color); controls.appendChild(brush); controls.appendChild(bPreview); controls.appendChild(bCancel); box.appendChild(controls); modal.appendChild(box); document.body.appendChild(modal)

    const vctx = view.getContext('2d')!
    const redraw = () => { vctx.imageSmoothingEnabled = false; vctx.clearRect(0, 0, view.width, view.height); vctx.drawImage(work, 0, 0, view.width, view.height) }
    redraw()

    let painting = false
    const onMouseDown = (e: MouseEvent) => { painting = true; paintAt(e) }
    const onMouseMove = (e: MouseEvent) => { if (painting) paintAt(e) }
    const onMouseUp = () => { painting = false }
    const onMouseLeave = () => { painting = false }
    view.addEventListener('mousedown', onMouseDown)
    view.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    view.addEventListener('mouseleave', onMouseLeave)

    function paintAt(e: MouseEvent) {
      const r = view.getBoundingClientRect()
      const x = Math.floor((e.clientX - r.left) / scale)
      const y = Math.floor((e.clientY - r.top) / scale)
      wctx.fillStyle = color.value
      const s = parseInt(brush.value, 10)
      wctx.fillRect(x, y, s, s)
      redraw()
    }

    bPreview.onclick = () => {
      const copy = document.createElement('canvas')
      copy.width = work.width; copy.height = work.height
      copy.getContext('2d')!.drawImage(work, 0, 0)
      showPreview(sel, copy)
      modal.remove()
      afterPreviewPlaced()
    }
    bCancel.onclick = () => modal.remove()
  }

  /** --------------- Preview & Purchase --------------- */
  function showPreview(rect: Rect, work: HTMLCanvasElement) {
    const { pctx, preview } = ensureCanvases()
    preview.width = preview.width // clear
    pctx.imageSmoothingEnabled = false
    pctx.globalCompositeOperation = 'source-over'
    pctx.drawImage(work, rect.x0, rect.y0)
    pendingPreviewRef.current = { rect, work }
    updatePurchaseUI(rect, true)
  }
  function clearPreview() { const { preview } = ensureCanvases(); preview.width = preview.width }
  function afterPreviewPlaced() {
    showPurchaseBar()
    previewBarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    linkInputRef.current?.focus()
    toast('Preview applied. Add your link, then Pay & Apply.', 'info')
  }

  /** --------------- Apply & Pay --------------- */
  async function applyPay() {
    if (pendingPayRef.current) return
    const a = billboardRef.current
    const l = ledgerRef.current
    const owner = principalRef.current
    if (!a || !l || !owner) { alert('Please sign in first.'); return }

    const linkVal = (linkInputRef.current?.value || '').trim()
    if (!isValidHttpUrl(linkVal)) { alert('Please enter a valid link (http/https).'); linkInputRef.current?.focus(); return }

    const rect = pendingPreviewRef.current?.rect || selectionRef.current || loadSelection()
    const work = pendingPreviewRef.current?.work || null
    if (!rect) { nudgeSelect(); return }

    const amount = calcCostE8s(rect)
    const fee = await getLedgerFee(l)
    const total = amount + fee

    if (balanceE8sRef.current < total) {
      const need = (Number(total - balanceE8sRef.current) / 1e8).toFixed(4)
      alert(`You need ${need} ICP (incl. fee) to purchase this area.`)
      updatePurchaseUI(rect, !!pendingPreviewRef.current)
      return
    }

    // Optimistic deduction
    pendingPayRef.current = true
    const prevBal = balanceE8sRef.current
    balanceE8sRef.current = prevBal - total
    setBalanceText((Number(balanceE8sRef.current) / 1e8).toFixed(4))
    try {
payBtnRef.current && (payBtnRef.current.disabled = true)
    const revert = (msg?: string) => {
      balanceE8sRef.current = prevBal
      setBalanceText((Number(prevBal) / 1e8).toFixed(4))
      
      if (payBtnRef.current) payBtnRef.current.disabled = false;
      pendingPayRef.current = false;


if (msg) alert(msg)
    }


      // 1) Pay
      toast('Sending payment…', 'info')
      const blockIndex = await transferRobust(l, amount, fee)
      if (blockIndex === null) { return revert('Payment failed — please try again.') }
      console.log('[PAY OK] block_index =', blockIndex?.toString?.() ?? blockIndex)
      toast('Payment confirmed. Claiming…', 'success')

      // Refresh balance soon after
      setTimeout(() => refreshBalance({ hardRetry: true }), 1200)

      // 2) Claim
      const idxs = rectToIndices(rect)
      for (let i = 0; i < idxs.length; i += CLAIM_SLICE) {
        await a.claim_pixels(idxs.slice(i, i + CLAIM_SLICE), [linkVal])
      }

      // 3) Apply paint
      if (work) {
        toast('Applying your design…', 'info')
        const w = work.width, h = work.height
        const data = work.getContext('2d')!.getImageData(0, 0, w, h).data
        const pairs: { index: number; color: number }[] = []
        let p = 0
        for (let yy = rect.y0; yy <= rect.y1; yy++) {
          for (let xx = rect.x0; xx <= rect.x1; xx++) {
            const r = data[p++], g = data[p++], b = data[p++], a8 = data[p++]
            const rgba = ((r << 24) | (g << 16) | (b << 8) | (a8)) >>> 0
            pairs.push({ index: yy * WIDTH + xx, color: rgba })
          }
        }
        for (let i = 0; i < pairs.length; i += PAINT_SLICE) {
          await a.paint(pairs.slice(i, i + PAINT_SLICE))
        }
      }

      try { await drawSingleShot(billboardRef.current ?? a) } catch {}
      
      // Prefer this host right after commit to avoid stale reads during verification
      stickyHostRef.current = agentHostRef.current
      stickyHostExpiryRef.current = Date.now() + 60_000
      // 3.5) Wait until public read shows the change (handles query lag on boundary nodes)
      try {
        const rectNow = rect
        const ok = await waitForPublicVisibility(a, rectNow, work, linkVal, 15000)
        if (!ok) console.warn('Visibility check timed out; drawing anyway.')
      } catch (e) {
        console.warn('Visibility check error', e)
        try { await drawSingleShot(a) } catch {}
      }
      clearPreview()
      pendingPreviewRef.current = null
      dispatchPreviewOff()
      updatePurchaseUI(selectionRef.current, false)
      // Stick to this host for a short window to avoid stale reads
      stickyHostRef.current = agentHostRef.current
      stickyHostExpiryRef.current = Date.now() + 60_000
      toast('Purchase complete! Your changes are live.', 'success')
        try {
          const a = billboardRef.current
          const sel = selectionRef.current || (typeof loadSelection === 'function' ? loadSelection() : null)
          const rect = sel ? { x0: Math.min(sel.x0, sel.x1), y0: Math.min(sel.y0, sel.y1), x1: Math.max(sel.x0, sel.x1), y1: Math.max(sel.y0, sel.y1) } : null
          const work = document.getElementById('canvas-preview') as HTMLCanvasElement | null
          const linkVal = ((document.getElementById('link-input') as HTMLInputElement | null)?.value || '').trim()
          if (a && rect) {
            await commitPixelsAndLinkReliable(a, rect, work, linkVal)
          }
        } catch (e) {
          console.warn('[commit after pay] failed', e)
        }

    } catch (e) {
      console.error('applyPay fatal', e)
      revert('Something went wrong during payment.')
      return
    } finally {
      payBtnRef.current && (payBtnRef.current.disabled = false)
      pendingPayRef.current = false
    }
  }

  
  /** --------------- Post-commit verification --------------- */
  async function waitForPublicVisibility(a: any, rect: { x0:number; y0:number; x1:number; y1:number }, work: HTMLCanvasElement | null, linkVal: string, timeoutMs = 15000) {
    const started = Date.now()
    const samplePoints: Array<{x:number;y:number;rgba?:number}> = []
    // corners + center samples
    const cx = Math.floor((rect.x0 + rect.x1) / 2)
    const cy = Math.floor((rect.y0 + rect.y1) / 2)
    const pts = [
      {x:rect.x0, y:rect.y0},
      {x:rect.x1, y:rect.y0},
      {x:rect.x0, y:rect.y1},
      {x:rect.x1, y:rect.y1},
      {x:cx, y:cy},
    ]
    // if we have a painted preview, compute expected RGBA for samples
    if (work) {
      const w = work.width, h = work.height
      const sctx = work.getContext('2d')!
      for (const p of pts) {
        const wx = Math.min(w-1, Math.max(0, p.x - rect.x0))
        const wy = Math.min(h-1, Math.max(0, p.y - rect.y0))
        const d = sctx.getImageData(wx, wy, 1, 1).data
        const rgba = (((d[0] & 255) << 24) | ((d[1] & 255) << 16) | ((d[2] & 255) << 8) | (d[3] & 255)) >>> 0
        samplePoints.push({ x:p.x, y:p.y, rgba })
      }
    } else {
      samplePoints.push(...pts)
    }

    async function pixelMatches(): Promise<boolean> {
      // check link on center if API available
      try {
        const linkNow = await fetchLinkAt(a, cx, cy)
        if (linkVal && linkNow !== linkVal) return false
      } catch {}
      // check colors
      if (samplePoints.length && typeof a?.get_pixel === 'function') {
        for (const sp of samplePoints) {
          if (sp.rgba === undefined) continue
          const idx = sp.y * WIDTH + sp.x
          const px = await a.get_pixel(idx)
          const rgbaNow = (px?.color ?? px) >>> 0
          if (rgbaNow !== sp.rgba) return false
        }
      }
      return true
    }

    let delay = 250
    while (Date.now() - started < timeoutMs) {
      try {
        if (await pixelMatches()) return true
      } catch {}
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(1200, Math.round(delay * 1.3))
    }
    return false
  }
/** --------------- ICRC-1 transfer helper --------------- */
  async function transferRobust(ledger: any, amount: bigint, feeGuess: bigint): Promise<bigint | null> {
    if (typeof ledger?.icrc1_transfer !== 'function') {
      alert('Ledger interface is outdated. Please rebuild with ICRC-1 ledger.idl.ts and hard refresh.')
      return null
    }
    const trySend = async (opts: { fee: bigint; withTime: boolean }) => {
      return await ledger.icrc1_transfer({
        from_subaccount: [],
        to: { owner: OWNER_RECEIVER, subaccount: [] },
        amount,
        fee: [opts.fee],
        memo: [],
        created_at_time: opts.withTime ? [nowNs()] : []
      })
    }

    let fee = feeGuess

    try {
      let res: any = await trySend({ fee, withTime: true })
      if (res && 'Ok' in res) return res.Ok as bigint

      if (res && 'Err' in res) {
        const err = res.Err
        console.warn('icrc1_transfer Err (withTime=true):', err)

        if (isErr(err, 'BadFee')) {
          fee = await getLedgerFee(ledger, /*force*/true)
          res = await trySend({ fee, withTime: true })
          if ('Ok' in res) return res.Ok as bigint
        }
        if (isErr(err, 'CreatedInFuture') || isErr(err, 'TooOld')) {
          res = await trySend({ fee, withTime: false })
          if ('Ok' in res) return res.Ok as bigint
        }
        if (isErr(err, 'TemporarilyUnavailable')) {
          await sleep(400)
          res = await trySend({ fee, withTime: false })
          if ('Ok' in res) return res.Ok as bigint
        }
        if (isErr(err, 'InsufficientFunds')) {
          alert('Ledger says: Insufficient funds (amount + fee).')
          return null
        }
        if (isErr(err, 'Duplicate')) {
          toast('Payment already submitted (duplicate). Check your wallet history.', 'info')
          return null
        }
        alert('Ledger rejected transfer: ' + prettyIcrcErr(err))
        return null
      }
    } catch (thrown: any) {
      console.error('icrc1_transfer threw:', thrown)
      try {
        const res2: any = await trySend({ fee, withTime: false })
        if (res2 && 'Ok' in res2) return res2.Ok as bigint
        if (res2 && 'Err' in res2) {
          alert('Ledger rejected transfer: ' + prettyIcrcErr(res2.Err))
          return null
        }
      } catch (thrown2: any) {
        console.error('icrc1_transfer fallback threw:', thrown2)
        alert('Transfer failed (network/decoding): ' + String(thrown2?.message || thrown2))
        return null
      }
    }

    alert('Transfer failed for an unknown reason. Check console for details.')
    return null
  }

  /** --------------- Ledger helpers --------------- */
  async function getLedgerFee(ledger: any, force = false): Promise<bigint> {
    try {
      if (!force && (getLedgerFee as any)._cache) return (getLedgerFee as any)._cache
      if (typeof ledger.icrc1_fee === 'function') {
        const f = await ledger.icrc1_fee() as bigint
        ;(getLedgerFee as any)._cache = f
        return f
      }
      if (typeof ledger.icrc1_metadata === 'function') {
        const md = await ledger.icrc1_metadata() as Array<[string, any]>
        const kv = md.find(([k]) => k.toLowerCase() === 'icrc1:fee')
        if (kv && Array.isArray(kv[1]) && 'Nat' in kv[1]) {
          const f = BigInt((kv as any)[1].Nat)
          ;(getLedgerFee as any)._cache = f
          return f
        }
      }
    } catch {/* ignore */}
    const fallback = 10_000n // 0.0001 ICP
    ;(getLedgerFee as any)._cache = fallback
    return fallback
  }

  /** --------------- Small utils --------------- */
  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ms)
    // We can’t actually abort canister calls, but we can race a rejection:
    return Promise.race([
      p.finally(() => clearTimeout(t)),
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
    ]) as Promise<T>
  }

  function nowNs(): bigint { return BigInt(Date.now()) * 1_000_000n }
  function sleep(ms:number){ return new Promise(r=>setTimeout(r,ms)) }
  function isErr(e: any, key: string){ return e && typeof e === 'object' && key in e }
  function prettyIcrcErr(e: any){ try { return JSON.stringify(e) } catch { return String(e) } }
  function dispatchPreviewOff(){ window.dispatchEvent(new CustomEvent('ic:preview:off')) }

  function toast(msg: string, kind: 'info'|'success'|'error' = 'info') {
    const host = document.getElementById('toastHost') || (() => {
      const t = document.createElement('div')
      t.id = 'toastHost'
      Object.assign(t.style, { position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)', zIndex: '10000', display: 'grid', gap: '8px' } as CSSStyleDeclaration)
      document.body.appendChild(t)
      return t
    })()
    const el = document.createElement('div')
    const bg = kind === 'success' ? '#183a24' : kind === 'error' ? '#3a1818' : '#182033'
    const border = kind === 'success' ? '#1f6b36' : kind === 'error' ? '#7a2c2c' : '#2a3a5c'
    el.textContent = msg
    Object.assign(el.style, { background: bg, color: '#e6e9ef', border: `1px solid ${border}`, padding: '8px 12px', borderRadius: '10px', fontSize: '14px', boxShadow: '0 6px 20px rgba(0,0,0,.35)' } as CSSStyleDeclaration)
    host.appendChild(el)
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; setTimeout(() => { el.remove() }, 220) }, 2200)
  }

  function clamp(v:number,a:number,b:number){ return Math.max(a, Math.min(b, v)) }
  function normRect(r:Rect){ const x0=Math.min(r.x0,r.x1), x1=Math.max(r.x0,r.x1); const y0=Math.min(r.y0,r.y1), y1=Math.max(r.y0,r.y1); return { x0, y0, x1, y1 } }
  function rectToIndices(rect:Rect){ const idxs:number[]=[]; for(let y=rect.y0;y<=rect.y1;y++){ for(let x=rect.x0;x<=rect.x1;x++){ idxs.push(y*WIDTH+x) } } return idxs }
  function calcCostE8s(rect:Rect){ const pixels=(rect.x1-rect.x0+1)*(rect.y1-rect.y0+1); return BigInt(pixels)*PRICE_E8S }
  function formatICP(e8s:bigint){ return (Number(e8s)/1e8).toFixed(4) }
  function isValidHttpUrl(u: string){ try{ const x=new URL(u); return x.protocol==='http:'||x.protocol==='https:' } catch { return false } }

  return null
}