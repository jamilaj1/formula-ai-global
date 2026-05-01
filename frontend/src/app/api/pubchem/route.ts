import { NextResponse } from 'next/server'

export const runtime = 'edge'

// PubChem PUG REST: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest
// No API key required. Used for verifying CAS numbers and getting basic
// safety / identification info on a chemical the user typed.
const BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'

type Hit = {
  cid: number
  iupac_name?: string
  molecular_formula?: string
  molecular_weight?: number
  cas_numbers: string[]
  pubchem_url: string
}

async function getCidsByName(name: string): Promise<number[]> {
  const url = `${BASE}/compound/name/${encodeURIComponent(name)}/cids/JSON`
  const res = await fetch(url, { next: { revalidate: 86400 } })
  if (!res.ok) return []
  const json = await res.json()
  return json?.IdentifierList?.CID || []
}

async function getProps(cid: number) {
  const url = `${BASE}/compound/cid/${cid}/property/IUPACName,MolecularFormula,MolecularWeight/JSON`
  const res = await fetch(url, { next: { revalidate: 86400 } })
  if (!res.ok) return null
  const json = await res.json()
  return json?.PropertyTable?.Properties?.[0] || null
}

async function getCasNumbers(cid: number): Promise<string[]> {
  // Synonyms endpoint returns aliases including CAS RN like "67-63-0".
  const url = `${BASE}/compound/cid/${cid}/synonyms/JSON`
  const res = await fetch(url, { next: { revalidate: 86400 } })
  if (!res.ok) return []
  const json = await res.json()
  const all: string[] = json?.InformationList?.Information?.[0]?.Synonym || []
  // CAS numbers are 2-7-1 digit dash patterns.
  const re = /^\d{2,7}-\d{2}-\d$/
  return all.filter((s) => re.test(s)).slice(0, 5)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')?.trim()
  if (!name) {
    return NextResponse.json({ error: 'name query param required' }, { status: 400 })
  }

  try {
    const cids = await getCidsByName(name)
    if (cids.length === 0) {
      return NextResponse.json({ found: false, query: name })
    }

    const cid = cids[0]
    const [props, cas] = await Promise.all([getProps(cid), getCasNumbers(cid)])

    const hit: Hit = {
      cid,
      iupac_name: props?.IUPACName,
      molecular_formula: props?.MolecularFormula,
      molecular_weight: props?.MolecularWeight,
      cas_numbers: cas,
      pubchem_url: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
    }

    return NextResponse.json({ found: true, query: name, hit })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'PubChem lookup failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
