/**
 * Reference data for `prisma/seed.ts`.
 * Categories, brands, geography, ledger system accounts and campaign copy ONLY.
 * Absolute rule: no product, no price, no stock, no delivery fee is seeded.
 */

export type L = { ar: string; en: string; fr: string };

export type CategorySeed = {
  slug: string;
  icon: string;
  name: L;
  children: { slug: string; icon: string; name: L }[];
};

export const CATEGORIES: CategorySeed[] = [
  {
    slug: 'smartphones',
    icon: 'smartphone',
    name: { ar: 'الهواتف الذكية', en: 'Smartphones', fr: 'Smartphones' },
    children: [
      { slug: 'smartphones-apple', icon: 'smartphone', name: { ar: 'آيفون من أبل', en: 'Apple iPhone', fr: 'Apple iPhone' } },
      { slug: 'smartphones-samsung', icon: 'smartphone', name: { ar: 'سامسونج جالاكسي', en: 'Samsung Galaxy', fr: 'Samsung Galaxy' } },
      { slug: 'smartphones-honor', icon: 'smartphone', name: { ar: 'هونر', en: 'HONOR', fr: 'HONOR' } },
      { slug: 'smartphones-xiaomi', icon: 'smartphone', name: { ar: 'شاومي', en: 'Xiaomi', fr: 'Xiaomi' } },
      { slug: 'smartphones-huawei', icon: 'smartphone', name: { ar: 'هواوي', en: 'Huawei', fr: 'Huawei' } },
      { slug: 'smartphones-google-pixel', icon: 'smartphone', name: { ar: 'جوجل بكسل', en: 'Google Pixel', fr: 'Google Pixel' } },
      { slug: 'smartphones-oneplus', icon: 'smartphone', name: { ar: 'ون بلس', en: 'OnePlus', fr: 'OnePlus' } },
      { slug: 'smartphones-oppo', icon: 'smartphone', name: { ar: 'أوبو', en: 'OPPO', fr: 'OPPO' } },
      { slug: 'smartphones-other', icon: 'smartphone', name: { ar: 'علامات تجارية أخرى', en: 'Other brands', fr: 'Autres marques' } },
    ],
  },
  {
    slug: 'computers',
    icon: 'laptop',
    name: { ar: 'أجهزة الكمبيوتر', en: 'Computers', fr: 'Ordinateurs' },
    children: [
      { slug: 'macbook', icon: 'laptop', name: { ar: 'ماك بوك', en: 'MacBook', fr: 'MacBook' } },
      { slug: 'laptops', icon: 'laptop', name: { ar: 'أجهزة لابتوب', en: 'Laptops', fr: 'Ordinateurs portables' } },
      { slug: 'gaming-pc', icon: 'gamepad-2', name: { ar: 'أجهزة كمبيوتر للألعاب', en: 'Gaming PCs', fr: 'PC gaming' } },
      { slug: 'desktops', icon: 'monitor', name: { ar: 'أجهزة مكتبية', en: 'Desktops', fr: 'Ordinateurs de bureau' } },
      { slug: 'mini-pc', icon: 'box', name: { ar: 'أجهزة ميني بي سي', en: 'Mini PCs', fr: 'Mini-PC' } },
      { slug: 'monitors', icon: 'monitor', name: { ar: 'شاشات', en: 'Monitors', fr: 'Écrans' } },
      { slug: 'pc-components', icon: 'cpu', name: { ar: 'مكونات الكمبيوتر', en: 'PC components', fr: 'Composants PC' } },
    ],
  },
  {
    slug: 'audio',
    icon: 'headphones',
    name: { ar: 'الصوتيات', en: 'Audio', fr: 'Audio' },
    children: [
      { slug: 'airpods', icon: 'headphones', name: { ar: 'إيربودز', en: 'AirPods', fr: 'AirPods' } },
      { slug: 'galaxy-buds', icon: 'headphones', name: { ar: 'جالاكسي بودز', en: 'Galaxy Buds', fr: 'Galaxy Buds' } },
      { slug: 'headphones', icon: 'headphones', name: { ar: 'سماعات رأس', en: 'Headphones', fr: 'Casques' } },
      { slug: 'wireless-earbuds', icon: 'bluetooth', name: { ar: 'سماعات أذن لاسلكية', en: 'Wireless earbuds', fr: 'Écouteurs sans fil' } },
      { slug: 'speakers', icon: 'speaker', name: { ar: 'مكبرات صوت', en: 'Speakers', fr: 'Enceintes' } },
    ],
  },
  {
    slug: 'accessories',
    icon: 'cable',
    name: { ar: 'الإكسسوارات', en: 'Accessories', fr: 'Accessoires' },
    children: [
      { slug: 'chargers', icon: 'plug-zap', name: { ar: 'شواحن', en: 'Chargers', fr: 'Chargeurs' } },
      { slug: 'cables', icon: 'cable', name: { ar: 'كابلات', en: 'Cables', fr: 'Câbles' } },
      { slug: 'power-banks', icon: 'battery-charging', name: { ar: 'بطاريات متنقلة', en: 'Power banks', fr: 'Batteries externes' } },
      { slug: 'cases', icon: 'smartphone', name: { ar: 'أغطية وحافظات', en: 'Cases', fr: 'Coques et étuis' } },
      { slug: 'screen-protectors', icon: 'shield', name: { ar: 'واقيات الشاشة', en: 'Screen protectors', fr: "Protections d'écran" } },
      { slug: 'gaming-accessories', icon: 'gamepad-2', name: { ar: 'إكسسوارات الألعاب', en: 'Gaming accessories', fr: 'Accessoires gaming' } },
    ],
  },
];

