// =========================================================================
// SIGN IN (prototype)
// Demo accounts only. Replace checkLogin() with a real auth call later.
// =========================================================================
const DEMO_ACCOUNTS = {
  'hafiz@sejukjaya.my': { role: 'OWNER', name: 'Encik Hafiz' },
  'aina@sejukjaya.my': { role: 'STAFF', name: 'Aina' }
};
const SESSION_KEY = 'cashchase-session';

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
  el.textContent = message || '';
  el.hidden = !message;
}

// Simulates a server check; returns the account or an error message
function checkLogin(email, password) {
  return new Promise(resolve => {
    setTimeout(() => {
      const account = DEMO_ACCOUNTS[email];
      if (!account) resolve({ error: "We couldn't find an account with that email. Try a demo account below." });
      else if (password.length < 6) resolve({ error: 'That password is too short.' });
      else resolve({ account });
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
  if (!email) { setFieldError('login-email', 'Enter your email.'); firstBad = firstBad || 'login-email'; }
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFieldError('login-email', 'Enter an email like you@company.my.'); firstBad = firstBad || 'login-email'; }
  else setFieldError('login-email', '');

  if (!password) { setFieldError('login-password', 'Enter your password.'); firstBad = firstBad || 'login-password'; }
  else if (password.length < 6) { setFieldError('login-password', 'Use at least 6 characters.'); firstBad = firstBad || 'login-password'; }
  else setFieldError('login-password', '');

  if (firstBad) { document.getElementById(firstBad).focus(); return; }

  const btn = document.getElementById('login-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="login-spinner" aria-hidden="true"></span> Signing in…';

  const result = await checkLogin(email, password);
  btn.disabled = false;
  btn.textContent = 'Sign in';

  if (result.error) {
    setFormError(result.error);
    return;
  }
  enterApp({ email, ...result.account }, remember);
}

function demoLogin(role) {
  const email = Object.keys(DEMO_ACCOUNTS).find(e => DEMO_ACCOUNTS[e].role === role);
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = 'demo1234';
  setFieldError('login-email', '');
  setFieldError('login-password', '');
  document.getElementById('login-form').requestSubmit();
}

function enterApp(session, remember) {
  writeSession(session, remember);
  if (typeof currentRole !== 'undefined' && currentRole !== session.role) toggleRole();
  document.getElementById('login-screen').hidden = true;
  document.body.classList.remove('is-locked');
  showToast(`Welcome back, ${session.name}.`);
}

function logout() {
  clearSession();
  document.getElementById('login-password').value = '';
  setFormError('');
  document.getElementById('login-screen').hidden = false;
  document.body.classList.add('is-locked');
  setTimeout(() => document.getElementById('login-email').focus(), 50);
}

function togglePasswordVisibility() {
  const input = document.getElementById('login-password');
  const btn = document.getElementById('login-toggle-pw');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

function forgotPassword() {
  showToast('Password reset is not set up in this prototype. Use a demo account.');
}

// On load: skip the sign-in screen if a session is still active
(function () {
  const session = readSession();
  if (session && DEMO_ACCOUNTS[session.email]) {
    if (currentRole !== session.role) toggleRole();
    document.getElementById('login-screen').hidden = true;
  } else {
    document.body.classList.add('is-locked');
    setTimeout(() => document.getElementById('login-email').focus(), 50);
  }
})();
