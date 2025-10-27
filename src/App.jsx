import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import QRCode from 'qrcode'

function uid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {}
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

const emptyInvoice = () => ({
  your: { company: '', name: '', email: '', phone: '', address: '', vatId: '' },
  client: { company: '', name: '', email: '', address: '', vatId: '' },
  meta: {
    number: 'INV-0001',
    date: new Date().toISOString().slice(0,10),
    due: '',
    currency: 'USD',
    taxRate: 0,
    discount: 0,
    notes: '',
    paymentLink: '',
    logoDataUrl: '',
    status: 'draft',
    poNumber: '',
    terms: '',
    publicViewUrl: '',
  },
  items: [{ id: uid(), description: '', qty: 1, price: 0 }],
})

function withDefaults(data) {
  const d = emptyInvoice()
  const out = {
    ...d,
    ...data,
    your: { ...d.your, ...(data?.your || {}) },
    client: { ...d.client, ...(data?.client || {}) },
    meta: { ...d.meta, ...(data?.meta || {}) },
    items: Array.isArray(data?.items) ? data.items.map(it => ({ id: it.id || uid(), description: it.description || '', qty: it.qty ?? 1, price: it.price ?? 0 })) : d.items,
  }
  return out
}

function App() {
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem('invoice:data')
      return raw ? withDefaults(JSON.parse(raw)) : emptyInvoice()
    } catch {
      return emptyInvoice()
    }
  })
  const [showPreview, setShowPreview] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const logoInputRef = useRef(null)
  const [showClients, setShowClients] = useState(false)
  const [showTos, setShowTos] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [clients, setClients] = useState(() => {
    try { return JSON.parse(localStorage.getItem('invoice:clients') || '[]') } catch { return [] }
  })

  // persist
  useEffect(() => {
    localStorage.setItem('invoice:data', JSON.stringify(data))
  }, [data])

  useEffect(() => {
    localStorage.setItem('invoice:clients', JSON.stringify(clients))
  }, [clients])

  // Generate QR code whenever payment link changes
  useEffect(() => {
    const link = (data?.meta?.paymentLink || '').trim()
    if (!link) { setQrDataUrl(''); return }
    let cancelled = false
    QRCode.toDataURL(link, { errorCorrectionLevel: 'M', margin: 1, width: 240 })
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch(() => { if (!cancelled) setQrDataUrl('') })
    return () => { cancelled = true }
  }, [data?.meta?.paymentLink])

  const subtotal = useMemo(() => data.items.reduce((s, it) => s + (Number(it.qty)||0) * (Number(it.price)||0), 0), [data.items])
  const tax = useMemo(() => subtotal * ((Number(data.meta.taxRate) || 0) / 100), [subtotal, data.meta.taxRate])
  const discount = useMemo(() => Number(data.meta.discount) || 0, [data.meta.discount])
  const total = useMemo(() => Math.max(0, subtotal + tax - discount), [subtotal, tax, discount])

  const addItem = () => setData(d => ({ ...d, items: [...d.items, { id: uid(), description: '', qty: 1, price: 0 }] }))
  const removeItem = (id) => setData(d => ({ ...d, items: d.items.filter(it => it.id !== id) }))
  const updateItem = (id, patch) => setData(d => ({ ...d, items: d.items.map(it => it.id === id ? { ...it, ...patch } : it) }))

  const onField = (path, value) => setData(d => {
    const clone = deepClone(d)
    let ref = clone
    const parts = path.split('.')
    for (let i=0;i<parts.length-1;i++) ref = ref[parts[i]]
    ref[parts.at(-1)] = value
    return clone
  })

  const onPrint = () => {
    setShowPreview(true)
    const prevTitle = document.title
    const newTitle = `Invoice ${data.meta.number || ''}`.trim()
    document.title = newTitle
    const restore = () => {
      document.title = prevTitle
      window.removeEventListener('afterprint', restore)
    }
    window.addEventListener('afterprint', restore)
    setTimeout(() => window.print(), 50)
  }

  const onDownloadPdf = async () => {
    // Ensure preview is visible to capture
    setShowPreview(true)
    await new Promise(r => setTimeout(r, 50))
    const node = document.getElementById('invoice')
    if (!node) return
    const canvas = await html2canvas(node, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
    })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'pt', 'a4')
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = pageWidth
    const imgHeight = (canvas.height * imgWidth) / canvas.width

    let position = 0
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
    let heightLeft = imgHeight - pageHeight

    while (heightLeft > 0) {
      pdf.addPage()
      position = -(imgHeight - heightLeft)
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }

    const fileName = `Invoice_${(data.meta.number || '').replace(/\s+/g, '-') || 'export'}.pdf`
    pdf.save(fileName)
    setData(d => ({ ...d, meta: { ...d.meta, status: 'sent' } }))
    pushClientHistory({ type: 'sent', total, number: data.meta.number })
  }

  const onUploadLogoClick = () => logoInputRef.current?.click()
  const onUploadLogo = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const fr = new FileReader()
    fr.onload = () => {
      const dataUrl = String(fr.result || '')
      onField('meta.logoDataUrl', dataUrl)
    }
    fr.readAsDataURL(f)
    e.target.value = ''
  }
  const onRemoveLogo = () => onField('meta.logoDataUrl', '')

  const autoNumber = () => {
    const today = new Date()
    const ymd = [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('')
    const last = JSON.parse(localStorage.getItem('invoice:lastSeq') || 'null')
    let seq = 1
    if (last && last.date === ymd) seq = (last.seq || 0) + 1
    localStorage.setItem('invoice:lastSeq', JSON.stringify({ date: ymd, seq }))
    const num = `INV-${ymd}-${String(seq).padStart(3,'0')}`
    onField('meta.number', num)
  }

  // Client management
  function saveAsClient() {
    const base = { company: '', name: '', email: '', address: '' }
    const c = { id: uid(), ...base, ...data.client, history: [] }
    setClients(prev => [c, ...prev])
  }
  function selectClient(c) {
    onField('client.company', c.company || '')
    onField('client.name', c.name || '')
    onField('client.email', c.email || '')
    onField('client.address', c.address || '')
    setShowClients(false)
  }
  function removeClient(id) {
    setClients(prev => prev.filter(c => c.id !== id))
  }
  function pushClientHistory(evt) {
    const email = (data.client.email || '').trim()
    if (!email) return
    setClients(prev => prev.map(c => {
      if ((c.email||'').trim().toLowerCase() !== email.toLowerCase()) return c
      const rec = { at: Date.now(), ...evt }
      return { ...c, history: [rec, ...(c.history||[])] }
    }))
  }

  // Email via webhook or mailto fallback
  async function emailInvoice() {
    const subject = `Invoice ${data.meta.number}`
    const body = `Hello ${data.client.name || ''},%0D%0A%0D%0APlease find your invoice ${data.meta.number}.%0D%0ATotal: ${formatCurrency(total, data.meta.currency)}.%0D%0A%0D%0ARegards,%0D%0A${data.your.company || data.your.name}`
    const to = (data.client.email || '').trim()
    const webhook = import.meta.env.VITE_EMAIL_WEBHOOK_URL
    try {
      if (webhook) {
        const node = document.getElementById('invoice')
        const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
        const imgData = canvas.toDataURL('image/png')
        await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, subject, html: decodeURIComponent(body.replace(/%0D%0A/g,'<br/>')), attachment: imgData }) })
        alert('Email request sent')
      } else {
        window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${body}`
      }
      setData(d => ({ ...d, meta: { ...d.meta, status: 'sent' } }))
      pushClientHistory({ type: 'sent', total, number: data.meta.number })
    } catch (e) {
      alert('Failed to send email')
    }
  }

  return (
    <div className="wrap narrow">
      <header className="top">
        <div className="brand">Billura</div>
        <div className="brand">Minimal Invoice</div>
        <div className="actions">
          <button onClick={() => setData(emptyInvoice())}>New</button>
          <button onClick={() => setShowPreview(p => !p)}>{showPreview ? 'Edit' : 'Preview'}</button>
          <button onClick={onPrint}>Print / PDF</button>
          <button onClick={onDownloadPdf}>Download PDF</button>
          <button onClick={emailInvoice}>Email Invoice</button>
          {data.meta.publicViewUrl && (
            <button onClick={() => navigator.clipboard.writeText(`${data.meta.publicViewUrl}?invoice=${encodeURIComponent(data.meta.number)}&email=${encodeURIComponent(data.client.email||'')}`)}>Copy View Link</button>
          )}
        </div>
      </header>

      <main className="grid">
        {/* LEFT: form */}
        <section className={`panel ${showPreview ? 'hide-on-print' : ''}`}>
          <h2>Details</h2>
          <div className="two">
            <div>
              <h3>Your Info</h3>
              <Input label="Company" value={data.your.company} onChange={v => onField('your.company', v)} />
              <Input label="Name" value={data.your.name} onChange={v => onField('your.name', v)} />
              <Input label="Email" value={data.your.email} onChange={v => onField('your.email', v)} />
              <Input label="Phone" value={data.your.phone} onChange={v => onField('your.phone', v)} />
              <Input label="VAT/Tax ID" value={data.your.vatId} onChange={v => onField('your.vatId', v)} />
              <Text label="Address" value={data.your.address} onChange={v => onField('your.address', v)} />
            </div>
            <div>
              <h3>Client</h3>
              <Input label="Company" value={data.client.company} onChange={v => onField('client.company', v)} />
              <Input label="Name" value={data.client.name} onChange={v => onField('client.name', v)} />
              <Input label="Email" value={data.client.email} onChange={v => onField('client.email', v)} />
              <Input label="VAT/Tax ID" value={data.client.vatId} onChange={v => onField('client.vatId', v)} />
              <Text label="Address" value={data.client.address} onChange={v => onField('client.address', v)} />
              <div style={{ display:'flex', gap: 8 }}>
                <button type="button" onClick={saveAsClient}>Save as Client</button>
                <button type="button" onClick={() => setShowClients(true)}>Choose Client</button>
              </div>
            </div>
          </div>

          <div className="two">
            <div>
              <h3>Invoice</h3>
              <div className="field">
                <span>Number</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={data.meta.number} onChange={(e) => onField('meta.number', e.target.value)} />
                  <button type="button" onClick={autoNumber}>Auto</button>
                </div>
              </div>
              <Input label="Date" type="date" value={data.meta.date} onChange={v => onField('meta.date', v)} />
              <Input label="Due" type="date" value={data.meta.due} onChange={v => onField('meta.due', v)} />
              <Input label="Currency" value={data.meta.currency} onChange={v => onField('meta.currency', v)} />
              <Input label="PO Number" value={data.meta.poNumber} onChange={v => onField('meta.poNumber', v)} />
              <div className="field">
                <span>Status</span>
                <select value={data.meta.status || 'draft'} onChange={(e) => onField('meta.status', e.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="viewed">Viewed</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                </select>
                <div style={{ display:'flex', gap: 8, marginTop: 8 }}>
                  <button type="button" onClick={() => onField('meta.status','viewed')}>Mark Viewed</button>
                  <button type="button" onClick={() => onField('meta.status','paid')}>Mark Paid</button>
                </div>
              </div>
              <Input label="Payment Link" value={data.meta.paymentLink} onChange={v => onField('meta.paymentLink', v)} />
              <Input label="Public View URL" value={data.meta.publicViewUrl} onChange={v => onField('meta.publicViewUrl', v)} />
            </div>
            <div>
              <h3>Summary</h3>
              <NumberField label="Tax %" value={data.meta.taxRate} onChange={v => onField('meta.taxRate', v)} />
              <NumberField label="Discount" value={data.meta.discount} onChange={v => onField('meta.discount', v)} />
              <Text label="Notes" value={data.meta.notes} onChange={v => onField('meta.notes', v)} rows={4} />
              <div className="field">
                <span>Terms</span>
                <textarea rows={3} value={data.meta.terms} onChange={(e) => onField('meta.terms', e.target.value)} />
              </div>
              <div className="field">
                <span>Logo</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="button" onClick={onUploadLogoClick}>Upload Logo</button>
                  {data.meta.logoDataUrl && <button type="button" onClick={onRemoveLogo}>Remove</button>}
                  <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onUploadLogo} />
                </div>
              </div>
            </div>
          </div>

          <h2>Items</h2>
          <div className="items">
            <div className="row head">
              <div>Description</div>
              <div className="num">Qty</div>
              <div className="num">Price</div>
              <div className="num">Amount</div>
              <div></div>
            </div>
            {data.items.map(it => (
              <div className="row" key={it.id}>
                <input className="desc" placeholder="Description" value={it.description} onChange={e => updateItem(it.id, { description: e.target.value })} />
                <input className="num" type="number" min="0" value={it.qty} onChange={e => updateItem(it.id, { qty: Number(e.target.value) })} />
                <input className="num" type="number" min="0" step="0.01" value={it.price} onChange={e => updateItem(it.id, { price: Number(e.target.value) })} />
                <div className="num amt">{formatCurrency((it.qty||0)*(it.price||0), data.meta.currency)}</div>
                <button className="muted" onClick={() => removeItem(it.id)}>Remove</button>
              </div>
            ))}
            <div className="actions-line">
              <button onClick={addItem}>Add Item</button>
            </div>
          </div>

          <div className="totals">
            <div><span>Subtotal</span><span>{formatCurrency(subtotal, data.meta.currency)}</span></div>
            <div><span>Tax</span><span>{formatCurrency(tax, data.meta.currency)}</span></div>
            <div><span>Discount</span><span>-{formatCurrency(discount, data.meta.currency)}</span></div>
            <div className="grand"><span>Total</span><span>{formatCurrency(total, data.meta.currency)}</span></div>
          </div>
        </section>

        {/* RIGHT: preview */}
        <section className={`panel preview ${showPreview ? '' : 'muted-border'}`}>
          <InvoicePreview data={data} subtotal={subtotal} tax={tax} discount={discount} total={total} />
        </section>
      </main>
      <footer className="legal">
        <span>
          By using this app you agree to the
          {' '}<button className="link-btn" onClick={() => setShowTos(true)}>Terms of Service</button>
          {' '}and{' '}
          <button className="link-btn" onClick={() => setShowPrivacy(true)}>Privacy Policy</button>.
        </span>
      </footer>
      {showClients && (
        <div className="modal-backdrop" onClick={() => setShowClients(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Clients</h3>
            <div className="list">
              {clients.length === 0 ? (
                <div className="row"><div>No clients yet</div></div>
              ) : (
                clients.map(c => (
                  <div key={c.id} className="row">
                    <div>
                      <div><strong>{c.company || c.name}</strong></div>
                      <div className="muted">{c.email}</div>
                    </div>
                    <button onClick={() => selectClient(c)}>Use</button>
                    <button onClick={() => removeClient(c.id)}>Delete</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      {showTos && (
        <div className="modal-backdrop" onClick={() => setShowTos(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Terms of Service</h3>
            <div className="list" style={{ padding: 12, border: '1px solid var(--border)' }}>
              <p>Use this app at your own discretion. You retain responsibility for your invoice content, taxes, and compliance. This tool provides no guarantees and is offered “as is”.</p>
              <p>Do not store sensitive personal data beyond what is necessary. All data is kept in your browser’s local storage unless you explicitly connect external services.</p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={() => setShowTos(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {showPrivacy && (
        <div className="modal-backdrop" onClick={() => setShowPrivacy(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Privacy Policy</h3>
            <div className="list" style={{ padding: 12, border: '1px solid var(--border)' }}>
              <p>Data you enter is stored locally in your browser (localStorage). No invoice or client data is sent to a server unless you configure a webhook (e.g., for emailing) or use third‑party services.</p>
              <p>For features like emailing or payment links, data is shared only with the services you explicitly connect. Review and trust any endpoints you provide via environment variables.</p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={() => setShowPrivacy(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {/* Ad placeholders removed: Google auto-inserts ads */}
    </div>
  )
}

function Input({ label, value, onChange, type = 'text' }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function NumberField({ label, value, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

function Text({ label, value, onChange, rows = 3 }) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function InvoicePreview({ data, subtotal, tax, discount, total }) {
  return (
    <div id="invoice" className="invoice">
      <div className="invoice-top">
        <div className="invoice-brand">
          {data.meta.logoDataUrl && <img className="invoice-logo" src={data.meta.logoDataUrl} alt="Logo" />}
          <div>
            <div className="title">Invoice</div>
            <div className="muted">{data.meta.number} {' '}
              {data.meta.status === 'paid' && (<span className="badge paid">PAID</span>)}
              {(data.meta.status === 'overdue' || (data.meta.due && new Date(data.meta.due) < new Date() && data.meta.status !== 'paid')) && (
                <span className="badge overdue" style={{ marginLeft: 8 }}>OVERDUE</span>
              )}
            </div>
          </div>
        </div>
        <div className="align-right">
          <div>{data.your.company || data.your.name}</div>
          <div className="muted small">{data.your.email}</div>
          <div className="muted small">{data.your.phone}</div>
          {data.your.vatId && <div className="muted small">VAT/Tax: {data.your.vatId}</div>}
          <div className="muted small">{data.your.address}</div>
        </div>
      </div>
      <div className="invoice-meta">
        <div>
          <div className="label">Bill To</div>
          <div>{data.client.company || data.client.name}</div>
          {data.client.company && <div className="muted small">Attn: {data.client.name}</div>}
          <div className="muted small">{data.client.email}</div>
          {data.client.vatId && <div className="muted small">VAT/Tax: {data.client.vatId}</div>}
          <div className="muted small">{data.client.address}</div>
        </div>
        <div className="pay-block">
          <div className="align-right">
            <div><span className="label">Date:</span> {data.meta.date}</div>
            <div><span className="label">Due:</span> {data.meta.due}</div>
            <div><span className="label">Currency:</span> {data.meta.currency}</div>
            {data.meta.poNumber && <div><span className="label">PO:</span> {data.meta.poNumber}</div>}
          </div>
          {data.meta.paymentLink && (
            <div className="align-right">
              <div className="label">Pay via QR</div>
              <div className="qr">{qrDataUrl ? <img src={qrDataUrl} alt="Payment QR" /> : null}</div>
            </div>
          )}
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Qty</th>
            <th className="num">Price</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map(it => (
            <tr key={it.id}>
              <td>{it.description || '\u00A0'}</td>
              <td className="num">{it.qty}</td>
              <td className="num">{formatCurrency(it.price, data.meta.currency)}</td>
              <td className="num">{formatCurrency((it.qty||0)*(it.price||0), data.meta.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="totals-view">
        <div className="right">
          <div><span>Subtotal</span><span>{formatCurrency(subtotal, data.meta.currency)}</span></div>
          <div><span>Tax</span><span>{formatCurrency(tax, data.meta.currency)}</span></div>
          <div><span>Discount</span><span>-{formatCurrency(discount, data.meta.currency)}</span></div>
          <div className="grand"><span>Total</span><span>{formatCurrency(total, data.meta.currency)}</span></div>
        </div>
      </div>

      {data.meta.notes && (
        <div className="notes">
          <div className="label">Notes</div>
          <div className="muted small">{data.meta.notes}</div>
        </div>
      )}
    </div>
  )
}

function formatCurrency(value, currency) {
  const num = Number(value) || 0
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(num)
  } catch {
    return `${currency} ${num.toFixed(2)}`
  }
}

export default App