export const BRANDS: { slug: string; name: string; nameAr: string; featured?: boolean }[] = [
  { slug: 'apple', name: 'Apple', nameAr: 'أبل', featured: true },
  { slug: 'samsung', name: 'Samsung', nameAr: 'سامسونج', featured: true },
  { slug: 'honor', name: 'HONOR', nameAr: 'هونر', featured: true },
  { slug: 'xiaomi', name: 'Xiaomi', nameAr: 'شاومي' },
  { slug: 'huawei', name: 'Huawei', nameAr: 'هواوي' },
  { slug: 'google', name: 'Google', nameAr: 'جوجل' },
  { slug: 'oneplus', name: 'OnePlus', nameAr: 'ون بلس' },
  { slug: 'oppo', name: 'OPPO', nameAr: 'أوبو' },
  { slug: 'lenovo', name: 'Lenovo', nameAr: 'لينوفو' },
  { slug: 'hp', name: 'HP', nameAr: 'إتش بي' },
  { slug: 'dell', name: 'Dell', nameAr: 'ديل' },
  { slug: 'asus', name: 'ASUS', nameAr: 'أسوس' },
  { slug: 'acer', name: 'Acer', nameAr: 'أيسر' },
  { slug: 'msi', name: 'MSI', nameAr: 'إم إس آي' },
  { slug: 'sony', name: 'Sony', nameAr: 'سوني' },
  { slug: 'jbl', name: 'JBL', nameAr: 'جي بي إل' },
  { slug: 'bose', name: 'Bose', nameAr: 'بوز' },
  { slug: 'anker', name: 'Anker', nameAr: 'أنكر' },
  { slug: 'belkin', name: 'Belkin', nameAr: 'بيلكن' },
  { slug: 'logitech', name: 'Logitech', nameAr: 'لوجيتك' },
  { slug: 'razer', name: 'Razer', nameAr: 'ريزر' },
];

