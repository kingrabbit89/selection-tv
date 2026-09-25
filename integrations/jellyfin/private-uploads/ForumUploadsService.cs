using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.SelectionTvPrivate;

public sealed class ForumUploadsService
{
    private readonly string _configPath;
    private readonly ILogger<ForumUploadsService> _logger;
    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private ForumUploadsEnvelope? _cache;
    private DateTimeOffset _cacheAt = DateTimeOffset.MinValue;

    public ForumUploadsService(IApplicationPaths applicationPaths, ILogger<ForumUploadsService> logger)
    {
        _logger = logger;
        var dir = Path.Combine(applicationPaths.PluginConfigurationsPath, "Jellyfin.Plugin.SelectionTvPrivate");
        _configPath = Path.Combine(dir, "config.json");
    }

    public async Task<ForumUploadsEnvelope> GetUploadsAsync(int? requestedHours, CancellationToken cancellationToken)
    {
        var cfg = LoadConfig();
        var hours = Math.Clamp(requestedHours ?? cfg.WindowHours, 1, 168);

        if (_cache is not null && DateTimeOffset.UtcNow - _cacheAt < TimeSpan.FromMinutes(8))
        {
            return FilterEnvelope(_cache, hours);
        }

        await _refreshLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_cache is null || DateTimeOffset.UtcNow - _cacheAt >= TimeSpan.FromMinutes(8))
            {
                _cache = await RefreshAsync(cfg, cancellationToken).ConfigureAwait(false);
                _cacheAt = DateTimeOffset.UtcNow;
            }

            return FilterEnvelope(_cache, hours);
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    private PrivateUploadsConfig LoadConfig()
    {
        if (!File.Exists(_configPath))
        {
            throw new InvalidOperationException($"Configuration absente : {_configPath}");
        }

        var cfg = JsonSerializer.Deserialize<PrivateUploadsConfig>(
            File.ReadAllText(_configPath),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        if (cfg is null || string.IsNullOrWhiteSpace(cfg.Username) || string.IsNullOrWhiteSpace(cfg.Password))
        {
            throw new InvalidOperationException("Identifiants Forumactif absents de config.json.");
        }

        return cfg;
    }

    private async Task<ForumUploadsEnvelope> RefreshAsync(PrivateUploadsConfig cfg, CancellationToken cancellationToken)
    {
        var baseUri = new Uri(cfg.ForumUrl.TrimEnd('/') + "/");
        var cookieJar = new CookieContainer();
        using var handler = new HttpClientHandler
        {
            CookieContainer = cookieJar,
            AllowAutoRedirect = true,
            AutomaticDecompression = DecompressionMethods.All
        };
        using var client = new HttpClient(handler)
        {
            BaseAddress = baseUri,
            Timeout = TimeSpan.FromSeconds(30)
        };
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("SelectionTV-Jellyfin", "0.1"));
        client.DefaultRequestHeaders.AcceptLanguage.ParseAdd("fr-FR,fr;q=0.9,en;q=0.5");

        await LoginAsync(client, cfg, cancellationToken).ConfigureAwait(false);

        var forumPath = $"f{cfg.ForumId}-";
        var forumResponse = await client.GetAsync(forumPath, cancellationToken).ConfigureAwait(false);
        var forumHtml = await forumResponse.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (LooksLikeLogin(forumResponse.RequestMessage?.RequestUri, forumHtml))
        {
            throw new InvalidOperationException("Connexion Forumactif refusée ou session non authentifiée.");
        }

        var feedPath = $"feed/?f={cfg.ForumId}";
        var xml = await client.GetStringAsync(feedPath, cancellationToken).ConfigureAwait(false);
        var doc = XDocument.Parse(xml, LoadOptions.PreserveWhitespace);
        var all = new List<ForumUploadItem>();

        foreach (var node in doc.Descendants().Where(x => x.Name.LocalName == "item"))
        {
            var topicTitle = WebUtility.HtmlDecode(Value(node, "title")).Trim();
            var url = Value(node, "link").Trim();
            var pub = ParseDate(Value(node, "pubDate"));
            var author = Value(node, "creator").Trim();
            if (string.IsNullOrWhiteSpace(topicTitle) || string.IsNullOrWhiteSpace(url))
            {
                continue;
            }

            var parsed = ParseReleaseTitle(topicTitle);
            all.Add(new ForumUploadItem
            {
                TopicTitle = topicTitle,
                TopicUrl = url,
                TitleGuess = parsed.Title,
                Year = parsed.Year,
                ActivityAt = pub,
                Author = string.IsNullOrWhiteSpace(author) ? null : author
            });
        }

        all = all
            .OrderByDescending(x => x.ActivityAt ?? DateTimeOffset.MinValue)
            .Take(100)
            .ToList();

        _logger.LogInformation("Selection TV: {Count} authenticated forum feed items loaded.", all.Count);

        return new ForumUploadsEnvelope
        {
            GeneratedAt = DateTimeOffset.UtcNow,
            WindowHours = cfg.WindowHours,
            SourceCount = all.Count,
            Items = all
        };
    }

