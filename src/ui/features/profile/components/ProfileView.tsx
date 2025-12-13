export function ProfileView() {
  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      <div className="text-center">
        <div className="w-16 h-16 bg-muted rounded-full mx-auto mb-2"></div>
        <h2 className="text-xl font-semibold">Profile Settings</h2>
        <p className="text-muted-foreground text-sm">
          Manage your Nostr identity
        </p>
      </div>

      <div className="space-y-2">
        <div className="bg-card border border-border rounded-lg p-3">
          <h3 className="font-medium mb-1 text-sm">Display Name</h3>
          <p className="text-xs text-muted-foreground">Not set</p>
        </div>

        <div className="bg-card border border-border rounded-lg p-3">
          <h3 className="font-medium mb-1 text-sm">About</h3>
          <p className="text-xs text-muted-foreground">Add a bio</p>
        </div>

        <div className="bg-card border border-border rounded-lg p-3">
          <h3 className="font-medium mb-1 text-sm">Website</h3>
          <p className="text-xs text-muted-foreground">Add your website</p>
        </div>

        <button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2 px-4 rounded-lg font-medium text-sm">
          Edit Profile
        </button>
      </div>
    </div>
  );
}
