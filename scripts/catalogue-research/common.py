"""Shared helpers for the verified-catalogue assemblers (stdlib only)."""
LABELS = {
    'display': {'en': 'Display', 'fr': 'Écran', 'ar': 'الشاشة'},
    'coverDisplay': {'en': 'Cover display', 'fr': 'Écran externe', 'ar': 'الشاشة الخارجية'},
    'chip': {'en': 'Processor', 'fr': 'Processeur', 'ar': 'المعالج'},
    'memory': {'en': 'Memory (RAM)', 'fr': 'Mémoire vive (RAM)', 'ar': 'الذاكرة العشوائية (RAM)'},
    'storage': {'en': 'Storage options', 'fr': 'Capacités de stockage', 'ar': 'سعات التخزين'},
    'rearCamera': {'en': 'Rear cameras', 'fr': 'Appareils photo arrière', 'ar': 'الكاميرات الخلفية'},
    'frontCamera': {'en': 'Front camera', 'fr': 'Caméra avant', 'ar': 'الكاميرا الأمامية'},
    'battery': {'en': 'Battery', 'fr': 'Batterie', 'ar': 'البطارية'},
    'charging': {'en': 'Charging', 'fr': 'Recharge', 'ar': 'الشحن'},
    'resistance': {'en': 'Water and dust resistance', 'fr': 'Résistance à l’eau et à la poussière', 'ar': 'مقاومة الماء والغبار'},
    'sim': {'en': 'SIM', 'fr': 'SIM', 'ar': 'شريحة الاتصال'},
    'connectivity': {'en': 'Connectivity', 'fr': 'Connectivité', 'ar': 'الاتصال'},
    'dimensions': {'en': 'Dimensions', 'fr': 'Dimensions', 'ar': 'الأبعاد'},
    'weight': {'en': 'Weight', 'fr': 'Poids', 'ar': 'الوزن'},
    'os': {'en': 'Operating system', 'fr': 'Système d’exploitation', 'ar': 'نظام التشغيل'},
    'materials': {'en': 'Design and materials', 'fr': 'Design et matériaux', 'ar': 'التصميم والمواد'},
    'modelNumber': {'en': 'Model number (Oman / GCC)', 'fr': 'Numéro de modèle (Oman / CCG)', 'ar': 'رقم الطراز (عُمان / الخليج)'},
    'inTheBox': {'en': 'In the box', 'fr': 'Contenu de la boîte', 'ar': 'محتويات العلبة'},
    'softwareSupport': {'en': 'Security updates until', 'fr': 'Mises à jour de sécurité jusqu’au', 'ar': 'تحديثات الأمان حتى'},
    'stylus': {'en': 'Stylus', 'fr': 'Stylet', 'ar': 'القلم'},
}

def same(v):
    return {'ar': v, 'en': v, 'fr': v}

def spec(key, value):
    """value: str (identical in the three languages) or {ar,en,fr}."""
    if value is None: return None
    if isinstance(value, str):
        if not value.strip(): return None
        value = same(value.strip())
    return {'key': key, 'label': LABELS[key], 'value': value}

def storage_label(gb):
    return f'{gb // 1024} TB' if gb >= 1024 and gb % 1024 == 0 else f'{gb} GB'

def storages_value(gbs):
    en = ' · '.join(storage_label(g) for g in gbs)
    fr = ' · '.join((f'{g // 1024} To' if g >= 1024 else f'{g} Go') for g in gbs)
    ar = ' · '.join((f'{g // 1024} تيرابايت' if g >= 1024 else f'{g} جيجابايت') for g in gbs)
    return {'en': en, 'fr': fr, 'ar': ar}
