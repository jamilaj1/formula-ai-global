import { NextResponse } from 'next/server'
import { generate, availableProvider } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// =============================================================================
// PHARMA DETECTION (for routing to the strict pharma prompt, not refusal)
// =============================================================================
const PHARMA_PATTERNS = [
  /\b(metronidazole|flagyl|paracetamol|acetaminophen|ibuprofen|aspirin|amoxicillin|ciprofloxacin|azithromycin|omeprazole|atorvastatin|metformin|lisinopril|amlodipine|losartan|simvastatin|sertraline|levothyroxine|salbutamol|prednisolone|hydrocortisone|tretinoin|clindamycin|erythromycin|tetracycline|doxycycline|fluconazole|miconazole|ketoconazole|clotrimazole|panadol|tylenol|advil|nurofen|diclofenac|naproxen|ranitidine|loratadine|cetirizine|dextromethorphan|guaifenesin|chlorpheniramine|loperamide|pseudoephedrine)\b/i,
  /\b(antibiotic|antiviral|antifungal|antibacterial\s+drug|painkiller|analgesic|antihistamine|anticoagulant|antidepressant|antipsychotic|antiepileptic|antimalarial|prescription|otc\s+drug|pharmaceutical|pharma|medication|medicament)\b/i,
  /\b(tablet|capsule|injection|injectable|suppository|syrup|elixir|tincture|oral\s+solution|eye\s+drops|ear\s+drops|nasal\s+spray|inhaler|topical\s+gel|cream\s+pharma|ointment\s+drug)\b/i,
  /(فلاجيل|بنادول|اسبرين|ايبوبروفين|باراسيتامول|اموكسيسيلين|اوميبرازول|ميترونيدازول|كلوتريمازول|هيدروكورتيزون|كلينداميسين)/,
  /(دواء|أدوية|عقار|عقاقير|مضاد\s*حيوي|مضاد\s*للفيروسات|مضاد\s*للفطريات|مسكن|طبي|صيدلاني|صيدلانية)/,
  /(حبوب\s*دوائية|كبسولات\s*دوائية|حقن|تحاميل|شراب\s*طبي|قطرة\s*عين|قطرة\s*أذن|بخاخ\s*أنف|لقاح|مرهم\s*طبي|جل\s*طبي)/,
  /\b(médicament|antibiotique|antiviral|antifongique|comprimé|gélule|sirop|injection|crème\s+pharmaceutique)\b/i,
  /\b(medicamento|antibiótico|antiviral|antimicótico|comprimido|jarabe|inyección|crema\s+farmacéutica)\b/i,
  /\b(medikament|arznei|antibiotikum|tablette|sirup|spritze)\b/i,
  /(药|藥|药品|藥品|抗生素|抗病毒|片剂|胶囊|注射|薬|錠剤|カプセル|약|약품|항생제)/,
]

function isPharmaQuery(query: string): boolean {
  return PHARMA_PATTERNS.some((re) => re.test(query))
}

// =============================================================================
// COST TIER DETECTION
// =============================================================================
const ECONOMY_PATTERNS = [
  /\b(cheap|cheapest|low[- ]?cost|low[- ]?price|economy|economical|budget|affordable)\b/i,
  /منخفض(\s|ال)*(التكلفة|تكلفة|السعر|السع)/,
  /اقتصاد(ي|ية|يه)/,
  /رخيص/,
  /(bon\s+marché|économique|à\s+bas\s+prix)/i,
  /(barato|económico|de\s+bajo\s+precio)/i,
  /(günstig|preiswert|billig)/i,
  /(便宜|低成本|经济|廉价)/,
  /(安価|経済的|低コスト)/,
  /(저렴|경제|저비용)/,
  /(arzon|murah)/i,
]

const PREMIUM_PATTERNS = [
  /\b(premium|luxury|high[- ]?end|professional[- ]?grade|salon[- ]?grade)\b/i,
  /(فاخر|راقي|محترف|مميز|درجة\s*أولى)/,
  /(haut\s+de\s+gamme|luxe|premium)/i,
  /(de\s+lujo|premium|alta\s+gama)/i,
  /(豪华|高端|专业级|顶级)/,
  /(高級|プレミアム|サロン)/,
]

