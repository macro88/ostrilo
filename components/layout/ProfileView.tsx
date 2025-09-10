export function ProfileView() {
  return (
    <div className="p-4 space-y-4">
      <div className="text-center">
        <div className="w-16 h-16 bg-muted rounded-full mx-auto mb-3"></div>
        <h2 className="text-xl font-semibold">Profile Settings</h2>
        <p className="text-muted-foreground">Manage your Nostr identity</p>
      </div>

      <div className="space-y-3">
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="font-medium mb-2">Display Name</h3>
          <p className="text-sm text-muted-foreground">Not set</p>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="font-medium mb-2">About</h3>
          <p className="text-sm text-muted-foreground">Add a bio</p>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="font-medium mb-2">Website</h3>
          <p className="text-sm text-muted-foreground">Add your website</p>
        </div>

        <button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 px-4 rounded-lg font-medium">
          Edit Profile
        </button>
      </div>
    </div>
  );
}
