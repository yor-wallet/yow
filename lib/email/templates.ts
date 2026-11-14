import { escapeHtml, layout, type EmailMessage } from './index';
import { giftCardBrandLabel } from '@/lib/payments/giftcard-brands';

/** Texts of the transactional e-mails (Arabic, English, French). Values inserted are always escaped. */
type Lang = 'ar' | 'en' | 'fr';
const lang = (l: string | null | undefined): Lang => (l === 'ar' || l === 'fr' ? l : 'en');

const FOOTER: Record<Lang, string> = {
  ar: 'دوم — متجر إلكترونيات في سلطنة عُمان. وصلتك هذه الرسالة لأن حسابك مرتبط بهذا العنوان.',
  en: 'DOOM — electronics store in the Sultanate of Oman. You receive this e-mail because your account uses this address.',
  fr: 'DOOM — boutique d’électronique au Sultanat d’Oman. Vous recevez cet e-mail car votre compte utilise cette adresse.',
};

export function verifyEmailMessage(opts: { locale: string | null; name: string; email: string; url: string }): EmailMessage {
  const l = lang(opts.locale);
  const name = escapeHtml(opts.name);
  const T = {
    ar: { subject: 'أكّد عنوان بريدك الإلكتروني', title: 'أكّد عنوان بريدك الإلكتروني', p1: `مرحبًا ${name}،`, p2: 'اضغط على الزر أدناه لتأكيد حسابك في دوم. ينتهي هذا الرابط بعد 48 ساعة.', p3: 'إن لم تُنشئ حسابًا لدينا فتجاهل هذه الرسالة.', button: 'تأكيد بريدي الإلكتروني' },
    en: { subject: 'Confirm your e-mail address', title: 'Confirm your e-mail address', p1: `Hello ${name},`, p2: 'Press the button below to confirm your DOOM account. This link expires in 48 hours.', p3: 'If you did not create an account with us, ignore this e-mail.', button: 'Confirm my e-mail' },
    fr: { subject: 'Confirmez votre adresse e-mail', title: 'Confirmez votre adresse e-mail', p1: `Bonjour ${name},`, p2: 'Appuyez sur le bouton ci-dessous pour confirmer votre compte DOOM. Ce lien expire dans 48 heures.', p3: 'Si vous n’avez pas créé de compte chez nous, ignorez cet e-mail.', button: 'Confirmer mon e-mail' },
  }[l];
  const { html, text } = layout({ locale: l, title: T.title, paragraphs: [T.p1, T.p2, T.p3], button: { label: T.button, url: opts.url }, footer: FOOTER[l] });
  return { to: [{ email: opts.email, name: opts.name }], subject: T.subject, html, text, tag: 'email-verification' };
}

