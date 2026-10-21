function renderAll() {
      renderTopNumbers();
      renderWhatsAppView();
      renderWebAppView();
      renderApprovalsCard();
      renderTeamPermissions();
    }

    renderAll();
    syncFromBackend();
