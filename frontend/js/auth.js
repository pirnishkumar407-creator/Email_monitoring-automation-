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
    const data = await res.json();

    if (data.success) {
      // Store session
      sessionStorage.setItem('session_token', data.token);
      sessionStorage.setItem('user_email', data.user.email);
      sessionStorage.setItem('user_role', data.user.role);
      sessionStorage.setItem('user_id', data.user.id);
      window.location.href = '/dashboard.html';
    } else {
      showMessage(data.message, 'error');
    }
  } catch (err) {
    showMessage('Connection error. Is the server running?', 'error');
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

  const lengthValid = password.length >= 9 && password.length <= 10;
  const capitalValid = /[A-Z]/.test(password);
  const lowerValid = /[a-z]/.test(password);
  const specialValid = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password);
  const noSpaceValid = !/\s/.test(password);

  if (!lengthValid || !capitalValid || !lowerValid || !specialValid || !noSpaceValid) {
    showMessage('Password must meet all complexity requirements.', 'error');
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
    const data = await res.json();

    if (data.success) {
      showMessage('Account created! Signing you in...', 'success');
      // Auto-fill login form
      document.getElementById('loginEmail').value = email;
      document.getElementById('loginPassword').value = password;
      setTimeout(() => switchTab('signin'), 1500);
    } else {
      showMessage(data.message, 'error');
    }
  } catch (err) {
    showMessage('Connection error. Is the server running?', 'error');
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
    const data = await res.json();

    if (data.success) {
      showMessage('OTP sent to your email! Check your inbox.', 'success');
      document.getElementById('resetEmail').value = email;
      document.getElementById('forgotForm').style.display = 'none';
      document.getElementById('resetForm').style.display = 'flex';
    } else {
      showMessage(data.message, 'error');
    }
  } catch (err) {
    showMessage('Connection error. Is the server running?', 'error');
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

  const lengthValid = password.length >= 9 && password.length <= 10;
  const capitalValid = /[A-Z]/.test(password);
  const lowerValid = /[a-z]/.test(password);
  const specialValid = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password);
  const noSpaceValid = !/\s/.test(password);

  if (!lengthValid || !capitalValid || !lowerValid || !specialValid || !noSpaceValid) {
    showMessage('Password must meet all complexity requirements.', 'error');
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
    const data = await res.json();

    if (data.success) {
      showMessage('Password reset successful! Redirecting...', 'success');
      document.getElementById('forgotEmail').value = '';
      document.getElementById('resetOTP').value = '';
      document.getElementById('resetPassword').value = '';
      document.getElementById('confirmResetPassword').value = '';
      setTimeout(() => switchTab('signin'), 2000);
    } else {
      showMessage(data.message, 'error');
    }
  } catch (err) {
    showMessage('Connection error. Is the server running?', 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Reset Password';
  }
}

// Password requirements dynamic indicator
function updateRequirementItem(id, isValid, inputId = 'signupPassword') {
  const el = document.getElementById(id);
  if (!el) return;
  if (isValid) {
    el.classList.add('valid');
    el.classList.remove('invalid');
    el.querySelector('.req-icon').textContent = '✅';
  } else {
    el.classList.remove('valid');
    const inputVal = document.getElementById(inputId).value;
    if (inputVal.length > 0) {
      el.classList.add('invalid');
    } else {
      el.classList.remove('invalid');
    }
    el.querySelector('.req-icon').textContent = '❌';
  }
}

function initPasswordValidation() {
  const passwordInput = document.getElementById('signupPassword');
  if (passwordInput) {
    passwordInput.addEventListener('input', () => {
      const password = passwordInput.value;
      const lengthValid = password.length >= 9 && password.length <= 10;
      const capitalValid = /[A-Z]/.test(password);
      const lowerValid = /[a-z]/.test(password);
      const specialValid = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password);
      const noSpaceValid = !/\s/.test(password);

      updateRequirementItem('reqLength', lengthValid, 'signupPassword');
      updateRequirementItem('reqCapital', capitalValid, 'signupPassword');
      updateRequirementItem('reqLower', lowerValid, 'signupPassword');
      updateRequirementItem('reqSpecial', specialValid, 'signupPassword');
      updateRequirementItem('reqNoSpace', noSpaceValid, 'signupPassword');
    });
  }

  const resetPasswordInput = document.getElementById('resetPassword');
  if (resetPasswordInput) {
    resetPasswordInput.addEventListener('input', () => {
      const password = resetPasswordInput.value;
      const lengthValid = password.length >= 9 && password.length <= 10;
      const capitalValid = /[A-Z]/.test(password);
      const lowerValid = /[a-z]/.test(password);
      const specialValid = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password);
      const noSpaceValid = !/\s/.test(password);

      updateRequirementItem('resetReqLength', lengthValid, 'resetPassword');
      updateRequirementItem('resetReqCapital', capitalValid, 'resetPassword');
      updateRequirementItem('resetReqLower', lowerValid, 'resetPassword');
      updateRequirementItem('resetReqSpecial', specialValid, 'resetPassword');
      updateRequirementItem('resetReqNoSpace', noSpaceValid, 'resetPassword');
    });
  }
}

// Check if already logged in and initialize validation
(function() {
  const email = sessionStorage.getItem('user_email');
  if (email) {
    window.location.href = '/dashboard.html';
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPasswordValidation);
  } else {
    initPasswordValidation();
  }
})();

