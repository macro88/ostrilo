export function ActivityView() {
  return (
    <div className="p-4 space-y-4">
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold">Recent Activity</h2>
        <p className="text-muted-foreground">Your transaction history</p>
      </div>

      <div className="space-y-3">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Signed Event</h3>
              <p className="text-sm text-muted-foreground">2 hours ago</p>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-green-600">Success</div>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Permission Request</h3>
              <p className="text-sm text-muted-foreground">1 day ago</p>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-yellow-600">Pending</div>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Key Generated</h3>
              <p className="text-sm text-muted-foreground">3 days ago</p>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-green-600">Complete</div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center mt-6">
        <button className="text-primary hover:text-primary/80 text-sm">
          View All Activity
        </button>
      </div>
    </div>
  );
}
