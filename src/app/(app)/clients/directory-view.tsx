'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiClientError, apiListAll, apiRequest } from '@/lib/client-api'
import { Chip, KpiCard } from '@/components/ui/primitives'
import { Icons } from '@/components/ui/icons'

interface ClientRow {
  id: string
  name: string
  clientType: 'BUSINESS' | 'INDIVIDUAL'
  tinNumber: string | null
  email: string | null
  phone: string | null
  address: string | null
  city?: string | null
  countryCode?: string | null
  postcode?: string | null
  contactPerson: string | null
  notes: string | null
  isActive: boolean
}

interface SupplierRow {
  id: string
  name: string
  country: string | null
  email: string | null
  phone: string | null
  address: string | null
  city?: string | null
  postcode?: string | null
  isActive: boolean
}

type DirectoryTab = 'clients' | 'suppliers'

const emptyClient: {
  name: string
  clientType: ClientRow['clientType']
  tinNumber: string
  email: string
  phone: string
  address: string
  city: string
  countryCode: string
  postcode: string
  contactPerson: string
  notes: string
} = {
  name: '', clientType: 'BUSINESS' as const, tinNumber: '', email: '', phone: '',
  address: '', city: '', countryCode: 'BS', postcode: '', contactPerson: '', notes: '',
}
const emptySupplier = {
  name: '', country: 'US', email: '', phone: '', address: '', city: '', postcode: '',
}

function optional(value: string) {
  const trimmed = value.trim()
  return trimmed || undefined
}

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError && error.details) {
    const first = Object.values(error.details).flat()[0]
    return first ?? error.message
  }
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