    private static async Task LoginAsync(HttpClient client, PrivateUploadsConfig cfg, CancellationToken cancellationToken)
    {
        var loginPage = await client.GetStringAsync("login", cancellationToken).ConfigureAwait(false);
        var form = ExtractHiddenInputs(loginPage);
        form["username"] = cfg.Username;
        form["password"] = cfg.Password;
        form["autologin"] = "on";
        form["login"] = "Connexion";
        form["redirect"] = $"/f{cfg.ForumId}-";

        using var content = new FormUrlEncodedContent(form);
        var response = await client.PostAsync("login", content, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
    }

    private static Dictionary<string, string> ExtractHiddenInputs(string html)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match input in Regex.Matches(html, @"<input\b[^>]*>", RegexOptions.IgnoreCase | RegexOptions.Singleline))
        {
            var tag = input.Value;
            var type = Attribute(tag, "type");
            var name = Attribute(tag, "name");
            if (!string.Equals(type, "hidden", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            result[name] = WebUtility.HtmlDecode(Attribute(tag, "value") ?? "");
        }

        return result;
    }

    private static string? Attribute(string tag, string name)
    {
        var m = Regex.Match(
            tag,
            $@"\b{Regex.Escape(name)}\s*=\s*(?:""(?<v>[^""]*)""|'(?<v>[^']*)'|(?<v>[^\s>]+))",
            RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return m.Success ? m.Groups["v"].Value : null;
    }

    private static bool LooksLikeLogin(Uri? uri, string html)
    {
        if (uri?.AbsolutePath.Contains("/login", StringComparison.OrdinalIgnoreCase) == true)
        {
            return true;
        }

        return Regex.IsMatch(html, @"<title>\s*Connexion\s*</title>", RegexOptions.IgnoreCase);
    }

    private static string Value(XElement node, string localName)
        => node.Elements().FirstOrDefault(x => x.Name.LocalName == localName)?.Value ?? "";

    private static DateTimeOffset? ParseDate(string value)
    {
        if (DateTimeOffset.TryParse(
            value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AllowWhiteSpaces | DateTimeStyles.AssumeUniversal,
            out var parsed))
        {
            return parsed.ToUniversalTime();
        }

        return null;
    }

    private static (string Title, int? Year) ParseReleaseTitle(string raw)
    {
        var s = WebUtility.HtmlDecode(raw);
        s = Regex.Replace(s, @"^\s*(?:\[[^\]]+\]\s*)+", "");
        s = s.Replace('_', ' ').Trim();

        var tech = new Regex(
            @"(?ix)
              \s+(?=
                2160p|1080p|720p|576p|480p|4k|uhd|
                blu[ .-]?ray|bdrip|bdremux|remux|web[ .-]?dl|webrip|hdrip|dvdrip|
                x26[45]|h[ .-]?26[45]|hevc|av1|
                multi|truefrench|french|vostfr|subfrench|
                dts(?:[ .-]?hd)?|aac|ac3|eac3|atmos|
                hdr10\+?|hdr|dolby[ .-]?vision|\bdv\b|
                proper|repack
              ).*$");
        s = tech.Replace(s, "");

        int? year = null;
        var ym = Regex.Match(s, @"\b(19\d{2}|20\d{2})\b");
        if (ym.Success)
        {
            year = int.Parse(ym.Value, CultureInfo.InvariantCulture);
            var before = s[..ym.Index].Trim(' ', '.', '-', '–', '—');
            if (before.Length >= 2)
            {
                s = before;
            }
        }

        s = Regex.Replace(s, @"[.]+", " ");
        s = Regex.Replace(s, @"\s{2,}", " ").Trim(' ', '-', '–', '—', '.');

        return (string.IsNullOrWhiteSpace(s) ? raw.Trim() : s, year);
    }

    private static ForumUploadsEnvelope FilterEnvelope(ForumUploadsEnvelope source, int hours)
    {
        var cutoff = DateTimeOffset.UtcNow.AddHours(-hours);
        var filtered = source.Items
            .Where(x => x.ActivityAt is null || x.ActivityAt >= cutoff)
            .OrderByDescending(x => x.ActivityAt ?? DateTimeOffset.MinValue)
            .ToList();

        return new ForumUploadsEnvelope
        {
            GeneratedAt = source.GeneratedAt,
            WindowHours = hours,
            SourceCount = source.SourceCount,
            Items = filtered
        };
    }
}
