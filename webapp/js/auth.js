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

function enterApp(session, remember) {
  writeSession(session, remember);
  if (typeof currentRole !== 'undefined' && currentRole !== session.role) toggleRole();
  const screen = document.getElementById('login-screen');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finish = () => {
    screen.hidden = true;
    screen.classList.remove('is-leaving');
    document.body.classList.remove('is-locked');
    showToast(`Welcome back, ${session.name}.`);
  };
  if (reduce) return finish();
  screen.classList.add('is-leaving');
  setTimeout(finish, 300);
}

function logout() {
  clearSession();
  document.getElementById('login-password').value = '';
  document.getElementById('login-password-caps').hidden = true;
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
  input.focus();
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
