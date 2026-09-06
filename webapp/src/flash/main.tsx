import React from "react";
import ReactDOM from "react-dom/client";
import { FlashPage } from "./FlashPage";
import "./flash.css";

const root = document.getElementById("root");
if (!root) throw new Error("Flash page root element is missing");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <FlashPage />
  </React.StrictMode>,
);
