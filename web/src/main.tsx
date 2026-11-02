import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { Router } from "./router.tsx";
import { SessionProvider } from "./session.tsx";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Router>
      <SessionProvider>
        <App />
      </SessionProvider>
    </Router>
  </StrictMode>,
);
