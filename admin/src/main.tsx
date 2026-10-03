import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import { OwnerDemo } from "./OwnerDemo";
import { App } from "./App";
import { Api } from "./api";
import { readConfig } from "./config";
import "./style.css";
const root = createRoot(document.getElementById("root")!);
// Consume credentials before rendering anything or loading third-party content.
const fragment = new URLSearchParams(location.hash.slice(1));
const code = new URLSearchParams(location.search).get("code");
const ownerDemo = new URLSearchParams(location.search).get("demo") === "owner";
const callback = location.pathname === "/auth/callback";
if (location.hash || code)
  history.replaceState(null, "", callback ? "/auth/callback" : "/");
async function start() {
  // The demo is selected before constructing Auth or any production API client.
  if (ownerDemo) {
    root.render(<OwnerDemo />);
    return;
  }
  try {
    const config = readConfig(import.meta.env);
    const auth = createClient(config.supabaseUrl, config.key, {
      auth: {
        detectSessionInUrl: false,
        flowType: "pkce",
        storageKey: "one-concept-review-auth",
      },
    });
    let initialError = "";
    if (fragment.has("access_token") && fragment.has("refresh_token")) {
      const { error } = await auth.auth.setSession({
        access_token: fragment.get("access_token")!,
        refresh_token: fragment.get("refresh_token")!,
      });
      if (error)
        initialError =
          "This invitation or recovery link is no longer valid. Request a new one.";
    } else if (code && callback) {
      const { error } = await auth.auth.exchangeCodeForSession(code);
      if (error)
        initialError =
          "This recovery link could not be verified. Open it in the browser that requested it, or request a new one.";
    } else if (fragment.has("error"))
      initialError = "This sign-in link has expired or could not be verified.";
    root.render(
      <App
        auth={auth}
        api={new Api(config.apiUrl)}
        environment={config.environment}
        passwordSetup={callback && !initialError}
        initialError={initialError}
      />,
    );
  } catch {
    root.render(
      <main className="card narrow">
        <h1>Workspace configuration needed</h1>
        <p>
          The site owner needs to configure the public API origin and Supabase
          public credentials. No privileged keys belong in this website.
        </p>
      </main>,
    );
  }
}
void start();
