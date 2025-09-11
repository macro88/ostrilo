import { MainApp } from "@/components/layout/MainApp";
import { KeyManagerProvider } from "@/hooks/KeyManagerContext";

function AppPanel() {
  return (
    <KeyManagerProvider>
      <MainApp />
    </KeyManagerProvider>
  );
}

export default AppPanel;
