import { ReactNode } from "react";
import { Header } from "./Header";
import { BottomTabs, TabKey } from "../navigation/BottomTabs";

interface AppLayoutProps {
  children: ReactNode;
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  onAddKey?: () => void;
}

export function AppLayout({
  children,
  activeTab,
  onTabChange,
  onAddKey,
}: AppLayoutProps) {
  return (
    <div className="app-canvas flex h-screen w-full flex-col overflow-hidden bg-background">
      <Header onAddKey={onAddKey} />

      <main className="w-full flex-1 overflow-y-auto overflow-x-hidden">
        {children}
      </main>

      <BottomTabs activeTab={activeTab} onTabChange={onTabChange} />
    </div>
  );
}
