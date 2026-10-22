// frontend/js/auth.js — Login & Signup Client Logic

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';

  if (isPassword) {
    btn.innerHTML = `
      <svg class="eye-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>
    `;
    btn.setAttribute('aria-label', 'Hide password');
  } else {
    btn.innerHTML = `
      <svg class="eye-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    `;
    btn.setAttribute('aria-label', 'Show password');
  }
}

function switchTab(tab) {
  const signinForm = document.getElementById('signinForm');
  const signupForm = document.getElementById('signupForm');
  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');
  const msg = document.getElementById('authMessage');
  msg.style.display = 'none';

  const forgotForm = document.getElementById('forgotForm');
  const resetForm = document.getElementById('resetForm');

  if (forgotForm) forgotForm.style.display = 'none';
  if (resetForm) resetForm.style.display = 'none';

  if (tab === 'signin') {
    signinForm.style.display = 'flex';
    signupForm.style.display = 'none';
    tabSignIn.classList.add('active');
    tabSignUp.classList.remove('active');
  } else if (tab === 'signup') {
    signinForm.style.display = 'none';
    signupForm.style.display = 'flex';
    tabSignIn.classList.remove('active');
    tabSignUp.classList.add('active');
  }
}

function showMessage(text, type) {
  const msg = document.getElementById('authMessage');
  msg.textContent = text;
  msg.className = `auth-message ${type}`;
  msg.style.display = 'block';
}

async function parseApiResponse(res) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const data = await res.json();
      if (res.status === 401 && (data.message === 'Protected by Vercel Authentication' || (data.error && data.error.message === 'Protected deployment'))) {
        return {
          success: false,
          message: 'This preview deployment has Vercel Authentication enabled. Use https://email-monitoring-automation.vercel.app or disable Deployment Protection in Vercel settings.'
        };
      }
      return data;
    } catch (_) {}
  }
  const text = await res.text();
  if (res.status === 401 && text.includes('Protected')) {
    return {
      success: false,
      message: 'This preview deployment has Vercel Authentication enabled. Use https://email-monitoring-automation.vercel.app or disable Deployment Protection in Vercel settings.'
    };
  }
  return {
    success: false,
    message: text ? text.slice(0, 150) : `Server error (Status ${res.status}).`
  };
}

function getFriendlyErrorMessage(err) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'You appear to be offline. Please check your internet connection.';
  }
  if (window.location.hostname.includes('vercel.app')) {
    return 'Connection error. If you are viewing a Vercel preview URL, Vercel Authentication may be blocking API calls. Please open: https://email-monitoring-automation.vercel.app';
  }
  return 'Connection error. Is the server running?';
}

async function handleSignIn(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('signinBtn');

  btn.disabled = true;
  btn.querySelector('span').textContent = 'Signing in...';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await parseApiResponse(res);

    if (data.success) {
      // Store session
      sessionStorage.setItem('session_token', data.token);
      sessionStorage.setItem('user_email', data.user.email);
      sessionStorage.setItem('user_role', data.user.role);
      sessionStorage.setItem('user_id', data.user.id);
      window.location.href = '/dashboard.html';
    } else {
      showMessage(data.message || 'Invalid email or password.', 'error');
    }
  } catch (err) {
    showMessage(getFriendlyErrorMessage(err), 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Sign In';
  }
}

