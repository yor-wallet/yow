# DOOM | دوم — Application Android (Capacitor) et iOS

DOOM est une application Next.js avec rendu serveur (paiements, sessions, webhooks). Elle ne peut
donc pas être exportée en fichiers statiques. L'application mobile est une coque **Capacitor** qui
charge le site de production en HTTPS (`server.url`), avec une page hors-ligne locale
(`capacitor/www/index.html`) si le réseau est absent.

Avantages : une seule base de code, les correctifs sont visibles sans republier l'application,
les paiements restent entièrement côté serveur.

## Pré-requis
- Le site est déployé sur un domaine HTTPS définitif (voir `docs/DEPLOYMENT.md`).
- Android Studio (SDK 34+), JDK 17.
- Un compte Google Play Console (et, pour iOS, Xcode + compte Apple Developer).

## Étapes Android
```bash
# 1. Renseigner le domaine de production dans capacitor.config.json → server.url
#    ex. "https://doom.om/ar"

# 2. Installer Capacitor (non installé par défaut pour ne pas alourdir le build web)
npm i @capacitor/core @capacitor/android @capacitor/splash-screen
npm i -D @capacitor/cli

# 3. Générer le projet Android natif
npx cap add android
npx cap sync android
```

### Icônes et splash (issus du logo officiel)
Générés par `npm run brand:icons` dans `public/icons/` :

| Usage | Fichier |
|---|---|
| Icône adaptative — premier plan (zone sûre 66 %) | `android-foreground-432.png` |
| Icône adaptative — arrière-plan (violet nuit #10052E) | `android-background-432.png` |
| Icône classique | `icon-192.png`, `icon-512.png` |
| Icône Play Store (512×512) | `icon-512.png` |
| Splash portrait / tablette | `splash-1284x2778.png`, `splash-2732x2732.png` |

Dans Android Studio : *res → New → Image Asset → Launcher Icons (Adaptive)*, choisir
`android-foreground-432.png` comme premier plan et la couleur `#10052E` comme arrière-plan.
Ne pas recadrer ni recolorer le logo.

### Retour Android
Le bouton Retour matériel déclenche l'historique du WebView, géré par le site lui-même
(`BackButton`/`useSafeBack`, modales liées à l'historique). Aucune configuration native n'est requise.
Pour quitter l'application depuis l'accueil, ajouter éventuellement `@capacitor/app` :
```ts
App.addListener('backButton', ({ canGoBack }) => (canGoBack ? window.history.back() : App.exitApp()));
```

### Publication
1. `npx cap open android` → *Build → Generate Signed Bundle (AAB)*.
2. Conserver la clé de signature en lieu sûr (sa perte empêche toute mise à jour).
3. Fiche Play Store : nom « DOOM | دوم », captures d'écran (ar/en/fr), politique de
   confidentialité (`/ar/legal/privacy`), déclaration des données (identité KYC, localisation GPS
   pour la livraison, appareil photo pour la vérification).

## iOS
```bash
npm i @capacitor/ios && npx cap add ios && npx cap open ios
```
Ajouter dans `Info.plist` : `NSCameraUsageDescription` (vérification d'identité, preuve de livraison)
et `NSLocationWhenInUseUsageDescription` (adresse de livraison GPS). Apple exige que l'application
apporte plus qu'un simple site : la PWA installable (`app/manifest.ts`) reste l'alternative immédiate
sur iPhone (Safari → Partager → Sur l'écran d'accueil).

## PWA (déjà active)
- Manifest : `app/manifest.ts` (icônes standard + maskable, thème #10052E, `start_url` /ar).
- Service worker : `public/sw.js` — met en cache les ressources statiques et une page hors-ligne ;
  **ne met jamais en cache** les routes API, paiement, portefeuille ou admin.
