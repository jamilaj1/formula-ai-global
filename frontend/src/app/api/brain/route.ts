import { NextResponse } from 'next/server'
import { generate, availableProvider } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// =============================================================================
// SAFETY GUARD: refuse pharmaceutical / drug formulations
// =============================================================================
// We are a cosmetics / cleaning / industrial chemistry tool. Generating
// pharmaceutical recipes is dangerous because:
//   1. Drugs require regulatory approval (FDA, SFDA, EMA, etc.)
//   2. Manufacturing must be GMP-certified
//   3. Wrong concentration or wrong inactive ingredients can be toxic
//   4. The AI may hallucinate ingredients (e.g. surfactants in pharma gels)
const PHARMA_PATTERNS = [
  // English drug names + classes
  /\b(metronidazole|flagyl|paracetamol|acetaminophen|ibuprofen|aspirin|amoxicillin|ciprofloxacin|azithromycin|omeprazole|atorvastatin|metformin|lisinopril|amlodipine|losartan|simvastatin|sertraline|levothyroxine|salbutamol|prednisolone|hydrocortisone|tretinoin|clindamycin|erythromycin|tetracycline|doxycycline|fluconazole|miconazole|ketoconazole|chlorhexidine\s+oral|panadol|tylenol|advil|motrin|nurofen|zoloft|prozac|xanax|valium)\b/i,
  // Drug categories
  /\b(antibiotic|antiviral|antifungal|antibacterial\s+drug|painkiller|analgesic|antihistamine|anticoagulant|antidepressant|antipsychotic|antiepileptic|antimalarial|chemotherap|prescription|otc\s+drug|pharmaceutical|pharma|medication|medicament)\b/i,
  // Dosage forms
  /\b(tablet|capsule|injection|injectable|suppository|syrup|elixir|tincture|oral\s+solution|eye\s+drops|ear\s+drops|nasal\s+spray|inhaler|vaccine|infusion|iv\s+fluid)\b/i,
  // Arabic
  /(فلاجيل|بنادول|اسبرين|ايبوبروفين|باراسيتامول|اموكسيسيلين|اوميبرازول|ميترونيدازول)/,
  /(دواء|أدوية|عقار|عقاقير|مضاد\s*حيوي|مضاد\s*للفيروسات|مضاد\s*للفطريات|مسكن|مهدئ)/,
  /(حبوب\s*دوائية|كبسولات\s*دوائية|حقن|تحاميل|شراب\s*طبي|قطرة\s*عين|قطرة\s*أذن|بخاخ\s*أنف|لقاح)/,
  // French
  /\b(médicament|antibiotique|antiviral|antifongique|comprimé|gélule|sirop|injection)\b/i,
  // Spanish
  /\b(medicamento|antibiótico|antiviral|antimicótico|comprimido|jarabe|inyección)\b/i,
  // German
  /\b(medikament|arznei|antibiotikum|tablette|sirup|spritze)\b/i,
  // Chinese / Japanese / Korean drug words
  /(药|藥|药品|藥品|抗生素|抗病毒|片剂|胶囊|注射|薬|錠剤|カプセル|약|약품|항생제)/,
]

function isPharmaQuery(query: string): boolean {
  return PHARMA_PATTERNS.some((re) => re.test(query))
}

