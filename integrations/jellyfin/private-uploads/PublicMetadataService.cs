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
        var imdbId = NormalizeImdbId(request.ImdbId);
        var key = $"{title}|{year}|{imdbId}";

        if (_cache.TryGetValue(key, out var cached) && DateTimeOffset.UtcNow - cached.At < CacheTtl)
        {
            return cached.Value;
        }

        var result = new MetadataEnrichmentResult();

        using var handler = new HttpClientHandler
        {
            AllowAutoRedirect = true,
            AutomaticDecompression = DecompressionMethods.All
        };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };
        client.DefaultRequestHeaders.TryAddWithoutValidation(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0 Safari/537.36");
        client.DefaultRequestHeaders.TryAddWithoutValidation("Accept-Language", "fr-FR,fr;q=0.9,en;q=0.7");

        if (!string.IsNullOrWhiteSpace(imdbId))
        {
            result.ImdbUrl = $"https://www.imdb.com/title/{imdbId}/";
            try
            {
                var html = await client.GetStringAsync(result.ImdbUrl, cancellationToken).ConfigureAwait(false);
                result.ImdbRating = FirstRegex(
                    html,
                    @"""ratingValue""\s*:\s*""?(?<v>\d+(?:\.\d+)?)",
                    "v");
                result.ImageUrl =
                    FirstRegex(html, @"<meta[^>]+property=[""']og:image[""'][^>]+content=[""'](?<v>https?://[^""']+)[""']", "v")
                    ?? FirstRegex(html, @"""image""\s*:\s*""(?<v>https:\/\/[^""]+)""", "v");
                if (result.ImageUrl is not null)
                {
                    result.ImageUrl = WebUtility.HtmlDecode(result.ImageUrl).Replace(@"\/", "/", StringComparison.Ordinal);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Selection TV: IMDb enrichment failed for {ImdbId}", imdbId);
            }
        }

        try
        {
            var scUrl = await FindSensCritiqueAsync(client, title, year, cancellationToken).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(scUrl))
            {
                result.SensCritiqueUrl = scUrl;
                try
                {
                    var html = await client.GetStringAsync(scUrl, cancellationToken).ConfigureAwait(false);
                    result.SensCritiqueRating =
                        FirstRegex(html, @"""ratingValue""\s*:\s*""?(?<v>\d+(?:[\.,]\d+)?)", "v")
                        ?? FirstRegex(html, @"""rating""\s*:\s*(?<v>\d+(?:[\.,]\d+)?)", "v");

                    if (string.IsNullOrWhiteSpace(result.ImageUrl))
                    {
                        result.ImageUrl = FirstRegex(
                            html,
                            @"<meta[^>]+property=[""']og:image[""'][^>]+content=[""'](?<v>https?://[^""']+)[""']",
                            "v");
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Selection TV: SensCritique page enrichment failed for {Url}", scUrl);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Selection TV: SensCritique lookup failed for {Title}", title);
        }

        result.ImdbRating = NormalizeRating(result.ImdbRating);
        result.SensCritiqueRating = NormalizeRating(result.SensCritiqueRating);

        _cache[key] = new CacheEntry(DateTimeOffset.UtcNow, result);
        return result;
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
            ? v.ToString("0.0", CultureInfo.InvariantCulture).Replace('.', ',')
            : null;
    }

    private static string? FirstRegex(string input, string pattern, string group)
    {
        var m = Regex.Match(input, pattern, RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return m.Success ? WebUtility.HtmlDecode(m.Groups[group].Value) : null;
    }

    private static async Task<string?> FindSensCritiqueAsync(
        HttpClient client,
        string title,
        int? year,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(title))
        {
            return null;
        }

        var q = $"site:senscritique.com/film \"{title}\"{(year.HasValue ? " " + year.Value : "")}";
        foreach (var url in new[]
        {
            "https://www.google.com/search?q=" + Uri.EscapeDataString(q),
            "https://www.bing.com/search?q=" + Uri.EscapeDataString(q),
            "https://html.duckduckgo.com/html/?q=" + Uri.EscapeDataString(q)
        })
        {
            try
            {
                var html = await client.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
                var found = ExtractSensCritiqueUrl(html);
                if (found is not null)
                {
                    return found;
                }
            }
            catch
            {
                // Try the next public search surface.
            }
        }

        return null;
    }

    private static string? ExtractSensCritiqueUrl(string html)
    {
        html = WebUtility.HtmlDecode(html).Replace(@"\u0026", "&", StringComparison.Ordinal);

        foreach (Match m in Regex.Matches(
            html,
            @"https?://(?:www\.)?senscritique\.com/film/(?<slug>[a-zA-Z0-9_%\-]+)(?:/(?<id>\d+))?",
            RegexOptions.IgnoreCase))
        {
            var raw = m.Value.TrimEnd('.', ',', '"', '\'', ')', ']', '}', '\\');
            if (raw.Contains("/critique/", StringComparison.OrdinalIgnoreCase))
            {
                raw = raw[..raw.IndexOf("/critique/", StringComparison.OrdinalIgnoreCase)];
            }

            if (Uri.TryCreate(raw, UriKind.Absolute, out var uri)
                && uri.Host.EndsWith("senscritique.com", StringComparison.OrdinalIgnoreCase))
            {
                return uri.GetLeftPart(UriPartial.Path);
            }
        }

        // DuckDuckGo wraps the target in an uddg= parameter.
        foreach (Match m in Regex.Matches(html, @"uddg=(?<v>[^&""']+)", RegexOptions.IgnoreCase))
        {
            var decoded = Uri.UnescapeDataString(m.Groups["v"].Value);
            if (decoded.Contains("senscritique.com/film/", StringComparison.OrdinalIgnoreCase)
                && Uri.TryCreate(decoded, UriKind.Absolute, out var uri))
            {
                return uri.GetLeftPart(UriPartial.Path);
            }
        }

        return null;
    }
}
