export function readConfig(env: Record<string, string | undefined>) {
  function url(name: string) {
    const value = env[name] || "";
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "https:" &&
        !(
          parsed.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(parsed.hostname)
        )) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (name === "VITE_API_URL"
        ? !["/", "/functions/v1/api"].includes(parsed.pathname)
        : parsed.pathname !== "/")
    )
      throw new Error("Use an HTTPS origin or the exact Supabase API function URL for " + name);
    return name === "VITE_API_URL" && parsed.pathname !== "/"
      ? parsed.origin + parsed.pathname : parsed.origin;
  }
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  if (!key.startsWith("sb_publishable_")) {
    try {
      if (JSON.parse(atob(key.split(".")[1])).role !== "anon")
        throw new Error();
    } catch {
      throw new Error("Use a Supabase public publishable or anon key.");
    }
  }
  const apiUrl = url("VITE_API_URL");
  const supabaseUrl = url("VITE_SUPABASE_URL");
  if (new URL(apiUrl).hostname.endsWith(".supabase.co") &&
      (new URL(apiUrl).pathname !== "/functions/v1/api" ||
        new URL(apiUrl).origin !== supabaseUrl)) {
    throw new Error("Supabase API and Auth must use the same project");
  }
  return {
    apiUrl,
    supabaseUrl,
    key,
    environment: env.VITE_ENVIRONMENT || "Unspecified environment",
  };
}
