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
    <div className="flex flex-col h-screen min-h-screen bg-background">
      <Header selectedKey={selectedKey} avatar={avatar} />

      <main className="flex-1 overflow-y-auto">{children}</main>

      <BottomTabs activeTab={activeTab} onTabChange={onTabChange} />
    </div>
  );
}
