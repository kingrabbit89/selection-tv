using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.SelectionTvPrivate;

public sealed class PublicMetadataService
{
    private readonly ILogger<PublicMetadataService> _logger;
    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly TimeSpan CacheTtl = TimeSpan.FromHours(24);

    private sealed record CacheEntry(DateTimeOffset At, MetadataEnrichmentResult Value);

    private sealed class FilmPage
    {
        public string? Title { get; set; }
        public string? AlternateTitle { get; set; }
        public int? Year { get; set; }
        public string? Director { get; set; }
        public string? Rating { get; set; }
        public string? Image { get; set; }
        public string? CanonicalUrl { get; set; }
        public string? ImdbId { get; set; }
    }

    public PublicMetadataService(ILogger<PublicMetadataService> logger)
    {
        _logger = logger;
    }

    public async Task<MetadataEnrichmentResult> EnrichAsync(
        MetadataEnrichmentRequest request,
        CancellationToken cancellationToken)
    {
        var title = (request.Title ?? "").Trim();
        var year = request.Year;
        var director = CleanDirector(request.Director);
        var suppliedImdb = NormalizeImdbId(request.ImdbId);
        var candidates = TitleCandidates(title, request.TopicTitle);
        var key = string.Join("|", candidates) + $"|{year}|{director}|{suppliedImdb}";

        if (_cache.TryGetValue(key, out var cached)
            && DateTimeOffset.UtcNow - cached.At < CacheTtl)
        {
            return cached.Value;
        }

        using var handler = new HttpClientHandler
        {
            AllowAutoRedirect = true,
            AutomaticDecompression = DecompressionMethods.All
        };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };
        client.DefaultRequestHeaders.TryAddWithoutValidation(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36");
        client.DefaultRequestHeaders.TryAddWithoutValidation(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        client.DefaultRequestHeaders.TryAddWithoutValidation(
            "Accept-Language",
            "fr-FR,fr;q=0.9,en;q=0.7");

        var result = new MetadataEnrichmentResult();

        var imdb = await ResolveImdbAsync(
            client,
            candidates,
            year,
            director,
            suppliedImdb,
            cancellationToken).ConfigureAwait(false);

        if (imdb is not null)
        {
            result.MatchedTitle = imdb.Title;
            result.ImdbId = imdb.ImdbId;
            result.ImdbUrl = imdb.CanonicalUrl;
            result.ImdbRating = NormalizeRating(imdb.Rating);
            result.ImageUrl = imdb.Image;
        }

        var sc = await ResolveSensCritiqueAsync(
            client,
            candidates,
            year,
            director,
            cancellationToken).ConfigureAwait(false);

        if (sc is not null)
        {
            result.SensCritiqueUrl = sc.CanonicalUrl;
            result.SensCritiqueRating = NormalizeRating(sc.Rating);
            if (string.IsNullOrWhiteSpace(result.ImageUrl))
            {
                result.ImageUrl = sc.Image;
            }

            result.MatchedTitle ??= sc.Title;
        }

        _cache[key] = new CacheEntry(DateTimeOffset.UtcNow, result);
        return result;
    }

    private async Task<FilmPage?> ResolveImdbAsync(
        HttpClient client,
        IReadOnlyList<string> titles,
        int? year,
        string? director,
        string? suppliedId,
        CancellationToken cancellationToken)
    {
        var ids = new List<string>();
        if (!string.IsNullOrWhiteSpace(suppliedId))
        {
            ids.Add(suppliedId);
        }

        foreach (var title in titles.Take(3))
        {
            var query = title
                + (year.HasValue ? " " + year.Value.ToString(CultureInfo.InvariantCulture) : "")
                + (!string.IsNullOrWhiteSpace(director) ? " " + director : "");
            var url = "https://www.imdb.com/find/?q=" + Uri.EscapeDataString(query)
                + "&s=tt&ttype=ft,tv";
            try
            {
                var html = await client.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
                foreach (Match m in Regex.Matches(html, @"/title/(?<id>tt\d{5,12})/", RegexOptions.IgnoreCase))
                {
                    var id = m.Groups["id"].Value.ToLowerInvariant();
                    if (!ids.Contains(id, StringComparer.OrdinalIgnoreCase))
                    {
                        ids.Add(id);
                    }

                    if (ids.Count >= 8)
                    {
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Selection TV: IMDb search failed for {Title}", title);
            }

            if (ids.Count >= 8)
            {
                break;
            }
        }

        FilmPage? best = null;
        var bestScore = int.MinValue;

        foreach (var id in ids.Take(8))
        {
            try
            {
                var page = await LoadImdbPageAsync(client, id, cancellationToken).ConfigureAwait(false);
                if (page is null)
                {
                    continue;
                }

                var score = Score(page, titles, year, director);
                if (string.Equals(id, suppliedId, StringComparison.OrdinalIgnoreCase))
                {
                    score += 3;
                }

                if (score > bestScore)
                {
                    bestScore = score;
                    best = page;
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Selection TV: IMDb candidate failed for {ImdbId}", id);
            }
        }

        // A wrong link is worse than no link.
        return bestScore >= 70 ? best : null;
    }

    private static async Task<FilmPage?> LoadImdbPageAsync(
        HttpClient client,
        string imdbId,
        CancellationToken cancellationToken)
    {
        var url = $"https://www.imdb.com/title/{imdbId}/";
        var html = await client.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
        var page = ParseJsonLdMovie(html);

        if (page is null)
        {
            page = new FilmPage
            {
                Title = Meta(html, "og:title")?.Replace(" - IMDb", "", StringComparison.OrdinalIgnoreCase),
                Image = Meta(html, "og:image"),
                Rating = FirstRegex(html, @"""ratingValue""\s*:\s*""?(?<v>\d+(?:\.\d+)?)", "v")
            };
        }

        page.ImdbId = imdbId;
        page.CanonicalUrl = $"https://www.imdb.com/title/{imdbId}/";
        page.Image = CleanImageUrl(page.Image);
        return page;
    }

    private async Task<FilmPage?> ResolveSensCritiqueAsync(
        HttpClient client,
        IReadOnlyList<string> titles,
        int? year,
        string? director,
        CancellationToken cancellationToken)
    {
        var candidateUrls = new List<string>();

        foreach (var title in titles.Take(3))
        {
            var q = $"site:senscritique.com/film \"{title}\""
                + (year.HasValue ? " " + year.Value.ToString(CultureInfo.InvariantCulture) : "")
                + (!string.IsNullOrWhiteSpace(director) ? " \"" + director + "\"" : "");

            foreach (var searchUrl in new[]
            {
                "https://www.google.com/search?q=" + Uri.EscapeDataString(q),
                "https://www.bing.com/search?q=" + Uri.EscapeDataString(q),
                "https://html.duckduckgo.com/html/?q=" + Uri.EscapeDataString(q)
            })
            {
                try
                {
                    var html = await client.GetStringAsync(searchUrl, cancellationToken).ConfigureAwait(false);
                    foreach (var found in ExtractSensCritiqueUrls(html))
                    {
                        if (!candidateUrls.Contains(found, StringComparer.OrdinalIgnoreCase))
                        {
                            candidateUrls.Add(found);
                        }
                    }
                }
                catch
                {
                    // Continue with the next public search surface.
                }

                if (candidateUrls.Count >= 8)
                {
                    break;
                }
            }

            if (candidateUrls.Count >= 8)
            {
                break;
            }
        }

        var resolvedUrls = new List<string>();
        foreach (var candidate in candidateUrls.Take(8))
        {
            try
            {
                foreach (var resolved in await ResolveSensCritiqueWorkUrlsAsync(
                    client,
                    candidate,
                    cancellationToken).ConfigureAwait(false))
                {
                    if (!resolvedUrls.Contains(resolved, StringComparer.OrdinalIgnoreCase))
                    {
                        resolvedUrls.Add(resolved);
                    }
                }
            }
            catch
            {
                // Skip malformed/blocked result.
            }
        }

        FilmPage? best = null;
        var bestScore = int.MinValue;

        foreach (var url in resolvedUrls.Take(8))
        {
            try
            {
                var html = await client.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
                var page = ParseSensCritiquePage(html, url);
                var score = Score(page, titles, year, director);
                if (score > bestScore)
                {
                    bestScore = score;
                    best = page;
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Selection TV: SensCritique candidate failed for {Url}", url);
            }
        }

        return bestScore >= 65 ? best : null;
    }

    private static async Task<IReadOnlyList<string>> ResolveSensCritiqueWorkUrlsAsync(
        HttpClient client,
        string candidate,
        CancellationToken cancellationToken)
    {
        var result = new List<string>();

        if (IsCanonicalSensCritiqueWork(candidate))
        {
            result.Add(NormalizeSensCritiqueUrl(candidate));
            return result;
        }

        var html = await client.GetStringAsync(candidate, cancellationToken).ConfigureAwait(false);

        // A critique page contains breadcrumb/work links. Never derive a work
        // URL by simply chopping "/critique/...": that creates dead links.
        foreach (Match m in Regex.Matches(
            WebUtility.HtmlDecode(html),
            @"https?://(?:www\.)?senscritique\.com/film/[a-zA-Z0-9_%\-]+/\d+",
            RegexOptions.IgnoreCase))
        {
            var u = NormalizeSensCritiqueUrl(m.Value);
            if (IsCanonicalSensCritiqueWork(u)
                && !result.Contains(u, StringComparer.OrdinalIgnoreCase))
            {
                result.Add(u);
            }
        }

        foreach (Match m in Regex.Matches(
            WebUtility.HtmlDecode(html),
            @"href=[""'](?<u>/film/[a-zA-Z0-9_%\-]+/\d+)[""']",
            RegexOptions.IgnoreCase))
        {
            var u = "https://www.senscritique.com" + m.Groups["u"].Value;
            u = NormalizeSensCritiqueUrl(u);
            if (!result.Contains(u, StringComparer.OrdinalIgnoreCase))
            {
                result.Add(u);
            }
        }

        return result;
    }

    private static FilmPage ParseSensCritiquePage(string html, string fallbackUrl)
    {
        var page = ParseJsonLdMovie(html) ?? new FilmPage();

        page.CanonicalUrl = Canonical(html) is { } canonical && IsCanonicalSensCritiqueWork(canonical)
            ? NormalizeSensCritiqueUrl(canonical)
            : NormalizeSensCritiqueUrl(fallbackUrl);

        page.Title ??= CleanSensCritiqueTitle(Meta(html, "og:title"));
        page.Image ??= Meta(html, "og:image");
        page.Image = CleanImageUrl(page.Image);

        page.Rating ??=
            FirstRegex(html, @"""ratingValue""\s*:\s*""?(?<v>\d+(?:[\.,]\d+)?)", "v")
            ?? FirstRegex(html, @"""rating""\s*:\s*(?<v>\d+(?:[\.,]\d+)?)", "v");

        if (!page.Year.HasValue)
        {
            var source = Meta(html, "og:title") ?? html;
            var ym = Regex.Match(source, @"\b(19\d{2}|20\d{2})\b");
            if (ym.Success)
            {
                page.Year = int.Parse(ym.Value, CultureInfo.InvariantCulture);
            }
        }

        if (string.IsNullOrWhiteSpace(page.Director))
        {
            page.Director = FirstRegex(
                StripTags(html),
                @"Film\s+de\s+(?<v>[^(\r\n]{2,100})\s*\((?:19|20)\d{2}\)",
                "v")?.Trim();
        }

        return page;
    }

    private static FilmPage? ParseJsonLdMovie(string html)
    {
        foreach (Match m in Regex.Matches(
            html,
            @"<script\b[^>]*type=[""']application/ld\+json[""'][^>]*>(?<json>.*?)</script>",
            RegexOptions.IgnoreCase | RegexOptions.Singleline))
        {
            try
            {
                using var doc = JsonDocument.Parse(WebUtility.HtmlDecode(m.Groups["json"].Value));
                foreach (var node in EnumerateObjects(doc.RootElement))
                {
                    if (!node.TryGetProperty("@type", out var type))
                    {
                        continue;
                    }

                    var typeText = type.ValueKind == JsonValueKind.String ? type.GetString() : null;
                    if (typeText is not ("Movie" or "TVMovie" or "CreativeWork"))
                    {
                        continue;
                    }

                    var page = new FilmPage
                    {
                        Title = StringProp(node, "name"),
                        AlternateTitle = StringProp(node, "alternateName"),
                        Image = ImageProp(node),
                        Rating = RatingProp(node),
                        Year = YearProp(node),
                        Director = DirectorProp(node)
                    };

                    if (!string.IsNullOrWhiteSpace(page.Title))
                    {
                        return page;
                    }
                }
            }
            catch
            {
                // Try the next JSON-LD block.
            }
        }

        return null;
    }

    private static IEnumerable<JsonElement> EnumerateObjects(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object)
        {
            yield return root;
            if (root.TryGetProperty("@graph", out var graph) && graph.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in graph.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.Object)
                    {
                        yield return item;
                    }
                }
            }
        }
        else if (root.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in root.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Object)
                {
                    yield return item;
                }
            }
        }
    }

    private static string? StringProp(JsonElement node, string name)
        => node.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    private static string? ImageProp(JsonElement node)
    {
        if (!node.TryGetProperty("image", out var image))
        {
            return null;
        }

        if (image.ValueKind == JsonValueKind.String)
        {
            return image.GetString();
        }

        if (image.ValueKind == JsonValueKind.Object)
        {
            return StringProp(image, "url") ?? StringProp(image, "contentUrl");
        }

        return null;
    }

    private static string? RatingProp(JsonElement node)
    {
        if (!node.TryGetProperty("aggregateRating", out var rating)
            || rating.ValueKind != JsonValueKind.Object
            || !rating.TryGetProperty("ratingValue", out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.String => value.GetString(),
            _ => null
        };
    }

    private static int? YearProp(JsonElement node)
    {
        var date = StringProp(node, "datePublished");
        if (date is not null)
        {
            var m = Regex.Match(date, @"\b(19\d{2}|20\d{2})\b");
            if (m.Success)
            {
                return int.Parse(m.Value, CultureInfo.InvariantCulture);
            }
        }

        return null;
    }

    private static string? DirectorProp(JsonElement node)
    {
        if (!node.TryGetProperty("director", out var d))
        {
            return null;
        }

        if (d.ValueKind == JsonValueKind.Object)
        {
            return StringProp(d, "name");
        }

        if (d.ValueKind == JsonValueKind.Array)
        {
            return string.Join(", ", d.EnumerateArray()
                .Where(x => x.ValueKind == JsonValueKind.Object)
                .Select(x => StringProp(x, "name"))
                .Where(x => !string.IsNullOrWhiteSpace(x)));
        }

        return null;
    }

    private static int Score(
        FilmPage page,
        IReadOnlyList<string> titles,
        int? expectedYear,
        string? expectedDirector)
    {
        var score = 0;
        var actualTitles = new[] { page.Title, page.AlternateTitle }
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(Norm)
            .Where(x => x.Length > 0)
            .ToArray();

        foreach (var title in titles)
        {
            var n = Norm(title);
            if (actualTitles.Contains(n, StringComparer.Ordinal))
            {
                score = Math.Max(score, 85);
            }
            else if (actualTitles.Any(a => a.Contains(n, StringComparison.Ordinal) || n.Contains(a, StringComparison.Ordinal)))
            {
                score = Math.Max(score, 45);
            }
        }

        if (expectedYear.HasValue && page.Year.HasValue)
        {
            var delta = Math.Abs(expectedYear.Value - page.Year.Value);
            score += delta == 0 ? 40 : delta == 1 ? 8 : -80;
        }

        if (!string.IsNullOrWhiteSpace(expectedDirector) && !string.IsNullOrWhiteSpace(page.Director))
        {
            var expected = Norm(expectedDirector);
            var actual = Norm(page.Director);
            if (actual.Contains(expected, StringComparison.Ordinal) || expected.Contains(actual, StringComparison.Ordinal))
            {
                score += 35;
            }
            else
            {
                score -= 20;
            }
        }

        return score;
    }

    private static IReadOnlyList<string> TitleCandidates(string title, string? topicTitle)
    {
        var list = new List<string>();

        void Add(string? value)
        {
            value = Regex.Replace(value ?? "", @"\s+", " ").Trim(' ', '-', '–', '—', '.', ':', ';');
            if (value.Length >= 2 && !list.Any(x => Norm(x) == Norm(value)))
            {
                list.Add(value);
            }
        }

        Add(title);

        foreach (Match m in Regex.Matches(title, @"\((?<v>[^()]{2,100})\)"))
        {
            Add(m.Groups["v"].Value);
        }

        Add(Regex.Replace(title, @"\s*\([^()]+\)\s*", " "));

        if (!string.IsNullOrWhiteSpace(topicTitle))
        {
            var year = Regex.Match(topicTitle, @"\b(?:19|20)\d{2}\b");
            var head = year.Success ? topicTitle[..year.Index] : topicTitle;
            head = head.Trim(' ', '-', '–', '—', '.', ':', ';');
            Add(head);
            foreach (Match m in Regex.Matches(head, @"\((?<v>[^()]{2,100})\)"))
            {
                Add(m.Groups["v"].Value);
            }
        }

        return list.Take(5).ToArray();
    }

    private static IEnumerable<string> ExtractSensCritiqueUrls(string html)
    {
        html = WebUtility.HtmlDecode(html)
            .Replace(@"\u0026", "&", StringComparison.Ordinal)
            .Replace(@"\/", "/", StringComparison.Ordinal);

        var found = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (Match m in Regex.Matches(
            html,
            @"https?://(?:www\.)?senscritique\.com/film/[a-zA-Z0-9_%\-]+(?:/\d+|/critique/\d+)",
            RegexOptions.IgnoreCase))
        {
            var u = m.Value.TrimEnd('.', ',', '"', '\'', ')', ']', '}', '\\');
            if (found.Add(u))
            {
                yield return u;
            }
        }

        foreach (Match m in Regex.Matches(html, @"uddg=(?<v>[^&""']+)", RegexOptions.IgnoreCase))
        {
            var decoded = Uri.UnescapeDataString(m.Groups["v"].Value);
            if (Regex.IsMatch(
                decoded,
                @"https?://(?:www\.)?senscritique\.com/film/",
                RegexOptions.IgnoreCase)
                && found.Add(decoded))
            {
                yield return decoded;
            }
        }
    }

    private static bool IsCanonicalSensCritiqueWork(string url)
        => Regex.IsMatch(
            url,
            @"^https?://(?:www\.)?senscritique\.com/film/[a-zA-Z0-9_%\-]+/\d+/?(?:\?.*)?$",
            RegexOptions.IgnoreCase);

    private static string NormalizeSensCritiqueUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            return url;
        }

        return "https://www.senscritique.com" + uri.AbsolutePath.TrimEnd('/');
    }

    private static string? Canonical(string html)
        => FirstRegex(
            html,
            @"<link\b[^>]*rel=[""']canonical[""'][^>]*href=[""'](?<v>https?://[^""']+)[""']",
            "v")
        ?? FirstRegex(
            html,
            @"<link\b[^>]*href=[""'](?<v>https?://[^""']+)[""'][^>]*rel=[""']canonical[""']",
            "v");

    private static string? Meta(string html, string property)
        => FirstRegex(
            html,
            $@"<meta\b[^>]*(?:property|name)=[""']{Regex.Escape(property)}[""'][^>]*content=[""'](?<v>[^""']+)[""']",
            "v")
        ?? FirstRegex(
            html,
            $@"<meta\b[^>]*content=[""'](?<v>[^""']+)[""'][^>]*(?:property|name)=[""']{Regex.Escape(property)}[""']",
            "v");

    private static string? CleanSensCritiqueTitle(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return Regex.Replace(
            WebUtility.HtmlDecode(value),
            @"\s*-\s*(?:Film|SensCritique).*$",
            "",
            RegexOptions.IgnoreCase).Trim();
    }

    private static string? CleanImageUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return WebUtility.HtmlDecode(value)
            .Replace(@"\/", "/", StringComparison.Ordinal)
            .Trim();
    }

    private static string? NormalizeImdbId(string? value)
    {
        var m = Regex.Match(value ?? "", @"tt\d{5,12}", RegexOptions.IgnoreCase);
        return m.Success ? m.Value.ToLowerInvariant() : null;
    }

    private static string? NormalizeRating(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        value = value.Replace(',', '.');
        return double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var v)
            && v >= 0
            && v <= 10
            ? v.ToString("0.0", CultureInfo.InvariantCulture).Replace('.', ',')
            : null;
    }

    private static string? CleanDirector(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        value = Regex.Replace(
            value,
            @"\s*\((?:vostfr|vo(?:\s+ou\s+vf)?|vf|multi|truefrench|french|subfrench|téléfilm|telefilm)[^)]*\)\s*$",
            "",
            RegexOptions.IgnoreCase);
        return Regex.Replace(value, @"\s+", " ").Trim(' ', '-', '–', '—', '.', ':', ';');
    }

    private static string Norm(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "";
        }

        var normalized = value.ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var chars = normalized
            .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
            .Select(c => char.IsLetterOrDigit(c) ? c : ' ')
            .ToArray();
        return Regex.Replace(new string(chars), @"\s+", " ").Trim();
    }

    private static string StripTags(string html)
        => Regex.Replace(WebUtility.HtmlDecode(html), @"<[^>]+>", " ");

    private static string? FirstRegex(string input, string pattern, string group)
    {
        var m = Regex.Match(input, pattern, RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return m.Success ? WebUtility.HtmlDecode(m.Groups[group].Value) : null;
    }
}
