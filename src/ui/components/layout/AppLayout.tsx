import { ReactNode } from "react";
import { Header } from "./Header";
import { BottomTabs, TabKey } from "../navigation/BottomTabs";

interface AppLayoutProps {
  children: ReactNode;
  selectedKey?: string;
  avatar?: string;
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

export function AppLayout({
  children,
  selectedKey,
  avatar,
  activeTab,
  onTabChange,
}: AppLayoutProps) {
  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background">
      <Header selectedKey={selectedKey} avatar={avatar} />

      <main className="flex-1 overflow-y-auto overflow-x-hidden w-full">
        {children}
      </main>

      <BottomTabs activeTab={activeTab} onTabChange={onTabChange} />
    </div>
  );
}
