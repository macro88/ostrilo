import { MainApp } from "@/components/layout/MainApp";
import { KeyManagerProvider } from "@/ui/features/authentication/hooks/KeyManagerContext";
import "./App.css";

function App() {

  return (
    <KeyManagerProvider>
      <MainApp />
    </KeyManagerProvider>
  );

}

export default App;
