import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { SkipLink } from "./CommandPalette";

interface PageLayoutProps {
  children: React.ReactNode;
}

export function PageLayout({ children }: PageLayoutProps) {
  return (
    <div className="flex h-screen flex-col bg-background">
      <SkipLink />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto bg-surface-base focus:outline-none"
        >
          {children}
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