/** The 11 governorates of the Sultanate of Oman (ISO 3166-2:OM) and their 61 wilayas. */
export const GOVERNORATES: { code: string; name: L; wilayas: { slug: string; name: L }[] }[] = [
  {
    code: 'MA',
    name: { ar: 'مسقط', en: 'Muscat', fr: 'Mascate' },
    wilayas: [
      { slug: 'muscat', name: { ar: 'مسقط', en: 'Muscat', fr: 'Mascate' } },
      { slug: 'muttrah', name: { ar: 'مطرح', en: 'Muttrah', fr: 'Matrah' } },
      { slug: 'bawshar', name: { ar: 'بوشر', en: 'Bawshar', fr: 'Bawshar' } },
      { slug: 'as-seeb', name: { ar: 'السيب', en: 'As Seeb', fr: 'As-Sib' } },
      { slug: 'al-amerat', name: { ar: 'العامرات', en: 'Al Amerat', fr: 'Al-Amirat' } },
      { slug: 'qurayyat', name: { ar: 'قريات', en: 'Qurayyat', fr: 'Qurayyat' } },
    ],
  },
  {
    code: 'ZU',
    name: { ar: 'ظفار', en: 'Dhofar', fr: 'Dhofar' },
    wilayas: [
      { slug: 'salalah', name: { ar: 'صلالة', en: 'Salalah', fr: 'Salalah' } },
      { slug: 'taqah', name: { ar: 'طاقة', en: 'Taqah', fr: 'Taqah' } },
      { slug: 'mirbat', name: { ar: 'مرباط', en: 'Mirbat', fr: 'Mirbat' } },
      { slug: 'rakhyut', name: { ar: 'رخيوت', en: 'Rakhyut', fr: 'Rakhyut' } },
      { slug: 'thumrait', name: { ar: 'ثمريت', en: 'Thumrait', fr: 'Thumrait' } },
      { slug: 'dhalkut', name: { ar: 'ضلكوت', en: 'Dhalkut', fr: 'Dhalkut' } },
      { slug: 'al-mazyunah', name: { ar: 'المزيونة', en: 'Al Mazyunah', fr: 'Al-Mazyouna' } },
      { slug: 'muqshin', name: { ar: 'مقشن', en: 'Muqshin', fr: 'Muqshin' } },
      { slug: 'shalim-hallaniyat', name: { ar: 'شليم وجزر الحلانيات', en: 'Shalim and the Hallaniyat Islands', fr: 'Shalim et îles Hallaniyat' } },
      { slug: 'sadah', name: { ar: 'سدح', en: 'Sadah', fr: 'Sadah' } },
    ],
  },
  {
    code: 'MU',
    name: { ar: 'مسندم', en: 'Musandam', fr: 'Moussandam' },
    wilayas: [
      { slug: 'khasab', name: { ar: 'خصب', en: 'Khasab', fr: 'Khasab' } },
      { slug: 'dibba', name: { ar: 'دبا', en: 'Dibba', fr: 'Dibba' } },
      { slug: 'bukha', name: { ar: 'بخاء', en: 'Bukha', fr: 'Bukha' } },
      { slug: 'madha', name: { ar: 'مدحاء', en: 'Madha', fr: 'Madha' } },
    ],
  },
  {
    code: 'BU',
    name: { ar: 'البريمي', en: 'Al Buraimi', fr: 'Al-Bouraimi' },
    wilayas: [
      { slug: 'al-buraimi', name: { ar: 'البريمي', en: 'Al Buraimi', fr: 'Al-Bouraimi' } },
      { slug: 'mahdah', name: { ar: 'محضة', en: 'Mahdah', fr: 'Mahdah' } },
      { slug: 'as-sunaynah', name: { ar: 'السنينة', en: 'As Sunaynah', fr: 'As-Sunaynah' } },
    ],
  },
  {
    code: 'DA',
    name: { ar: 'الداخلية', en: 'Ad Dakhiliyah', fr: 'Ad-Dakhiliyah' },
    wilayas: [
      { slug: 'nizwa', name: { ar: 'نزوى', en: 'Nizwa', fr: 'Nizwa' } },
      { slug: 'bahla', name: { ar: 'بهلاء', en: 'Bahla', fr: 'Bahla' } },
      { slug: 'manah', name: { ar: 'منح', en: 'Manah', fr: 'Manah' } },
      { slug: 'al-hamra', name: { ar: 'الحمراء', en: 'Al Hamra', fr: 'Al-Hamra' } },
      { slug: 'adam', name: { ar: 'أدم', en: 'Adam', fr: 'Adam' } },
      { slug: 'izki', name: { ar: 'إزكي', en: 'Izki', fr: 'Izki' } },
      { slug: 'samail', name: { ar: 'سمائل', en: 'Samail', fr: 'Samail' } },
      { slug: 'bidbid', name: { ar: 'بدبد', en: 'Bidbid', fr: 'Bidbid' } },
    ],
  },
  {
    code: 'BS',
    name: { ar: 'شمال الباطنة', en: 'North Al Batinah', fr: 'Al-Batina Nord' },
    wilayas: [
      { slug: 'sohar', name: { ar: 'صحار', en: 'Sohar', fr: 'Sohar' } },
      { slug: 'shinas', name: { ar: 'شناص', en: 'Shinas', fr: 'Shinas' } },
      { slug: 'liwa', name: { ar: 'لوى', en: 'Liwa', fr: 'Liwa' } },
      { slug: 'saham', name: { ar: 'صحم', en: 'Saham', fr: 'Saham' } },
      { slug: 'al-khaburah', name: { ar: 'الخابورة', en: 'Al Khaburah', fr: 'Al-Khabourah' } },
      { slug: 'as-suwayq', name: { ar: 'السويق', en: 'As Suwayq', fr: 'As-Suwayq' } },
    ],
  },
  {
    code: 'BJ',
    name: { ar: 'جنوب الباطنة', en: 'South Al Batinah', fr: 'Al-Batina Sud' },
    wilayas: [
      { slug: 'ar-rustaq', name: { ar: 'الرستاق', en: 'Ar Rustaq', fr: 'Ar-Rustaq' } },
      { slug: 'al-awabi', name: { ar: 'العوابي', en: 'Al Awabi', fr: 'Al-Awabi' } },
      { slug: 'nakhal', name: { ar: 'نخل', en: 'Nakhal', fr: 'Nakhal' } },
      { slug: 'wadi-al-maawil', name: { ar: 'وادي المعاول', en: 'Wadi Al Maawil', fr: 'Wadi Al-Maawil' } },
      { slug: 'barka', name: { ar: 'بركاء', en: 'Barka', fr: 'Barka' } },
      { slug: 'al-musannah', name: { ar: 'المصنعة', en: 'Al Musannah', fr: 'Al-Musannah' } },
    ],
  },
  {
    code: 'SJ',
    name: { ar: 'جنوب الشرقية', en: 'South Ash Sharqiyah', fr: 'Ach-Charqiya Sud' },
    wilayas: [
      { slug: 'sur', name: { ar: 'صور', en: 'Sur', fr: 'Sour' } },
      { slug: 'al-kamil-wal-wafi', name: { ar: 'الكامل والوافي', en: 'Al Kamil Wal Wafi', fr: 'Al-Kamil wal-Wafi' } },
      { slug: 'jaalan-bani-bu-hassan', name: { ar: 'جعلان بني بو حسن', en: "Ja'alan Bani Bu Hassan", fr: "Ja'alan Bani Bu Hassan" } },
      { slug: 'jaalan-bani-bu-ali', name: { ar: 'جعلان بني بو علي', en: "Ja'alan Bani Bu Ali", fr: "Ja'alan Bani Bu Ali" } },
      { slug: 'masirah', name: { ar: 'مصيرة', en: 'Masirah', fr: 'Masirah' } },
    ],
  },
  {
    code: 'SS',
    name: { ar: 'شمال الشرقية', en: 'North Ash Sharqiyah', fr: 'Ach-Charqiya Nord' },
    wilayas: [
      { slug: 'ibra', name: { ar: 'إبراء', en: 'Ibra', fr: 'Ibra' } },
      { slug: 'al-mudaybi', name: { ar: 'المضيبي', en: 'Al Mudaybi', fr: 'Al-Mudaybi' } },
      { slug: 'bidiyah', name: { ar: 'بدية', en: 'Bidiyah', fr: 'Bidiyah' } },
      { slug: 'al-qabil', name: { ar: 'القابل', en: 'Al Qabil', fr: 'Al-Qabil' } },
      { slug: 'wadi-bani-khalid', name: { ar: 'وادي بني خالد', en: 'Wadi Bani Khalid', fr: 'Wadi Bani Khalid' } },
      { slug: 'dima-wa-al-taiyyin', name: { ar: 'دماء والطائيين', en: 'Dima Wa Al Taiyyin', fr: 'Dima wa at-Taiyyin' } },
    ],
  },
  {
    code: 'ZA',
    name: { ar: 'الظاهرة', en: 'Ad Dhahirah', fr: 'Ad-Dhahirah' },
    wilayas: [
      { slug: 'ibri', name: { ar: 'عبري', en: 'Ibri', fr: 'Ibri' } },
      { slug: 'yanqul', name: { ar: 'ينقل', en: 'Yanqul', fr: 'Yanqul' } },
      { slug: 'dhank', name: { ar: 'ضنك', en: 'Dhank', fr: 'Dhank' } },
    ],
  },
  {
    code: 'WU',
    name: { ar: 'الوسطى', en: 'Al Wusta', fr: 'Al-Wusta' },
    wilayas: [
      { slug: 'haima', name: { ar: 'هيماء', en: 'Haima', fr: 'Haima' } },
      { slug: 'duqm', name: { ar: 'الدقم', en: 'Duqm', fr: 'Duqm' } },
      { slug: 'mahout', name: { ar: 'محوت', en: 'Mahout', fr: 'Mahout' } },
      { slug: 'al-jazer', name: { ar: 'الجازر', en: 'Al Jazer', fr: 'Al-Jazer' } },
    ],
  },
];

