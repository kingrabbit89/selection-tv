using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.SelectionTvPrivate;

[ApiController]
[Authorize]
[Route("SelectionTv")]
public sealed class SelectionTvController : ControllerBase
{
    private readonly ForumUploadsService _service;
    private readonly PublicMetadataService _metadata;

    public SelectionTvController(ForumUploadsService service, PublicMetadataService metadata)
    {
        _service = service;
        _metadata = metadata;
    }

    [HttpGet("Uploads")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<ForumUploadsEnvelope>> GetUploads(
        [FromQuery] int hours = 24,
        CancellationToken cancellationToken = default)
    {
        try
        {
            return Ok(await _service.GetUploadsAsync(hours, cancellationToken).ConfigureAwait(false));
        }
        catch (Exception ex)
        {
            return Problem(
                title: "Selection TV private uploads unavailable",
                detail: ex.Message,
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
    [HttpPost("Enrich")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<MetadataEnrichmentResult>> Enrich(
        [FromBody] MetadataEnrichmentRequest request,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Title) && string.IsNullOrWhiteSpace(request.ImdbId))
        {
            return BadRequest();
        }

        return Ok(await _metadata.EnrichAsync(request, cancellationToken).ConfigureAwait(false));
    }

}
