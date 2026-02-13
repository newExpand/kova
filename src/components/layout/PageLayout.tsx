import type { ReactNode } from "react";

interface PageLayoutProps {
  children: ReactNode;
  title?: string;
  actions?: ReactNode;
}

function PageLayout({ children, title, actions }: PageLayoutProps) {
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {title && (
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-6">
          <h1 className="text-sm font-semibold text-text">{title}</h1>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}

export { PageLayout };
