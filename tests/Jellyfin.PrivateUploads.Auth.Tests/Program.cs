using System.Net;
using System.Reflection;
using Jellyfin.Plugin.SelectionTvPrivate;

internal static class Program
{
    private const string ClassicForm = """
        <form method='POST' action='/login'>
          <input name='username' type='text'>
          <input type='password' name='password'>
          <input type='hidden' name='csrf_token' value='safe&amp;token'>
          <input type='hidden' name='redirect' value=''>
          <input type='hidden' name='query' value=''>
        </form>
        """;
    private const string MagicForm = """
        <form method='post' action='/login'>
          <input type='email' name='email'>
          <input type='hidden' name='magic_request' value='1'>
        </form>
        """;

    public static async Task<int> Main()
    {
        var tests = new (string Name, Func<Task> Run)[]
        {
            ("classic login retains its hidden fields", () => CheckPasswordPost(ClassicForm)),
            ("magic-link form after password form cannot alter the POST", () => CheckPasswordPost(ClassicForm + MagicForm)),
            ("magic-link form before password form cannot alter the POST", () => CheckPasswordPost(MagicForm + ClassicForm)),
            ("real public two-form fixture uses only the password form", CheckPublicFixture),
            ("missing password form fails before posting credentials", () => CheckMissingForm(MagicForm)),
            ("a non-POST password form fails before posting credentials", () => CheckMissingForm(ClassicForm.Replace("method='POST'", "method='GET'"))),
            ("HTTP rejection is propagated", CheckHttpRejection),
            ("credentials remain on the configured login origin", () => CheckPasswordPost(ClassicForm.Replace("action='/login'", "action='https://untrusted.example/login'")))
        };

        foreach (var (name, run) in tests)
        {
            try
            {
                await run();
                Console.WriteLine($"PASS {name}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"FAIL {name}: {ex.Message}");
                return 1;
            }
        }

        Console.WriteLine($"{tests.Length} real LoginAsync transport tests passed.");
        return 0;
    }

    private static async Task CheckPasswordPost(string html, bool expectsCsrf = true)
    {
        using var handler = new LoginHandler(html);
        using var client = Client(handler);
        await Login(client);
        Assert(handler.GetCount == 1 && handler.PostCount == 1, "Expected one login GET and one login POST.");
        Assert(handler.PostUri == new Uri("https://forum.example.test/login"), "The login POST must remain on the configured origin.");
        var fields = handler.PostFields;
        Assert(!fields.ContainsKey("magic_request") && !fields.ContainsKey("email"), "The password POST included another form's fields.");
        Assert(fields.GetValueOrDefault("username") == "fixture-user", "Configured username was not sent.");
        Assert(fields.GetValueOrDefault("password") == "fixture-password", "Configured password was not sent.");
        Assert(fields.GetValueOrDefault("autologin") == "on" && fields.GetValueOrDefault("login") == "Connexion", "Classic login controls were lost.");
        Assert(fields.GetValueOrDefault("redirect") == "/f4-" && fields.ContainsKey("query"), "Classic redirect or hidden query was lost.");
        if (expectsCsrf)
        {
            Assert(fields.GetValueOrDefault("csrf_token") == "safe&token", "The password form's hidden token was not preserved and decoded.");
        }
    }

    private static async Task CheckPublicFixture()
    {
        var html = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Fixtures", "public-login-two-forms.html"));
        await CheckPasswordPost(html, expectsCsrf: false);
    }

    private static async Task CheckMissingForm(string html)
    {
        using var handler = new LoginHandler(html);
        using var client = Client(handler);
        try
        {
            await Login(client);
            throw new Exception("A missing password form did not fail.");
        }
        catch (InvalidOperationException ex)
        {
            Assert(ex.Message.Contains("Formulaire de connexion", StringComparison.Ordinal), "The missing-form error was not actionable.");
        }
        Assert(handler.GetCount == 1 && handler.PostCount == 0, "Credentials were posted without a password login form.");
    }

    private static async Task CheckHttpRejection()
    {
        using var handler = new LoginHandler(ClassicForm, HttpStatusCode.Forbidden);
        using var client = Client(handler);
        try
        {
            await Login(client);
            throw new Exception("HTTP login rejection was ignored.");
        }
        catch (HttpRequestException ex)
        {
            Assert(ex.StatusCode == HttpStatusCode.Forbidden, "Expected the upstream HTTP rejection.");
        }
        Assert(handler.PostCount == 1, "Unexpected repeated login POST.");
    }

    private static HttpClient Client(HttpMessageHandler handler) => new(handler)
    {
        BaseAddress = new Uri("https://forum.example.test/")
    };

    // Exercise the production method, including the outgoing HTTP request, without
    // exposing a new public API or making any real forum authentication attempt.
    private static Task Login(HttpClient client)
    {
        var method = typeof(ForumUploadsService).GetMethod("LoginAsync", BindingFlags.NonPublic | BindingFlags.Static)
            ?? throw new Exception("Production LoginAsync was not found.");
        return (Task)(method.Invoke(null, new object[]
        {
            client,
            new PrivateUploadsConfig { Username = "fixture-user", Password = "fixture-password", ForumId = 4 },
            CancellationToken.None
        }) ?? throw new Exception("Production LoginAsync did not return a Task."));
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    private sealed class LoginHandler(string html, HttpStatusCode postStatus = HttpStatusCode.OK) : HttpMessageHandler
    {
        public int GetCount { get; private set; }
        public int PostCount { get; private set; }
        public Uri? PostUri { get; private set; }
        public Dictionary<string, string> PostFields { get; private set; } = new(StringComparer.OrdinalIgnoreCase);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Method == HttpMethod.Get && request.RequestUri?.AbsolutePath == "/login")
            {
                GetCount++;
                return new HttpResponseMessage(HttpStatusCode.OK) { RequestMessage = request, Content = new StringContent(html) };
            }
            if (request.Method == HttpMethod.Post && request.RequestUri?.AbsolutePath == "/login")
            {
                PostCount++;
                PostUri = request.RequestUri;
                var body = await (request.Content ?? throw new Exception("No login POST body.")).ReadAsStringAsync(cancellationToken);
                PostFields = body.Split('&', StringSplitOptions.RemoveEmptyEntries)
                    .Select(field => field.Split('=', 2))
                    .ToDictionary(field => WebUtility.UrlDecode(field[0]), field => WebUtility.UrlDecode(field.Length == 2 ? field[1] : ""), StringComparer.OrdinalIgnoreCase);
                return new HttpResponseMessage(postStatus) { RequestMessage = request, Content = new StringContent("<title>Index</title>") };
            }
            throw new Exception("Unexpected HTTP request in login test.");
        }
    }
}
