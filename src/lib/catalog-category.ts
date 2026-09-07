/**
 * Klasifikasi kategori Katalog Umum ke taksonomi ringkas ala toko kelontong/
 * grosir/ritel Indonesia (Bahasa Indonesia). Berbasis kata kunci pada
 * nama + kategori sumber + keywords + brand, plus petunjuk host foto (Open
 * Beauty Facts → perawatan diri). Dipakai seed & reclassify agar konsisten.
 */

export const CATALOG_CATEGORIES = [
  'Sembako',
  'Mie Instan',
  'Makanan Ringan',
  'Cokelat & Permen',
  'Minuman',
  'Kopi & Teh',
  'Susu & Olahan Susu',
  'Bumbu & Bahan Masak',
  'Makanan Kaleng & Instan',
  'Sarapan & Sereal',
  'Roti & Kue',
  'Perawatan Tubuh',
  'Pembersih Rumah Tangga',
  'Bayi & Anak',
  'Kesehatan',
  'Rokok',
  'Lainnya',
] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

const CLEANING =
  /(deterjen|detergent|pewangi pakaian|pelembut|softener|pembersih|cleaner|karbol|pel lantai|floor cleaner|pemutih|bleach|bayclin|dishwash|cuci piring|cuci baju|\brinso\b|so klin|\bmolto\b|wipol|super ?pell|\bvixal\b|harpic|baygon|obat nyamuk|pengharum ruangan|stella|kamper)/i;