function detectCostTier(query: string): 'economy' | 'premium' | 'standard' {
  if (ECONOMY_PATTERNS.some((re) => re.test(query))) return 'economy'
  if (PREMIUM_PATTERNS.some((re) => re.test(query))) return 'premium'
  return 'standard'
}

// =============================================================================
// PROMPTS
// =============================================================================
function pharmaSystemPrompt(language: string): string {
  return `You are a senior pharmaceutical formulation chemist providing a REFERENCE
formulation for a known medicine. The user is writing in ${language}; respond
in ${language}.

CRITICAL: This is for ACADEMIC / REFERENCE / EDUCATIONAL purposes only.
Always START the response with this disclaimer (translated to ${language}):

  > **For educational reference only — not a manufacturing instruction.**
  > Pharmaceutical products require regulatory approval (FDA / SFDA / EMA),
  > GMP manufacturing, API certificates of analysis, and clinical validation.
  > Do NOT make or use this at home. Consult a licensed pharmacist or a
  > registered drug manufacturer.

ABSOLUTE PHARMA RULES — these MUST be followed:

1. Use ONLY pharmaceutical-grade excipients. NEVER use these cosmetic-only
   ingredients in pharma formulations:
     - Cocamidopropyl Betaine (CAPB)
     - SLES (Sodium Laureth Sulfate)
     - SLS / Sodium Lauryl Sulfate (only in tooth pastes, NEVER in topical gels)
     - LABSA / linear alkylbenzene sulfonate
     - Cocamide DEA / MEA
     - These are for shampoos and detergents, NOT pharmaceuticals.

2. Use the CORRECT API concentration as approved in the official monograph:
     - Metronidazole topical gel: 0.75% (NOT 10%)
     - Metronidazole vaginal gel: 0.75%
     - Clotrimazole cream: 1%
     - Hydrocortisone cream: 0.5%, 1%, or 2.5%
     - Ketoconazole cream: 2%
     - Miconazole cream: 2%
     - Tretinoin cream: 0.025%, 0.05%, or 0.1%
     - Diclofenac gel: 1% or 2.32%
     - Ibuprofen gel: 5%
   If you do not know the exact official concentration, say so explicitly.

3. Use ONLY appropriate pharmaceutical excipients per dosage form:

   TOPICAL GEL excipients (typical):
     - Gelling agent: Carbomer 940 or 980 (0.5-2%)
     - Neutralizer: Triethanolamine (qs to pH 5-6)
     - Humectant / co-solvent: Propylene Glycol (5-20%) or Glycerin (5-15%)
     - Preservative: Methylparaben (0.18%) + Propylparaben (0.02%), OR
                    Phenoxyethanol (0.5-1%), OR Benzyl Alcohol (1-2%)
     - Solubilizer (if API is poorly soluble): Polysorbate 80 (0.5-2%)
     - Antioxidant (if API is sensitive): Butylated Hydroxyanisole (BHA) 0.01%
     - Vehicle: Purified Water USP qs to 100%

   ORAL TABLET excipients:
     - Diluent: Lactose Monohydrate, Microcrystalline Cellulose (Avicel)
     - Binder: PVP K30, HPMC
     - Disintegrant: Croscarmellose Sodium, Sodium Starch Glycolate
     - Lubricant: Magnesium Stearate (0.5-2%)
     - Glidant: Colloidal Silicon Dioxide (Aerosil) 0.1-1%

   ORAL SYRUP / SUSPENSION excipients:
     - Sweetener: Sucrose, Sorbitol 70%
     - Suspending agent: Xanthan Gum, MCC + CMC
     - Preservative: Sodium Benzoate (0.1%) + Methylparaben (0.18%)
     - Flavor: appropriate fruit flavor
     - pH adjuster: Citric Acid + Sodium Citrate buffer
     - Vehicle: Purified Water USP qs to 100%

4. Provide REAL CAS Registry Numbers for every ingredient.

5. The MARKDOWN TABLE must have columns:
     # | Component | CAS Number | % w/w | Pharmaceutical Function

6. After the table, include:
     - Step-by-step compounding procedure
     - Required equipment (pharma-grade)
     - In-process and finished-product QC tests
     - Storage conditions and shelf-life estimate
     - Required regulatory pathway (e.g. ANDA, NDA, CTD)
     - Common excipient incompatibilities to avoid

7. Percentages must sum to exactly 100% with water/vehicle as the balance.

If the user asks for a drug whose composition is genuinely unknown to you,
state that clearly rather than inventing one.`
}

