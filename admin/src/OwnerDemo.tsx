import { useEffect, useState } from "react";
import { OwnerDashboard } from "./OwnerDashboard";
import { ownerDemoApi } from "./ownerDemo";
export function OwnerDemo() {
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <div className="owner-demo">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="owner-demo-header">
        <div className="brand">
          <span className="brand-mark">1</span>
          <div>
            One Concept<small>Owner dashboard · demo</small>
          </div>
        </div>
        <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
          Use {theme === "light" ? "dark" : "light"} theme
        </button>
        <a href="/">Return to sign in</a>
      </header>
      <main id="main">
        <OwnerDashboard api={ownerDemoApi} environment="Demo" demo />
      </main>
    </div>
  );
}
