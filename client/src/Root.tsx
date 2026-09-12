import { lazy, Suspense } from "react";
import DemoApp from "./demo/DemoApp";

const AuthPreview = lazy(() => import("./AuthPreview"));

export default function Root() {
  return (
    <Suspense fallback={<p className="auth-preview">Opening ShareTally…</p>}>
      {window.location.pathname === "/auth" ? <AuthPreview /> : <DemoApp />}
    </Suspense>
  );
}
