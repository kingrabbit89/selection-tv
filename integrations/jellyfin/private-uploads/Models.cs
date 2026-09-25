namespace Jellyfin.Plugin.SelectionTvPrivate;

public sealed class PrivateUploadsConfig
{
    public string ForumUrl { get; set; } = "https://kebekmac.forum-canada.com/";
    public int ForumId { get; set; } = 4;
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public int WindowHours { get; set; } = 24;
}

public sealed class ForumUploadItem
{
    public string TopicTitle { get; set; } = "";
    public string TopicUrl { get; set; } = "";
    public string TitleGuess { get; set; } = "";
    public int? Year { get; set; }
    public DateTimeOffset? ActivityAt { get; set; }
    public string? Author { get; set; }
}

public sealed class ForumUploadsEnvelope
{
    public DateTimeOffset GeneratedAt { get; set; }
    public int WindowHours { get; set; }
    public int SourceCount { get; set; }
    public IReadOnlyList<ForumUploadItem> Items { get; set; } = Array.Empty<ForumUploadItem>();
}


public sealed class MetadataEnrichmentRequest
{
    public string Title { get; set; } = "";
    public int? Year { get; set; }
    public string? ImdbId { get; set; }
}

public sealed class MetadataEnrichmentResult
{
    public string? ImdbUrl { get; set; }
    public string? ImdbRating { get; set; }
    public string? SensCritiqueUrl { get; set; }
    public string? SensCritiqueRating { get; set; }
    public string? ImageUrl { get; set; }
}
