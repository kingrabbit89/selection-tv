# Frozen installed Jellyfin wrapper regression fixture

`jellyfin-selection-tv-pre-s42.html` is an exact byte copy of
`integrations/jellyfin/selection-tv.html` at published commit
`77c7f8387704bd7caa3b7c085a2cd305af722bd7`, before the S42 shared-reader repairs.
Its bytes also match the version introduced at
`a650fe4f91978f8632be979bccc8868b950a35eb`.

SHA-256: `fd7efb94261aed4c5c5f981a5640143cd18f0cd8c41bf37bd1e417485f7b245b`.

The browser gate checks this hash before running. Keep this fixture frozen:
changing the currently maintained wrapper must not silently change the old
installed-parent compatibility test. It is served only by the local browser
test harness, with simulated Jellyfin APIs and no credentials or private data.

Required cases pair this historical parent with the current weekly reader:

- current S42 renders a normal successful feed without updating the parent;
- iframe becomes visible after every historical startup attempt has elapsed;
- Jellyfin API becomes available after every historical startup attempt;
- a genuine uploads request remains pending beyond the old eight-second
  timeout (the fixture controls when it is released), without
  falsely reporting a broken transport or starting a second request.
