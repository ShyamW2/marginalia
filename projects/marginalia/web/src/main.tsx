import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App.js";
import "./theme.css";
import "./controls/registers.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("root element not found");
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
