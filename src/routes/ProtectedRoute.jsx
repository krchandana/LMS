import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, profileError, loading } = useAuth();
  const location = useLocation();
  const userRole = user?.user_metadata?.role;

  if (loading) return <p>Loading...</p>;

  if (!user) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    const loginPath = allowedRoles?.includes("student")
      ? `/?role=student&returnTo=${encodeURIComponent(returnTo)}`
      : "/";
    return <Navigate to={loginPath} replace />;
  }

  if (profileError) {
    if (userRole && allowedRoles?.includes(userRole)) {
      return children;
    }

    return (
      <div className="p-6 text-red-700">
        <h2 className="text-xl font-semibold">Profile load error</h2>
        <p>{profileError.message || "Unable to load profile."}</p>
      </div>
    );
  }

  if (!profile) {
    if (userRole && allowedRoles?.includes(userRole)) {
      return children;
    }

    return <Navigate to="/" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    if (userRole && allowedRoles.includes(userRole)) {
      return children;
    }

    return <Navigate to="/" replace />;
  }

  if (profile.role === "student" && !["active", "approved"].includes((profile.status || "").toLowerCase())) {
    return <Navigate to="/" replace />;
  }

  return children;
}
