import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { AuthContext } from "./authContextValue";

const updateProfileWithColumnFallback = async (profileId, payload) => {
  let nextPayload = { ...payload };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase
      .from("profiles")
      .update(nextPayload)
      .eq("id", profileId)
      .select()
      .single();

    if (!error) return { data };

    const message = error.message || "";
    const missingColumnMatch = message.match(/column "([^"]+)"/i) || message.match(/'([^']+)' column/i);
    if (!missingColumnMatch) return { error };

    const missingColumn = missingColumnMatch[1];
    if (!Object.prototype.hasOwnProperty.call(nextPayload, missingColumn)) return { error };

    const remainingPayload = { ...nextPayload };
    delete remainingPayload[missingColumn];
    nextPayload = remainingPayload;
  }

  return { error: { message: "Unable to update the profile with the available columns." } };
};

const syncProfileFromMetadata = async (profileData, sessionUser) => {
  const metadata = sessionUser.user_metadata || {};
  const metadataStatus = (metadata.status || "").toLowerCase();
  const metadataRole = metadata.role;

  if (!metadataRole) {
    return profileData;
  }

  const updates = {
    role: metadataRole,
    status: metadataStatus || profileData?.status || "active",
    full_name: metadata.full_name || profileData.full_name,
    email: metadata.registered_email || metadata.email || profileData.email || sessionUser.email,
    auth_email: sessionUser.email,
  };

  if (metadataRole === "student") {
    updates.student_id = metadata.student_id || profileData.student_id;
    updates.student_login_id = metadata.student_id || profileData.student_login_id;
  }

  if (
    updates.role === profileData?.role &&
    (profileData?.status || "").toLowerCase() === updates.status &&
    (profileData?.full_name || "") === (updates.full_name || "")
  ) {
    return profileData;
  }

  const { data: updatedProfile, error: updateError } = await updateProfileWithColumnFallback(sessionUser.id, updates);

  if (updateError) {
    console.error("Profile metadata sync error:", updateError);
    return profileData;
  }

  return updatedProfile ?? { ...profileData, ...updates };
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);

  const fetchOrCreateProfile = useCallback(async (sessionUser) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", sessionUser.id)
        .maybeSingle();

      if (error) {
        console.error("Profile fetch error:", error);
        setProfileError(error);
        setProfile(null);
        return;
      }

      if (!data) {
        const defaultProfile = {
          id: sessionUser.id,
          email: sessionUser.email,
          full_name: sessionUser.user_metadata?.full_name || sessionUser.email,
          role: sessionUser.user_metadata?.role || "student",
          status: sessionUser.user_metadata?.status || "pending",
        };

        const { data: insertedProfile, error: insertError } = await supabase
          .from("profiles")
          .insert(defaultProfile)
          .select()
          .single();

        if (insertError) {
          console.error("Profile insert error:", insertError);
          setProfileError(insertError);
          setProfile(null);
          return;
        }

        setProfile(insertedProfile ?? defaultProfile);
        return;
      }

      const syncedProfile = await syncProfileFromMetadata(data, sessionUser);
      setProfile(syncedProfile);
    } catch (error) {
      console.error("Profile bootstrap error:", error);
      setProfileError(error);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const sessionResult = await Promise.race([
          supabase.auth.getSession(),
          new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 3000)),
        ]);

        if (sessionResult?.timeout) {
          setUser(null);
          setProfile(null);
          setProfileError(null);
          return;
        }

        const { data } = sessionResult;
        const sessionUser = data?.session?.user;
        setUser(sessionUser ?? null);
        setProfile(null);
        setProfileError(null);

        if (sessionUser) {
          await fetchOrCreateProfile(sessionUser);
        }
      } catch (error) {
        console.error("Auth session bootstrap error:", error);
        setUser(null);
        setProfile(null);
        setProfileError(error);
      } finally {
        setLoading(false);
      }
    })();

    const { data } = supabase.auth.onAuthStateChange(async (_, session) => {
      const sessionUser = session?.user;
      setUser(sessionUser ?? null);
      setProfile(null);
      setProfileError(null);

      if (sessionUser) {
        await fetchOrCreateProfile(sessionUser);
      }
    });

    return () => data.subscription.unsubscribe();
  }, [fetchOrCreateProfile]);

  return (
    <AuthContext.Provider value={{ user, profile, profileError, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
