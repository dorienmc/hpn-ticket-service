export async function initAdminAccessPage(root: HTMLElement, baseUrl: string, canManageAdminEmails: boolean): Promise<void> {
  if (!canManageAdminEmails) {
    root.innerHTML = '<p class="error-message" role="alert">Alleen de eigenaar ingelogd met Google kan beheerderstoegang beheren.</p>';
    return;
  }

  root.innerHTML = `
    <section id="admin-access" class="payment-box muted-box">
      <p>De eigenaar blijft altijd toegang houden. Verwijderde beheerders verliezen direct toegang.</p>
      <form id="admin-access-form" class="form">
        <label>
          Toegestane Google e-mailadressen (een per regel)
          <textarea id="admin-access-emails" rows="5" required></textarea>
        </label>
        <button id="admin-access-save" type="submit" disabled>Toegang opslaan</button>
      </form>
      <p id="admin-access-status" class="status" aria-live="polite"></p>
    </section>
    <section id="admin-config" class="payment-box muted-box">
      <h2>Configuratie</h2>
      <p>Huidige API-configuratie (alleen lezen).</p>
      <dl class="config-list" id="admin-config-values"></dl>
      <p id="admin-config-status" class="status" aria-live="polite">Configuratie laden...</p>
    </section>
  `;

  const form = root.querySelector<HTMLFormElement>('#admin-access-form')!;
  const emails = root.querySelector<HTMLTextAreaElement>('#admin-access-emails')!;
  const save = root.querySelector<HTMLButtonElement>('#admin-access-save')!;
  const status = root.querySelector<HTMLParagraphElement>('#admin-access-status')!;

  try {
    const response = await fetch(`${baseUrl}/api/admin/access`, { credentials: 'include' });
    const payload: { emails?: string[]; error?: string } = await response.json();
    if (!response.ok || !payload.emails) {
      throw new Error(payload.error ?? 'Beheerderstoegang kon niet worden geladen.');
    }
    emails.value = payload.emails.join('\n');
    save.disabled = false;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Beheerderstoegang kon niet worden geladen.';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    status.textContent = '';
    try {
      const response = await fetch(`${baseUrl}/api/admin/access`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: emails.value.split('\n').map((email) => email.trim()).filter(Boolean) }),
      });
      const payload: { emails?: string[]; error?: string } = await response.json();
      if (!response.ok || !payload.emails) {
        throw new Error(payload.error ?? 'Beheerderstoegang kon niet worden opgeslagen.');
      }
      emails.value = payload.emails.join('\n');
      status.textContent = 'Beheerderstoegang opgeslagen.';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Beheerderstoegang kon niet worden opgeslagen.';
    } finally {
      save.disabled = false;
    }
  });

  const configStatus = root.querySelector<HTMLParagraphElement>('#admin-config-status')!;
  const configValues = root.querySelector<HTMLDListElement>('#admin-config-values')!;
  const configKeys = [
    'GOOGLE_CLIENT_ID', 'GOOGLE_AUTH_CLIENT_ID',
    'ING_PAYMENT_LINK_1', 'ING_PAYMENT_LINK_2', 'ING_PAYMENT_LINK_3',
    'ING_PAYMENT_LINK_4', 'ING_PAYMENT_LINK_5',
  ] as const;
  try {
    const response = await fetch(`${baseUrl}/api/admin/access/config`, { credentials: 'include', cache: 'no-store' });
    const payload: Partial<Record<typeof configKeys[number], string | null>> & { error?: string } = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'Configuratie kon niet worden geladen.');
    for (const key of configKeys) {
      if (payload[key] !== null && typeof payload[key] !== 'string') {
        throw new Error('Ongeldige configuratie ontvangen.');
      }
    }
    for (const key of configKeys) {
      const row = document.createElement('div');
      const label = document.createElement('dt');
      const value = document.createElement('dd');
      label.textContent = key;
      value.textContent = payload[key] ?? 'Niet ingesteld';
      row.append(label, value);
      configValues.append(row);
    }
    configStatus.textContent = '';
  } catch (error) {
    configStatus.textContent = error instanceof Error ? error.message : 'Configuratie kon niet worden geladen.';
  }
}
