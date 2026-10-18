'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, CircleHelp, Download, FileUp, Heart, Menu, Music2, Play, Plus, Power, Search, Settings2, SlidersHorizontal, Star, Trash2, Upload, Wifi, X, Zap } from 'lucide-react'

type Tone = { bank:string; kind:string; number:string; category:string; name:string; sub:string; msb:number; lsb:number; pc:number; pc_byte:number }
type ButtonTone = Tone & { id:string; label:string; color:string }

const starter = [
  ['0001','Grand Piano','#e7a84b'], ['0045','Pure EP','#ec765c'], ['0115','GT Org Std','#b98bde'], ['0380','String Ens 1','#7ba6e8'],
  ['0490','Brass Sect 1','#d87ab1'], ['0315','SH Sawtooth','#58c6b2'], ['0951','Cell Space','#8e8ce8'], ['0241','Nylon Gtr','#d6c06a'],
]

const categories = ['All tones','Piano','E.Piano','Organ / Keys','Strings','Brass','Guitar / Bass','Synth','Pad / FX','World','Drums','My Tones']
const catMap: Record<string,string> = { Pf:'Piano', Ky:'Organ / Keys', St:'Strings', Br:'Brass', Gt:'Guitar / Bass', Sy:'Synth', Pd:'Pad / FX', Wr:'World', Dr:'Drums', EP:'E.Piano' }

const STORE_KEY = 'midipop.setlist.v1'
const isToneList = (v: unknown): v is ButtonTone[] =>
  Array.isArray(v) && v.every(b => !!b && typeof b.id === 'string' && typeof b.msb === 'number' && typeof b.lsb === 'number' && typeof b.pc_byte === 'number')

