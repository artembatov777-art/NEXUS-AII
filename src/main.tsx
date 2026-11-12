import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MobileDemo } from "./components/MobileDemo";
import "./styles.css";
import "./cinematic.css";
import "./redesign.css";

const isMobileDemo = new URLSearchParams(window.location.search).get("demo") === "1";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isMobileDemo ? <MobileDemo /> : <App />}</React.StrictMode>
);