function pharmaRefusal(language: string): string {
  const refusals: Record<string, string> = {
    ar: `# لا يمكن إنشاء هذه التركيبة

**هذا الموقع لا يقدّم تركيبات صيدلانية** للأسباب التالية:

1. **الأدوية تحتاج موافقات تنظيمية** (وزارة الصحة، FDA، EMA، SFDA) قبل تصنيعها أو بيعها
2. **التصنيع يجب أن يكون في مصنع GMP-certified** بأنظمة جودة معتمدة
3. **المواد الفعّالة (APIs)** يجب أن تأتي من موردين مرخّصين وبشهادات تحليل
4. **التراكيز الخاطئة قد تكون قاتلة** — جرعة صغيرة من بعض الأدوية مميتة
5. **اختبار الأمان والكفاءة** يتطلّب دراسات إكلينيكية على البشر

## ماذا يمكنني مساعدتك به

تركيبات **مستحضرات تجميل** (شامبو، كريم، صابون)، **منظّفات منزلية** (سائل جلي، مطهّر، مزيل بقع)، **منتجات صناعية** (طلاء، ملصقات، شموع)، **عطور ومطيّبات**.

جرّب بحثاً مثل: "كريم مرطّب اقتصادي" أو "سائل غسيل صحون".

للأدوية يرجى استشارة صيدلي مرخّص أو شركة أدوية معتمدة.`,

    en: `# I cannot generate this formulation

**This platform does not provide pharmaceutical formulations** because:

1. **Drugs require regulatory approval** (FDA, EMA, SFDA, MHRA) before being manufactured or sold
2. **Manufacturing must be GMP-certified** with validated quality systems
3. **Active Pharmaceutical Ingredients (APIs)** must come from licensed suppliers with Certificates of Analysis
4. **Wrong concentrations can be fatal** — many drugs have a narrow therapeutic window
5. **Safety and efficacy** require human clinical trials

## What I can help with

**Cosmetics** (shampoo, cream, soap), **household cleaners** (dish soap, disinfectant, stain remover), **industrial products** (paint, adhesives, candles), **fragrances and air fresheners**.

Try a query like: "Economical moisturizing cream" or "Liquid dish soap".

For pharmaceutical needs please consult a licensed pharmacist or registered drug manufacturer.`,
  }
  return refusals[language] || refusals.en
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
// SYSTEM PROMPT BUILDER
// =============================================================================
function buildSystemPrompt(language: string, tier: 'economy' | 'premium' | 'standard'): string {
  const base = `You are an expert chemical formulator with 30 years of experience in
COSMETICS, CLEANING PRODUCTS, and INDUSTRIAL CHEMISTRY ONLY. The user is writing
in ${language}; respond in ${language}.

ABSOLUTE SCOPE LIMITS:
- You ONLY help with: cosmetics (shampoo, cream, lotion, soap, fragrance),
  household cleaners (dish soap, detergent, disinfectant, polish), industrial
  chemistry (paint, adhesive, lubricant, ink, candle).
- You DO NOT generate pharmaceutical, medicinal, drug, or prescription
  formulations. If the user asks for one, refuse politely and explain that
  drugs require regulatory approval (FDA/SFDA/EMA) and GMP manufacturing.
- You DO NOT generate food recipes (consult a food technologist).
- You DO NOT generate explosives, energetic compounds, or weapons of any kind.

Always provide:
1. A clear formula name and category
2. A markdown table with columns: # | Component | CAS Number | % | Function
3. The percentages MUST sum to exactly 100%, with WATER as the balance
4. Step-by-step mixing procedure (numbered)
5. Safety warnings (PPE, incompatibilities, fatal-mix warnings)
6. Quality control parameters (pH, viscosity, appearance)
7. Estimated cost per kg in USD (rough order of magnitude)

HARD CHEMISTRY RULES:
- Use REAL CAS Registry Numbers only (never invented)
- Never mix anionic + cationic surfactants
- NaOCl + any acid = CHLORINE GAS (FATAL) — never propose this
- NaCl has no role in disinfectants
- Pine oil requires non-ionic emulsifiers, not anionic
- Cocamide DEA is restricted in many markets — prefer Cocamide MEA or
  Cocamidopropyl Betaine
- NEVER put cosmetic surfactants (CAPB, SLES, SLS) in pharmaceutical gels`

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
- Quote a cost in USD per kilogram below the market average
- Mention that local water quality may affect ratios in developing markets`
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

  // SAFETY: refuse pharmaceutical queries before calling any AI
  if (isPharmaQuery(query)) {
    return NextResponse.json({
      success: true,
      result: pharmaRefusal(language),
      query,
      tier: 'refused',
      provider: 'safety-guard',
      model: 'pharma-refusal',
    })
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
    const tier = detectCostTier(query)
    const system = buildSystemPrompt(language, tier)
    const out = await generate({ system, user: query, maxTokens: 4096, temperature: 0.1 })
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
