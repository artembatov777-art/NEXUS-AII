import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
const App = lazy(() => import("./App"));
const MobileDemo = lazy(() => import("./components/MobileDemo").then(module => ({ default: module.MobileDemo })));
import "./styles.css";
import "./cinematic.css";
import "./redesign.css";
import "./premium.css";

const isMobileDemo = new URLSearchParams(window.location.search).get("demo") === "1";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<div role="status" style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#070b12", color: "#79c7e8", fontFamily: "sans-serif", fontSize: "10px", letterSpacing: ".2em" }}>INITIALIZING NEXUS AU</div>}>
      {isMobileDemo ? <MobileDemo /> : <App />}
    </Suspense>
  </React.StrictMode>
);
