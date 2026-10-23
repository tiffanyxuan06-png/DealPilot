// =========================================================================
// SIGN IN
// With SUPABASE_URL + SUPABASE_ANON_KEY in .env (served by /api/auth/config)
// this is a real Supabase login and the role comes from the account.
// Without them it falls back to the demo accounts below.
// =========================================================================
const DEMO_ACCOUNTS = {
  // Names shown in the app come from the backend (Staff = the rep linked to the Staff login), not from here.
  'hafiz@sejukjaya.my': { role: 'OWNER', name: 'Owner' },
  'aina@sejukjaya.my': { role: 'STAFF', name: 'Staff' },
  // Predefined admin (Owner rights). Demo only: never used when Supabase login is on.
  'admin@cashchase.my': { role: 'OWNER', name: 'Admin', password: 'admin1234' }
};
const SESSION_KEY = 'cashchase-session';
let sb = null;  // Supabase client when real login is on

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
  if (session && res.status === 401) logout();  // token rejected: back to the sign-in screen
  return res;
};

// Storage can be blocked (private mode, sandboxed previews); never let that break sign-in
function readSession() {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
  }
  return null;
}

function writeSession(session, remember) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }
  if (remember) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }
  }
}

function clearSession() {
  for (const store of [sessionStorage, localStorage]) {
    try { store.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }
}

function setFieldError(id, message) {
  const input = document.getElementById(id);
  const err = document.getElementById(id + '-error');
  if (!input || !err) return;
  err.textContent = message || '';
  err.hidden = !message;
  input.classList.toggle('is-invalid', !!message);
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function setFormError(message) {
  const el = document.getElementById('login-form-error');
  document.getElementById('login-form-error-text').textContent = message || '';
  el.hidden = !message;
  if (message) {
    const form = document.getElementById('login-form');
    form.classList.remove('is-shaking');
    void form.offsetWidth;
    form.classList.add('is-shaking');
  }
}

// Returns an error message for a field, or '' when it is fine
function fieldProblem(id) {
  const value = document.getElementById(id).value;
  if (id === 'login-email') {
    const email = value.trim();
    if (!email) return 'Enter your email.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter an email like you@company.my.';
    return '';
  }
  if (!value) return 'Enter your password.';
  if (value.length < 6) return 'Use at least 6 characters.';
  return '';
}

// Check a field when the person leaves it, but only once they have typed something
function validateField(id) {
  if (!document.getElementById(id).value) return;
  setFieldError(id, fieldProblem(id));
}

function clearFieldError(id) {
  const input = document.getElementById(id);
  if (input.classList.contains('is-invalid') && !fieldProblem(id)) setFieldError(id, '');
  setFormError('');
}

function checkCapsLock(event) {
  if (!event.getModifierState) return;
  document.getElementById('login-password-caps').hidden = !event.getModifierState('CapsLock');
}

// The account for a Supabase user: role from app_metadata (set by the Owner), anyone else is Staff
function supabaseAccount(user) {
  const role = (user.app_metadata || {}).role === 'OWNER' ? 'OWNER' : 'STAFF';
  return { role, name: user.email };
}

// Checks the email and password; returns the account or an error message
async function checkLogin(email, password) {
  if (sb) {
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        return { error: error.name === 'AuthRetryableFetchError'
          ? 'Cannot reach the sign-in service. Check your internet connection.'
          : error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message };
      }
      return { account: supabaseAccount(data.user) };
    } catch (e) {
      return { error: 'Cannot reach the sign-in service. Check your internet connection.' };
    }
  }
  return new Promise(resolve => {
    setTimeout(() => {
      const account = DEMO_ACCOUNTS[email];
      if (!account) resolve({ error: "We couldn't find an account with that email. Try a demo account below." });
      else if (password.length < 6) resolve({ error: 'That password is too short.' });
      else if (account.password && password !== account.password) resolve({ error: 'Wrong email or password.' });
      else resolve({ account: { role: account.role, name: account.name } });
    }, 600);
  });
}

