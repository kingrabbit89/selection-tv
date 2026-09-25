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

    public SelectionTvController(ForumUploadsService service)
    {
        _service = service;
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
}