export default function Page() {
  const [catalog, setCatalog] = useState<Tone[]>([])
  const [screen, setScreen] = useState<'play'|'library'|'settings'>('play')
  const [page, setPage] = useState('Worship')
  const [buttons, setButtons] = useState<ButtonTone[]>([])
  const [active, setActive] = useState<ButtonTone | null>(null)
  const [connected, setConnected] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All tones')
  const [edit, setEdit] = useState(false)
  const [light, setLight] = useState(false)
  const [cutOld, setCutOld] = useState(true)
  const [channel, setChannel] = useState(1)
  const [monitor, setMonitor] = useState(false)
  const [midiLog, setMidiLog] = useState<string[]>([])
  const [customTone, setCustomTone] = useState({ msb: '', lsb: '', pc: '' })
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const output = useRef<MIDIOutput | null>(null)
  const input = useRef<MIDIInput | null>(null)
  const bankRef = useRef({ msb: 0, lsb: 0 })
  const toneQueue = useRef(Promise.resolve())
  const isSendingRef = useRef(false)
  const hydratedRef = useRef(false)
  const restoreInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    // 1. Import the saved setlist straight from this device's storage first.
    let saved: ButtonTone[] | null = null
    try {
      const raw = window.localStorage.getItem(STORE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (isToneList(parsed)) saved = parsed
      }
    } catch {}
    if (saved) { setButtons(saved); setActive(saved[0] ?? null) }
    hydratedRef.current = true

    // 2. Fall back to the starter setlist only when nothing was saved on the phone.
    fetch('/xps30_sound_catalog.json').then(r => r.json()).then((all: Tone[]) => {
      setCatalog(all)
      const picks = starter.map(([number, label, color]) => { const t = all.find(x => x.number === number) || all[0]; return {...t, id: `b-${number}`, label, color} })
      setButtons(prev => (prev.length ? prev : picks))
      setActive(prev => prev ?? picks[0])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    // Every saved tone is written straight back to the phone as it changes.
    if (!hydratedRef.current) return
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(buttons)) } catch {}
  }, [buttons])

  const handleIncoming = (event: MIDIMessageEvent) => {
    const data = event.data || []
    logMidi(Array.from(data), 'IN')
    const status = data[0] ?? 0
    if ((status & 0xf0) === 0xb0 && data[1] === 0) bankRef.current.msb = data[2] ?? 0
    if ((status & 0xf0) === 0xb0 && data[1] === 32) bankRef.current.lsb = data[2] ?? 0
    if ((status & 0xf0) === 0xc0) {
      const tone = catalog.find(t => t.msb === bankRef.current.msb && t.lsb === bankRef.current.lsb && t.pc_byte === data[1]) || catalog.find(t => t.pc_byte === data[1])
      if (tone) setActive(current => ({...tone, id: current?.id || `incoming-${tone.bank}-${tone.number}`, label: tone.name, color: current?.color || '#e7a84b'}))
    }
  }

  const connect = async () => {
    if (!navigator.requestMIDIAccess) { setToast('Web MIDI needs Chrome on Android or desktop Chrome / Edge.'); return }
    try {
      const access = await navigator.requestMIDIAccess()
      const found = [...access.outputs.values()].find(x => /xps-30|roland/i.test(x.name || '')) || [...access.outputs.values()][0]
      const midiInput = [...access.inputs.values()].find(x => /xps-30|roland/i.test(x.name || '')) || [...access.inputs.values()][0]
      if (midiInput) { input.current = midiInput; midiInput.onmidimessage = handleIncoming }
      if (found) { output.current = found; setConnected(true); setToast(`${found.name || 'MIDI output'} ready`) }
      else setToast('No MIDI output found. Connect the XPS-30 and try again.')
    } catch { setToast('MIDI access was denied. Allow MIDI access in Chrome, then try again.') }
    setTimeout(() => setToast(''), 3500)
  }

  const logMidi = (bytes: number[], direction: 'OUT' | 'IN' = 'OUT') => {
    const hex = bytes.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')
    const label = direction === 'OUT' ? 'XPS-30 ← APP' : 'XPS-30 → APP'
    // Keep the log chronological so the visible order matches the wire order.
  setMidiLog(items => [...items, `${new Date().toLocaleTimeString()}  ${label}  ${hex}`].slice(-80))
  }

  const sendMidi = (bytes: number[]) => {
    output.current?.send(bytes)
    logMidi(bytes)
  }

  const silenceAllParts = () => {
    if (!output.current) return
    // Performance Mode can leave other Parts sounding on their own MIDI channels.
    // Send one explicit silence pass before every patch change; do not send CC 121,
    // because Reset All Controllers can reset the keyboard's volume/expression.
    for (let midiCh = 0; midiCh < 16; midiCh++) {
      sendMidi([0xB0 + midiCh, 120, 0]) // All Sound Off
      sendMidi([0xB0 + midiCh, 123, 0]) // All Notes Off
    }
  }

  const sendTone = async (tone: Tone | ButtonTone) => {
    if (!output.current) { 
      setToast('Connect the XPS-30 before switching tones.')
      setTimeout(() => setToast(''), 3000)
      return 
    }
    if (isSendingRef.current) return
    isSendingRef.current = true

    const ch = Math.max(1, Math.min(16, channel)) - 1

    try {
      // 1. Force a total hardware-level panic silence across all 16 channels first
      for (let midiCh = 0; midiCh < 16; midiCh++) {
        sendMidi([0xB0 + midiCh, 120, 0]) // All Sound Off
        sendMidi([0xB0 + midiCh, 123, 0]) // All Notes Off
      }

      // Brief 20ms micro-pause to let the audio engine flush out old buffers
      await new Promise(resolve => setTimeout(resolve, 20))

      // 2. STRIKE THE BANK AND PATCH IN STRICT ORDER (MSB -> LSB -> PC)
      sendMidi([0xB0 + ch, 0, tone.msb])       // CC 0: Bank MSB
      sendMidi([0xB0 + ch, 32, tone.lsb])      // CC 32: Bank LSB
      sendMidi([0xC0 + ch, tone.pc_byte])      // Program Change (Must be last)
    } finally {
      // Cooldown lock to prevent double-click race conditions
      setTimeout(() => {
        isSendingRef.current = false
      }, 100)
    }
  }

  const choose = async (tone: ButtonTone) => { 
    setActive(current => ({...tone, label: tone.name}))
    await sendTone(tone) 
  }
  const addCustomTone = () => {
    const msb = Number(customTone.msb), lsb = Number(customTone.lsb), pc = Number(customTone.pc)
    if (![msb, lsb, pc].every(Number.isInteger) || msb < 0 || msb > 127 || lsb < 0 || lsb > 127 || pc < 1 || pc > 128) {
      setToast('Enter MSB and LSB from 0–127, and PC from 1–128.'); setTimeout(() => setToast(''), 2500); return
    }
    const tone: Tone = { bank: 'Custom', kind: 'patch', number: `PC ${pc}`, category: 'Custom tone', name: `Custom ${msb}/${lsb}/${pc}`, sub: 'Custom', msb, lsb, pc, pc_byte: pc - 1 }
    add(tone); setCustomTone({ msb: '', lsb: '', pc: '' })
  }
  const moveButton = (fromId: string, toId: string) => {
    if (fromId === toId) return
    setButtons(items => { const next = [...items]; const from = next.findIndex(item => item.id === fromId); const to = next.findIndex(item => item.id === toId); const [item] = next.splice(from, 1); next.splice(to, 0, item); return next })
  }
  const filtered = useMemo(() => catalog.filter(t => {
    const q = search.toLowerCase(); const mapped = catMap[t.sub] || (t.category?.split(':')[0] && catMap[t.category.split(':')[0]]) || ''
    return (!q || `${t.name} ${t.number} ${t.category}`.toLowerCase().includes(q)) && (category === 'All tones' || mapped === category)
  }).slice(0, 50), [catalog, search, category])
  const add = (tone: Tone) => { const b = {...tone, id:`b-${tone.bank}-${tone.number}-${Date.now()}`, label:tone.name, color:'#e7a84b'}; setButtons(x => [...x,b]); setToast(`${tone.name} added to ${page}`); setTimeout(() => setToast(''), 2200) }
  const panic = () => { if (!output.current) return; for (let c=0;c<16;c++) output.current.send([0xB0+c,120,0],); for (let c=0;c<16;c++) output.current.send([0xB0+c,123,0]); for (let c=0;c<16;c++) output.current.send([0xB0+c,121,0]); setToast('All channels silenced'); setTimeout(() => setToast(''), 2000) }

  const backupSetlist = async () => {
    const payload = JSON.stringify({ app: 'MidiPoP', version: 1, savedAt: new Date().toISOString(), buttons }, null, 2)
    try {
      const file = new File([payload], 'midipop-setlist.json', { type: 'application/json' })
      if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'MidiPoP setlist' })
        setToast('Setlist shared from this phone'); setTimeout(() => setToast(''), 2400)
        return
      }
    } catch {}
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'midipop-setlist.json'; a.click()
    URL.revokeObjectURL(url)
    setToast('Setlist backed up'); setTimeout(() => setToast(''), 2400)
  }

  const restoreSetlist = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        const list = Array.isArray(data) ? data : data?.buttons
        if (!isToneList(list) || !list.length) throw new Error('invalid')
        setButtons(list); setActive(list[0])
        setToast(`${list.length} tones imported`); setTimeout(() => setToast(''), 2500)
      } catch {
        setToast('That file is not a valid MidiPoP setlist.'); setTimeout(() => setToast(''), 3000)
      }
    }
    reader.readAsText(file)
  }

  return <main className={light ? 'app light' : 'app'}>
    <header className="topbar"><div className="brand"><span className="brand-mark"><Music2 size={19}/></span><span className="brand-name">Midi<span className="accent">PoP</span></span></div><div className="top-actions"><button className={`status ${connected ? 'online' : ''}`} onClick={connect}><span className="status-dot"/>{connected ? 'Connected' : 'Not connected'}</button><button className="panic" onClick={panic}><Zap size={14}/> PANIC</button></div></header>
    {toast && <div className="toast" role="status">{toast}</div>}
    {screen === 'play' && <section className="screen play-screen"><div className="eyebrow">PERFORMANCE / PART {channel}</div><div className="now-playing"><div className="now-label">NOW PLAYING</div><h1>{active?.label || 'Connect a keyboard'}</h1><div className="tone-meta">{active ? `${active.bank === 'PRST' ? 'Preset' : active.bank} ${active.number}  ·  ${active.category}  ·  ${active.msb}/${active.lsb}/${active.pc}` : 'Tap Connect to begin'}</div></div><div className="page-tabs">{['Worship','Pop','Practice'].map(p => <button key={p} className={page===p?'selected':''} onClick={() => setPage(p)}>{p}</button>)}<button className={`edit-toggle ${edit?'selected':''}`} onClick={() => setEdit(!edit)}>{edit ? 'Done' : 'Edit'}</button></div>{edit && <div className="arrange-hint">Drag buttons to reorder your setlist. Enter a tone number to add it quickly.</div>}<div className="tone-number-entry"><input inputMode="numeric" value={customTone.msb} onChange={e=>setCustomTone(x=>({...x,msb:e.target.value.replace(/\D/g,'').slice(0,3)}))} placeholder="MSB" aria-label="Bank MSB"/><input inputMode="numeric" value={customTone.lsb} onChange={e=>setCustomTone(x=>({...x,lsb:e.target.value.replace(/\D/g,'').slice(0,3)}))} placeholder="LSB" aria-label="Bank LSB"/><input inputMode="numeric" value={customTone.pc} onChange={e=>setCustomTone(x=>({...x,pc:e.target.value.replace(/\D/g,'').slice(0,3)}))} placeholder="PC 1–128" aria-label="Program change number"/><button onClick={addCustomTone}><Plus size={16}/> Add tone</button></div><div className="tone-grid">{buttons.map(b => <button key={b.id} draggable={edit} onDragStart={() => setDraggedId(b.id)} onDragOver={e=>e.preventDefault()} onDrop={() => {if(draggedId) moveButton(draggedId,b.id);setDraggedId(null)}} className={`tone-button ${active?.id===b.id?'active':''}`} onClick={() => choose(b)}><span className="stripe" style={{background:b.color}}/><span className="tone-name">{b.label}</span><span className="tone-category">{catMap[b.sub] || b.sub || 'Tone'} <span>{b.number}</span></span>{edit && <span className="remove" onClick={e => {e.stopPropagation();setButtons(x=>x.filter(y=>y.id!==b.id))}}><Trash2 size={15}/></span>}</button>)}<button className="add-tile" onClick={() => setScreen('library')}><Plus size={22}/><span>Add tone</span></button></div></section>}
    {screen === 'library' && <section className="screen library-screen"><div className="section-heading"><div><div className="eyebrow">SOUND LIBRARY</div><h2>Find your sound.</h2></div><button className="icon-button" onClick={() => setScreen('play')} aria-label="Close library"><X size={20}/></button></div><div className="search-box"><Search size={19}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search 1,847 tones" autoFocus/></div><div className="chips">{categories.map(c => <button key={c} className={category===c?'chip-active':''} onClick={()=>setCategory(c)}>{c}</button>)}</div><div className="library-top"><span>{filtered.length ? `${filtered.length} results` : 'Loading catalog…'}</span><button className="filter-button"><SlidersHorizontal size={15}/> Filters <ChevronDown size={14}/></button></div><div className="results">{filtered.map(t => <div className="result-row" key={`${t.bank}-${t.number}-${t.name}`}><button className="preview" onClick={()=>{ void sendTone(t); setActive(current => ({...t, id: current?.id || `preview-${t.bank}-${t.number}`, label: t.name, color: current?.color || '#e7a84b'})) }}><span className="result-number">{t.number}</span><span><strong>{t.name}</strong><small>{catMap[t.sub] || t.sub} · {t.bank === 'PRST' ? 'Preset' : t.bank}</small></span></button><button className="add-button" onClick={()=>add(t)}><Plus size={17}/> Add</button></div>)}</div></section>}
    {screen === 'settings' && <section className="screen settings-screen"><div className="eyebrow">CONTROL ROOM</div><h2>Settings</h2><div className="setting-group"><label>MIDI output</label><button className="setting-row" onClick={connect}><span><Wifi size={17}/> {connected ? 'XPS-30 · USB MIDI' : 'No output selected'}</span><ChevronDown size={17}/></button></div><div className="setting-group"><label>Active channel</label><div className="stepper"><button onClick={()=>setChannel(Math.max(1,channel-1))}>−</button><strong>Channel {channel}</strong><button onClick={()=>setChannel(Math.min(16,channel+1))}>+</button></div></div><div className="setting-group"><label>Switching</label><button className="setting-row" onClick={()=>setCutOld(!cutOld)}><span><Power size={17}/> Cut old notes</span><span className={`toggle ${cutOld?'on':''}`}><span/></span></button><p className="hint">Sends All Sounds Off before every tone change.</p></div><div className="setting-group"><label>Stage tools</label><button className="setting-row" onClick={()=>setMonitor(!monitor)}><span><CircleHelp size={17}/> MIDI monitor</span>{monitor?<ChevronUp size={17}/>:<ChevronDown size={17}/>}</button>{monitor&&<div className="monitor"><div className="monitor-toolbar"><code>{midiLog.length ? `${midiLog.length} message${midiLog.length === 1 ? '' : 's'}` : 'No messages yet'}</code><div><button onClick={()=>navigator.clipboard?.writeText(midiLog.join('\n'))} disabled={!midiLog.length}>Copy log</button><button onClick={()=>setMidiLog([])} disabled={!midiLog.length}>Clear</button></div></div><pre aria-live="polite">{midiLog.length ? midiLog.join('\n') : 'Connect the XPS-30, then switch a tone to see exact MIDI bytes.'}</pre></div>}<button className="setting-row"><span><SlidersHorizontal size={17}/> Never-use channels</span><span className="muted">None</span></button><button className="setting-row"><span><Zap size={17}/> Keep screen awake</span><span className="toggle on"><span/></span></button></div><div className="setting-group"><label>Appearance</label><button className="setting-row" onClick={()=>setLight(!light)}><span>{light ? 'Light theme' : 'Dark theme'}</span><span className="muted">{light ? 'Light' : 'Dark'}</span></button></div><div className="setting-group"><label>App data</label><div className="data-actions"><button onClick={backupSetlist}><Download size={16}/> Backup</button><button onClick={() => restoreInput.current?.click()}><Upload size={16}/> Restore</button><input ref={restoreInput} type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) restoreSetlist(f); e.target.value = '' }} /></div><p className="hint">Your setlist saves to this phone automatically and reloads when you open MidiPoP.</p></div></section>}
    <nav className="bottom-nav"><button className={screen==='play'?'nav-active':''} onClick={()=>setScreen('play')}><Play size={18}/><span>Play</span></button><button className={screen==='library'?'nav-active':''} onClick={()=>setScreen('library')}><Search size={18}/><span>Library</span></button><button className={screen==='settings'?'nav-active':''} onClick={()=>setScreen('settings')}><Settings2 size={18}/><span>Settings</span></button></nav>
  </main>
}