// Urut dari paling spesifik → umum; match pertama menang.
const RULES: [CatalogCategory, RegExp][] = [
  ['Pembersih Rumah Tangga', CLEANING],
  [
    'Perawatan Tubuh',
    /(shampoo|shampo|sampo|conditioner|kondisioner|sabun mandi|sabun muka|body wash|face wash|facial|toothpaste|pasta gigi|\bodol\b|mouthwash|obat kumur|lotion|hand ?body|deodorant|deodoran|parfum|perfume|cologne|cosmetic|kosmetik|lipstick|lip ?balm|bedak|skincare|skin ?care|moisturizer|\bserum\b|pomade|minyak rambut|pembalut|pantyliner|\btisu\b|\btissue\b|razor|shaving|cukur|\bsoap\b)/i,
  ],
  ['Bayi & Anak', /(\bbaby\b|\bbayi\b|diaper|popok|\binfant\b|cerelac|milna|makanan bayi|susu formula|toddler|balita)/i],
  ['Rokok', /(cigarette|\brokok\b|kretek|tobacco|tembakau|\bfilter\b tar)/i],
  [
    'Kesehatan',
    /(vitamin|suplemen|supplement|\bobat\b|medicine|paracetamol|antangin|tolak angin|kayu putih|minyak angin|minyak telon|balsem|\bbalm\b|\bkoyo\b|hand sanitizer|masker medis|plester|antiseptik|betadine|protein powder|\bwhey\b)/i,
  ],
  ['Mie Instan', /(instant noodle|\bnoodles?\b|\bmie\b|\bmi\b goreng|mi instan|indomie|sedaap|pop ?mie|supermi|sarimi|\bbihun\b|kwetiau|\bpasta\b|spaghetti|makaroni)/i],
  // Snack dinaikkan prioritasnya agar "salty snacks"/"cream onion chips" tak salah ke Bumbu/Susu.
  ['Makanan Ringan', /(\bsnacks?\b|biscuit|biskuit|wafer|cracker|chips|keripik|crisps?|kerupuk|cookies?|pop ?corn|\bnuts\b|kacang|chiki|chitato|\btaro\b|qtela|richeese|nabati|momogi|astor|\broma\b|khong ?guan|biskuat|\boreo\b|tango|\bpilus\b|pringles|potato|seaweed|rumput laut|\bnori\b)/i],
  ['Kopi & Teh', /(\bcoffee\b|\bkopi\b|espresso|cappuccino|latte|kapal api|nescafe|good ?day|torabika|luwak|\btea\b|\bteh\b|matcha|sariwangi|tong ?tji|teh celup)/i],
  [
    'Susu & Olahan Susu',
    /(\bmilk\b|\bsusu\b|dairy|cheese|\bkeju\b|yogurt|yoghurt|butter|mentega|margarin|margarine|\bcream\b|\bcreme\b|custard|pudding|dessert|krimer|creamer|kental manis|condensed|\buht\b|frisian|ultra ?milk|dancow|indomilk|bear brand|\bmilo\b|ovaltine)/i,
  ],
  [
    'Minuman',
    /(\bwaters?\b|air mineral|\bsodas?\b|\bcolas?\b|soft ?drink|\bjuices?\b|\bjus\b|\bsirup\b|\bsyrup\b|isotonic|isotonik|energy drink|minuman|\bdrinks?\b|beverages?|coconut water|sprite|fanta|coca.?cola|pocari|\baqua\b|le minerale|teh botol|floridina|nutrisari|buavita|hydro ?coco|\bmarjan\b|kratingdaeng|extra joss)/i,
  ],
  ['Cokelat & Permen', /(chocolate|coklat|cokelat|\bcandy\b|permen|\bgum\b|lollipop|marshmallow|toffee|confectioner|silver ?queen|beng.?beng|\bdelfi\b|kit ?kat|mentos|kopiko|yupi|relaxa)/i],
  ['Sarapan & Sereal', /(cereal|sereal|\boat|oatmeal|granola|muesli|corn ?flakes|breakfast|\bspread\b|hazelnut|nutella|\bjam\b|\bselai\b|\bhoney\b|\bmadu\b|peanut butter|selai kacang|\bmeses\b|energen|quaker)/i],
  ['Roti & Kue', /(\bbread\b|\broti\b|\bcake\b|\bkue\b|pastry|\bdonut\b|bakery|sari roti)/i],
  ['Makanan Kaleng & Instan', /(canned|\bkaleng\b|sardine|sarden|corned|kornet|\btuna\b|instant food|siap saji|bubur instan|\babon\b|pronas|botan)/i],
  [
    'Bumbu & Bahan Masak',
    /(\bsauces?\b|\bsaus\b|sambal|\bkecap\b|ketchup|mayonnaise|mayones|seasoning|\bbumbu\b|penyedap|\bmsg\b|royco|masako|\bsasa\b|\bsoups?\b|\bsup\b|\bbroth\b|kaldu|garam dapur|vinegar|\bcuka\b|\bchili\b|\bcabai\b|tepung|\bflour\b|santan|coconut milk|saori|ladaku|desaku|bango)/i,
  ],
  ['Sembako', /(\brice\b|\bberas\b|\bsugar\b|\bgula\b|cooking oil|minyak goreng|vegetable oil|palm oil|olive oil|\bolio\b|zaitun|\bminyak\b|\boil\b|\btelur\b|\begg\b|bimoli|\bsania\b|gulaku|\bfilma\b|tropical|sunco)/i],
];

export interface ClassifyInput {
  name?: string | null;
  offCategory?: string | null;
  keywords?: string[] | null;
  brand?: string | null;
  photoUrl?: string | null;
}

/** Tentukan kategori Bahasa Indonesia. Default 'Lainnya' bila tak cocok. */
export function classifyCategory(input: ClassifyInput): CatalogCategory {
  const hay = [input.name, input.offCategory, (input.keywords ?? []).join(' '), input.brand]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  // Produk dari Open Beauty Facts → perawatan diri (kecuali jelas pembersih).
  const isBeauty = (input.photoUrl ?? '').includes('openbeautyfacts');
  if (isBeauty) return CLEANING.test(hay) ? 'Pembersih Rumah Tangga' : 'Perawatan Tubuh';

  for (const [cat, re] of RULES) {
    if (re.test(hay)) return cat;
  }
  return 'Lainnya';
}
