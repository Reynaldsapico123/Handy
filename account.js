(async function initializeAccountModule() {
  const button = document.querySelector("#accountButton");
  const url = "https://llpdsgvnhggzydbhvjjm.supabase.co";
  const key = "sb_publishable_MmpJJ0M037LeB_Sz0frm2Q_GBdeSDsS";
  let client = null;
  let user = null;
  let premium = false;

  function updateButton() {
    if (!button) return;
    button.textContent = user ? (premium ? "P" : "✓") : "A";
    button.setAttribute("aria-label", user ? "Handy account signed in" : "A account");
  }

  async function loadClient() {
    if (!url || !key) throw new Error("Account setup is not configured.");
    if (!window.supabase?.createClient) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "vendor/supabase.js";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Could not load Supabase."));
        document.head.append(script);
      });
    }
    if (!window.supabase?.createClient) throw new Error("Supabase is unavailable.");
    client = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  async function syncState() {
    if (!client || !user) return;
    const state = window.readSettingsBackupData?.();
    if (!state) {
      showToast("Local settings could not be read.");
      return;
    }
    const { error } = await client.from("handy_user_state").upsert({
      user_id: user.id,
      state,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
    showToast(error ? "Cloud sync failed." : "Settings synced.");
  }

  window.openHandyAccount = async function () {
    try {
      await loadClient();
      const { data } = await client.auth.getSession();
      user = data.session?.user || null;
      if (user) {
        const { data: profile } = await client
          .from("handy_profiles")
          .select("is_premium")
          .eq("id", user.id)
          .maybeSingle();
        premium = profile?.is_premium === true;
      }
      updateButton();
      if (user) {
        if (window.confirm("Sync settings now? Choose Cancel to sign out.")) {
          await syncState();
        } else {
          await client.auth.signOut();
          user = null;
          premium = false;
          updateButton();
          showToast("Signed out.");
        }
        return;
      }
      const email = window.prompt("Email address for the Handy sign-in link:");
      if (!email) return;
      const normalized = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        showToast("Enter a valid email address.");
        return;
      }
      const { error } = await client.auth.signInWithOtp({
        email: normalized,
        options: { emailRedirectTo: window.location.origin }
      });
      showToast(error ? "Could not send sign-in link." : "Sign-in link sent.");
    } catch (error) {
      console.error("Could not open Handy account.", error);
      showToast(error.message || "Account is unavailable.");
    }
  };

  updateButton();
})();
