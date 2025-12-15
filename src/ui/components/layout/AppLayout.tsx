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
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background">
      <Header onAddKey={onAddKey} />

      <main className="flex-1 overflow-y-auto overflow-x-hidden w-full">
        {children}
      </main>

      <BottomTabs activeTab={activeTab} onTabChange={onTabChange} />
    </div>
  );
}
