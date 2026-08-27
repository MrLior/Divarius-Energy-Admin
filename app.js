/* global supabase, DIVARIUS_CONFIG */
(function () {
  'use strict';

  var config = window.DIVARIUS_CONFIG || {};
  var message = document.getElementById('global-message');
  var views = ['view-loading', 'view-login', 'view-mfa-enroll', 'view-mfa-challenge', 'view-dashboard'];
  var state = {
    client: null,
    enrollment: null,
    factorId: null,
    licenses: new Map(),
    licenseList: [],
    settings: { renewal_url: '' }
  };

  function showView(id) {
    views.forEach(function (viewId) {
      document.getElementById(viewId).hidden = viewId !== id;
    });
  }

  function showError(text) {
    message.textContent = text || 'אירעה שגיאה. נסה שוב.';
    message.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearError() {
    message.textContent = '';
    message.hidden = true;
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = label || 'מעבד…';
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalLabel || button.textContent;
      button.disabled = false;
    }
  }

  async function copyText(value) {
    var text = String(value || '');
    if (!text) return false;

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        // Some browsers copy the value but still reject the Clipboard promise.
        // Fall back to the older selection-based copy method before reporting
        // an error to the administrator.
      }
    }

    var textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.setAttribute('aria-hidden', 'true');
    textArea.style.position = 'fixed';
    textArea.style.top = '-1000px';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, text.length);

    var copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (_) {
      copied = false;
    } finally {
      document.body.removeChild(textArea);
    }
    return copied;
  }

  function showCopied(button) {
    clearError();
    button.textContent = 'הועתק';
    window.setTimeout(function () { button.textContent = 'העתק'; }, 1500);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function localDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function formatPrice(value) {
    if (value === null || value === undefined || value === '') return '—';
    var price = Number(value);
    if (!Number.isFinite(price)) return '—';
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(price);
  }

  function dateInputValue(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    var offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function endOfLocalDay(dateValue) {
    if (!dateValue) return null;
    var date = new Date(dateValue + 'T23:59:59');
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  async function api(action, payload, noAuth) {
    clearError();
    var headers = {
      'Content-Type': 'application/json',
      apikey: config.publishableKey
    };
    if (!noAuth) {
      var sessionResponse = await state.client.auth.getSession();
      if (sessionResponse.data && sessionResponse.data.session) {
        headers.Authorization = 'Bearer ' + sessionResponse.data.session.access_token;
      }
    }
    var response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    });
    var body = {};
    try { body = await response.json(); } catch (_) {}
    if (!response.ok || body.ok === false) {
      var error = new Error(body.message || 'הבקשה נכשלה.');
      error.code = body.code;
      throw error;
    }
    return body;
  }

  async function start() {
    if (!window.supabase || !config.supabaseUrl || !config.publishableKey || !config.apiUrl) {
      showError('חסרה הגדרה של Supabase בפורטל.');
      showView('view-login');
      return;
    }
    state.client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'divarius-energy-admin-session-v1'
      }
    });
    var result = await state.client.auth.getSession();
    if (result.data && result.data.session) {
      await decideMfa();
    } else {
      showView('view-login');
    }
  }

  async function decideMfa() {
    try {
      var assurance = await state.client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error) throw assurance.error;
      if (assurance.data.currentLevel === 'aal2') {
        await loadDashboard();
        return;
      }
      var factorsResult = await state.client.auth.mfa.listFactors();
      if (factorsResult.error) throw factorsResult.error;
      var factors = (factorsResult.data && factorsResult.data.totp) || [];
      var verified = factors.find(function (factor) { return factor.status === 'verified'; });
      if (verified) {
        state.factorId = verified.id;
        showView('view-mfa-challenge');
      } else {
        await prepareEnrollment();
      }
    } catch (error) {
      showError(error.message || 'לא ניתן לבדוק את האימות הדו־שלבי.');
      await signOut();
    }
  }

  async function prepareEnrollment() {
    try {
      var enrollment = await state.client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Divarius Energy Admin'
      });
      if (enrollment.error) throw enrollment.error;
      state.enrollment = enrollment.data;
      state.factorId = enrollment.data.id;
      document.getElementById('mfa-qr').src = enrollment.data.totp.qr_code;
      document.getElementById('mfa-secret').textContent = enrollment.data.totp.secret;
      showView('view-mfa-enroll');
    } catch (error) {
      showError(error.message || 'לא ניתן ליצור קוד להגדרת אימות דו־שלבי.');
      await signOut();
    }
  }

  async function verifyMfa(code) {
    if (!/^\d{6}$/.test(code)) throw new Error('יש להזין קוד בן 6 ספרות.');
    var challenge = await state.client.auth.mfa.challenge({ factorId: state.factorId });
    if (challenge.error) throw challenge.error;
    var verification = await state.client.auth.mfa.verify({
      factorId: state.factorId,
      challengeId: challenge.data.id,
      code: code
    });
    if (verification.error) throw verification.error;
    var refresh = await state.client.auth.refreshSession();
    if (refresh.error) throw refresh.error;
  }

  async function loadDashboard() {
    try {
      showView('view-loading');
      var data = await api('admin_bootstrap');
      state.settings = data.settings || { renewal_url: '' };
      state.licenseList = data.licenses || [];
      state.licenses = new Map(state.licenseList.map(function (license) { return [license.id, license]; }));
      document.getElementById('admin-welcome').textContent = 'מחובר כ־' + (data.admin.display_name || data.admin.username || 'מנהל');
      document.getElementById('renewal-url').value = state.settings.renewal_url || '';
      document.getElementById('license-search-query').value = '';
      document.getElementById('license-search-date').value = '';
      document.getElementById('search-results-summary').hidden = true;
      renderStats(state.licenseList);
      renderLicenses(state.licenseList, false);
      renderAudit(data.events || []);
      showView('view-dashboard');
    } catch (error) {
      if (error.code === 'mfa_required') {
        await decideMfa();
        return;
      }
      showError(error.message || 'לא ניתן לטעון את נתוני הניהול.');
      showView('view-login');
    }
  }

  function renderStats(licenses) {
    var total = licenses.length;
    var active = licenses.filter(function (license) { return license.effective_status === 'active'; }).length;
    var expired = licenses.filter(function (license) { return license.effective_status === 'expired'; }).length;
    var devices = licenses.filter(function (license) { return license.device_active; }).length;
    document.getElementById('license-stats').innerHTML = [
      ['סה״כ רישיונות', total],
      ['פעילים', active],
      ['פגי תוקף', expired],
      ['מכשירים מחוברים', devices]
    ].map(function (item) {
      return '<div class="stat"><strong>' + item[1] + '</strong><span>' + item[0] + '</span></div>';
    }).join('');
  }

  function statusLabel(status) {
    if (status === 'active') return 'פעיל';
    if (status === 'expired') return 'פג תוקף';
    return 'מושבת';
  }

  function renderLicenses(licenses, searchActive) {
    var body = document.getElementById('licenses-body');
    var empty = document.getElementById('licenses-empty');
    empty.hidden = licenses.length !== 0;
    empty.textContent = searchActive ? 'לא נמצאו רישיונות שמתאימים לחיפוש.' : 'עדיין לא נוצרו מפתחות.';
    body.innerHTML = licenses.map(function (license) {
      var device = license.device_active
        ? '<span class="device-active">מחובר</span>'
        : '<span class="device-none">לא מחובר</span>';
      var reveal = license.key_revealable
        ? '<button class="button ghost row-button reveal-button" type="button" data-reveal-license="' + escapeHtml(license.id) + '">הצג מלא</button>'
        : '<button class="button ghost row-button" type="button" data-store-existing-key="' + escapeHtml(license.id) + '">שמור מפתח קיים</button>' +
          '<span class="key-unavailable">אם העותק המלא אבד, יש להחליף את המפתח</span>';
      return '<tr>' +
        '<td>' + escapeHtml(license.label || '—') + '</td>' +
        '<td><div class="key-cell"><code class="license-hint">' + escapeHtml(license.key_hint || '—') + '</code>' + reveal + '</div></td>' +
        '<td><span class="badge ' + escapeHtml(license.effective_status) + '">' + statusLabel(license.effective_status) + '</span></td>' +
        '<td>' + escapeHtml(localDate(license.expires_at)) + '</td>' +
        '<td>' + escapeHtml(license.bound_email || '—') + '</td>' +
        '<td dir="ltr">' + escapeHtml(license.phone || '—') + '</td>' +
        '<td>' + escapeHtml(formatPrice(license.price)) + '</td>' +
        '<td>' + device + '</td>' +
        '<td><button class="button ghost row-button" type="button" data-edit-license="' + escapeHtml(license.id) + '">ניהול</button></td>' +
      '</tr>';
    }).join('');
  }

  function renderAudit(events) {
    var list = document.getElementById('audit-list');
    var empty = document.getElementById('audit-empty');
    empty.hidden = events.length !== 0;
    list.innerHTML = events.map(function (event) {
      return '<li><span>' + escapeHtml(event.message || event.event_type) + '</span><time>' + escapeHtml(localDate(event.created_at)) + '</time></li>';
    }).join('');
  }

  function showNewKey(key) {
    document.getElementById('new-key-value').textContent = key;
    document.getElementById('new-key-dialog').showModal();
  }

  function showRevealedKey(key, license) {
    document.getElementById('revealed-key-title').textContent = license && license.label
      ? 'המפתח של ' + license.label
      : 'המפתח המלא';
    document.getElementById('revealed-key-value').textContent = key;
    document.getElementById('reveal-key-dialog').showModal();
  }

  function clearLicenseSearch() {
    document.getElementById('license-search-query').value = '';
    document.getElementById('license-search-date').value = '';
    document.getElementById('search-results-summary').hidden = true;
    renderLicenses(state.licenseList, false);
  }

  function openStoreExistingKey(licenseId) {
    var license = state.licenses.get(licenseId);
    if (!license) return;
    document.getElementById('store-key-license-id').value = license.id;
    document.getElementById('store-key-license-name').textContent = license.label || license.key_hint || 'הרישיון';
    document.getElementById('store-existing-key-value').value = '';
    document.getElementById('store-key-dialog').showModal();
  }

  function openEdit(licenseId) {
    var license = state.licenses.get(licenseId);
    if (!license) return;
    document.getElementById('edit-license-id').value = license.id;
    document.getElementById('edit-license-title').textContent = license.label || license.key_hint || 'עריכת רישיון';
    document.getElementById('edit-license-label').value = license.label || '';
    document.getElementById('edit-license-phone').value = license.phone || '';
    document.getElementById('edit-license-price').value = license.price == null ? '' : license.price;
    document.getElementById('edit-license-expiry').value = dateInputValue(license.expires_at);
    document.getElementById('edit-license-status').value = license.status === 'disabled' ? 'disabled' : 'active';
    document.getElementById('edit-disconnect').disabled = !license.device_active;
    document.getElementById('edit-license-dialog').showModal();
  }

  async function signOut() {
    if (state.client) await state.client.auth.signOut();
    state.enrollment = null;
    state.factorId = null;
    state.licenses.clear();
    state.licenseList = [];
    document.getElementById('revealed-key-value').textContent = '';
    showView('view-login');
  }

  document.getElementById('login-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = event.submitter;
    try {
      setBusy(button, true, 'נכנס…');
      var username = document.getElementById('login-username').value.trim();
      var password = document.getElementById('login-password').value;
      var response = await api('admin_login', { username: username, password: password }, true);
      var session = response.session;
      var setSession = await state.client.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token
      });
      if (setSession.error) throw setSession.error;
      document.getElementById('login-password').value = '';
      await decideMfa();
    } catch (error) {
      showError(error.message || 'לא ניתן להתחבר.');
    } finally {
      setBusy(button, false);
    }
  });

  document.getElementById('mfa-enroll-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = event.submitter;
    try {
      setBusy(button, true, 'מאמת…');
      await verifyMfa(document.getElementById('mfa-enroll-code').value.trim());
      document.getElementById('mfa-enroll-code').value = '';
      await loadDashboard();
    } catch (error) {
      showError(error.message || 'קוד האימות אינו תקין.');
    } finally {
      setBusy(button, false);
    }
  });

  document.getElementById('mfa-challenge-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = event.submitter;
    try {
      setBusy(button, true, 'מאמת…');
      await verifyMfa(document.getElementById('mfa-challenge-code').value.trim());
      document.getElementById('mfa-challenge-code').value = '';
      await loadDashboard();
    } catch (error) {
      showError(error.message || 'קוד האימות אינו תקין.');
    } finally {
      setBusy(button, false);
    }
  });

  document.getElementById('license-create-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = event.submitter;
    try {
      var expiresAt = endOfLocalDay(document.getElementById('new-license-expiry').value);
      if (!expiresAt) throw new Error('יש לבחור תאריך תוקף.');
      setBusy(button, true, 'יוצר…');
      var response = await api('admin_create_license', {
        label: document.getElementById('new-license-label').value.trim(),
        phone: document.getElementById('new-license-phone').value.trim(),
        price: document.getElementById('new-license-price').value,
        expires_at: expiresAt
      });
      event.target.reset();
      showNewKey(response.license_key);
      await loadDashboard();
    } catch (error) {
      showError(error.message || 'לא ניתן ליצור מפתח.');
    } finally {
      setBusy(button, false);
    }
  });

  document.getElementById('settings-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = event.submitter;
    try {
      setBusy(button, true, 'שומר…');
      await api('admin_update_settings', { renewal_url: document.getElementById('renewal-url').value.trim() });
      await loadDashboard();
    } catch (error) {
      showError(error.message || 'לא ניתן לשמור את הקישור.');
    } finally {
      setBusy(button, false);
    }
  });

  document.getElementById('refresh-button').addEventListener('click', loadDashboard);

  document.getElementById('license-search-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = event.submitter || document.getElementById('license-search-button');
    var query = document.getElementById('license-search-query').value.trim();
    var date = document.getElementById('license-search-date').value;
    if (!query && !date) {
      clearLicenseSearch();
      return;
    }
    try {
      setBusy(button, true, 'מחפש…');
      var response = await api('admin_search_licenses', { query: query, date: date });
      var matches = new Set(response.license_ids || []);
      var filtered = state.licenseList.filter(function (license) { return matches.has(license.id); });
      var summary = document.getElementById('search-results-summary');
      summary.textContent = 'נמצאו ' + filtered.length + ' מתוך ' + state.licenseList.length + ' רישיונות';
      summary.hidden = false;
      renderLicenses(filtered, true);
    } catch (error) {
      showError(error.message || 'לא ניתן לבצע את החיפוש.');
    } finally {
      setBusy(button, false);
    }
  });

  document.getElementById('clear-license-search').addEventListener('click', clearLicenseSearch);

  document.getElementById('licenses-body').addEventListener('click', async function (event) {
    var storeButton = event.target.closest('[data-store-existing-key]');
    if (storeButton) {
      openStoreExistingKey(storeButton.dataset.storeExistingKey);
      return;
    }
    var revealButton = event.target.closest('[data-reveal-license]');
    if (revealButton) {
      var licenseId = revealButton.dataset.revealLicense;
      try {
        setBusy(revealButton, true, 'פותח…');
        var response = await api('admin_reveal_license_key', { license_id: licenseId });
        showRevealedKey(response.license_key, state.licenses.get(licenseId));
      } catch (error) {
        showError(error.message || 'לא ניתן להציג את המפתח.');
      } finally {
        setBusy(revealButton, false);
      }
      return;
    }
    var editButton = event.target.closest('[data-edit-license]');
    if (editButton) openEdit(editButton.dataset.editLicense);
  });

  document.getElementById('license-edit-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    if (event.submitter && event.submitter.value !== 'save') return;
    var button = event.submitter;
    try {
      var expiresAt = endOfLocalDay(document.getElementById('edit-license-expiry').value);
      if (!expiresAt) throw new Error('יש לבחור תאריך תוקף.');
      setBusy(button, true, 'שומר…');
      await api('admin_update_license', {
        license_id: document.getElementById('edit-license-id').value,
        label: document.getElementById('edit-license-label').value.trim(),
        phone: document.getElementById('edit-license-phone').value.trim(),
        price: document.getElementById('edit-license-price').value,
        expires_at: expiresAt,
        status: document.getElementById('edit-license-status').value
      });
      document.getElementById('edit-license-dialog').close();
      await loadDashboard();
    } catch (error) {
      showError(error.message || 'לא ניתן לעדכן את הרישיון.');
    } finally {
      setBusy(button, false);
    }
  });

  document.getElementById('store-existing-key-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    if (event.submitter && event.submitter.value !== 'save') {
      document.getElementById('store-key-dialog').close();
      return;
    }
    var button = event.submitter;
    var valueInput = document.getElementById('store-existing-key-value');
    try {
      setBusy(button, true, 'בודק ושומר…');
      await api('admin_store_existing_license_key', {
        license_id: document.getElementById('store-key-license-id').value,
        license_key: valueInput.value.trim()
      });
      valueInput.value = '';
      document.getElementById('store-key-dialog').close();
      await loadDashboard();
    } catch (error) {
      showError(error.message || 'לא ניתן לשמור את המפתח הקיים.');
    } finally {
      setBusy(button, false);
    }
  });

  document.getElementById('edit-disconnect').addEventListener('click', async function (event) {
    var licenseId = document.getElementById('edit-license-id').value;
    if (!window.confirm('לנתק את המכשיר הפעיל? האימייל יישאר משויך לרישיון.')) return;
    try {
      setBusy(event.currentTarget, true, 'מנתק…');
      await api('admin_disconnect_device', { license_id: licenseId });
      document.getElementById('edit-license-dialog').close();
      await loadDashboard();
    } catch (error) {
      showError(error.message || 'לא ניתן לנתק את המכשיר.');
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  document.getElementById('edit-reset-key').addEventListener('click', async function (event) {
    var licenseId = document.getElementById('edit-license-id').value;
    if (!window.confirm('להחליף מפתח? הפעולה מנתקת את המכשיר ומבטלת גם את שיוך האימייל הקודם.')) return;
    try {
      setBusy(event.currentTarget, true, 'מחליף…');
      var response = await api('admin_reset_license_key', { license_id: licenseId });
      document.getElementById('edit-license-dialog').close();
      showNewKey(response.license_key);
      await loadDashboard();
    } catch (error) {
      showError(error.message || 'לא ניתן להחליף את המפתח.');
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  document.getElementById('edit-delete-license').addEventListener('click', async function (event) {
    var licenseId = document.getElementById('edit-license-id').value;
    if (!window.confirm('למחוק את הרישיון לצמיתות? פעולה זו אינה ניתנת לשחזור.')) return;
    try {
      setBusy(event.currentTarget, true, 'מוחק…');
      await api('admin_delete_license', { license_id: licenseId });
      document.getElementById('edit-license-dialog').close();
      await loadDashboard();
    } catch (error) {
      showError(error.message || 'לא ניתן למחוק את הרישיון.');
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  document.getElementById('copy-new-key').addEventListener('click', async function (event) {
    var copied = await copyText(document.getElementById('new-key-value').textContent);
    if (copied) {
      showCopied(event.currentTarget);
    } else {
      showError('לא ניתן להעתיק אוטומטית. סמן את המפתח והעתק ידנית.');
    }
  });

  document.getElementById('copy-revealed-key').addEventListener('click', async function (event) {
    var copied = await copyText(document.getElementById('revealed-key-value').textContent);
    if (copied) {
      showCopied(event.currentTarget);
    } else {
      showError('לא ניתן להעתיק אוטומטית. סמן את המפתח והעתק ידנית.');
    }
  });

  document.getElementById('reveal-key-dialog').addEventListener('close', function () {
    document.getElementById('revealed-key-value').textContent = '';
  });

  document.getElementById('store-key-dialog').addEventListener('close', function () {
    document.getElementById('store-existing-key-value').value = '';
  });

  document.querySelectorAll('[data-signout]').forEach(function (button) {
    button.addEventListener('click', signOut);
  });

  start().catch(function (error) {
    showError(error.message || 'לא ניתן להפעיל את מערכת הניהול.');
    showView('view-login');
  });
})();
