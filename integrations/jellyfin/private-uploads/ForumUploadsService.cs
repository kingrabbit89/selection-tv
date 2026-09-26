using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text;
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
        var fresh = _cache is not null && DateTimeOffset.UtcNow - _cacheAt < TimeSpan.FromMinutes(8);

        if (fresh && _cache!.WindowHours >= hours)
        {
            return FilterEnvelope(_cache, hours);
        }

        await _refreshLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            fresh = _cache is not null && DateTimeOffset.UtcNow - _cacheAt < TimeSpan.FromMinutes(8);
            if (!fresh || _cache!.WindowHours < hours)
            {
                _cache = await RefreshAsync(cfg, hours, cancellationToken).ConfigureAwait(false);
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

    private async Task<ForumUploadsEnvelope> RefreshAsync(
        PrivateUploadsConfig cfg,
        int crawlHours,
        CancellationToken cancellationToken)
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
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("SelectionTV-Jellyfin", "0.3"));
        client.DefaultRequestHeaders.AcceptLanguage.ParseAdd("fr-FR,fr;q=0.9,en;q=0.5");

        await LoginAsync(client, cfg, cancellationToken).ConfigureAwait(false);

        var all = new List<ForumUploadItem>();
        var cutoff = DateTimeOffset.Now.AddHours(-crawlHours);
        var current = new Uri(baseUri, $"f{cfg.ForumId}-");
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (var page = 0; page < 10; page++)
        {
            if (!visited.Add(current.PathAndQuery))
            {
                break;
            }

            var forumResponse = await client.GetAsync(current, cancellationToken).ConfigureAwait(false);
            var html = await forumResponse.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

            if (LooksLikeLogin(forumResponse.RequestMessage?.RequestUri, html))
            {
                throw new InvalidOperationException("Connexion Forumactif refusée ou session non authentifiée.");
            }

            var parsedPage = ParseForumHtml(baseUri, html)
                .GroupBy(x => TopicIdOf(x.TopicUrl) ?? x.TopicUrl, StringComparer.OrdinalIgnoreCase)
                .Select(g => g.OrderByDescending(x => x.ActivityAt ?? DateTimeOffset.MinValue).First())
                .ToList();

            if (parsedPage.Count == 0)
            {
                break;
            }

            all.AddRange(parsedPage);

            var dated = parsedPage.Where(x => x.ActivityAt.HasValue).ToList();
            if (dated.Count > 0 && dated.Max(x => x.ActivityAt!.Value) < cutoff)
            {
                break;
            }

            var next = FindNextForumPage(baseUri, html, cfg.ForumId, current);
            if (next is null)
            {
                break;
            }

            current = next;
        }

        // Last-resort compatibility fallback. Some Forumactif boards expose a
        // usable authenticated RSS feed even when the HTML template changes.
        if (all.Count == 0 || all.All(x => !x.ActivityAt.HasValue))
        {
            // If the HTML template was parsed but no activity timestamp could
            // be recovered, those rows cannot safely be treated as recent.
            // Prefer the authenticated RSS fallback, which carries pubDate.
            all.Clear();
            try
            {
                var xml = await client.GetStringAsync($"feed/?f={cfg.ForumId}", cancellationToken).ConfigureAwait(false);
                var doc = XDocument.Parse(xml, LoadOptions.PreserveWhitespace);

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
                        DirectorGuess = parsed.Director,
                        ActivityAt = pub,
                        Author = string.IsNullOrWhiteSpace(author) ? null : author
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Selection TV: authenticated Forumactif RSS unavailable.");
            }
        }

        all = all
            .GroupBy(x => TopicIdOf(x.TopicUrl) ?? x.TopicUrl, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.OrderByDescending(x => x.ActivityAt ?? DateTimeOffset.MinValue).First())
            .Take(500)
            .ToList();

        // A Forumactif theme may expose the topic title correctly while the
        // "last post" timestamp sits outside the DOM fragment we parsed.
        // Verify only those ambiguous rows against the topic itself. This is
        // deliberately capped so a template regression cannot hammer the forum.
        await ResolveAmbiguousActivitiesAsync(client, baseUri, all, cancellationToken).ConfigureAwait(false);

        all = all
            .OrderByDescending(x => x.ActivityAt ?? DateTimeOffset.MinValue)
            .ToList();

        _logger.LogInformation(
            "Selection TV: parsed {Count} authenticated forum topics across {PageCount} page(s).",
            all.Count,
            visited.Count);

        return new ForumUploadsEnvelope
        {
            GeneratedAt = DateTimeOffset.UtcNow,
            WindowHours = crawlHours,
            SourceCount = all.Count,
            Items = all
        };
    }

    private static Uri? FindNextForumPage(Uri baseUri, string html, int forumId, Uri current)
    {
        var currentStart = ForumPageStart(current);
        var candidates = new List<(int Start, Uri Uri)>();

        foreach (Match m in Regex.Matches(
            html,
            @"<a\b[^>]*\bhref\s*=\s*(?:""(?<href>[^""]+)""|'(?<href>[^']+)')[^>]*>",
            RegexOptions.IgnoreCase | RegexOptions.Singleline))
        {
            var href = WebUtility.HtmlDecode(m.Groups["href"].Value).Trim();
            if (string.IsNullOrWhiteSpace(href))
            {
                continue;
            }

            Uri uri;
            try
            {
                uri = new Uri(baseUri, href);
            }
            catch
            {
                continue;
            }

            var path = uri.PathAndQuery;
            var fm = Regex.Match(path, $@"(?:^|/)f{forumId}p(?<start>\d+)-", RegexOptions.IgnoreCase);
            var qm = Regex.Match(path, @"[?&]start=(?<start>\d+)", RegexOptions.IgnoreCase);
            var sm = fm.Success ? fm : qm;
            if (!sm.Success)
            {
                continue;
            }

            var start = int.Parse(sm.Groups["start"].Value, CultureInfo.InvariantCulture);
            if (start > currentStart)
            {
                candidates.Add((start, uri));
            }
        }

        return candidates
            .OrderBy(x => x.Start)
            .Select(x => x.Uri)
            .FirstOrDefault();
    }

    private static int ForumPageStart(Uri uri)
    {
        var fm = Regex.Match(uri.PathAndQuery, @"/f\d+p(?<start>\d+)-", RegexOptions.IgnoreCase);
        if (fm.Success)
        {
            return int.Parse(fm.Groups["start"].Value, CultureInfo.InvariantCulture);
        }

        var qm = Regex.Match(uri.Query, @"(?:^|[?&])start=(?<start>\d+)", RegexOptions.IgnoreCase);
        return qm.Success
            ? int.Parse(qm.Groups["start"].Value, CultureInfo.InvariantCulture)
            : 0;
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

    private static List<ForumUploadItem> ParseForumHtml(Uri baseUri, string html)
    {
        var items = new List<ForumUploadItem>();
        var anchorRx = new Regex(
            @"<a\b(?=[^>]*\bclass\s*=\s*(?:""[^""]*\btopictitle\b[^""]*""|'[^']*\btopictitle\b[^']*'))[^>]*\bhref\s*=\s*(?:""(?<href>[^""]+)""|'(?<href>[^']+)')[^>]*>(?<title>.*?)</a>",
            RegexOptions.IgnoreCase | RegexOptions.Singleline);

        foreach (Match m in anchorRx.Matches(html))
        {
            var href = WebUtility.HtmlDecode(m.Groups["href"].Value).Trim();
            if (!Regex.IsMatch(href, @"(?:^|/)t\d+(?:p\d+)?-", RegexOptions.IgnoreCase))
            {
                continue;
            }

            var title = CleanHtmlText(m.Groups["title"].Value);
            if (string.IsNullOrWhiteSpace(title))
            {
                continue;
            }

            var container = FindTopicContainer(html, m.Index);
            var activity = ParseForumActivity(container);
            var author = ParseLastPostAuthor(container);
            var url = new Uri(baseUri, href).ToString();
            var parsed = ParseReleaseTitle(title);

            items.Add(new ForumUploadItem
            {
                TopicTitle = title,
                TopicUrl = url,
                TitleGuess = parsed.Title,
                Year = parsed.Year,
                DirectorGuess = parsed.Director,
                ActivityAt = activity,
                Author = author
            });
        }

        // Some customized Forumactif templates drop the topictitle class.
        // Fallback: accept h2.topic-title anchors that point to a /t123- topic.
        if (items.Count == 0)
        {
            var h2Rx = new Regex(
                @"<h2\b[^>]*\bclass\s*=\s*(?:""[^""]*\btopic-title\b[^""]*""|'[^']*\btopic-title\b[^']*')[^>]*>(?<body>.*?)</h2>",
                RegexOptions.IgnoreCase | RegexOptions.Singleline);

            foreach (Match h2 in h2Rx.Matches(html))
            {
                var am = Regex.Match(
                    h2.Groups["body"].Value,
                    @"<a\b[^>]*\bhref\s*=\s*(?:""(?<href>[^""]+)""|'(?<href>[^']+)')[^>]*>(?<title>.*?)</a>",
                    RegexOptions.IgnoreCase | RegexOptions.Singleline);
                if (!am.Success)
                {
                    continue;
                }

                var href = WebUtility.HtmlDecode(am.Groups["href"].Value).Trim();
                if (!Regex.IsMatch(href, @"(?:^|/)t\d+(?:p\d+)?-", RegexOptions.IgnoreCase))
                {
                    continue;
                }

                var title = CleanHtmlText(am.Groups["title"].Value);
                var container = FindTopicContainer(html, h2.Index);
                var parsed = ParseReleaseTitle(title);
                items.Add(new ForumUploadItem
                {
                    TopicTitle = title,
                    TopicUrl = new Uri(baseUri, href).ToString(),
                    TitleGuess = parsed.Title,
                    Year = parsed.Year,
                    ActivityAt = ParseForumActivity(container),
                    Author = ParseLastPostAuthor(container)
                });
            }
        }

        return items;
    }

    private static string FindTopicContainer(string html, int index)
    {
        foreach (var tag in new[] { "tr", "li" })
        {
            var start = html.LastIndexOf("<" + tag, index, StringComparison.OrdinalIgnoreCase);
            if (start < 0)
            {
                continue;
            }

            var end = html.IndexOf("</" + tag + ">", index, StringComparison.OrdinalIgnoreCase);
            if (end > start && end - start < 30000)
            {
                return html.Substring(start, end + tag.Length + 3 - start);
            }
        }

        var left = Math.Max(0, index - 3000);
        var len = Math.Min(html.Length - left, 9000);
        return html.Substring(left, len);
    }

    private static string CleanHtmlText(string html)
    {
        var s = Regex.Replace(html, @"<br\s*/?>", " ", RegexOptions.IgnoreCase);
        s = Regex.Replace(s, @"<[^>]+>", " ");
        s = WebUtility.HtmlDecode(s);
        return Regex.Replace(s, @"\s+", " ").Trim();
    }

    private static DateTimeOffset? ParseForumActivity(string container)
        => ParseForumActivities(container).OrderByDescending(x => x).FirstOrDefault();

    private static IReadOnlyList<DateTimeOffset> ParseForumActivities(string htmlOrText)
    {
        var text = CleanHtmlText(htmlOrText);
        var now = DateTimeOffset.Now;
        var found = new List<DateTimeOffset>();

        foreach (Match m in Regex.Matches(
            text,
            @"Aujourd['’]hui\s+(?:à|-)\s*(?<h>\d{1,2}):(?<m>\d{2})",
            RegexOptions.IgnoreCase))
        {
            found.Add(new DateTimeOffset(
                now.Year, now.Month, now.Day,
                int.Parse(m.Groups["h"].Value, CultureInfo.InvariantCulture),
                int.Parse(m.Groups["m"].Value, CultureInfo.InvariantCulture),
                0,
                now.Offset));
        }

        foreach (Match m in Regex.Matches(
            text,
            @"Hier\s+(?:à|-)\s*(?<h>\d{1,2}):(?<m>\d{2})",
            RegexOptions.IgnoreCase))
        {
            var d = now.Date.AddDays(-1);
            found.Add(new DateTimeOffset(
                d.Year, d.Month, d.Day,
                int.Parse(m.Groups["h"].Value, CultureInfo.InvariantCulture),
                int.Parse(m.Groups["m"].Value, CultureInfo.InvariantCulture),
                0,
                now.Offset));
        }

        // Forumactif topic pages commonly render post dates as
        // "Sam 19 Sep - 11:49", i.e. without a year. Infer the current year
        // and roll back one year only when that would otherwise be in future.
        foreach (Match m in Regex.Matches(
            text,
            @"(?:(?:lun|mar|mer|jeu|ven|sam|dim)[a-zéû]*\.?\s+)?(?<d>\d{1,2})\s+(?<mon>jan(?:v)?|fév(?:r)?|fev(?:r)?|mar(?:s)?|avr|mai|juin|juil(?:l)?|ao[uû]t|sept?|oct|nov|déc|dec)\.?\s*(?:(?<y>\d{4})\s*)?(?:-|à)\s*(?<h>\d{1,2}):(?<m>\d{2})",
            RegexOptions.IgnoreCase))
        {
            var month = ForumMonth(m.Groups["mon"].Value);
            if (month <= 0)
            {
                continue;
            }

            var year = m.Groups["y"].Success
                ? int.Parse(m.Groups["y"].Value, CultureInfo.InvariantCulture)
                : now.Year;

            DateTimeOffset candidate;
            try
            {
                candidate = new DateTimeOffset(
                    year,
                    month,
                    int.Parse(m.Groups["d"].Value, CultureInfo.InvariantCulture),
                    int.Parse(m.Groups["h"].Value, CultureInfo.InvariantCulture),
                    int.Parse(m.Groups["m"].Value, CultureInfo.InvariantCulture),
                    0,
                    now.Offset);
            }
            catch (ArgumentOutOfRangeException)
            {
                continue;
            }

            if (!m.Groups["y"].Success && candidate > now.AddDays(2))
            {
                candidate = candidate.AddYears(-1);
            }

            found.Add(candidate);
        }

        return found;
    }

    private async Task ResolveAmbiguousActivitiesAsync(
        HttpClient client,
        Uri baseUri,
        List<ForumUploadItem> items,
        CancellationToken cancellationToken)
    {
        const int maxDirectChecks = 32;
        var ambiguous = items
            .Where(x => !x.ActivityAt.HasValue && !string.IsNullOrWhiteSpace(x.TopicUrl))
            .Take(maxDirectChecks)
            .ToList();

        if (ambiguous.Count == 0)
        {
            return;
        }

        var gate = new SemaphoreSlim(4, 4);
        var resolved = 0;

        await Task.WhenAll(ambiguous.Select(async item =>
        {
            await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                var activity = await FetchLatestTopicActivityAsync(
                    client,
                    baseUri,
                    item.TopicUrl,
                    cancellationToken).ConfigureAwait(false);

                if (activity.HasValue)
                {
                    item.ActivityAt = activity.Value;
                    Interlocked.Increment(ref resolved);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogDebug(ex, "Selection TV: unable to verify activity for {TopicUrl}.", item.TopicUrl);
            }
            finally
            {
                gate.Release();
            }
        })).ConfigureAwait(false);

        _logger.LogInformation(
            "Selection TV: directly verified {Resolved}/{Checked} ambiguous forum topic date(s).",
            resolved,
            ambiguous.Count);
    }

    private async Task<DateTimeOffset?> FetchLatestTopicActivityAsync(
        HttpClient client,
        Uri baseUri,
        string topicUrl,
        CancellationToken cancellationToken)
    {
        var topicUri = new Uri(topicUrl, UriKind.Absolute);
        var response = await client.GetAsync(topicUri, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var html = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (LooksLikeLogin(response.RequestMessage?.RequestUri, html))
        {
            return null;
        }

        var topicId = TopicIdOf(topicUri.ToString());
        var lastPage = topicId is null ? null : FindLastTopicPage(baseUri, html, topicId, topicUri);

        if (lastPage is not null &&
            !string.Equals(lastPage.PathAndQuery, topicUri.PathAndQuery, StringComparison.OrdinalIgnoreCase))
        {
            var lastResponse = await client.GetAsync(lastPage, cancellationToken).ConfigureAwait(false);
            lastResponse.EnsureSuccessStatusCode();
            var lastHtml = await lastResponse.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            if (!LooksLikeLogin(lastResponse.RequestMessage?.RequestUri, lastHtml))
            {
                html = lastHtml;
            }
        }

        return ParseForumActivities(html)
            .OrderByDescending(x => x)
            .FirstOrDefault();
    }

    private static Uri? FindLastTopicPage(Uri baseUri, string html, string topicId, Uri current)
    {
        var candidates = new List<(int Start, Uri Uri)>
        {
            (TopicPageStart(current, topicId), current)
        };

        foreach (Match m in Regex.Matches(
            html,
            @"<a\b[^>]*\bhref\s*=\s*(?:""(?<href>[^""]+)""|'(?<href>[^']+)')[^>]*>",
            RegexOptions.IgnoreCase | RegexOptions.Singleline))
        {
            var href = WebUtility.HtmlDecode(m.Groups["href"].Value).Trim();
            if (string.IsNullOrWhiteSpace(href))
            {
                continue;
            }

            Uri uri;
            try
            {
                uri = new Uri(baseUri, href);
            }
            catch
            {
                continue;
            }

            var rx = Regex.Match(
                uri.PathAndQuery,
                $@"/t{Regex.Escape(topicId)}p(?<start>\d+)-",
                RegexOptions.IgnoreCase);
            if (!rx.Success)
            {
                continue;
            }

            candidates.Add((
                int.Parse(rx.Groups["start"].Value, CultureInfo.InvariantCulture),
                uri));
        }

        return candidates
            .OrderByDescending(x => x.Start)
            .Select(x => x.Uri)
            .FirstOrDefault();
    }

    private static int TopicPageStart(Uri uri, string topicId)
    {
        var m = Regex.Match(
            uri.PathAndQuery,
            $@"/t{Regex.Escape(topicId)}p(?<start>\d+)-",
            RegexOptions.IgnoreCase);
        return m.Success
            ? int.Parse(m.Groups["start"].Value, CultureInfo.InvariantCulture)
            : 0;
    }

    private static int ForumMonth(string value)
    {
        var s = value.ToLowerInvariant()
            .Normalize(NormalizationForm.FormD);
        s = new string(s.Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).ToArray())
            .Replace(".", "", StringComparison.Ordinal);

        if (s.StartsWith("jan", StringComparison.Ordinal)) return 1;
        if (s.StartsWith("fev", StringComparison.Ordinal)) return 2;
        if (s.StartsWith("mar", StringComparison.Ordinal)) return 3;
        if (s.StartsWith("avr", StringComparison.Ordinal)) return 4;
        if (s.StartsWith("mai", StringComparison.Ordinal)) return 5;
        if (s.StartsWith("juin", StringComparison.Ordinal)) return 6;
        if (s.StartsWith("juil", StringComparison.Ordinal)) return 7;
        if (s.StartsWith("aou", StringComparison.Ordinal)) return 8;
        if (s.StartsWith("sep", StringComparison.Ordinal)) return 9;
        if (s.StartsWith("oct", StringComparison.Ordinal)) return 10;
        if (s.StartsWith("nov", StringComparison.Ordinal)) return 11;
        if (s.StartsWith("dec", StringComparison.Ordinal)) return 12;
        return 0;
    }

    private static string? ParseLastPostAuthor(string container)
    {
        var lastPost = Regex.Match(
            container,
            @"(?:lastpost|postdetails)[^>]*>(?<body>.*?)</(?:span|div|dd|td)>",
            RegexOptions.IgnoreCase | RegexOptions.Singleline);
        var scope = lastPost.Success ? lastPost.Groups["body"].Value : container;

        var users = Regex.Matches(
            scope,
            @"<a\b[^>]*href\s*=\s*(?:""[^""]*/u\d+[^""]*""|'[^']*/u\d+[^']*')[^>]*>(?<name>.*?)</a>",
            RegexOptions.IgnoreCase | RegexOptions.Singleline);
        if (users.Count == 0)
        {
            return null;
        }

        var name = CleanHtmlText(users[^1].Groups["name"].Value);
        return string.IsNullOrWhiteSpace(name) ? null : name;
    }

    private static string? TopicIdOf(string url)
    {
        var m = Regex.Match(url, @"/t(?<id>\d+)", RegexOptions.IgnoreCase);
        return m.Success ? m.Groups["id"].Value : null;
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

    private static (string Title, int? Year, string? Director) ParseReleaseTitle(string raw)
    {
        var s = WebUtility.HtmlDecode(raw);
        s = Regex.Replace(s, @"^\s*(?:\[[^\]]+\]\s*)+", "");
        s = s.Replace('_', ' ').Trim();

        // Remove the release/codec tail while keeping editorial information
        // such as "title - year - director" intact.
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
        string? director = null;
        var title = s;

        var ym = Regex.Match(s, @"\b(19\d{2}|20\d{2})\b");
        if (ym.Success)
        {
            year = int.Parse(ym.Value, CultureInfo.InvariantCulture);

            var before = s[..ym.Index].Trim(' ', '.', '-', '–', '—');
            if (before.Length >= 2)
            {
                title = before;
            }

            var after = s[(ym.Index + ym.Length)..].Trim(' ', '.', '-', '–', '—', ':', ';');
            if (!string.IsNullOrWhiteSpace(after))
            {
                // Topic conventions frequently put the director immediately
                // after the year, followed by language/edition notes.
                after = Regex.Replace(
                    after,
                    @"\s*\((?:vostfr|vo(?:\s+ou\s+vf)?|vf|multi|truefrench|french|subfrench|téléfilm|telefilm)[^)]*\)\s*$",
                    "",
                    RegexOptions.IgnoreCase);
                after = Regex.Replace(
                    after,
                    @"\s+(?:vostfr|vo(?:\s+ou\s+vf)?|vf|multi|truefrench|french|subfrench)\b.*$",
                    "",
                    RegexOptions.IgnoreCase);
                after = after.Trim(' ', '.', '-', '–', '—', ':', ';');

                // Do not promote obvious release vocabulary to a director.
                if (after.Length >= 3
                    && after.Length <= 90
                    && !Regex.IsMatch(
                        after,
                        @"\b(?:1080p|720p|2160p|4k|bluray|blu-ray|web[- .]?dl|remux|x26[45]|hevc|hdr|vostfr|french|multi)\b",
                        RegexOptions.IgnoreCase))
                {
                    director = after;
                }
            }
        }

        title = Regex.Replace(title, @"[.]+", " ");
        title = Regex.Replace(title, @"\s{2,}", " ").Trim(' ', '-', '–', '—', '.');

        return (string.IsNullOrWhiteSpace(title) ? raw.Trim() : title, year, director);
    }

    private static ForumUploadsEnvelope FilterEnvelope(ForumUploadsEnvelope source, int hours)
    {
        var cutoff = DateTimeOffset.UtcNow.AddHours(-hours);
        var filtered = source.Items
            .Where(x => x.ActivityAt.HasValue && x.ActivityAt.Value >= cutoff)
            .OrderByDescending(x => x.ActivityAt!.Value)
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
