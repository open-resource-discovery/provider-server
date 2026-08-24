import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import "@open-resource-discovery/explorer/components/styles";

const rootEl = document.getElementById("root");
if (rootEl === null) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
