# Mortelbook web — guide d'installation

Compte environ une heure la première fois. Tout est gratuit, sauf les 10 $ de crédit OpenRouter.

**Contenu du dossier**

| Fichier | Rôle |
|---|---|
| `index.html` | L'appli : la même que dans Claude, avec en plus ⚙️ Réglages IA et le mode 🌶️ |
| `js/shim.js` | Le module qui relie l'appli à Supabase, Gemini et OpenRouter |
| `config.js` | Les deux infos de ton projet Supabase (à remplir à l'étape 2) |
| `supabase.sql` | Le script qui crée la table de sauvegarde (étape 2) |
| `manifest.webmanifest`, `sw.js`, `icons/` | Pour l'installer comme une appli sur ton téléphone |

---

## Étape 1 — Exporter tes données depuis Claude

1. Ouvre Mortelbook dans Claude.
2. Va dans ton profil, en touchant ton nom en haut à droite.
3. Touche **📦 Exporter mes données**, puis accepte le téléchargement.

Tu obtiens un fichier `mortelbook-export-AAAA-MM-JJ.json`. Garde-le, tu l'importeras à l'étape 5.

## Étape 2 — Supabase (base de données et connexion)

1. Crée un compte sur **supabase.com**, puis un nouveau projet :
   - nom : `mortelbook` ;
   - région : **Paris (eu-west-3)** ;
   - choisis un mot de passe de base de données et garde-le de côté.
2. Dans le menu de gauche, ouvre **SQL Editor**, puis **New query**. Colle tout le contenu de `supabase.sql` et clique sur **Run**. Le message doit indiquer « Success ».
3. Va dans **Authentication**, puis **Sign In / Providers**, puis **Email**. Désactive **Confirm email** pour pouvoir te connecter tout de suite.
4. Va dans **Project Settings**, puis **API**, et copie deux valeurs :
   - **Project URL**, de la forme `https://xxxx.supabase.co` ;
   - la clé **anon public**, parfois appelée « publishable key ». N'utilise jamais la clé « service_role » ni la clé « secret ».
5. Ouvre `config.js` et remplace les deux valeurs par celles que tu viens de copier.

> Ces deux valeurs peuvent être publiques sans risque : c'est le script `supabase.sql` qui protège tes données, puisque chaque compte ne voit que ses propres lignes.

## Étape 3 — Mettre l'appli en ligne avec GitHub Pages

1. Sur **github.com**, crée un nouveau dépôt **public** nommé `mortelbook`. Il peut être public sans risque, car aucune clé IA n'est dans le code.
2. Clique sur **Add file**, puis **Upload files**. Glisse tout le contenu du dossier, y compris les dossiers `js` et `icons`, puis **Commit**.
3. Va dans **Settings**, puis **Pages** :
   - Source : **Deploy from a branch** ;
   - Branche : `main`, dossier `/ (root)` ;
   - clique sur **Save**.
4. Une à deux minutes plus tard, ton appli est en ligne à l'adresse `https://TON-PSEUDO.github.io/mortelbook/`.
5. De retour dans Supabase, va dans **Authentication**, puis **URL Configuration**, et mets cette adresse dans **Site URL**.

Pour les mises à jour : quand je te donne une nouvelle version d'un fichier, tu refais **Upload files** avec ce fichier, et il remplace l'ancien.

## Étape 4 — Les clés IA

**Gemini (gratuit), pour le réseau social et les histoires**
1. Va sur **aistudio.google.com/apikey** et connecte-toi avec ton compte Google.
2. Clique sur **Create API key**, puis copie la clé (elle commence par `AIza…`).

**OpenRouter, pour le mode 🌶️ et le secours**
1. Crée un compte sur **openrouter.ai**.
2. Va dans **Settings**, puis **Credits**, et achète **10 $**. Ça débloque aussi 1 000 requêtes par jour sur les modèles gratuits, pour toujours.
3. Va dans **Settings**, puis **Keys**, et clique sur **Create key**. Tu peux fixer une limite de dépense, par exemple 5 $, par sécurité.
4. Copie la clé (elle commence par `sk-or-…`).

## Étape 5 — Premier lancement

1. Ouvre ton adresse GitHub Pages et touche **Créer mon compte**, avec ton e-mail et un mot de passe.
2. Les réglages ⚙️ s'ouvrent. Colle tes deux clés, puis touche **Tester** sur chaque ligne. Tu dois voir un ✓ avec « Bonjour Sandra ! ».
3. Dans **📦 Importer mes données**, choisis le fichier exporté à l'étape 1. L'appli se recharge avec tous tes persos.
4. Recommandé : dans Supabase, va dans **Authentication**, puis **Sign In / Providers**, et désactive **Allow new users to sign up**. Comme ça, personne d'autre ne peut créer de compte sur ton appli.

## Étape 6 — L'installer sur ton téléphone

1. Ouvre l'adresse dans **Chrome** sur ton téléphone.
2. Ouvre le menu **⋮**, puis touche **Ajouter à l'écran d'accueil** ou **Installer l'application**.

Mortelbook apparaît avec son icône et s'ouvre en plein écran, comme une vraie appli.

---

## Utilisation

**⚙️ Réglages IA**
- Tu choisis un modèle pour chaque usage : réseau social, histoires, histoires « Plume soignée », 🌶️ épicé et secours.
- **🔄 Charger les modèles** affiche la liste de tous les modèles disponibles. Pour OpenRouter, le prix est indiqué à côté, ou « gratuit ».
- Par défaut :

| Usage | Modèle |
|---|---|
| Réseau social et histoires | `gemini-flash-latest` (gratuit) |
| 🌶️ Épicé | `thedrummer/cydonia-24b-v4.1` (environ 0,30 $ et 0,50 $ par million de jetons) |
| 🛟 Secours | Cydonia |

Le modèle de secours est utilisé automatiquement si Gemini atteint sa limite gratuite ou refuse de répondre. Il coûte un peu, mais très peu. Si tu préfères un secours gratuit, choisis un modèle OpenRouter qui finit par `:free`, ou « Aucun ».

**🌶️ Le mode épicé**
- **En messages privés :** le bouton 🌶️ apparaît en haut de la conversation dès que le perso est au palier Amour ou en couple avec toi. Une fois activé, ses messages, rendez-vous et événements à deux passent par le modèle épicé. Touche à nouveau 🌶️ pour revenir au réseau normal.
- **Dans les histoires :** choisis le niveau de romance « Épicée 🌶️ ».

**À savoir**
- **Limites de Gemini :** l'offre gratuite a des limites par minute et par jour, que Google change de temps en temps. Si tu les atteins, le modèle de secours prend le relais.
- **Confidentialité :** selon les conditions de Google, ce que tu envoies via l'offre gratuite de Gemini peut servir à améliorer leurs produits. C'est pour ça que le mode 🌶️ passe par OpenRouter et non par Gemini.
- **Deux applis séparées :** la version dans Claude et la version web ne se synchronisent pas. Ce que tu fais dans l'une n'apparaît pas dans l'autre. Tu peux réimporter un nouvel export quand tu veux, mais il remplace tout le contenu de la version web.
- **Tes données sont dans ton compte Supabase.** L'export dans 👤 Profil marche aussi dans la version web, pour garder une sauvegarde.
