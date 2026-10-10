# Sélection TV — flux privé Jellyfin

Ce composant optionnel ajoute un endpoint **authentifié par Jellyfin** pour alimenter une rubrique privée à partir du forum Forumactif.

Il ne publie jamais les topics ou les identifiants dans GitHub Pages.


### Fenêtre temporelle

La rubrique applique une fenêtre glissante stricte (24 h par défaut). La date utilisée est l’activité du dernier message du topic. Si cette date n’est pas lisible dans la liste du sous-forum, le plugin vérifie directement le topic (et sa dernière page lorsqu’elle est paginée). Un sujet dont la date reste indéterminable est exclu au lieu d’être considéré comme récent.

## Principe

1. Le plugin Jellyfin se connecte au forum côté serveur.
2. Il lit les pages du sous-forum dans la session authentifiée ; le RSS authentifié sert de secours lorsque le thème HTML ne fournit pas les dates.
3. Il conserve les sujets actifs dans la fenêtre demandée (24 h par défaut).
4. Il extrait un titre de film et une année probables du titre de release.
5. La page Jellyfin de Sélection TV utilise ensuite les fournisseurs de métadonnées de Jellyfin pour identifier le film, récupérer une affiche et enrichir la fiche.
6. Le navigateur envoie uniquement les fiches enrichies à l'iframe Sélection TV par `postMessage`.

## Configuration locale

Après compilation et installation du plugin, créer :

```text
C:\ProgramData\Jellyfin\Server\plugins\configurations\Jellyfin.Plugin.SelectionTvPrivate\config.json
```

à partir de `config.example.json`.

**Ne jamais committer ce fichier.** Le mot de passe reste en clair dans ce fichier local parce que le serveur doit pouvoir l'utiliser pour se connecter au forum. Limiter l'accès NTFS au compte qui exécute Jellyfin et aux administrateurs.

L'endpoint exposé est :

```text
GET /SelectionTv/Uploads?hours=24
```

Il porte l'attribut `[Authorize]` : un visiteur non authentifié de Jellyfin ne peut pas lire le flux.

## Compilation pour Jellyfin 10.11.x

Le projet cible .NET 9 et les packages Jellyfin 10.11.0, comme les plugins compatibles 10.11.x.

```powershell
dotnet restore .\Jellyfin.Plugin.SelectionTvPrivate.csproj
dotnet build .\Jellyfin.Plugin.SelectionTvPrivate.csproj -c Release
```

Copier uniquement `Jellyfin.Plugin.SelectionTvPrivate.dll` dans un dossier de plugin Jellyfin dédié puis redémarrer le serveur.

## Mise à jour du correctif de connexion 0.6.1

Le formulaire Forumactif peut proposer une connexion classique et une connexion par lien reçu par courriel. Le plugin utilise uniquement le formulaire classique et ses champs cachés. Il ne doit jamais envoyer le champ `magic_request` du second formulaire avec le mot de passe.

L'archive `SelectionTvPrivate-Jellyfin-10.11` produite par le workflow **Build Jellyfin private uploads plugin** contient le plugin compilé et le parent Web correspondant. Sous Windows :

1. Extraire l'archive dans un dossier temporaire.
2. Arrêter le serveur Jellyfin.
3. Remplacer la DLL `Jellyfin.Plugin.SelectionTvPrivate.dll` dans le dossier du plugin déjà installé, sous `C:\ProgramData\Jellyfin\Server\plugins\`. Ne pas créer une seconde copie du même plugin.
4. Remplacer `C:\Program Files\Jellyfin\Server\jellyfin-web\selection-tv.html` par le fichier `selection-tv.html` de l'archive. Cette copie transmet les erreurs du flux au magazine, y compris un refus de connexion Forumactif.
5. Conserver le `config.json` existant, puis redémarrer Jellyfin. `config.example.json` reste un exemple : ne pas l'utiliser pour écraser les identifiants en place.
6. Recharger complètement la page Jellyfin avec `Ctrl+Maj+R`. Vérifier que `SelectionTv/Uploads?hours=24` renvoie HTTP 200 et que les cartes apparaissent, ou que le message indique explicitement un flux vide.

Le correctif public du magazine ne remplace pas la DLL installée sur le serveur. Une erreur 503 avec le détail « Connexion Forumactif refusée ou session non authentifiée. » signifie que l'accès au sous-forum revient sur la connexion ; elle ne suffit pas à conclure que le mot de passe est incorrect. Si ce refus persiste avec le plugin 0.6.1, vérifier la connexion au forum et l'accès au sous-forum avec le même compte que celui du `config.json` local.

## Rafraîchissement

Le serveur garde le résultat au maximum 8 minutes en mémoire. La page Jellyfin peut donc interroger l'endpoint toutes les 10 minutes sans relancer une connexion Forumactif à chaque affichage.
