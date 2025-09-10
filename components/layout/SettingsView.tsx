import { SidePanelToggle } from "../common/sidepanel-toggle";

export function SettingsView() {
  return (
    <div className="p-4 space-y-4">
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="text-muted-foreground">Configure your signer</p>
      </div>

      <div className="space-y-3">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Auto-sign Events</h3>
              <p className="text-sm text-muted-foreground">
                Automatically sign trusted events
              </p>
            </div>
            <div className="w-10 h-6 bg-muted rounded-full"></div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <SidePanelToggle />
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Notifications</h3>
              <p className="text-sm text-muted-foreground">
                Get notified of sign requests
              </p>
            </div>
            <div className="w-10 h-6 bg-primary rounded-full"></div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="font-medium mb-2">Security</h3>
          <div className="space-y-2">
            <button className="w-full text-left text-sm text-muted-foreground hover:text-foreground">
              Change Password
            </button>
            <button className="w-full text-left text-sm text-muted-foreground hover:text-foreground">
              Export Private Key
            </button>
            <button className="w-full text-left text-sm text-red-600 hover:text-red-700">
              Reset Wallet
            </button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="font-medium mb-2">About</h3>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>Version 1.0.0</p>
            <p>Built with ❤️ for Nostr</p>
          </div>
        </div>
      </div>
    </div>
  );
}