export const LEDGER_SYSTEM_ACCOUNTS: { type: string; name: string }[] = [
  { type: 'PLATFORM_CASH', name: 'Platform cash (settled funds)' },
  { type: 'PAYMENT_CLEARING', name: 'Payment provider clearing' },
  { type: 'PLATFORM_REVENUE', name: 'Platform revenue (sales)' },
  { type: 'DELIVERY_REVENUE', name: 'Delivery revenue' },
  { type: 'GIFT_CARD_CLEARING', name: 'Gift card clearing (verified encashed value)' },
  { type: 'REFUNDS', name: 'Refunds' },
  { type: 'FLEX_RECEIVABLE', name: 'DOOM FLEX receivable' },
  { type: 'DISCOUNTS', name: 'Discounts and promotions' },
  { type: 'ADJUSTMENTS', name: 'Manual adjustments (audited)' },
];

export type CampaignSeed = {
  slug: string;
  internalName: string;
  title: L;
  subtitle: L;
  cta: L;
  mediaType: 'IMAGE' | 'VIDEO' | 'LOTTIE' | 'SCENE_3D';
  sceneKind: 'PHONE' | 'LAPTOP' | 'EARBUDS' | 'NONE';
  linkUrl: string;
  priority: number;
  theme: 'primary' | 'secondary' | 'premium';
  placements: string[];
};

