using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.SelectionTvPrivate;

public sealed class SelectionTvPrivatePlugin : BasePlugin<BasePluginConfiguration>
{
    public SelectionTvPrivatePlugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
    }

    public override Guid Id => Guid.Parse("4e01c504-8c83-4c8f-a6cf-09c4727779fa");

    public override string Name => "Selection TV Private Uploads";

    public override string Description => "Private authenticated forum feed for the Selection TV Jellyfin integration.";
}