export function kycSubmittedAdminMessage(opts: { locale: string | null; admin: { email: string; name: string }; customerName: string; submittedAt: Date; url: string }): EmailMessage {
  const l = lang(opts.locale);
  const who = escapeHtml(opts.customerName);
  const when = escapeHtml(opts.submittedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
  const T = {
    ar: { subject: `طلب توثيق هوية جديد: ${opts.customerName}`, title: 'طلب توثيق هوية جديد', p1: `أرسل ${who} مستندات هويته في ${when}.`, p2: 'افتح الطلب في مركز الإدارة لمراجعة المستندات، ثم اقبل الطلب أو ارفضه أو اطلب مستندات أخرى.', button: 'مراجعة الطلب' },
    en: { subject: `New identity verification: ${opts.customerName}`, title: 'New identity verification to review', p1: `${who} sent their identity documents on ${when}.`, p2: 'Open the request in the admin centre to review the documents, then validate it, refuse it or ask for other documents.', button: 'Review the request' },
    fr: { subject: `Nouvelle vérification d’identité : ${opts.customerName}`, title: 'Nouvelle vérification d’identité à traiter', p1: `${who} a envoyé ses pièces d’identité le ${when}.`, p2: 'Ouvrez la demande dans le centre d’administration pour examiner les pièces, puis validez-la, refusez-la ou demandez d’autres documents.', button: 'Examiner la demande' },
  }[l];
  const { html, text } = layout({ locale: l, title: T.title, paragraphs: [T.p1, T.p2], button: { label: T.button, url: opts.url }, footer: FOOTER[l] });
  return { to: [{ email: opts.admin.email, name: opts.admin.name }], subject: T.subject, html, text, tag: 'kyc-submitted-admin' };
}

export function kycDecisionMessage(opts: { locale: string | null; email: string; name: string; decision: 'VERIFIED' | 'REJECTED' | 'DOCUMENTS_REQUESTED'; note: string | null; url: string }): EmailMessage {
  const l = lang(opts.locale);
  const name = escapeHtml(opts.name);
  const note = opts.note ? escapeHtml(opts.note) : null;
  const T = {
    ar: {
      VERIFIED: { subject: 'تم توثيق هويتك', title: 'تم توثيق هويتك', body: 'راجع فريقنا مستنداتك ووثّق هويتك. يمكنك الآن استخدام جميع وسائل الدفع المتاحة لحسابك.' },
      REJECTED: { subject: 'لم يُقبل طلب توثيق هويتك', title: 'لم يُقبل طلب توثيق هويتك', body: 'راجع فريقنا مستنداتك ولم يتمكن من قبولها.' },
      DOCUMENTS_REQUESTED: { subject: 'نحتاج إلى مستندات أخرى', title: 'نحتاج إلى مستندات أخرى لتوثيق هويتك', body: 'راجع فريقنا طلبك ويحتاج إلى مستندات إضافية.' },
      hello: `مرحبًا ${name}،`, reason: 'السبب', button: 'عرض حالة التوثيق',
    },
    en: {
      VERIFIED: { subject: 'Your identity is verified', title: 'Your identity is verified', body: 'Our team reviewed your documents and verified your identity. You can now use every payment method available to your account.' },
      REJECTED: { subject: 'Your identity verification was not accepted', title: 'Your identity verification was not accepted', body: 'Our team reviewed your documents and could not accept them.' },
      DOCUMENTS_REQUESTED: { subject: 'We need other documents', title: 'We need other documents to verify your identity', body: 'Our team reviewed your request and needs additional documents.' },
      hello: `Hello ${name},`, reason: 'Reason', button: 'See my verification',
    },
    fr: {
      VERIFIED: { subject: 'Votre identité est vérifiée', title: 'Votre identité est vérifiée', body: 'Notre équipe a examiné vos pièces et vérifié votre identité. Vous pouvez maintenant utiliser tous les moyens de paiement disponibles pour votre compte.' },
      REJECTED: { subject: 'Votre vérification d’identité n’a pas été acceptée', title: 'Votre vérification d’identité n’a pas été acceptée', body: 'Notre équipe a examiné vos pièces et n’a pas pu les accepter.' },
      DOCUMENTS_REQUESTED: { subject: 'Nous avons besoin d’autres documents', title: 'Nous avons besoin d’autres documents pour vérifier votre identité', body: 'Notre équipe a examiné votre demande et a besoin de documents supplémentaires.' },
      hello: `Bonjour ${name},`, reason: 'Motif', button: 'Voir ma vérification',
    },
  }[l];
  const d = T[opts.decision];
  const paragraphs = [T.hello, d.body, ...(note && opts.decision !== 'VERIFIED' ? [`<strong>${T.reason} :</strong> ${note}`.replace(' :', l === 'fr' ? ' :' : ':')] : [])];
  const { html, text } = layout({ locale: l, title: d.title, paragraphs, button: { label: T.button, url: opts.url }, footer: FOOTER[l] });
  return { to: [{ email: opts.email, name: opts.name }], subject: d.subject, html, text, tag: `kyc-${opts.decision.toLowerCase()}` };
}

const OTHER_CARD: Record<Lang, string> = { ar: 'علامة أخرى', en: 'other brand', fr: 'autre marque' };

/** To every staff member who can review gift cards: a customer sent one (never the code). */
export function giftCardSubmittedAdminMessage(opts: { locale: string | null; admin: { email: string; name: string }; customerName: string; brand: string; submittedAt: Date; url: string }): EmailMessage {
  const l = lang(opts.locale);
  const who = escapeHtml(opts.customerName);
  const brand = escapeHtml(giftCardBrandLabel(opts.brand, OTHER_CARD[l]));
  const when = escapeHtml(opts.submittedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
  const T = {
    ar: { subject: `بطاقة هدايا جديدة للتحقق: ${opts.customerName}`, title: 'بطاقة هدايا جديدة للتحقق', p1: `أرسل ${who} بطاقة هدايا (${brand}) في ${when}.`, p2: 'افتح البطاقة في مركز الإدارة للتحقق منها وصرف قيمتها، ثم اعتمدها ليُضاف المبلغ إلى محفظة العميل أو ارفضها.', button: 'مراجعة البطاقة' },
    en: { subject: `New gift card to verify: ${opts.customerName}`, title: 'New gift card to verify', p1: `${who} sent a gift card (${brand}) on ${when}.`, p2: 'Open the card in the admin centre to check and encash it, then verify it so the amount is added to the customer’s wallet, or refuse it.', button: 'Review the card' },
    fr: { subject: `Nouvelle carte cadeau à vérifier : ${opts.customerName}`, title: 'Nouvelle carte cadeau à vérifier', p1: `${who} a envoyé une carte cadeau (${brand}) le ${when}.`, p2: 'Ouvrez la carte dans le centre d’administration pour la contrôler et l’encaisser, puis validez-la pour créditer le portefeuille du client, ou refusez-la.', button: 'Examiner la carte' },
  }[l];
  const { html, text } = layout({ locale: l, title: T.title, paragraphs: [T.p1, T.p2], button: { label: T.button, url: opts.url }, footer: FOOTER[l] });
  return { to: [{ email: opts.admin.email, name: opts.admin.name }], subject: T.subject, html, text, tag: 'giftcard-submitted-admin' };
}

/** To the customer: the card was verified (amount credited, commission kept) or refused (reason). */
export function giftCardDecisionMessage(opts: {
  locale: string | null;
  email: string;
  name: string;
  decision: 'VERIFIED' | 'REJECTED';
  brand: string;
  /** Formatted amount added to the wallet (VERIFIED). */
  credited: string | null;
  /** Formatted exchange commission kept (VERIFIED, when there is one). */
  commission: string | null;
  note: string | null;
  url: string;
}): EmailMessage {
  const l = lang(opts.locale);
  const name = escapeHtml(opts.name);
  const brand = escapeHtml(giftCardBrandLabel(opts.brand, OTHER_CARD[l]));
  const credited = escapeHtml(opts.credited ?? '');
  const commission = opts.commission ? escapeHtml(opts.commission) : null;
  const note = opts.note ? escapeHtml(opts.note) : null;
  const T = {
    ar: {
      hello: `مرحبًا ${name}،`,
      VERIFIED: { subject: 'أُضيفت قيمة بطاقة الهدايا إلى محفظتك', title: 'أُضيفت قيمة بطاقة الهدايا إلى محفظتك', body: `تحقق فريقنا من بطاقة ${brand} وأضاف ${credited} إلى محفظتك.` },
      REJECTED: { subject: 'لم تُقبل بطاقة الهدايا', title: 'لم تُقبل بطاقة الهدايا', body: `راجع فريقنا بطاقة ${brand} ولم يتمكن من قبولها. لم يُضف أي مبلغ إلى محفظتك.` },
      commission: 'عمولة الاستبدال المخصومة', reason: 'السبب', button: 'عرض محفظتي',
    },
    en: {
      hello: `Hello ${name},`,
      VERIFIED: { subject: 'Your gift card was added to your wallet', title: 'Your gift card was added to your wallet', body: `Our team verified your ${brand} card and added ${credited} to your wallet.` },
      REJECTED: { subject: 'Your gift card was not accepted', title: 'Your gift card was not accepted', body: `Our team reviewed your ${brand} card and could not accept it. Nothing was added to your wallet.` },
      commission: 'Exchange commission kept', reason: 'Reason', button: 'See my wallet',
    },
    fr: {
      hello: `Bonjour ${name},`,
      VERIFIED: { subject: 'Votre carte cadeau a été ajoutée à votre portefeuille', title: 'Votre carte cadeau a été ajoutée à votre portefeuille', body: `Notre équipe a vérifié votre carte ${brand} et a ajouté ${credited} à votre portefeuille.` },
      REJECTED: { subject: 'Votre carte cadeau n’a pas été acceptée', title: 'Votre carte cadeau n’a pas été acceptée', body: `Notre équipe a examiné votre carte ${brand} et n’a pas pu l’accepter. Rien n’a été ajouté à votre portefeuille.` },
      commission: 'Commission d’échange retenue', reason: 'Motif', button: 'Voir mon portefeuille',
    },
  }[l];
  const d = T[opts.decision];
  const paragraphs = [T.hello, d.body];
  if (opts.decision === 'VERIFIED' && commission) paragraphs.push(`${T.commission} : ${commission}`);
  if (opts.decision === 'REJECTED' && note) paragraphs.push(`${T.reason} : ${note}`);
  const { html, text } = layout({ locale: l, title: d.title, paragraphs, button: { label: T.button, url: opts.url }, footer: FOOTER[l] });
  return { to: [{ email: opts.email, name: opts.name }], subject: d.subject, html, text, tag: 'giftcard-decision' };
}
