# Sélection TV — flux privé Jellyfin

Ce composant optionnel ajoute un endpoint **authentifié par Jellyfin** pour alimenter une rubrique privée à partir du forum Forumactif.

Il ne publie jamais les topics ou les identifiants dans GitHub Pages.

## Principe

1. Le plugin Jellyfin se connecte au forum côté serveur.
2. Il demande le flux RSS du sous-forum dans la session authentifiée.
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
dotnet publish .\Jellyfin.Plugin.SelectionTvPrivate.csproj -c Release
```

Copier ensuite les DLL produites dans un dossier de plugin Jellyfin dédié puis redémarrer le serveur.

## Rafraîchissement

Le serveur garde le résultat au maximum 8 minutes en mémoire. La page Jellyfin peut donc interroger l'endpoint toutes les 10 minutes sans relancer une connexion Forumactif à chaque affichage.
