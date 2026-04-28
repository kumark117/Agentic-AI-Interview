import "./globals.css";

import { ColdStartGate } from "../components/ColdStartGate";
import { SessionProvider } from "../lib/session-context";

export const metadata = {
  title: "AI Agentic Interview",
  description: "Event-driven AI interview frontend"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <ColdStartGate>{children}</ColdStartGate>
        </SessionProvider>
      </body>
    </html>
  );
}
