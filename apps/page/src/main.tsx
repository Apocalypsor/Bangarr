import { AuthGate } from "@page/app/auth-gate";
import { Toaster } from "@page/components/ui/sonner";
import { AuthProvider } from "@page/providers/auth-provider";
import { QueryProvider } from "@page/providers/query-provider";
import { RouterProvider } from "@page/providers/router-provider";
import { ThemeProvider } from "@page/providers/theme-provider";
import { createRoot } from "react-dom/client";
import "@page/styles/app.css";

const root = document.getElementById("root");

if (root)
  createRoot(root).render(
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <AuthGate>
            <RouterProvider />
          </AuthGate>
        </AuthProvider>

        <Toaster richColors />
      </QueryProvider>
    </ThemeProvider>,
  );
