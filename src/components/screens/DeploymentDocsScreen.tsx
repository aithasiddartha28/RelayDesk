export function DeploymentDocsScreen() {
  return (
    <div className="max-w-4xl space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-900">
          RelayDesk System Architecture, Docker &amp; Kubernetes Guide
        </h2>
        <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
          Complete technical reference for Objectives, Technology Stack, WebSocket Communication Protocol,
          Role-Based Reporting, Containerization, and Kubernetes Deployment.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-900">01. Objectives &amp; Scope</h3>
          <ul className="mt-2.5 space-y-1.5 text-xs text-slate-600 list-disc pl-4">
            <li>Low-latency one-to-one and group messaging using native WebSockets (`ws`).</li>
            <li>Persistent message history, delivery receipts (`sent`, `delivered`, `read`), and timestamps.</li>
            <li>Three distinct RBAC roles: Admin, Group Administrator, and Registered User.</li>
            <li>
              Admin-only Mandatory Reports: User Activity (joins, logins, texted timestamps), Message Activity,
              Group Participation, and Group Creation.
            </li>
          </ul>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-900">02. Technology Stack</h3>
          <ul className="mt-2.5 space-y-1.5 text-xs text-slate-600 list-disc pl-4">
            <li>Frontend: React 19, TypeScript, Tailwind CSS v4, Lucide Icons.</li>
            <li>Backend: Node.js 22, Express 4, `ws` WebSocket Server on unified port 3000.</li>
            <li>Persistence: Embedded ACID SQLite (`node:sqlite` WAL mode) with PersistentVolumeClaim support.</li>
            <li>Packaging: Multi-stage `Dockerfile`, `docker-compose.yml`, and Kubernetes manifests (`k8s/`).</li>
          </ul>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">03. Docker Execution Instructions</h3>
        <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
{`# Build the production container image
docker build -t relaydesk:latest .

# Run container with persistent SQLite volume
docker run -d --name relaydesk -p 3000:3000 -v relaydesk_data:/app/data relaydesk:latest

# Or launch with Docker Compose
docker compose up --build -d`}
        </pre>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">04. Kubernetes Deployment Instructions</h3>
        <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
{`# Apply storage, configuration, deployment, and service manifests
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# Verify pod readiness & service endpoints
kubectl get pods,svc -l app=relaydesk
kubectl port-forward svc/relaydesk-service 3000:3000`}
        </pre>
      </div>
    </div>
  );
}
