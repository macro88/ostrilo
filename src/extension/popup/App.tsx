import { MainApp } from "@/components/layout/MainApp";
import { KeyManagerProvider } from "@/ui/state/KeyManagerContext";
import { useTheme } from "@/ui/hooks/useTheme";
import "./App.css";

function App() {
  // Apply theme based on settings and system preference
  useTheme();

  return (
    <KeyManagerProvider>
      <MainApp />
    </KeyManagerProvider>
  );

}

export default App;
