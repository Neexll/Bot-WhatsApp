// Verifica se o WhatsApp Web está aberto em alguma aba
chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const btn = document.getElementById('btnOpen');

  if (tabs.length > 0) {
    statusEl.className = 'status ok';
    statusText.textContent = 'WhatsApp Web aberto - Painel ativo';
    btn.textContent = 'Ir para WhatsApp Web';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.update(tabs[0].id, { active: true });
      window.close();
    });
  } else {
    statusEl.className = 'status off';
    statusText.textContent = 'WhatsApp Web não está aberto';
  }
});
