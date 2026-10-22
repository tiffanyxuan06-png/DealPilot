function renderAll() {
  if (typeof renderTopNumbers === 'function') renderTopNumbers();
  if (typeof renderWhatsAppView === 'function') renderWhatsAppView();
  if (typeof renderWebAppView === 'function') renderWebAppView();
  if (typeof renderApprovalsCard === 'function') renderApprovalsCard();
  if (typeof renderTeamPermissions === 'function') renderTeamPermissions();
  if (typeof renderOnboarding === 'function') renderOnboarding();
}

renderAll();
if (typeof syncFromBackend === 'function') {
  syncFromBackend();
}