async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const remember = document.getElementById('login-remember').checked;

  setFormError('');
  let firstBad = null;
  for (const id of ['login-email', 'login-password']) {
    const problem = fieldProblem(id);
    setFieldError(id, problem);
    if (problem && !firstBad) firstBad = id;
  }

  if (firstBad) { document.getElementById(firstBad).focus(); return; }

  const btn = document.getElementById('login-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="login-spinner" aria-hidden="true"></span> Signing in…';

  const result = await checkLogin(email, password);

  if (result.error) {
    btn.disabled = false;
    btn.textContent = 'Sign in';
    setFormError(result.error);
    return;
  }

  // Brief success state, then fade into the app
  btn.classList.add('is-success');
  btn.innerHTML = '<svg class="w-4 h-4" aria-hidden="true"><use href="#i-check"/></svg> Signed in';
  setTimeout(() => {
    enterApp({ email, ...result.account }, remember);
    btn.disabled = false;
    btn.classList.remove('is-success');
    btn.textContent = 'Sign in';
  }, 450);
}

function demoLogin(role) {
  const email = Object.keys(DEMO_ACCOUNTS).find(e => DEMO_ACCOUNTS[e].role === role);
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = 'demo1234';
  setFieldError('login-email', '');
  setFieldError('login-password', '');
  document.getElementById('login-form').requestSubmit();
}

// With real login the role is the account's (set by the Owner in Supabase), so the
// demo role switcher is locked; with demo accounts it switches like before.
function applyRole(session) {
  if (!sb) {
    if (typeof currentRole !== 'undefined' && currentRole !== session.role) toggleRole();
    return;
  }
  currentRole = session.role;
  const avatar = document.getElementById('role-avatar');
  avatar.textContent = (session.email || '?').slice(0, 2).toUpperCase();
  document.getElementById('role-name').textContent = session.role === 'OWNER' ? 'Owner' : 'Staff';
  document.getElementById('role-sub').textContent = session.email;
  document.getElementById('role-btn').disabled = true;
  renderAll();
  if (typeof usesBackend === 'function' && usesBackend()) syncFromBackend();
}

function hideLoginScreen() {
  document.getElementById('login-screen').hidden = true;
  document.body.classList.remove('is-locked');
}

function enterApp(session, remember) {
  if (!sb) writeSession(session, remember);  // Supabase keeps its own session
  applyRole(session);
  if (sb) syncFromBackend();
  const screen = document.getElementById('login-screen');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finish = () => {
    hideLoginScreen();
    screen.classList.remove('is-leaving');
    showToast(`Welcome back, ${session.name}.`);
  };
  if (reduce) return finish();
  screen.classList.add('is-leaving');
  setTimeout(finish, 300);
}

function showLoginScreen() {
  document.getElementById('login-password').value = '';
  document.getElementById('login-password-caps').hidden = true;
  setFormError('');
  document.getElementById('login-screen').hidden = false;
  document.body.classList.add('is-locked');
  setTimeout(() => document.getElementById('login-email').focus(), 50);
}

function logout() {
  clearSession();
  if (sb) sb.auth.signOut();
  showLoginScreen();
}

function togglePasswordVisibility() {
  const input = document.getElementById('login-password');
  const btn = document.getElementById('login-toggle-pw');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  input.focus();
}

function forgotPassword() {
  showToast(sb
    ? 'Ask the Owner to reset your password in Supabase (Authentication → Users).'
    : 'Password reset is not set up in this prototype. Use a demo account.');
}

// On load: real login when Supabase is set up, otherwise the demo accounts.
// The sign-in screen stays up until we know someone is signed in.
(async function () {
  document.body.classList.add('is-locked');
  let config = null;
  try {
    config = await (await plainFetch(`${BACKEND_API_BASE}/api/auth/config`)).json();
  } catch (e) { /* backend offline: demo accounts */ }

  if (config && config.url && config.anonKey && window.supabase) {
    sb = supabase.createClient(config.url, config.anonKey);
    document.getElementById('login-demo').hidden = true;  // no fake accounts when login is real
    document.getElementById('login-demo-note').hidden = true;
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      applyRole({ email: session.user.email, ...supabaseAccount(session.user) });
      syncFromBackend();
      hideLoginScreen();
    } else {
      setTimeout(() => document.getElementById('login-email').focus(), 50);
    }
    return;
  }

  const session = readSession();
  if (session && DEMO_ACCOUNTS[session.email]) {
    applyRole(session);
    hideLoginScreen();
  } else {
    setTimeout(() => document.getElementById('login-email').focus(), 50);
  }
})();