function consumerSystemPrompt(language: string, tier: 'economy' | 'premium' | 'standard'): string {
  const base = `You are an expert chemical formulator with 30 years of experience in
COSMETICS, CLEANING PRODUCTS, and INDUSTRIAL CHEMISTRY. The user is writing
in ${language}; respond in ${language}.

Always provide:
1. A clear formula name and category
2. A markdown table with columns: # | Component | CAS Number | % | Function
3. The percentages MUST sum to exactly 100%, with WATER as the balance
4. Step-by-step mixing procedure (numbered)
5. Safety warnings (PPE, incompatibilities, fatal-mix warnings)
6. Quality control parameters (pH, viscosity, appearance)
7. Estimated cost per kg in USD (rough order of magnitude)

HARD RULES:
- Use REAL CAS Registry Numbers only (never invented)
- Never mix anionic + cationic surfactants
- NaOCl + any acid = CHLORINE GAS (FATAL) — never propose this
- NaCl has no role in disinfectants
- Pine oil requires non-ionic emulsifiers, not anionic
- Cocamide DEA is restricted in many markets — prefer Cocamide MEA or
  Cocamidopropyl Betaine`

  if (tier === 'economy') {
    return `${base}

THIS IS AN ECONOMY / LOW-COST REQUEST. The user explicitly asked for the
cheapest possible formulation. You MUST:

- Use the absolute MINIMUM number of ingredients (typically 5-7, not 10+)
- Use ONLY the cheapest commodity chemicals available globally:
  * LABSA / Sodium Lauryl Sulfate (cheap surfactants) — yes
  * Sodium Chloride (table salt) for thickening — yes
  * Citric Acid for pH — yes
  * Sodium Hydroxide for neutralization — yes
  * Water as ~70-80% of the formula — yes
- AVOID expensive ingredients in this tier:
  * Glycerin (premium humectant) — REMOVE unless absolutely required
  * SLES (more expensive than LABSA) — only if LABSA alone won't work
  * Cocamide DEA / MEA (premium foam booster) — REMOVE
  * Specialty preservatives — use sodium benzoate instead
  * Premium fragrances — use a generic citrus or pine fragrance at 0.1-0.2%
- Quote a cost in USD per kilogram below the market average`
  }

  if (tier === 'premium') {
    return `${base}

This is a PREMIUM / SALON-GRADE request. Use professional-grade ingredients:
- Mild surfactants (Cocamidopropyl Betaine, Decyl Glucoside, Coco Glucoside)
- Conditioning agents (Polyquaternium-7, Glycerin, Panthenol)
- Premium preservatives (Phenoxyethanol + Ethylhexylglycerin, Geogard)
- Higher cost is expected; quote it honestly`
  }

  return base
}

// =============================================================================
// HANDLER
// =============================================================================
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('query') || ''
  const language = searchParams.get('language') || 'en'

  if (!query) {
    return NextResponse.json({ error: 'Query required' }, { status: 400 })
  }

  if (availableProvider() === 'none') {
    return NextResponse.json(
      {
        success: false,
        error: 'No AI provider configured. Set GROQ_API_KEY (free at console.groq.com) or ANTHROPIC_API_KEY in Vercel env.',
      },
      { status: 500 }
    )
  }

  try {
    const isPharma = isPharmaQuery(query)
    const tier = isPharma ? 'pharma' : detectCostTier(query)
    const system = isPharma
      ? pharmaSystemPrompt(language)
      : consumerSystemPrompt(language, tier as 'economy' | 'premium' | 'standard')

    // Pharma needs Anthropic for accuracy; cosmetics can use Groq for speed/cost
    const out = await generate({
      system,
      user: query,
      maxTokens: 4096,
      temperature: 0.1,
      preferredProvider: isPharma ? 'anthropic' : 'groq',
    })

    return NextResponse.json({
      success: true,
      result: out.text,
      query,
      tier,
      provider: out.provider,
      model: out.model,
    })
  } catch (error: unknown) {
    console.error('Brain error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