/** Service & category campaigns. No prices, no stock, no unverifiable claims. */
export const CAMPAIGNS: CampaignSeed[] = [
  {
    slug: 'iphone',
    internalName: 'Apple iPhone category',
    title: { ar: 'آيفون', en: 'iPhone', fr: 'iPhone' },
    subtitle: {
      ar: 'اكتشف طرازات آيفون من أبل المتوفرة لدى دوم.',
      en: 'Explore the Apple iPhone models available at DOOM.',
      fr: 'Découvrez les modèles Apple iPhone disponibles chez DOOM.',
    },
    cta: { ar: 'تسوّق آيفون', en: 'Shop iPhone', fr: 'Voir les iPhone' },
    mediaType: 'SCENE_3D',
    sceneKind: 'PHONE',
    linkUrl: '/category/smartphones-apple',
    priority: 100,
    theme: 'premium',
    placements: ['home_hero'],
  },
  {
    slug: 'samsung-galaxy',
    internalName: 'Samsung Galaxy category',
    title: { ar: 'سامسونج جالاكسي', en: 'Samsung Galaxy', fr: 'Samsung Galaxy' },
    subtitle: {
      ar: 'هواتف جالاكسي في مكان واحد، مع كل التفاصيل في صفحة كل منتج.',
      en: 'Galaxy smartphones in one place, with full details on every product page.',
      fr: 'Les smartphones Galaxy réunis, avec tous les détails sur chaque fiche produit.',
    },
    cta: { ar: 'تسوّق جالاكسي', en: 'Shop Galaxy', fr: 'Voir les Galaxy' },
    mediaType: 'SCENE_3D',
    sceneKind: 'PHONE',
    linkUrl: '/category/smartphones-samsung',
    priority: 90,
    theme: 'primary',
    placements: ['home_hero'],
  },
  {
    slug: 'honor',
    internalName: 'HONOR category',
    title: { ar: 'هونر', en: 'HONOR', fr: 'HONOR' },
    subtitle: {
      ar: 'تصفّح هواتف هونر واختر اللون والسعة المناسبين لك.',
      en: 'Browse HONOR smartphones and pick the colour and capacity that suit you.',
      fr: 'Parcourez les smartphones HONOR et choisissez couleur et capacité.',
    },
    cta: { ar: 'تسوّق هونر', en: 'Shop HONOR', fr: 'Voir HONOR' },
    mediaType: 'SCENE_3D',
    sceneKind: 'PHONE',
    linkUrl: '/category/smartphones-honor',
    priority: 80,
    theme: 'premium',
    placements: ['home_hero'],
  },
  {
    slug: 'laptops',
    internalName: 'Computers category',
    title: { ar: 'لابتوب وماك بوك', en: 'Laptops & MacBook', fr: 'Portables et MacBook' },
    subtitle: {
      ar: 'أجهزة للعمل والدراسة والألعاب، مع المواصفات الكاملة لكل جهاز.',
      en: 'Machines for work, study and gaming, with complete specifications for each.',
      fr: 'Des machines pour le travail, les études et le jeu, avec fiches techniques complètes.',
    },
    cta: { ar: 'تسوّق الكمبيوتر', en: 'Shop computers', fr: 'Voir les ordinateurs' },
    mediaType: 'SCENE_3D',
    sceneKind: 'LAPTOP',
    linkUrl: '/category/computers',
    priority: 70,
    theme: 'primary',
    placements: ['home_hero'],
  },
  {
    slug: 'audio',
    internalName: 'Audio category',
    title: { ar: 'الصوتيات', en: 'Audio', fr: 'Audio' },
    subtitle: {
      ar: 'إيربودز وجالاكسي بودز وسماعات الرأس ومكبرات الصوت.',
      en: 'AirPods, Galaxy Buds, headphones and speakers.',
      fr: 'AirPods, Galaxy Buds, casques et enceintes.',
    },
    cta: { ar: 'تسوّق الصوتيات', en: 'Shop audio', fr: "Voir l'audio" },
    mediaType: 'SCENE_3D',
    sceneKind: 'EARBUDS',
    linkUrl: '/category/audio',
    priority: 60,
    theme: 'secondary',
    placements: ['home_hero'],
  },
  {
    slug: 'doom-flex',
    internalName: 'DOOM FLEX service',
    title: { ar: 'دوم فليكس', en: 'DOOM FLEX', fr: 'DOOM FLEX' },
    subtitle: {
      ar: 'قسّط مشترياتك على 3 أو 6 أو 12 شهرًا، بدون فوائد وبدون رسوم. يخضع للتحقق من الهوية والموافقة.',
      en: 'Spread your purchase over 3, 6 or 12 months, 0% interest and no fees. Subject to identity verification and approval.',
      fr: "Étalez votre achat sur 3, 6 ou 12 mois, 0 % d'intérêt et sans frais. Sous réserve de vérification d'identité et d'acceptation.",
    },
    cta: { ar: 'اكتشف فليكس', en: 'Discover FLEX', fr: 'Découvrir FLEX' },
    mediaType: 'IMAGE',
    sceneKind: 'NONE',
    linkUrl: '/flex',
    priority: 50,
    theme: 'secondary',
    placements: ['home_hero', 'home_flex'],
  },
  {
    slug: 'doom-express',
    internalName: 'DOOM EXPRESS service',
    title: { ar: 'دوم إكسبريس', en: 'DOOM EXPRESS', fr: 'DOOM EXPRESS' },
    subtitle: {
      ar: 'توصيل سريع بهدف 6 ساعات في المناطق المؤهلة، وتوصيل عادي بهدف 24 ساعة.',
      en: 'Express delivery targeted within 6 hours in eligible zones; standard delivery targeted within 24 hours.',
      fr: 'Livraison express visée en 6 h dans les zones éligibles ; livraison standard visée en 24 h.',
    },
    cta: { ar: 'مناطق التوصيل', en: 'Delivery zones', fr: 'Zones de livraison' },
    mediaType: 'IMAGE',
    sceneKind: 'NONE',
    linkUrl: '/delivery',
    priority: 40,
    theme: 'primary',
    placements: ['home_hero', 'home_express'],
  },
];
