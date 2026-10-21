// --- LOGIN (Supabase Auth) ---
    // The backend serves the Supabase URL + anon key from .env (/api/auth/config).
    // If they are not set, the page runs without login like before.
    let sb = null;

    // Every request to our backend carries the signed-in user's access token,
    // so the existing fetch() calls across the WebApp don't each need changing.
    const plainFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const isRequest = input instanceof Request;
      const url = String(isRequest ? input.url : input);
      let session = null;
      if (sb && url.startsWith(BACKEND_API_BASE)) {
        ({ data: { session } } = await sb.auth.getSession());  // refreshes an expired token
        if (session) {
          const headers = new Headers(init.headers || (isRequest ? input.headers : undefined));
          headers.set('Authorization', `Bearer ${session.access_token}`);
          init = { ...init, headers };
        }
      }
      const res = await plainFetch(input, init);
      if (session && res.status === 401) sb.auth.signOut();  // token rejected: back to the login screen
      return res;
    };

    // With login on, the role is the user's (set by the Owner in Supabase), not the demo switcher.
    function applyUserRole(session) {
      const role = (session.user.app_metadata || {}).role === 'OWNER' ? 'OWNER' : 'STAFF';
      currentRole = role;
      const avatar = document.getElementById('role-avatar');
      avatar.textContent = (session.user.email || '?').slice(0, 2).toUpperCase();
      avatar.className = role === 'OWNER'
        ? 'w-7 h-7 rounded-full bg-[#0152FC] text-white font-bold text-xs flex items-center justify-center'
        : 'w-7 h-7 rounded-full bg-[#042970] text-[#01E3FB] font-bold text-xs flex items-center justify-center';
      document.getElementById('role-name').textContent = role === 'OWNER' ? 'Owner' : 'Staff';
      document.getElementById('role-sub').textContent = 'Signed in';
      document.getElementById('role-btn').disabled = true;
      renderAll();
    }

    function showLoggedIn(session) {
      document.getElementById('login-screen').classList.toggle('hidden', !!session);
      const userBox = document.getElementById('auth-user');
      userBox.classList.toggle('hidden', !session);
      userBox.classList.toggle('flex', !!session);
      document.getElementById('auth-email').textContent = session ? session.user.email : '';
    }

    function showLoginError(msg) {
      const box = document.getElementById('login-error');
      box.textContent = msg || '';
      box.classList.toggle('hidden', !msg);
    }

    async function submitLogin(isSignup) {
      const form = document.getElementById('login-form');
      if (!form.reportValidity()) return;
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const buttons = form.querySelectorAll('button');
      buttons.forEach(b => b.disabled = true);
      showLoginError('');
      try {
        const { data, error } = isSignup
          ? await sb.auth.signUp({ email, password })
          : await sb.auth.signInWithPassword({ email, password });
        if (error) {
          return showLoginError(error.name === 'AuthRetryableFetchError'
            ? 'Cannot reach the login service. Check SUPABASE_URL and your internet connection.'
            : error.message);
        }
        if (isSignup && !data.session) showLoginError('Account created. Check your email to confirm it, then log in.');
      } finally {
        buttons.forEach(b => b.disabled = false);
      }
    }

    async function logout() {
      await sb.auth.signOut();
    }

    async function initAuth() {
      let config;
      try {
        config = await (await plainFetch(`${BACKEND_API_BASE}/api/auth/config`)).json();
      } catch (err) {
        return;  // backend offline: the page already shows that
      }
      if (!config.url || !config.anonKey) {
        console.warn('Supabase login is off: set SUPABASE_URL and SUPABASE_ANON_KEY in .env');
        return;
      }
      sb = supabase.createClient(config.url, config.anonKey);

      document.getElementById('login-form').addEventListener('submit', e => { e.preventDefault(); submitLogin(false); });
      document.getElementById('signup-submit').addEventListener('click', () => submitLogin(true));

      // Fires once on load with the saved session, then on every log in / log out.
      sb.auth.onAuthStateChange((event, session) => {
        showLoggedIn(session);
        if (!session) return;
        // Run outside the callback: Supabase calls made inside it (our fetch wrapper's getSession) can deadlock.
        setTimeout(() => {
          applyUserRole(session);
          if (event === 'SIGNED_IN') syncFromBackend();
        }, 0);
      });
    }

    initAuth();