export function DirectoryView() {
  const [tab, setTab] = useState<DirectoryTab>('clients')
  const [clients, setClients] = useState<ClientRow[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [clientDraft, setClientDraft] = useState(emptyClient)
  const [supplierDraft, setSupplierDraft] = useState(emptySupplier)

  const load = useCallback(async () => {
    try {
      const [clientRows, supplierRows] = await Promise.all([
        apiListAll<ClientRow>('/api/clients'),
        apiListAll<SupplierRow>('/api/suppliers'),
      ])
      setClients(clientRows)
      setSuppliers(supplierRows)
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const visibleClients = useMemo(() => {
    const q = query.trim().toLowerCase()
    return clients.filter((row) => !q || [row.name, row.email, row.tinNumber, row.contactPerson].some((v) => v?.toLowerCase().includes(q)))
  }, [clients, query])
  const visibleSuppliers = useMemo(() => {
    const q = query.trim().toLowerCase()
    return suppliers.filter((row) => !q || [row.name, row.email, row.country].some((v) => v?.toLowerCase().includes(q)))
  }, [suppliers, query])

  function beginCreate() {
    setEditingId('new')
    setNotice(null)
    if (tab === 'clients') setClientDraft(emptyClient)
    else setSupplierDraft(emptySupplier)
  }

  function editClient(row: ClientRow) {
    setTab('clients')
    setEditingId(row.id)
    setClientDraft({
      name: row.name,
      clientType: row.clientType,
      tinNumber: row.tinNumber ?? '',
      email: row.email ?? '',
      phone: row.phone ?? '',
      address: row.address ?? '',
      city: row.city ?? '',
      countryCode: row.countryCode ?? '',
      postcode: row.postcode ?? '',
      contactPerson: row.contactPerson ?? '',
      notes: row.notes ?? '',
    })
  }

  function editSupplier(row: SupplierRow) {
    setTab('suppliers')
    setEditingId(row.id)
    setSupplierDraft({
      name: row.name,
      country: row.country ?? '',
      email: row.email ?? '',
      phone: row.phone ?? '',
      address: row.address ?? '',
      city: row.city ?? '',
      postcode: row.postcode ?? '',
    })
  }

  async function saveClient() {
    if (!clientDraft.name.trim() || saving || !editingId) return
    setSaving(true)
    setNotice(null)
    try {
      const patching = editingId !== 'new'
      const body = {
        name: clientDraft.name.trim(),
        clientType: clientDraft.clientType,
        tinNumber: optional(clientDraft.tinNumber) ?? (patching ? null : undefined),
        email: optional(clientDraft.email) ?? (patching ? null : undefined),
        phone: optional(clientDraft.phone) ?? (patching ? null : undefined),
        address: optional(clientDraft.address) ?? (patching ? null : undefined),
        city: optional(clientDraft.city) ?? (patching ? null : undefined),
        countryCode: optional(clientDraft.countryCode)?.toUpperCase() ?? (patching ? null : undefined),
        postcode: optional(clientDraft.postcode) ?? (patching ? null : undefined),
        contactPerson: optional(clientDraft.contactPerson) ?? (patching ? null : undefined),
        notes: optional(clientDraft.notes) ?? (patching ? null : undefined),
      }
      await apiRequest<ClientRow>(editingId === 'new' ? '/api/clients' : `/api/clients/${editingId}`, {
        method: editingId === 'new' ? 'POST' : 'PATCH',
        body: JSON.stringify(body),
      })
      setEditingId(null)
      await load()
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function saveSupplier() {
    if (!supplierDraft.name.trim() || saving || !editingId) return
    setSaving(true)
    setNotice(null)
    try {
      const patching = editingId !== 'new'
      const body = {
        name: supplierDraft.name.trim(),
        country: optional(supplierDraft.country)?.toUpperCase() ?? (patching ? null : undefined),
        email: optional(supplierDraft.email) ?? (patching ? null : undefined),
        phone: optional(supplierDraft.phone) ?? (patching ? null : undefined),
        address: optional(supplierDraft.address) ?? (patching ? null : undefined),
        city: optional(supplierDraft.city) ?? (patching ? null : undefined),
        postcode: optional(supplierDraft.postcode) ?? (patching ? null : undefined),
      }
      await apiRequest<SupplierRow>(editingId === 'new' ? '/api/suppliers' : `/api/suppliers/${editingId}`, {
        method: editingId === 'new' ? 'POST' : 'PATCH',
        body: JSON.stringify(body),
      })
      setEditingId(null)
      await load()
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function setActive(kind: DirectoryTab, id: string, isActive: boolean) {
    setSaving(true)
    setNotice(null)
    try {
      await apiRequest(kind === 'clients' ? `/api/clients/${id}` : `/api/suppliers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      })
      await load()
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const field = { display: 'flex', flexDirection: 'column' as const, gap: 4 }

  return (
    <div className="sb-page">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 16 }}>
        <div>
          <h1 className="sb-h1">Client directory</h1>
          <p className="sb-meta" style={{ marginTop: 4 }}>Consignees and suppliers available to declaration preparation.</p>
        </div>
        <div style={{ flex: 1 }} />
        <button className="sb-btn is-primary" onClick={beginCreate}><Icons.plus /> New {tab === 'clients' ? 'client' : 'supplier'}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard label="Active clients" value={clients.filter((row) => row.isActive).length} sub="Available as consignees" tone="acc" />
        <KpiCard label="Active suppliers" value={suppliers.filter((row) => row.isActive).length} sub="Available for invoices" tone="pos" />
        <KpiCard label="Inactive records" value={[...clients, ...suppliers].filter((row) => !row.isActive).length} sub="Retained for audit history" />
      </div>

      {notice && <div className="sb-card sb-pad" role="status" style={{ marginBottom: 12, borderLeft: '3px solid var(--sb-neg)' }}>{notice}</div>}

      <div className="sb-stabs">
        <button className={`sb-stab ${tab === 'clients' ? 'is-active' : ''}`} onClick={() => { setTab('clients'); setEditingId(null) }}>Clients <span className="sb-count">{clients.length}</span></button>
        <button className={`sb-stab ${tab === 'suppliers' ? 'is-active' : ''}`} onClick={() => { setTab('suppliers'); setEditingId(null) }}>Suppliers <span className="sb-count">{suppliers.length}</span></button>
        <div style={{ flex: 1 }} />
        <div className="sb-search" style={{ margin: '3px 0' }}><Icons.search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${tab}…`} /></div>
      </div>

      {editingId && (
        <div className="sb-card sb-pad" style={{ margin: '14px 0', borderLeft: '3px solid var(--sb-accent)' }}>
          <div className="sb-h2" style={{ marginBottom: 12 }}>{editingId === 'new' ? 'Create' : 'Edit'} {tab === 'clients' ? 'client' : 'supplier'}</div>
          {tab === 'clients' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
              <label style={{ ...field, gridColumn: 'span 2' }}><span className="sb-eyebrow">Name</span><input className="sb-inp" value={clientDraft.name} onChange={(e) => setClientDraft((d) => ({ ...d, name: e.target.value }))} /></label>
              <label style={field}><span className="sb-eyebrow">Type</span><select className="sb-inp" value={clientDraft.clientType} onChange={(e) => setClientDraft((d) => ({ ...d, clientType: e.target.value as ClientRow['clientType'] }))}><option value="BUSINESS">Business</option><option value="INDIVIDUAL">Individual</option></select></label>
              <label style={field}><span className="sb-eyebrow">TIN</span><input className="sb-inp sb-mono" value={clientDraft.tinNumber} onChange={(e) => setClientDraft((d) => ({ ...d, tinNumber: e.target.value }))} /></label>
              <label style={field}><span className="sb-eyebrow">Email</span><input className="sb-inp" type="email" value={clientDraft.email} onChange={(e) => setClientDraft((d) => ({ ...d, email: e.target.value }))} /></label>
              <label style={field}><span className="sb-eyebrow">Phone</span><input className="sb-inp" value={clientDraft.phone} onChange={(e) => setClientDraft((d) => ({ ...d, phone: e.target.value }))} /></label>
              <label style={field}><span className="sb-eyebrow">Contact</span><input className="sb-inp" value={clientDraft.contactPerson} onChange={(e) => setClientDraft((d) => ({ ...d, contactPerson: e.target.value }))} /></label>
              <label style={field}><span className="sb-eyebrow">Country</span><input className="sb-inp sb-mono" maxLength={2} value={clientDraft.countryCode} onChange={(e) => setClientDraft((d) => ({ ...d, countryCode: e.target.value.toUpperCase() }))} /></label>
              <label style={{ ...field, gridColumn: 'span 2' }}><span className="sb-eyebrow">Address</span><input className="sb-inp" value={clientDraft.address} onChange={(e) => setClientDraft((d) => ({ ...d, address: e.target.value }))} /></label>
              <label style={field}><span className="sb-eyebrow">City</span><input className="sb-inp" value={clientDraft.city} onChange={(e) => setClientDraft((d) => ({ ...d, city: e.target.value }))} /></label>
              <label style={field}><span className="sb-eyebrow">Postcode</span><input className="sb-inp" value={clientDraft.postcode} onChange={(e) => setClientDraft((d) => ({ ...d, postcode: e.target.value }))} /></label>
              <label style={{ ...field, gridColumn: 'span 4' }}><span className="sb-eyebrow">Notes</span><textarea className="sb-inp" rows={2} value={clientDraft.notes} onChange={(e) => setClientDraft((d) => ({ ...d, notes: e.target.value }))} /></label>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
              <label style={{ ...field, gridColumn: 'span 2' }}><span className="sb-eyebrow">Name</span><input className="sb-inp" value={supplierDraft.name} onChange={(e) => setSupplierDraft((d) => ({ ...d, name: e.target.value }))} /></label>
              <label style={field}><span className="sb-eyebrow">Country</span><input className="sb-inp sb-mono" maxLength={2} value={supplierDraft.country} onChange={(e) => setSupplierDraft((d) => ({ ...d, country: e.target.value.toUpperCase() }))} /></label>
              <label style={field}><span className="sb-eyebrow">Email</span><input className="sb-inp" type="email" value={supplierDraft.email} onChange={(e) => setSupplierDraft((d) => ({ ...d, email: e.target.value }))} /></label>
              <label style={field}><span className="sb-eyebrow">Phone</span><input className="sb-inp" value={supplierDraft.phone} onChange={(e) => setSupplierDraft((d) => ({ ...d, phone: e.target.value }))} /></label>
              <label style={{ ...field, gridColumn: 'span 2' }}><span className="sb-eyebrow">Address</span><input className="sb-inp" value={supplierDraft.address} onChange={(e) => setSupplierDraft((d) => ({ ...d, address: e.target.value }))} /></label>
              <label style={field}><span className="sb-eyebrow">City</span><input className="sb-inp" value={supplierDraft.city} onChange={(e) => setSupplierDraft((d) => ({ ...d, city: e.target.value }))} /></label>
              <label style={field}><span className="sb-eyebrow">Postcode</span><input className="sb-inp" value={supplierDraft.postcode} onChange={(e) => setSupplierDraft((d) => ({ ...d, postcode: e.target.value }))} /></label>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button className="sb-btn" onClick={() => setEditingId(null)} disabled={saving}>Cancel</button>
            <button className="sb-btn is-primary" onClick={() => void (tab === 'clients' ? saveClient() : saveSupplier())} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      <div className="sb-card" style={{ overflowX: 'auto', marginTop: 14 }}>
        {loading ? <div className="sb-pad sb-meta">Loading directory…</div> : tab === 'clients' ? (
          <table className="sb-tbl"><thead><tr><th>Name</th><th>Type / TIN</th><th>Contact</th><th>Location</th><th>Status</th><th /></tr></thead><tbody>
            {visibleClients.map((row) => <tr key={row.id}><td className="sb-strong">{row.name}</td><td><div>{row.clientType}</div><div className="sb-meta sb-mono">{row.tinNumber ?? 'No TIN'}</div></td><td><div>{row.contactPerson ?? '—'}</div><div className="sb-meta">{row.email ?? row.phone ?? 'No contact details'}</div></td><td>{[row.city, row.countryCode].filter(Boolean).join(', ') || '—'}</td><td><Chip kind={row.isActive ? 'pos' : 'draft'}>{row.isActive ? 'Active' : 'Inactive'}</Chip></td><td><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}><button className="sb-btn is-sm" onClick={() => editClient(row)}><Icons.edit /> Edit</button><button className="sb-btn is-sm" disabled={saving} onClick={() => void setActive('clients', row.id, !row.isActive)}>{row.isActive ? 'Deactivate' : 'Reactivate'}</button></div></td></tr>)}
            {visibleClients.length === 0 && <tr><td colSpan={6} className="sb-meta" style={{ textAlign: 'center', padding: 28 }}>No clients found. Create one to begin a shipment.</td></tr>}
          </tbody></table>
        ) : (
          <table className="sb-tbl"><thead><tr><th>Name</th><th>Country</th><th>Contact</th><th>Address</th><th>Status</th><th /></tr></thead><tbody>
            {visibleSuppliers.map((row) => <tr key={row.id}><td className="sb-strong">{row.name}</td><td className="sb-mono">{row.country ?? '—'}</td><td><div>{row.email ?? '—'}</div><div className="sb-meta">{row.phone ?? ''}</div></td><td>{[row.address, row.city].filter(Boolean).join(', ') || '—'}</td><td><Chip kind={row.isActive ? 'pos' : 'draft'}>{row.isActive ? 'Active' : 'Inactive'}</Chip></td><td><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}><button className="sb-btn is-sm" onClick={() => editSupplier(row)}><Icons.edit /> Edit</button><button className="sb-btn is-sm" disabled={saving} onClick={() => void setActive('suppliers', row.id, !row.isActive)}>{row.isActive ? 'Deactivate' : 'Reactivate'}</button></div></td></tr>)}
            {visibleSuppliers.length === 0 && <tr><td colSpan={6} className="sb-meta" style={{ textAlign: 'center', padding: 28 }}>No suppliers found. Create one before adding a commercial invoice.</td></tr>}
          </tbody></table>
        )}
      </div>
    </div>
  )
}
