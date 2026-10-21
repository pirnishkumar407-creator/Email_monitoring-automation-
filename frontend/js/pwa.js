// frontend/js/pwa.js — PWA Service Worker Registration & Mobile Experience Controller

let deferredInstallPrompt = null;

// ── 1. Register Service Worker ──────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('[PWA] Service Worker registered with scope:', reg.scope);

        // Check for SW updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[PWA] New version available! Updating...');
              }
            });
          }
        });
      })
      .catch((err) => {
        console.warn('[PWA] Service Worker registration failed:', err);
      });
  });
}

// ── 2. Handle PWA Install Prompt (Add to Home Screen) ────────────────────────
window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome 67 and earlier from automatically showing the prompt
  e.preventDefault();
  // Stash the event so it can be triggered later
  deferredInstallPrompt = e;

  // Reveal PWA install buttons if present
  const installBanner = document.getElementById('pwaInstallBanner');
  if (installBanner) installBanner.style.display = 'flex';

  const installBtn = document.getElementById('pwaInstallBtn');
  if (installBtn) installBtn.style.display = 'inline-flex';
  
  const mobileInstallItem = document.getElementById('mobileInstallNav');
  if (mobileInstallItem) mobileInstallItem.style.display = 'flex';
});

async function triggerPwaInstall() {
  if (!deferredInstallPrompt) {
    if (typeof showToast === 'function') {
      showToast('ℹ To install this app, tap your browser menu (⋮ or Share) and select "Add to Home Screen"', 'info');
    } else {
      alert('To install this app, tap your browser menu and choose "Add to Home Screen" or "Install App".');
    }
    return;
  }
  // Show prompt
  deferredInstallPrompt.prompt();
  const choiceResult = await deferredInstallPrompt.userChoice;
  if (choiceResult.outcome === 'accepted') {
    console.log('[PWA] User accepted the install prompt');
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.style.display = 'none';
  }
  deferredInstallPrompt = null;
}

window.addEventListener('appinstalled', () => {
  console.log('[PWA] AI Email Automation was successfully installed!');
  if (typeof showToast === 'function') {
    showToast('🎉 AI Email Automation is now installed on your device!', 'success');
  }
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.style.display = 'none';
});

// ── 3. Offline / Online Connectivity Alerts ────────────────────────────────
window.addEventListener('online', () => {
  document.body.classList.remove('is-offline');
  if (typeof showToast === 'function') {
    showToast('🟢 Back online! Live inbox synchronization resumed.', 'success');
  }
});

window.addEventListener('offline', () => {
  document.body.classList.add('is-offline');
  if (typeof showToast === 'function') {
    showToast('⚠️ You are offline. Cached emails and local features remain active.', 'warning');
  }
});

// ── 4. Mobile Drawer (Sidebar) Toggle & Backdrop Handling ───────────────────
function toggleMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const hamburger = document.getElementById('hamburgerBtn');

  if (!sidebar) return;

  const isOpen = sidebar.classList.contains('mobile-open');
  if (isOpen) {
    closeMobileMenu();
  } else {
    sidebar.classList.add('mobile-open');
    if (backdrop) backdrop.classList.add('active');
    if (hamburger) hamburger.classList.add('active');
    document.body.style.overflow = 'hidden'; // Prevent background scroll
  }
}

function closeMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const hamburger = document.getElementById('hamburgerBtn');

  if (sidebar) sidebar.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.remove('active');
  if (hamburger) hamburger.classList.remove('active');
  document.body.style.overflow = '';
}

// Automatically close mobile menu when clicking any sidebar link on small screens
document.addEventListener('DOMContentLoaded', () => {
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        closeMobileMenu();
      }
    });
  });

  // Check if launched as installed PWA standalone app
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isStandalone) {
    document.body.classList.add('pwa-standalone');
    console.log('[PWA] Running in standalone PWA window');
  }
});