async function handleSignUp(e) {
  e.preventDefault();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const confirm = document.getElementById('confirmPassword').value;
  const btn = document.getElementById('signupBtn');

  if (password.length < 6) {
    showMessage('Password must be at least 6 characters long.', 'error');
    return;
  }

  if (password !== confirm) {
    showMessage('Passwords do not match.', 'error');
    return;
  }

  btn.disabled = true;
  btn.querySelector('span').textContent = 'Creating...';

  try {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await parseApiResponse(res);

    if (data.success) {
      showMessage('Account created! Signing you in...', 'success');
      // Auto-fill login form
      document.getElementById('loginEmail').value = email;
      document.getElementById('loginPassword').value = password;
      setTimeout(() => switchTab('signin'), 1500);
    } else {
      showMessage(data.message || 'Sign up failed.', 'error');
    }
  } catch (err) {
    showMessage(getFriendlyErrorMessage(err), 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Create Account';
  }
}

function showForgotPasswordForm(e) {
  if (e) e.preventDefault();
  const signinForm = document.getElementById('signinForm');
  const signupForm = document.getElementById('signupForm');
  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');
  const forgotForm = document.getElementById('forgotForm');
  const resetForm = document.getElementById('resetForm');
  const msg = document.getElementById('authMessage');
  msg.style.display = 'none';

  signinForm.style.display = 'none';
  signupForm.style.display = 'none';
  resetForm.style.display = 'none';
  forgotForm.style.display = 'flex';

  tabSignIn.classList.remove('active');
  tabSignUp.classList.remove('active');
}

async function handleRequestOTP(e) {
  e.preventDefault();
  const email = document.getElementById('forgotEmail').value.trim();
  const btn = document.getElementById('forgotBtn');

  btn.disabled = true;
  btn.querySelector('span').textContent = 'Sending OTP...';
  const msg = document.getElementById('authMessage');
  msg.style.display = 'none';

  try {
    const res = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await parseApiResponse(res);

    if (data.success) {
      showMessage('OTP sent to your email! Check your inbox.', 'success');
      document.getElementById('resetEmail').value = email;
      document.getElementById('forgotForm').style.display = 'none';
      document.getElementById('resetForm').style.display = 'flex';
    } else {
      showMessage(data.message || 'Failed to send OTP.', 'error');
    }
  } catch (err) {
    showMessage(getFriendlyErrorMessage(err), 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Send OTP';
  }
}

async function handleResetPassword(e) {
  e.preventDefault();
  const email = document.getElementById('resetEmail').value.trim();
  const otp = document.getElementById('resetOTP').value.trim();
  const password = document.getElementById('resetPassword').value;
  const confirm = document.getElementById('confirmResetPassword').value;
  const btn = document.getElementById('resetBtn');

  if (password.length < 6) {
    showMessage('Password must be at least 6 characters long.', 'error');
    return;
  }

  if (password !== confirm) {
    showMessage('Passwords do not match.', 'error');
    return;
  }

  btn.disabled = true;
  btn.querySelector('span').textContent = 'Resetting...';

  try {
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, password })
    });
    const data = await parseApiResponse(res);

    if (data.success) {
      showMessage('Password reset successful! Redirecting...', 'success');
      document.getElementById('forgotEmail').value = '';
      document.getElementById('resetOTP').value = '';
      document.getElementById('resetPassword').value = '';
      document.getElementById('confirmResetPassword').value = '';
      setTimeout(() => switchTab('signin'), 2000);
    } else {
      showMessage(data.message || 'Password reset failed.', 'error');
    }
  } catch (err) {
    showMessage(getFriendlyErrorMessage(err), 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Reset Password';
  }
}

// Check if already logged in or handle OAuth error
(function() {
  const params = new URLSearchParams(window.location.search);
  const oauthErr = params.get('oauth_error');
  const oauthMsg = params.get('oauth_msg');
  if (oauthErr) {
    window.history.replaceState({}, '', '/');
    const errorMap = {
      'no_code': 'Google authorization was cancelled.',
      'session_expired': 'Your session expired. Please sign in again.',
      'token_failed': 'Failed to exchange Google OAuth token. Please try again.',
      'no_email': 'Could not retrieve email address from your Google account.',
      'missing_gmail_permission': 'Gmail permission was not granted. Please check permissions.',
      'missing_client_id': 'Google Client ID is not configured.',
      'server_error': 'Server error during Google authorization. Please try again.'
    };
    const detail = oauthMsg ? ` (${decodeURIComponent(oauthMsg)})` : '';
    showMessage((errorMap[oauthErr] || 'Google sign-in failed.') + detail, 'error');
    return;
  }

  const email = sessionStorage.getItem('user_email');
  if (email) {
    window.location.href = '/dashboard.html';
  }
})();
