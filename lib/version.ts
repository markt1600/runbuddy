// Bumped manually when it matters that a device is seen running THIS web
// build — the shell loads the site remotely, so "which code is my phone
// actually executing" is a real question. The account screen shows it, the
// /api/version route serves it, and the shell compares the two on foreground
// to reload itself when a newer deploy has landed.
export const WEB_BUILD = "2026-09-01b";
