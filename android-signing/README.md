# Clé de signature de l'application Android

`debug.keystore` sert à signer l'APK produit par `.github/workflows/build-android.yml`.

## Pourquoi elle est versionnée ici

Android refuse d'installer une mise à jour signée par une clé différente de celle de la version
déjà installée. Il faudrait alors désinstaller d'abord — ce qui **efface toutes les données
locales de l'appli**, dont le miroir de la progression (`js/localmirror.js`) et les images
téléchargées pour le hors-ligne.

Or un runner GitHub Actions repart de zéro à chaque exécution : `assembleDebug` y fabriquerait
une clé de débogage **différente à chaque build**. Chaque nouvelle version aurait donc été
impossible à installer par-dessus la précédente. En versionnant la clé, la signature reste
identique d'une version à l'autre : les mises à jour s'installent normalement, sans rien perdre.

Ce sont les identifiants standard d'une clé de débogage Android (`androiddebugkey` /
`android`), ceux-là mêmes que le SDK Android génère sur la machine de chaque développeur. Ce
n'est donc pas un secret, et rien de sensible ne s'y trouve.

## Portée réelle

Cette clé n'ouvre l'accès à rien : elle ne protège aucune donnée, ne donne aucun droit sur le
compte Firebase, et l'appli ne s'en sert jamais à l'exécution. Son seul rôle est de prouver que
deux APK proviennent de la même origine. Le seul abus possible serait de fabriquer un APK
capable de s'installer **par-dessus** celui-ci — ce qui suppose déjà de convaincre l'utilisateur
d'installer un fichier venu d'ailleurs que de ce dépôt.

## Passer à une clé de publication

Nécessaire uniquement pour publier sur le Play Store, qui refuse les APK signés en debug.
Générer une clé, la stocker en secret de dépôt (base64), et faire signer `assembleRelease` avec :

```bash
keytool -genkeypair -v -keystore release.keystore -alias quizzppl \
  -keyalg RSA -keysize 2048 -validity 10950
base64 -w0 release.keystore   # -> secret RELEASE_KEYSTORE_B64
```

Une fois publiée, cette clé de publication ne doit **jamais** être perdue ni changée : elle
seule permet de publier une mise à jour de l'application.
